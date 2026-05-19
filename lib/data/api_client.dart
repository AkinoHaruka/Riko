import 'dart:async';
import 'dart:io' show Platform;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 远程后端 API 客户端（基于 Dio）
///
/// 自动管理 baseUrl（延迟加载）、JWT token 注入、统一错误处理（429 限流提示）。
class ApiClient {
  ApiClient({String? baseUrl}) : _dio = Dio() {
    _dio.options.connectTimeout = const Duration(seconds: 30);
    _dio.options.receiveTimeout = const Duration(seconds: 30);
    _dio.options.sendTimeout = const Duration(seconds: 30);
    _dio.options.responseType = ResponseType.json;
    _setupInterceptors();
  }

  static String defaultBaseUrl = 'http://127.0.0.1:3000';

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
      final probe = Dio(BaseOptions(
        connectTimeout: const Duration(milliseconds: 500),
        receiveTimeout: const Duration(milliseconds: 500),
        validateStatus: (s) => s != null && s < 400,
      ));
      await probe.get<dynamic>('$base/health');
      return true;
    } catch (_) {
      return false;
    }
  }

  final Dio _dio;

  SharedPreferences? _prefs;
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();
  String? _token;

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
        onError: (DioException e, handler) {
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

          handler.next(e);
        },
      ),
    );
  }

  Future<dynamic> get(
    String path, {
    Map<String, dynamic>? queryParameters,
  }) async {
    await _ensureBaseUrl();
    final response = await _dio.get<dynamic>(path, queryParameters: queryParameters);
    return response.data;
  }

  Future<dynamic> post(
    String path, {
    dynamic data,
    Duration? receiveTimeout,
  }) async {
    await _ensureBaseUrl();
    final options = receiveTimeout != null
        ? Options(receiveTimeout: receiveTimeout)
        : null;
    final response = await _dio.post<dynamic>(path, data: data, options: options);
    return response.data;
  }

  /// 快速健康检查（使用独立短超时 Dio，避免触发拦截器日志）
  Future<bool> healthCheckFast() async {
    try {
      final checkDio = Dio(BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 2),
        receiveTimeout: const Duration(seconds: 2),
        validateStatus: (status) => status != null && status < 400,
      ));
      await checkDio.get<dynamic>('/health');
      return true;
    } catch (_) {
      return false;
    }
  }

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

  Future<dynamic> patch(String path, {dynamic data}) async {
    await _ensureBaseUrl();
    final response = await _dio.patch<dynamic>(path, data: data);
    return response.data;
  }

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

  Future<void> _ensureBaseUrl() async {
    if (_dio.options.baseUrl.isEmpty) {
      await _loadBaseUrl();
    }
  }
}
