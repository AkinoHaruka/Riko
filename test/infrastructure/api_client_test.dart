import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riko/data/api_client.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ─── FlutterSecureStorage MethodChannel mock 基础设施 ────────────────

/// 模拟安全存储的内存字典
Map<String, String?> _secureStore = {};

/// FlutterSecureStorage v9.x 使用的 MethodChannel 名称
/// 注意：是 "it_nomads"（带 s），不是 "it_nomad"
const _secureStorageChannel =
    MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

/// 拦截 FlutterSecureStorage 的 MethodChannel 调用，用内存字典替代平台存储
///
/// v9.x 的方法参数格式为 {key, value, options}，其中 options 是平台选项 Map
Future<dynamic> _handleSecureStorageCall(MethodCall call) async {
  final args = call.arguments as Map<dynamic, dynamic>?;
  switch (call.method) {
    case 'write':
      _secureStore[args?['key'] as String] = args?['value'] as String?;
      return null;
    case 'read':
      return _secureStore[args?['key'] as String];
    case 'delete':
      _secureStore.remove(args?['key'] as String);
      return null;
    case 'containsKey':
      return _secureStore.containsKey(args?['key'] as String);
    default:
      return null;
  }
}

// ─── HTTP 测试辅助 ──────────────────────────────────────────────────

/// 在 TestWidgetsFlutterBinding 初始化之前创建的真实 HttpClient。
///
/// 关键技巧：TestWidgetsFlutterBinding 会拦截所有通过 HttpClient 工厂方法
/// 创建的实例，使其返回 400 状态码。但如果我们在此之前创建一个真实实例，
/// 它不受测试绑定影响，可以在 HttpOverrides.runZoned 中被复用。
HttpClient? _realHttpClient;

/// 启动本地 HTTP 测试服务器，OS 自动分配可用端口
Future<HttpServer> _startTestServer(void Function(HttpRequest) handler) async {
  final server = await HttpServer.bind('127.0.0.1', 0);
  server.listen(handler);
  return server;
}

/// 在 HttpOverrides.runZoned 中运行测试代码，绕过 TestWidgetsFlutterBinding
/// 对 HTTP 请求的拦截。
///
/// 原理：
/// 1. TestWidgetsFlutterBinding 通过 HttpOverrides 机制拦截 HttpClient 创建
/// 2. HttpOverrides.runZoned 在当前 Zone 中设置自定义 HttpOverrides
/// 3. Zone 内的 HttpClient() 工厂方法会调用我们的 createHttpClient
/// 4. 我们返回预创建的真实 HttpClient，从而绕过测试绑定的拦截
/// 5. 不能在 createHttpClient 内调用 HttpClient()，否则会递归导致 Stack Overflow
Future<T> _withRealHttp<T>(Future<T> Function() body) {
  return HttpOverrides.runZoned(
    body,
    createHttpClient: (_) => _realHttpClient!,
  );
}

// ─── 测试主体 ────────────────────────────────────────────────────────

