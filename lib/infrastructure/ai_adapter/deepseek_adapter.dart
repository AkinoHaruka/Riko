/// AI 适配器模块（通过本地 Fastify 后端转发）
///
/// 实现 [AIAdapter] 接口，通过 Dio HTTP 客户端将聊天请求转发到本地 Fastify 后端，
/// 由后端代理与各 AI Provider 交互。前端不直接持有 API Key，保障密钥安全。
/// 后端根据 model 参数自动路由到对应的 Provider（DeepSeek/OpenAI/Anthropic/Gemini 等）。
///
/// 核心特性：
/// - SSE 流式响应：设置 Accept: text/event-stream，逐块解析后端推送的数据
/// - 指数退避重试：连接类错误（超时/断连）最多重试 3 次，间隔 1s→2s→4s
/// - 错误分类映射：将 DioException 和 HTTP 状态码转换为结构化 [ErrorInfo]
/// - Token 热更新：通过 [updateToken] 动态更新 JWT，无需重建 Dio 实例
library;

import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:meta/meta.dart';

import '../../core/config/backend_config.dart';
import 'ai_adapter.dart';
import 'sse_stream_parser.dart';

/// AI 适配器（通过本地 Fastify 后端转发）
///
/// 将请求转发到本地后端服务（默认 http://127.0.0.1:3000，由 [BackendConfig] 统一管理），
/// 由后端负责与各 AI Provider 交互，前端无需直接持有 API Key。
/// 后端根据 model 参数自动路由到对应的 Provider。
class DeepSeekAdapter implements AIAdapter {
  final Dio _dio;

  static const String _defaultBaseUrl = BackendConfig.defaultBaseUrl;
  static const String _endpoint = '/chat/completions';

  String? _authToken;

