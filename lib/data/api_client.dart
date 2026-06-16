import 'dart:async';
import 'dart:io' show Platform;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 远程后端 API 客户端（基于 Dio）
///
/// 自动管理 baseUrl（延迟加载）、JWT token 注入、统一错误处理（429 限流提示）。
///
/// 初始化流程：
/// 1. 构造时 baseUrl 为空，首次请求时通过 [_ensureBaseUrl] 延迟加载
/// 2. Provider 层通过微任务异步解析后端地址、获取 bootstrap token
/// 3. 完成后调用 [completeInit] 通知所有等待 [initReady] 的依赖方
class ApiClient {
  ApiClient({String? baseUrl}) : _dio = Dio() {
    _dio.options.connectTimeout = const Duration(seconds: 30);
    _dio.options.receiveTimeout = const Duration(seconds: 30);
    _dio.options.sendTimeout = const Duration(seconds: 30);
    _dio.options.responseType = ResponseType.json;
    _setupInterceptors();
  }

  /// 默认后端地址（桌面端为 127.0.0.1:3000）
  static String _defaultBaseUrl = 'http://127.0.0.1:3000';

  static String get defaultBaseUrl => _defaultBaseUrl;

  static void setDefaultBaseUrl(String value) {
    _defaultBaseUrl = value;
  }

  /// 在 Android 上自动探测后端地址（模拟器用 10.0.2.2 连宿主机，真机用 127.0.0.1 连 proot）
  static Future<String> resolveBackendUrl() async {
    if (!Platform.isAndroid) return defaultBaseUrl;
    // 先快速试 127.0.0.1（真机 proot 后端）
    if (await _probeUrl(defaultBaseUrl)) return defaultBaseUrl;
    // 失败则试 10.0.2.2（模拟器连宿主机）
    const emulatorUrl = 'http://10.0.2.2:3000';
    if (await _probeUrl(emulatorUrl)) return emulatorUrl;
    return defaultBaseUrl;
  }

  static Future<bool> _probeUrl(String base) async {
    try {
      final probe = Dio(
        BaseOptions(
          connectTimeout: const Duration(milliseconds: 500),
          receiveTimeout: const Duration(milliseconds: 500),
          validateStatus: (s) => s != null && s < 400,
        ),
      );
      await probe.get<dynamic>('$base/health');
      return true;
    } catch (_) {
      return false;
    }
  }

  final Dio _dio;

  /// SharedPreferences 缓存（延迟初始化）
  SharedPreferences? _prefs;

  /// 安全存储（用于持久化 JWT token）
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();

  /// 当前 JWT token
  String? _token;

  /// 是否正在刷新 token（防止并发刷新）
  bool _isRefreshing = false;

  /// Token 过期回调（通知上层清除认证状态）
  VoidCallback? onTokenExpired;

  /// 异步初始化就绪信号（base URL 解析 + bootstrap token 完成后 resolve）
  final Completer<void> _initReady = Completer<void>();

  /// 等待异步初始化完成（base URL + token 就绪）
  Future<void> get initReady => _initReady.future;

  /// 标记初始化完成（由 Provider 的 Future.microtask 调用）
  void completeInit() {
    if (!_initReady.isCompleted) _initReady.complete();
  }

  /// 当前基础地址（尚未加载时返回默认值）
  String get baseUrl {
    if (_dio.options.baseUrl.isEmpty) {
      return defaultBaseUrl;
    }
    return _dio.options.baseUrl;
  }

  /// WebSocket 基础地址（http→ws, https→wss）
  String get wsBaseUrl => baseUrl
      .replaceFirst('http://', 'ws://')
      .replaceFirst('https://', 'wss://');

  /// 当前认证令牌
  String? get currentToken => _token;

  /// token 是否已就绪
  bool get hasToken => _token != null && _token!.isNotEmpty;

  /// 从 SharedPreferences 加载 baseUrl 和安全存储中的 token
  Future<void> _loadBaseUrl() async {
    _prefs ??= await SharedPreferences.getInstance();
    final savedUrl = _prefs!.getString('backend_url');
    _dio.options.baseUrl = (savedUrl != null && savedUrl.isNotEmpty)
        ? savedUrl
        : defaultBaseUrl;
    _token = await _secureStorage.read(key: 'auth_token');
  }

  /// 动态更新后端地址
  Future<void> setBaseUrl(String url) async {
    _prefs ??= await SharedPreferences.getInstance();
    await _prefs!.setString('backend_url', url);
    _dio.options.baseUrl = url;
  }

  /// 设置认证令牌
  Future<void> setToken(String? token) async {
    _token = token;
    if (token != null) {
      await _secureStorage.write(key: 'auth_token', value: token);
    } else {
      await _secureStorage.delete(key: 'auth_token');
    }
  }