void main() {
  // 关键：在测试绑定初始化之前创建真实 HttpClient，避免被拦截。
  // TestWidgetsFlutterBinding.ensureInitialized() 会设置 HttpOverrides
  // 使所有 HttpClient() 调用返回 mock 实例（状态码 400）。
  // 在此之前创建的 HttpClient 不受影响。
  _realHttpClient = HttpClient();

  TestWidgetsFlutterBinding.ensureInitialized();

  late ApiClient client;

  setUp(() {
    // 重置静态默认值，避免测试间互相污染
    ApiClient.setDefaultBaseUrl('http://127.0.0.1:3000');
    _secureStore = {};

    // Mock SharedPreferences（空初始值）
    SharedPreferences.setMockInitialValues({});

    // Mock FlutterSecureStorage MethodChannel
    TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      _secureStorageChannel,
      _handleSecureStorageCall,
    );

    client = ApiClient();
  });

  tearDown(() {
    // 清理 MethodChannel mock
    TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_secureStorageChannel, null);
  });

  tearDownAll(() {
    // 释放预创建的 HttpClient 资源
    _realHttpClient?.close(force: true);
    _realHttpClient = null;
  });

  // ─── 1. 构造与默认值 ──────────────────────────────────────────

  group('构造与默认值', () {
    test('构造时 baseUrl 为空，getter 返回 defaultBaseUrl', () {
      // ApiClient 构造时未设置 baseUrl，内部 _dio.options.baseUrl 为空字符串
      // getter 检测到空后应返回 defaultBaseUrl
      expect(client.baseUrl, equals('http://127.0.0.1:3000'));
    });

    test('defaultBaseUrl 静态属性可读取', () {
      expect(ApiClient.defaultBaseUrl, equals('http://127.0.0.1:3000'));
    });

    test('setDefaultBaseUrl 修改静态默认值并影响新实例', () {
      ApiClient.setDefaultBaseUrl('http://custom:8080');
      expect(ApiClient.defaultBaseUrl, equals('http://custom:8080'));

      // 新实例的 baseUrl getter 也应返回新默认值
      final newClient = ApiClient();
      expect(newClient.baseUrl, equals('http://custom:8080'));

      // 恢复原始值，避免影响后续测试
      ApiClient.setDefaultBaseUrl('http://127.0.0.1:3000');
    });
  });

  // ─── 2. wsBaseUrl ─────────────────────────────────────────────

  group('wsBaseUrl', () {
    test('http 替换为 ws', () async {
      await client.setBaseUrl('http://127.0.0.1:3000');
      expect(client.wsBaseUrl, equals('ws://127.0.0.1:3000'));
    });

    test('https 替换为 wss', () async {
      await client.setBaseUrl('https://example.com');
      expect(client.wsBaseUrl, equals('wss://example.com'));
    });
  });

  // ─── 3. Token 管理 ────────────────────────────────────────────

  group('Token 管理', () {
    test('初始状态无 token', () {
      expect(client.hasToken, isFalse);
      expect(client.currentToken, isNull);
    });

    test('setToken 设置 token 后 hasToken 为 true', () async {
      await client.setToken('jwt-token-123');
      expect(client.hasToken, isTrue);
      expect(client.currentToken, equals('jwt-token-123'));
    });

    test('setToken(null) 清除 token', () async {
      await client.setToken('jwt-token-123');
      expect(client.hasToken, isTrue);

      await client.setToken(null);
      expect(client.hasToken, isFalse);
      expect(client.currentToken, isNull);
    });

    test('setToken 空字符串时 hasToken 为 false', () async {
      // hasToken 检查 _token != null && _token!.isNotEmpty
      // 空字符串满足非 null 但不满足 isNotEmpty
      await client.setToken('');
      expect(client.hasToken, isFalse);
      expect(client.currentToken, equals(''));
    });
  });

  // ─── 4. 初始化信号 ────────────────────────────────────────────

  group('初始化信号', () {
    test('completeInit 让 initReady Future 完成', () async {
      // initReady 尚未完成
      bool completed = false;
      client.initReady.then((_) => completed = true);
      // 让事件循环推进一步
      await Future<void>.delayed(Duration.zero);
      expect(completed, isFalse);

      // 调用 completeInit 后 Future 应完成
      client.completeInit();
      await client.initReady;
      expect(completed, isTrue);
    });

    test('重复调用 completeInit 不抛异常', () {
      // Completer.complete 只能调用一次，第二次被 isCompleted 守卫跳过
      client.completeInit();
      client.completeInit(); // 不应抛出 StateError
    });
  });

  // ─── 5. 拦截器 ──────────────────────────────────────────────
  //
  // 使用 _withRealHttp 绕过 TestWidgetsFlutterBinding 的 HTTP 拦截，
  // 通过本地 HttpServer 验证拦截器行为。

  group('拦截器', () {
    test('请求自动注入 Authorization Bearer header', () async {
      await client.setToken('my-jwt-token');

      // 启动测试服务器，捕获收到的 Authorization header
      String? receivedAuth;
      final server = await _startTestServer((request) {
        receivedAuth = request.headers.value('authorization');
        request.response
          ..headers.set('Content-Type', 'application/json')
          ..statusCode = 200
          ..write(jsonEncode({'ok': true}))
          ..close();
      });
      addTearDown(() => server.close(force: true));

      await client.setBaseUrl('http://127.0.0.1:${server.port}');
      await _withRealHttp(() => client.get('/test'));

      expect(receivedAuth, equals('Bearer my-jwt-token'));
    });

    test('无 token 时不注入 Authorization header', () async {
      // 不设置 token，拦截器应跳过 Authorization 注入
      String? receivedAuth;
      final server = await _startTestServer((request) {
        receivedAuth = request.headers.value('authorization');
        request.response
          ..headers.set('Content-Type', 'application/json')
          ..statusCode = 200
          ..write(jsonEncode({'ok': true}))
          ..close();
      });
      addTearDown(() => server.close(force: true));

      await client.setBaseUrl('http://127.0.0.1:${server.port}');
      await _withRealHttp(() => client.get('/test'));

      expect(receivedAuth, isNull);
    });

    test('429 响应提取 error 字段作为拒绝消息', () async {
      final server = await _startTestServer((request) {
        final body = jsonEncode({'error': '自定义限流消息'});
        request.response
          ..headers.set('Content-Type', 'application/json; charset=utf-8')
          ..statusCode = 429
          ..add(utf8.encode(body))
          ..close();
      });
      addTearDown(() => server.close(force: true));

      await client.setBaseUrl('http://127.0.0.1:${server.port}');

      try {
        await _withRealHttp(() => client.get('/test'));
        fail('应抛出 DioException');
      } on DioException catch (e) {
        // 拦截器应从 response.data['error'] 提取消息
        expect(e.error, equals('自定义限流消息'));
      }
    });

    test('429 响应无 error 字段时使用默认消息', () async {
      final server = await _startTestServer((request) {
        final body = jsonEncode({'message': '其他内容'});
        request.response
          ..headers.set('Content-Type', 'application/json; charset=utf-8')
          ..statusCode = 429
          ..add(utf8.encode(body))
          ..close();
      });
      addTearDown(() => server.close(force: true));

      await client.setBaseUrl('http://127.0.0.1:${server.port}');

      try {
        await _withRealHttp(() => client.get('/test'));
        fail('应抛出 DioException');
      } on DioException catch (e) {
        // 无 error 字段时使用硬编码默认消息
        expect(e.error, equals('请求速率已达上限，请稍后重试'));
      }
    });
  });

  // ─── 6. setBaseUrl ────────────────────────────────────────────

  group('setBaseUrl', () {
    test('更新 baseUrl getter 返回值', () async {
      await client.setBaseUrl('http://custom:9999');
      expect(client.baseUrl, equals('http://custom:9999'));
    });
  });

  // ─── 7. healthCheckFast ───────────────────────────────────────
  //
  // healthCheckFast 内部创建独立 Dio 实例（2s 短超时）。
  // 在 _withRealHttp Zone 内，该 Dio 的 IOHttpClientAdapter 创建 HttpClient 时
  // 会调用我们的 createHttpClient，从而使用真实 HttpClient 连接本地服务器。

  group('healthCheckFast', () {
    test('成功时返回 true', () async {
      // 启动服务器，/health 端点返回 200
      final server = await _startTestServer((request) {
        request.response
          ..statusCode = 200
          ..write('OK')
          ..close();
      });
      addTearDown(() => server.close(force: true));

      await client.setBaseUrl('http://127.0.0.1:${server.port}');
      // healthCheckFast 使用独立 Dio 实例，2s 短超时
      final result = await _withRealHttp(() => client.healthCheckFast());
      expect(result, isTrue);
    });

    test('失败时返回 false', () async {
      // 指向不存在的端口，连接被拒绝，healthCheckFast 返回 false
      await client.setBaseUrl('http://127.0.0.1:1');
      final result = await _withRealHttp(() => client.healthCheckFast());
      expect(result, isFalse);
    });
  });

  // ─── 8. HTTP 方法 ────────────────────────────────────────────
  //
  // 所有 HTTP 方法测试共用一个返回请求信息的服务器，
  // 通过 _withRealHttp 绕过测试绑定的 HTTP 拦截。

  group('HTTP 方法', () {
    late HttpServer server;

    setUp(() async {
      // 所有 HTTP 方法测试共用一个返回请求信息的服务器
      server = await _startTestServer((request) {
        request.response
          ..headers.set('Content-Type', 'application/json')
          ..statusCode = 200
          ..write(jsonEncode({
            'method': request.method,
            'path': request.uri.path,
          }))
          ..close();
      });
      await client.setBaseUrl('http://127.0.0.1:${server.port}');
    });

    tearDown(() async {
      await server.close(force: true);
    });

    test('get 正确转发', () async {
      final result = await _withRealHttp(() => client.get('/api/test'));
      expect(result, isA<Map>());
      expect(result['method'], equals('GET'));
      expect(result['path'], equals('/api/test'));
    });

    test('post 正确转发', () async {
      final result = await _withRealHttp(
        () => client.post('/api/data', data: {'key': 'value'}),
      );
      expect(result, isA<Map>());
      expect(result['method'], equals('POST'));
    });

    test('put 正确转发', () async {
      final result = await _withRealHttp(
        () => client.put('/api/data', data: {'key': 'value'}),
      );
      expect(result, isA<Map>());
      expect(result['method'], equals('PUT'));
    });

    test('patch 正确转发', () async {
      final result = await _withRealHttp(
        () => client.patch('/api/data', data: {'key': 'value'}),
      );
      expect(result, isA<Map>());
      expect(result['method'], equals('PATCH'));
    });

    test('delete 正确转发', () async {
      final result = await _withRealHttp(() => client.delete('/api/data'));
      expect(result, isA<Map>());
      expect(result['method'], equals('DELETE'));
    });
  });
}