  DeepSeekAdapter({String? baseUrl, String? authToken})
    : _authToken = authToken,
      _dio = Dio(
        BaseOptions(
          baseUrl: baseUrl ?? _defaultBaseUrl,
          // 连接超时 30s，响应超时 600s（长文本生成可能耗时较长）
          connectTimeout: const Duration(seconds: 30),
          receiveTimeout: const Duration(seconds: 600),
          headers: {
            'Content-Type': 'application/json',
            // 声明接受 SSE 流式响应
            'Accept': 'text/event-stream',
          },
        ),
      ) {
    // 通过拦截器动态注入 JWT，避免在 BaseOptions 中硬编码 token
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (_authToken != null && _authToken!.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $_authToken';
          }
          handler.next(options);
        },
      ),
    );
  }

  /// 热更新认证令牌，无需重建 Dio 实例
  void updateToken(String? token) {
    _authToken = token;
  }

  /// 暴露 Dio 实例供测试注入 Mock HttpClientAdapter
  @visibleForTesting
  Dio get dio => _dio;

  /// 最大重试次数为3次，总计最多4次请求尝试（含首次）
  static const int _maxRetries = 3;

  /// 重试间隔基数（秒），实际间隔为 _retryBase * 2^(attempt-1)
  static const int _retryBase = 1;

  @override
  Stream<StreamChunk> chatStream(
    String userMessage,
    List<Message> context,
    Map<String, dynamic> options, {
    void Function(String rawLine)? onRawSseLine,
    void Function(ErrorInfo error)? onError,
  }) async* {
    final messages = [
      ...context.map((m) => m.toJson()),
      {'role': MessageRole.user, 'content': userMessage},
    ];

    final requestBody = <String, dynamic>{'messages': messages, 'stream': true};

    // 会话 ID、模型、温度等参数通过 options 透传给后端
    final conversationId = options['conversation_id'] as String?;
    if (conversationId != null) {
      requestBody['conversation_id'] = conversationId;
    }

    final model = options['model'] as String?;
    if (model != null && model.isNotEmpty) {
      requestBody['model'] = model;
    }

    // 标准参数：temperature、max_tokens 等
    final temperature = options['temperature'] as double?;
    if (temperature != null) {
      requestBody['temperature'] = temperature;
    }

    final maxTokens = options['maxTokens'] as int?;
    if (maxTokens != null) {
      requestBody['max_tokens'] = maxTokens;
    }

    final topP = options['top_p'] as double?;
    if (topP != null) {
      requestBody['top_p'] = topP;
    }

    final stop = options['stop'] as List<String>?;
    if (stop != null && stop.isNotEmpty) {
      requestBody['stop'] = stop;
    }

    // 思考模式透传给后端（enabled / disabled）
    final thinkingType = options['thinking_type'] as String?;
    if (thinkingType != null && thinkingType.isNotEmpty) {
      requestBody['thinking'] = {'type': thinkingType};
    }

    // 仅在思考模式启用时传递 reasoning_effort，避免无效参数被后端拒绝
    if (thinkingType == 'enabled' || thinkingType == null) {
      final reasoningEffort = options['reasoning_effort'] as String?;
      if (reasoningEffort != null && reasoningEffort.isNotEmpty) {
        requestBody['reasoning_effort'] = reasoningEffort;
      }
    }

    // 启用 JSON 结构化输出
    final jsonMode = options['json_mode'] as bool? ?? false;
    if (jsonMode) {
      requestBody['response_format'] = {'type': 'json_object'};
    }

    // 重试逻辑：连接类错误最多重试 _maxRetries 次，其他错误直接抛出
    for (int attempt = 0; attempt <= _maxRetries; attempt++) {
      try {
        final response = await _dio.post<ResponseBody>(
          _endpoint,
          data: jsonEncode(requestBody),
          options: Options(
            // 使用 stream 响应类型以支持 SSE 逐块读取
            responseType: ResponseType.stream,
            validateStatus: (status) =>
                status != null && status >= 200 && status < 300,
          ),
        );

        final byteStream = response.data?.stream;
        if (byteStream == null) {
          throw Exception('后端响应流为空');
        }

        yield* parseSseStream(byteStream, onRawSseLine: onRawSseLine);
        return;
      } on DioException catch (e) {
        final isConnectionError =
            e.type == DioExceptionType.connectionTimeout ||
            e.type == DioExceptionType.receiveTimeout ||
            e.type == DioExceptionType.connectionError ||
            e.type == DioExceptionType.sendTimeout;

        if (!isConnectionError || attempt >= _maxRetries) {
          final errorMsg = await _extractErrorMessage(e);
          final errorInfo = _mapDioExceptionToError(e, errorMsg);
          onError?.call(errorInfo);
          throw Exception(errorInfo.message);
        }

        // 指数退避：1s、2s、4s
        final delaySeconds = _retryBase * (1 << attempt);
        yield StreamChunk(
          content: '[正在重连...第${attempt + 1}次尝试]',
          isStatus: true,
        );
        // 使用 Future.delayed 实现延迟（原 Stream.periodic + break 方式延迟不生效）
        await Future<void>.delayed(Duration(seconds: delaySeconds));
      }
    }
  }

  /// 从 DioException 中提取可读错误信息
  ///
  /// 依次尝试：错误字符串 → Map 响应体 → ResponseBody 流式响应体 → 默认消息
  Future<String> _extractErrorMessage(DioException e) async {
    final errorObj = e.error;
    if (errorObj is String && errorObj.isNotEmpty) {
      return errorObj;
    }

    final responseData = e.response?.data;
    if (responseData is Map<String, dynamic>) {
      final extracted = _parseErrorMap(responseData);
      if (extracted != null) return extracted;
    }

    // responseType=stream 时，错误响应体可能是 ResponseBody，需要读取为字符串
    if (responseData is ResponseBody) {
      try {
        final bytes = await responseData.stream.fold<List<int>>(
          <int>[],
          (prev, chunk) => prev..addAll(chunk),
        );
        final body = utf8.decode(bytes);
        final json = jsonDecode(body) as Map<String, dynamic>;
        final extracted = _parseErrorMap(json);
        if (extracted != null) return extracted;
      } catch (_) {
        // 无法解析响应体，使用默认错误消息
      }
    }

    return e.message ?? '未知网络错误';
  }

  /// 从错误响应 Map 中提取 message 字段，兼容 error.message 和 message 两种结构
  String? _parseErrorMap(Map<String, dynamic> data) {
    final error = data['error'];
    if (error is String && error.isNotEmpty) return error;
    if (error is Map<String, dynamic>) {
      final message = error['message'] as String?;
      if (message != null && message.isNotEmpty) return message;
    }
    final message = data['message'] as String?;
    if (message != null && message.isNotEmpty) return message;
    return null;
  }

  /// 将 DioException 映射为分类错误信息，优先按异常类型分类，再按 HTTP 状态码分类
  ErrorInfo _mapDioExceptionToError(DioException e, String defaultMsg) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
        return const ErrorInfo(
          category: ErrorCategory.timeout,
          message: '请求超时',
          suggestion: '请检查网络连接后重试',
        );
      case DioExceptionType.connectionError:
        return const ErrorInfo(
          category: ErrorCategory.network,
          message: '无法连接到后端服务器',
          suggestion: '请确认后端服务已启动',
        );
      case DioExceptionType.receiveTimeout:
        return const ErrorInfo(
          category: ErrorCategory.timeout,
          message: '响应超时',
          suggestion: '请检查网络连接后重试',
        );
      default:
        return _mapHttpStatusToError(e.response?.statusCode, defaultMsg);
    }
  }

  /// 将 HTTP 状态码映射为分类错误信息
  ErrorInfo _mapHttpStatusToError(int? statusCode, String defaultMsg) {
    switch (statusCode) {
      case 400:
        return ErrorInfo(
          category: ErrorCategory.param,
          message: '请求参数错误: $defaultMsg',
          suggestion: '请检查请求参数',
        );
      case 401:
        return const ErrorInfo(
          category: ErrorCategory.auth,
          message: 'API 密钥认证失败',
          suggestion: '请检查 API Key 配置',
        );
      case 402:
        return const ErrorInfo(
          category: ErrorCategory.balance,
          message: 'API 账户余额不足',
          suggestion: '请前往对应平台充值页面充值',
        );
      case 422:
        return ErrorInfo(
          category: ErrorCategory.param,
          message: '请求参数错误: $defaultMsg',
          suggestion: '请检查请求参数',
        );
      case 429:
        return const ErrorInfo(
          category: ErrorCategory.rateLimit,
          message: '请求速率已达上限',
          suggestion: '请稍后重试',
        );
      case 500:
      case 503:
        return const ErrorInfo(
          category: ErrorCategory.server,
          message: 'AI 服务器故障',
          suggestion: '请等待后重试',
        );
      default:
        return ErrorInfo(
          category: ErrorCategory.unknown,
          message: 'AI 请求失败: $defaultMsg',
        );
    }
  }
}
