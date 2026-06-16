/// DeepSeekAdapter 核心路径单元测试
///
/// 通过 MockHttpClientAdapter 模拟 Dio 底层 HTTP 调用，
/// 间接验证私有方法的错误映射、消息提取、请求体构建、重试逻辑等行为。
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riko/infrastructure/ai_adapter/deepseek_adapter.dart';
import 'package:riko/infrastructure/ai_adapter/models/error_info.dart';
import 'package:riko/infrastructure/ai_adapter/models/message.dart';
import 'package:riko/infrastructure/ai_adapter/models/stream_chunk.dart';

// ---------------------------------------------------------------------------
// Mock：替换 Dio 底层 HTTP 适配器，精确控制请求返回值和异常
// ---------------------------------------------------------------------------

class MockHttpClientAdapter implements HttpClientAdapter {
  /// 模拟成功时返回的响应体（优先级低于 onFetch）
  ResponseBody? mockResponse;

  /// 模拟失败时抛出的异常（优先级低于 onFetch）
  DioException? mockException;

  /// 自定义 fetch 行为，优先级最高。返回 null 时回退到 mockException/mockResponse
  ResponseBody? Function(RequestOptions options)? onFetch;

  /// 记录 fetch 被调用的次数，用于验证重试行为
  int callCount = 0;

  /// 捕获最后一次请求的 RequestOptions，用于验证请求头
  RequestOptions? lastRequestOptions;

  /// 捕获最后一次请求的 body（JSON 字符串 → Map）
  Map<String, dynamic>? lastRequestBody;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    callCount++;
    lastRequestOptions = options;

    // 从请求流中读取 body 并解析为 Map
    if (requestStream != null) {
      final bytes = await requestStream.fold<List<int>>(
        <int>[],
        (prev, chunk) => prev..addAll(chunk),
      );
      final bodyStr = utf8.decode(bytes);
      if (bodyStr.isNotEmpty) {
        try {
          lastRequestBody =
              jsonDecode(bodyStr) as Map<String, dynamic>;
        } catch (_) {
          lastRequestBody = null;
        }
      }
    }

    // 优先使用自定义回调
    if (onFetch != null) {
      final result = onFetch!(options);
      if (result != null) return result;
    }

    if (mockException != null) throw mockException!;
    if (mockResponse != null) return mockResponse!;
    return ResponseBody.fromString('{}', 200);
  }

  @override
  void close({bool force = false}) {}
}

// ---------------------------------------------------------------------------
// 辅助工具函数
// ---------------------------------------------------------------------------

/// 创建 DeepSeekAdapter 并注入 MockHttpClientAdapter
DeepSeekAdapter createAdapterWithMock({
  String? authToken,
  MockHttpClientAdapter? mock,
}) {
  final adapter = DeepSeekAdapter(authToken: authToken);
  final mockAdapter = mock ?? MockHttpClientAdapter();
  adapter.dio.httpClientAdapter = mockAdapter;
  return adapter;
}

/// 构造一个包含有效 SSE 数据的 ResponseBody（模拟成功响应）
ResponseBody createSseResponseBody(String content) {
  final sseLines = 'data: {"type":"content","content":"$content"}\n\n'
      'data: [DONE]\n\n';
  final bytes = utf8.encode(sseLines);
  final stream = Stream.value(Uint8List.fromList(bytes));
  return ResponseBody(stream, 200, headers: {
    'content-type': ['text/event-stream'],
  });
}

/// 构造一个包含错误 JSON 的 ResponseBody（模拟非 2xx 响应体）
ResponseBody createErrorResponseBody(Map<String, dynamic> errorJson) {
  final body = jsonEncode(errorJson);
  final bytes = utf8.encode(body);
  final stream = Stream.value(Uint8List.fromList(bytes));
  return ResponseBody(stream, 400, headers: {
    'content-type': ['application/json'],
  });
}

/// 构造指定状态码的 DioException（badResponse 类型）
DioException createBadResponseException({
  required int statusCode,
  dynamic data,
}) {
  return DioException(
    type: DioExceptionType.badResponse,
    requestOptions: RequestOptions(path: '/chat/completions'),
    response: Response(
      requestOptions: RequestOptions(path: '/chat/completions'),
      statusCode: statusCode,
      data: data,
    ),
  );
}