  /// 设置请求/响应拦截器：自动注入 JWT token、日志、429 限流处理、401 自动刷新
  void _setupInterceptors() {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (_token != null && _token!.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $_token';
          }
          debugPrint('【API请求】${options.method} ${options.path}');
          handler.next(options);
        },
        onResponse: (response, handler) {
          debugPrint(
            '【API响应】${response.statusCode} ${response.requestOptions.path}',
          );
          handler.next(response);
        },
        onError: (DioException e, handler) async {
          final statusCode = e.response?.statusCode;
          final path = e.requestOptions.path;
          debugPrint('【API错误】$statusCode $path: ${e.message}');

          if (statusCode == 429) {
            final data = e.response?.data;
            String msg = '请求速率已达上限，请稍后重试';
            if (data is Map && data['error'] is String) {
              msg = data['error'] as String;
            }
            handler.reject(
              DioException(
                requestOptions: e.requestOptions,
                error: msg,
                type: DioExceptionType.badResponse,
                response: e.response,
              ),
            );
            return;
          }

          // 401 自动刷新 token：尝试 refresh，成功则重试原请求
          if (statusCode == 401 && !_isRefreshing && path != '/auth/refresh') {
            _isRefreshing = true;
            try {
              final refreshed = await _tryRefreshToken();
              if (refreshed) {
                // 用新 token 重试原请求
                final retryResponse = await _retryRequest(e.requestOptions);
                handler.resolve(retryResponse);
                return;
              }
            } catch (_) {
              // refresh 失败，继续走下面的 token 清除逻辑
            } finally {
              _isRefreshing = false;
            }
            // 刷新失败：清除 token，通知上层
            debugPrint('【API】Token 刷新失败，清除认证状态');
            await setToken(null);
            onTokenExpired?.call();
          }

          handler.next(e);
        },
      ),
    );
  }

  /// 尝试刷新 JWT token
  Future<bool> _tryRefreshToken() async {
    if (_token == null || _token!.isEmpty) return false;
    try {
      final refreshDio = Dio(BaseOptions(
        baseUrl: _dio.options.baseUrl,
        connectTimeout: _dio.options.connectTimeout,
        receiveTimeout: _dio.options.receiveTimeout,
      ));
      final response = await refreshDio.post<Map>(
        '/auth/refresh',
        options: Options(headers: {'Authorization': 'Bearer $_token'}),
      );
      if (response.statusCode == 200 && response.data is Map) {
        final data = response.data as Map;
        final newToken = data['token'] as String?;
        if (newToken != null && newToken.isNotEmpty) {
          await setToken(newToken);
          debugPrint('【API】Token 刷新成功');
          return true;
        }
      }
    } catch (e) {
      debugPrint('【API】Token 刷新请求失败: $e');
    }
    return false;
  }

  /// 用当前 token 重试失败的请求
  Future<Response<dynamic>> _retryRequest(RequestOptions options) {
    final retryDio = Dio()
      ..options.baseUrl = _dio.options.baseUrl
      ..options.connectTimeout = _dio.options.connectTimeout
      ..options.receiveTimeout = _dio.options.receiveTimeout
      ..options.responseType = _dio.options.responseType;

    if (_token != null && _token!.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $_token';
    }

    return retryDio.fetch(options);
  }

  /// GET 请求
  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
  }) async {
    await _ensureBaseUrl();
    final response = await _dio.get<dynamic>(
      path,
      queryParameters: queryParameters,
    );
    return response.data;
  }

  /// POST 请求，[receiveTimeout] 可覆盖默认超时（如压缩操作需 5 分钟）
  Future<dynamic> post(
    String path, {
    dynamic data,
    Duration? receiveTimeout,
  }) async {
    await _ensureBaseUrl();
    final options = receiveTimeout != null
        ? Options(receiveTimeout: receiveTimeout)
        : null;
    final response = await _dio.post<dynamic>(
      path,
      data: data,
      options: options,
    );
    return response.data;
  }

  /// 快速健康检查（使用独立短超时 Dio，避免触发拦截器日志）
  Future<bool> healthCheckFast() async {
    try {
      final checkDio = Dio(
        BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 2),
          receiveTimeout: const Duration(seconds: 2),
          validateStatus: (status) => status != null && status < 400,
        ),
      );
      await checkDio.get<dynamic>('/health');
      return true;
    } catch (_) {
      return false;
    }
  }

  /// PUT 请求
  Future<dynamic> put(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) async {
    await _ensureBaseUrl();
    final response = await _dio.put<dynamic>(
      path,
      data: data,
      queryParameters: queryParameters,
    );
    return response.data;
  }

  /// PATCH 请求
  Future<dynamic> patch(String path, {dynamic data}) async {
    await _ensureBaseUrl();
    final response = await _dio.patch<dynamic>(path, data: data);
    return response.data;
  }

  /// DELETE 请求
  Future<dynamic> delete(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
  }) async {
    await _ensureBaseUrl();
    final response = await _dio.delete<dynamic>(
      path,
      data: data,
      queryParameters: queryParameters,
    );
    return response.data;
  }

  /// 下载原始字节（用于文件预览/导入）
  Future<List<int>> downloadRaw(String path) async {
    await _ensureBaseUrl();
    final response = await _dio.get<List<int>>(
      path,
      options: Options(responseType: ResponseType.bytes),
    );
    return response.data as List<int>;
  }

  /// 上传原始字节（用作文件内容预览、导入合并）
  Future<dynamic> uploadRaw(String path, List<int> bytes) async {
    await _ensureBaseUrl();
    final response = await _dio.post<dynamic>(
      path,
      data: bytes,
      options: Options(
        contentType: 'application/octet-stream',
        responseType: ResponseType.json,
      ),
    );
    return response.data;
  }

  /// 确保 baseUrl 已加载（延迟初始化，首次请求时触发）
  ///
  /// 使用 [_loadBaseUrlFuture] 缓存确保并发调用时只执行一次加载，
  /// 避免多个请求同时触发 _loadBaseUrl 导致竞态条件。
  Future<void>? _loadBaseUrlFuture;

  Future<void> _ensureBaseUrl() async {
    if (_dio.options.baseUrl.isNotEmpty) return;
    _loadBaseUrlFuture ??= _loadBaseUrlSafe();
    await _loadBaseUrlFuture;
  }

  /// 安全加载 baseUrl，失败时延迟 500ms 重试一次
  Future<void> _loadBaseUrlSafe() async {
    try {
      await _loadBaseUrl();
    } catch (_) {
      await Future<void>.delayed(const Duration(milliseconds: 500));
      try {
        await _loadBaseUrl();
      } catch (e) {
        debugPrint('[ApiClient] baseUrl load failed after retry: $e');
      }
    }
  }
}