/// 构造指定类型的连接类 DioException
DioException createConnectionException(
  DioExceptionType type, {
  String? error,
  String? message,
}) {
  return DioException(
    type: type,
    requestOptions: RequestOptions(path: '/chat/completions'),
    error: error,
    message: message,
  );
}

/// 消费 chatStream 并收集所有 StreamChunk 和 ErrorInfo
Future<({
  List<StreamChunk> chunks,
  ErrorInfo? error,
  Object? exception,
})> collectChatStream(
  DeepSeekAdapter adapter, {
  String userMessage = 'test',
  List<Message> context = const [],
  Map<String, dynamic> options = const {},
}) async {
  final chunks = <StreamChunk>[];
  ErrorInfo? error;
  Object? exception;

  try {
    await for (final chunk in adapter.chatStream(
      userMessage,
      context,
      options,
      onError: (e) => error = e,
    )) {
      chunks.add(chunk);
    }
  } catch (e) {
    exception = e;
  }

  return (chunks: chunks, error: error, exception: exception);
}

// ===========================================================================
// 测试主体
// ===========================================================================

void main() {
  // -------------------------------------------------------------------------
  // 错误映射 - DioException 类型
  // -------------------------------------------------------------------------

  group('错误映射 - DioException 类型', () {
    test('connectionTimeout → ErrorCategory.timeout, "请求超时"', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createConnectionException(
        DioExceptionType.connectionTimeout,
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.timeout);
      expect(result.error?.message, '请求超时');
      expect(result.exception, isA<Exception>());
    });

    test('sendTimeout → ErrorCategory.timeout, "请求超时"', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createConnectionException(
        DioExceptionType.sendTimeout,
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.timeout);
      expect(result.error?.message, '请求超时');
    });

    test('connectionError → ErrorCategory.network, "无法连接到后端服务器"',
        () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createConnectionException(
        DioExceptionType.connectionError,
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.network);
      expect(result.error?.message, '无法连接到后端服务器');
    });

    test('receiveTimeout → ErrorCategory.timeout, "响应超时"', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createConnectionException(
        DioExceptionType.receiveTimeout,
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.timeout);
      expect(result.error?.message, '响应超时');
    });
  });

  // -------------------------------------------------------------------------
  // 错误映射 - HTTP 状态码
  // -------------------------------------------------------------------------

  group('错误映射 - HTTP 状态码', () {
    test('400 → ErrorCategory.param', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createBadResponseException(
        statusCode: 400,
        data: {'error': {'message': 'invalid param'}},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.param);
      expect(result.error?.message, contains('请求参数错误'));
    });

    test('401 → ErrorCategory.auth', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createBadResponseException(
        statusCode: 401,
        data: {'error': 'unauthorized'},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.auth);
      expect(result.error?.message, 'API 密钥认证失败');
    });

    test('402 → ErrorCategory.balance', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createBadResponseException(
        statusCode: 402,
        data: {'error': 'insufficient balance'},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.balance);
      expect(result.error?.message, 'API 账户余额不足');
    });

    test('422 → ErrorCategory.param', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createBadResponseException(
        statusCode: 422,
        data: {'error': {'message': 'unprocessable'}},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.param);
      expect(result.error?.message, contains('请求参数错误'));
    });

    test('429 → ErrorCategory.rateLimit', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createBadResponseException(
        statusCode: 429,
        data: {'error': 'rate limited'},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.rateLimit);
      expect(result.error?.message, '请求速率已达上限');
    });

    test('500 → ErrorCategory.server', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createBadResponseException(
        statusCode: 500,
        data: {'error': 'internal server error'},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.server);
      expect(result.error?.message, 'AI 服务器故障');
    });

    test('503 → ErrorCategory.server', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createBadResponseException(
        statusCode: 503,
        data: {'error': 'service unavailable'},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.server);
      expect(result.error?.message, 'AI 服务器故障');
    });

    test('未知状态码 → ErrorCategory.unknown', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createBadResponseException(
        statusCode: 418,
        data: {'message': "I'm a teapot"},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.unknown);
      expect(result.error?.message, contains('AI 请求失败'));
    });
  });

  // -------------------------------------------------------------------------
  // _parseErrorMap 间接测试（通过 badResponse 异常的 error.message 提取）
  // -------------------------------------------------------------------------

  group('_parseErrorMap 间接测试', () {
    test('error 为 String → 直接返回该字符串', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createBadResponseException(
        statusCode: 400,
        data: {'error': '参数格式不正确'},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      // _parseErrorMap 提取到 "参数格式不正确"，被 _mapHttpStatusToError 使用
      expect(result.error?.message, contains('参数格式不正确'));
    });

    test('error 为 Map 含 message → 返回 error.message', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createBadResponseException(
        statusCode: 400,
        data: {'error': {'message': '字段必填'}},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.message, contains('字段必填'));
    });

    test('顶层 message 字段 → 返回 message', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createBadResponseException(
        statusCode: 400,
        data: {'message': '缺少必要参数'},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.message, contains('缺少必要参数'));
    });

    test('空结构 → 回退到默认消息', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = createBadResponseException(
        statusCode: 400,
        data: <String, dynamic>{},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      // _parseErrorMap 返回 null，_extractErrorMessage 回退到 e.message 或 "未知网络错误"
      expect(result.error?.category, ErrorCategory.param);
      expect(result.error?.message, contains('请求参数错误'));
    });
  });

  // -------------------------------------------------------------------------
  // _extractErrorMessage 间接测试
  // -------------------------------------------------------------------------

  group('_extractErrorMessage 间接测试', () {
    test('e.error 为 String → 返回该字符串', () async {
      final mock = MockHttpClientAdapter();
      // 对于非 badResponse 的 DioException，e.error 可以是 String
      mock.mockException = DioException(
        type: DioExceptionType.unknown,
        requestOptions: RequestOptions(path: '/chat/completions'),
        error: '自定义错误字符串',
        message: '原始 message',
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      // _extractErrorMessage 优先返回 e.error（String）
      expect(result.error?.message, contains('自定义错误字符串'));
    });

    test('e.response.data 为 Map 含 error.message → 返回 message', () async {
      final mock = MockHttpClientAdapter();
      // 使用 400 状态码，因为 500 返回硬编码消息不使用 defaultMsg
      mock.mockException = createBadResponseException(
        statusCode: 400,
        data: {'error': {'message': '字段校验失败'}},
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.param);
      // _extractErrorMessage 提取到 "字段校验失败"，被 _mapHttpStatusToError 拼接
      expect(result.error?.message, contains('字段校验失败'));
    });

    test('e.response.data 为 ResponseBody → 读取流并解析', () async {
      final mock = MockHttpClientAdapter();
      // 模拟 responseType=stream 时，错误响应体为 ResponseBody
      // 使用 400 状态码，因为 500 返回硬编码消息不使用 defaultMsg
      final errorBody = createErrorResponseBody({
        'error': {'message': '流式错误响应'},
      });
      mock.mockException = DioException(
        type: DioExceptionType.badResponse,
        requestOptions: RequestOptions(path: '/chat/completions'),
        response: Response(
          requestOptions: RequestOptions(path: '/chat/completions'),
          statusCode: 400,
          data: errorBody,
        ),
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.param);
      // _extractErrorMessage 读取 ResponseBody 流后解析出 message
      expect(result.error?.message, contains('流式错误响应'));
    });

    test('默认 → 返回 e.message 或 "未知网络错误"', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = DioException(
        type: DioExceptionType.unknown,
        requestOptions: RequestOptions(path: '/chat/completions'),
        // error 不是 String，response 为 null → 回退到 e.message
        message: '连接被拒绝',
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      // _mapHttpStatusToError(null, "连接被拒绝") → unknown
      expect(result.error?.category, ErrorCategory.unknown);
      expect(result.error?.message, contains('连接被拒绝'));
    });

    test('e.message 也为 null → 返回 "未知网络错误"', () async {
      final mock = MockHttpClientAdapter();
      mock.mockException = DioException(
        type: DioExceptionType.unknown,
        requestOptions: RequestOptions(path: '/chat/completions'),
        // error 不是 String，response 为 null，message 也为 null
      );
      final adapter = createAdapterWithMock(mock: mock);

      final result = await collectChatStream(adapter);

      expect(result.error?.category, ErrorCategory.unknown);
      expect(result.error?.message, contains('未知网络错误'));
    });
  });

  // -------------------------------------------------------------------------
  // chatStream 请求体构建
  // -------------------------------------------------------------------------

  group('chatStream 请求体构建', () {
    late MockHttpClientAdapter mock;

    setUp(() {
      mock = MockHttpClientAdapter();
      mock.mockResponse = createSseResponseBody('hello');
    });

    test('请求体包含 messages + stream: true', () async {
      final adapter = createAdapterWithMock(mock: mock);
      await collectChatStream(
        adapter,
        userMessage: '你好',
        context: const [Message(role: MessageRole.system, content: '系统提示')],
      );

      expect(mock.lastRequestBody, isNotNull);
      expect(mock.lastRequestBody!['stream'], isTrue);
      final messages = mock.lastRequestBody!['messages'] as List;
      // 1 条 context + 1 条 userMessage
      expect(messages.length, 2);
      expect((messages[0] as Map)['role'], MessageRole.system);
      expect((messages[1] as Map)['role'], MessageRole.user);
      expect((messages[1] as Map)['content'], '你好');
    });

    test('options 中 conversation_id 透传', () async {
      final adapter = createAdapterWithMock(mock: mock);
      await collectChatStream(
        adapter,
        options: {'conversation_id': 'conv-123'},
      );

      expect(mock.lastRequestBody?['conversation_id'], 'conv-123');
    });

    test('options 中 model 透传', () async {
      final adapter = createAdapterWithMock(mock: mock);
      await collectChatStream(
        adapter,
        options: {'model': 'deepseek-v4-pro'},
      );

      expect(mock.lastRequestBody?['model'], 'deepseek-v4-pro');
    });

    test('options 中 temperature/maxTokens/topP/stop 透传', () async {
      final adapter = createAdapterWithMock(mock: mock);
      await collectChatStream(
        adapter,
        options: {
          'temperature': 0.7,
          'maxTokens': 2048,
          'top_p': 0.9,
          'stop': ['\n', '。'],
        },
      );

      final body = mock.lastRequestBody!;
      expect(body['temperature'], 0.7);
      expect(body['max_tokens'], 2048);
      expect(body['top_p'], 0.9);
      expect(body['stop'], ['\n', '。']);
    });

    test('options 中 thinking_type → thinking 对象', () async {
      final adapter = createAdapterWithMock(mock: mock);
      await collectChatStream(
        adapter,
        options: {'thinking_type': 'enabled'},
      );

      final thinking = mock.lastRequestBody?['thinking'] as Map?;
      expect(thinking, isNotNull);
      expect(thinking?['type'], 'enabled');
    });

    test('thinking_type 为 enabled 时 reasoning_effort 透传', () async {
      final adapter = createAdapterWithMock(mock: mock);
      await collectChatStream(
        adapter,
        options: {
          'thinking_type': 'enabled',
          'reasoning_effort': 'high',
        },
      );

      expect(mock.lastRequestBody?['reasoning_effort'], 'high');
    });

    test('thinking_type 为 disabled 时 reasoning_effort 不透传', () async {
      final adapter = createAdapterWithMock(mock: mock);
      await collectChatStream(
        adapter,
        options: {
          'thinking_type': 'disabled',
          'reasoning_effort': 'high',
        },
      );

      expect(mock.lastRequestBody?.containsKey('reasoning_effort'), isFalse);
    });

    test('options 中 json_mode → response_format', () async {
      final adapter = createAdapterWithMock(mock: mock);
      await collectChatStream(
        adapter,
        options: {'json_mode': true},
      );

      final format = mock.lastRequestBody?['response_format'] as Map?;
      expect(format, isNotNull);
      expect(format?['type'], 'json_object');
    });

    test('json_mode 默认为 false 时不添加 response_format', () async {
      final adapter = createAdapterWithMock(mock: mock);
      await collectChatStream(adapter);

      expect(
        mock.lastRequestBody?.containsKey('response_format'),
        isFalse,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 重试逻辑
  // -------------------------------------------------------------------------

  group('重试逻辑', () {
    test('连接错误时重试（callCount > 1）', () async {
      fakeAsync((async) {
        final mock = MockHttpClientAdapter();
        mock.mockException = createConnectionException(
          DioExceptionType.connectionError,
        );
        final adapter = createAdapterWithMock(mock: mock);

        final chunks = <StreamChunk>[];

        adapter.chatStream('test', [], {}).listen(
          chunks.add,
          onError: (e) {
            // 连接错误最多重试 3 次，总计 4 次请求（1 首次 + 3 重试）
            expect(mock.callCount, 4);
            // 每次重试前 yield 一条状态消息
            expect(chunks.length, 3);
            expect(chunks.every((c) => c.isStatus), isTrue);
          },
        );

        // 依次推进时间，触发各次重试的指数退避延迟
        // 首次失败 → yield 状态 → 延迟 1s → 第1次重试
        async.elapse(const Duration(seconds: 1));
        // 第1次重试失败 → yield 状态 → 延迟 2s → 第2次重试
        async.elapse(const Duration(seconds: 2));
        // 第2次重试失败 → yield 状态 → 延迟 4s → 第3次重试
        async.elapse(const Duration(seconds: 4));
        // 第3次重试失败 → 不再重试，抛出异常
        async.elapse(const Duration(milliseconds: 100));
      });
    });

    test('非连接错误时不重试', () async {
      final mock = MockHttpClientAdapter();
      // badResponse 不属于连接类错误，不应触发重试
      mock.mockException = createBadResponseException(
        statusCode: 400,
        data: {'error': 'bad request'},
      );
      final adapter = createAdapterWithMock(mock: mock);

      await collectChatStream(adapter);

      // 只调用 1 次，不重试
      expect(mock.callCount, 1);
    });

    test('重试时 yield 状态消息包含 "[正在重连...]"', () async {
      fakeAsync((async) {
        final mock = MockHttpClientAdapter();
        mock.mockException = createConnectionException(
          DioExceptionType.connectionTimeout,
        );
        final adapter = createAdapterWithMock(mock: mock);

        final chunks = <StreamChunk>[];

        adapter.chatStream('test', [], {}).listen(chunks.add);

        // 推进到第一次重试完成
        async.elapse(const Duration(seconds: 1));

        // 第一条状态消息应包含重连提示
        expect(chunks, isNotEmpty);
        expect(chunks.first.content, contains('正在重连'));
        expect(chunks.first.isStatus, isTrue);
      });
    });

    test('连接错误重试后成功 → 返回正常内容', () async {
      fakeAsync((async) {
        final mock = MockHttpClientAdapter();
        // 第一次连接失败，第二次成功
        var callIndex = 0;
        mock.onFetch = (_) {
          callIndex++;
          if (callIndex == 1) {
            throw createConnectionException(DioExceptionType.connectionError);
          }
          return createSseResponseBody('恢复成功');
        };
        final adapter = createAdapterWithMock(mock: mock);

        final chunks = <StreamChunk>[];

        adapter.chatStream('test', [], {}).listen(
          chunks.add,
          onDone: () {
            expect(mock.callCount, 2);
            // 第一条是重连状态消息
            expect(chunks.first.isStatus, isTrue);
            // 应包含 SSE 解析出的内容
            expect(
              chunks.any((c) => c.content == '恢复成功' && !c.isStatus),
              isTrue,
            );
          },
        );

        // 推进时间触发重试
        async.elapse(const Duration(seconds: 1));
        // 给 SSE 流解析留一点时间
        async.elapse(const Duration(milliseconds: 100));
      });
    });
  });

  // -------------------------------------------------------------------------
  // updateToken
  // -------------------------------------------------------------------------

  group('updateToken', () {
    test('updateToken 后请求携带新 token', () async {
      final mock = MockHttpClientAdapter();
      mock.mockResponse = createSseResponseBody('ok');
      final adapter = createAdapterWithMock(
        authToken: 'old-token',
        mock: mock,
      );

      // 初始 token 应在请求头中
      await collectChatStream(adapter);
      expect(
        mock.lastRequestOptions?.headers['Authorization'],
        'Bearer old-token',
      );

      // 更新 token
      adapter.updateToken('new-token');
      mock.callCount = 0; // 重置计数

      await collectChatStream(adapter);
      expect(
        mock.lastRequestOptions?.headers['Authorization'],
        'Bearer new-token',
      );
    });

    test('updateToken(null) 后请求不携带 Authorization', () async {
      final mock = MockHttpClientAdapter();
      mock.mockResponse = createSseResponseBody('ok');
      final adapter = createAdapterWithMock(
        authToken: 'some-token',
        mock: mock,
      );

      adapter.updateToken(null);
      await collectChatStream(adapter);

      expect(
        mock.lastRequestOptions?.headers.containsKey('Authorization'),
        isFalse,
      );
    });
  });
}
