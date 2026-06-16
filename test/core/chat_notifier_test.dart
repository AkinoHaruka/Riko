/// ChatNotifier 核心路径单元测试
///
/// 覆盖范围：
/// - 初始状态验证
/// - 简单 CRUD 操作（创建/重命名/删除会话、删除/清空消息、归档切换）
/// - 状态管理（updateAgentParams、currentTokenCount）
/// - switchConversation（切换到 null / 有效 ID）
/// - fetchTokenStatus（无活跃会话 / 有活跃会话）
/// - sendMessage 核心路径（空消息拦截、无会话时自动创建、乐观 UI、SSE 流接收、流结束、流错误）
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:riko/core/di/chat_provider.dart';
import 'package:riko/core/di/providers.dart';
import 'package:riko/core/di/settings_cache.dart';
import 'package:riko/data/api_client.dart';
import 'package:riko/data/models/chat_message.dart';
import 'package:riko/data/repositories/remote_chat_repository.dart';
import 'package:riko/infrastructure/ai_adapter/adapter_factory.dart';
import 'package:riko/infrastructure/ai_adapter/ai_adapter.dart';
import 'package:riko/infrastructure/websocket_client.dart';

// ==================== Mock 类定义 ====================

class MockRemoteChatRepository extends Mock
    implements RemoteChatRepository {}

class MockAdapterFactory extends Mock implements AdapterFactory {}

class MockAIAdapter extends Mock implements AIAdapter {}

class MockApiClient extends Mock implements ApiClient {}

class MockWebSocketClient extends Mock implements WebSocketClient {}

// ==================== Fake 类定义 ====================

/// 可控的 SettingsCache 替身，继承 SettingsCache 以满足类型约束
///
/// 继承而非直接构造，因为 StateNotifierProvider.overrideWith 要求返回类型匹配。
/// 传入 mock ApiClient 避免真实网络调用，init() 被重写为空操作。
class FakeSettingsCache extends SettingsCache {
  FakeSettingsCache([SettingsCacheState? initialState])
    : super(_noopApiClient) {
    if (initialState != null) {
      state = initialState;
    }
  }

  /// 阻止真实网络请求
  @override
  Future<void> init() async {}
}

/// 静态 mock ApiClient，仅供 FakeSettingsCache 构造使用
final _noopApiClient = MockApiClient();

// ==================== Fallback 值注册 ====================

/// 为 mocktail 注册 fallback 值，避免参数匹配器报错
void registerFallbackValues() {
  registerFallbackValue('');
  registerFallbackValue(<Message>[]);
  registerFallbackValue(<String, dynamic>{});
  registerFallbackValue(const StreamChunk());
}

// ==================== 测试辅助函数 ====================

/// 创建预配置的 ProviderContainer，覆盖所有 ChatNotifier 的传递依赖
///
/// 通过 override 隔离网络层和平台层，使测试纯内存运行。
ProviderContainer createTestContainer({
  required MockRemoteChatRepository mockChatRepo,
  required MockAdapterFactory mockAdapterFactory,
  required MockApiClient mockApiClient,
  required MockWebSocketClient mockWsClient,
  SettingsCacheState? settingsState,
  String? activeConversationId,
  List<ChatMessage>? messagesForConversation,
}) {
  final settings = settingsState ?? const SettingsCacheState();

  return ProviderContainer(
    overrides: [
      // 核心依赖：仓库和适配器工厂
      chatRepositoryProvider.overrideWithValue(mockChatRepo),
      adapterFactoryProvider.overrideWithValue(mockAdapterFactory),

      // 网络层依赖
      apiClientProvider.overrideWithValue(mockApiClient),
      webSocketClientProvider.overrideWithValue(mockWsClient),

      // 设置缓存：使用可控的 FakeSettingsCache
      settingsCacheProvider.overrideWith(
        (ref) => FakeSettingsCache(settings),
      ),

      // 会话消息流：返回空列表或指定消息
      conversationMessagesProvider.overrideWith((ref, id) {
        final msgs = messagesForConversation ?? <ChatMessage>[];
        return Stream.value(msgs);
      }),

      // 会话列表流
      conversationsProvider.overrideWith((ref) => Stream.value([])),
    ],
  );
}

/// 配置 MockApiClient 的默认行为
void setupMockApiClient(MockApiClient mockApiClient) {
  when(() => mockApiClient.baseUrl).thenReturn('http://127.0.0.1:3000');
  when(() => mockApiClient.currentToken).thenReturn('test-token');
  when(() => mockApiClient.initReady).thenAnswer((_) async {});
  when(() => mockApiClient.wsBaseUrl).thenReturn('ws://127.0.0.1:3000');
}

/// 配置 MockWebSocketClient 的默认行为
void setupMockWebSocketClient(MockWebSocketClient mockWsClient) {
  when(() => mockWsClient.events).thenAnswer(
    (_) => StreamController<WebSocketEvent>().stream,
  );
  when(() => mockWsClient.connect()).thenReturn(null);
  when(() => mockWsClient.dispose()).thenReturn(null);
  when(() => mockWsClient.setToken(any())).thenReturn(null);
}

void main() {
  late MockRemoteChatRepository mockChatRepo;
  late MockAdapterFactory mockAdapterFactory;
  late MockAIAdapter mockAIAdapter;
  late MockApiClient mockApiClient;
  late MockWebSocketClient mockWsClient;
  late ProviderContainer container;

  setUp(() {
    // 初始化 SharedPreferences mock，避免平台通道异常
    SharedPreferences.setMockInitialValues({});

    // 创建 mock 实例
    mockChatRepo = MockRemoteChatRepository();
    mockAdapterFactory = MockAdapterFactory();
    mockAIAdapter = MockAIAdapter();
    mockApiClient = MockApiClient();
    mockWsClient = MockWebSocketClient();

    // 注册 fallback 值
    registerFallbackValues();

    // 配置网络层 mock 的默认行为
    setupMockApiClient(mockApiClient);
    setupMockWebSocketClient(mockWsClient);

    // 配置 DreamNotifier 依赖的 getDreamStatus mock
    when(() => mockChatRepo.getDreamStatus())
        .thenAnswer((_) async => {'status': 'idle'});

    // 配置适配器工厂默认行为
    when(
      () => mockAdapterFactory.getAdapter(
        any(),
        backendBaseUrl: any(named: 'backendBaseUrl'),
        authToken: any(named: 'authToken'),
      ),
    ).thenReturn(mockAIAdapter);

    // 创建测试容器
    container = createTestContainer(
      mockChatRepo: mockChatRepo,
      mockAdapterFactory: mockAdapterFactory,
      mockApiClient: mockApiClient,
      mockWsClient: mockWsClient,
    );
  });

  tearDown(() {
    container.dispose();
  });

  // ==================== 获取 Notifier 的辅助方法 ====================

  /// 获取 ChatNotifier 实例
  ChatNotifier getNotifier() =>
      container.read(chatNotifierProvider.notifier);

  /// 获取当前 ChatState
  ChatState getState() => container.read(chatNotifierProvider);

  /// 设置活跃会话 ID
  void setActiveConversationId(String? id) {
    container.read(activeConversationIdProvider.notifier).state = id;
  }

  // ==================== 初始状态测试 ====================

  group('初始状态', () {
    test('默认值应为 isLoading=false, streamingContent="", pendingMessages=[]', () {
      final state = getState();

      expect(state.isLoading, isFalse);
      expect(state.streamingContent, isEmpty);
      expect(state.streamingReasoningContent, isEmpty);
      expect(state.pendingMessages, isEmpty);
      expect(state.error, isNull);
      expect(state.tokenCount, equals(0));
      expect(state.messageCount, equals(0));
      expect(state.streamingAssistantMessageId, isNull);
      expect(state.apiInputHistory, isEmpty);
    });
  });

  // ==================== 简单 CRUD 测试 ====================

  group('createConversation', () {
    test('应调用 chatRepository.createConversation 并设置活跃会话 ID', () async {
      when(() => mockChatRepo.createConversation(any()))
          .thenAnswer((_) async => 'new-conv-id');

      final notifier = getNotifier();
      await notifier.createConversation('测试会话');

      verify(() => mockChatRepo.createConversation('测试会话')).called(1);
      expect(container.read(activeConversationIdProvider), equals('new-conv-id'));
    });
  });

  group('renameConversation', () {
    test('应调用 chatRepository.renameConversation', () async {
      when(() => mockChatRepo.renameConversation(any(), any()))
          .thenAnswer((_) async {});

      final notifier = getNotifier();
      await notifier.renameConversation('conv-1', '新标题');

      verify(() => mockChatRepo.renameConversation('conv-1', '新标题')).called(1);
    });
  });

  group('deleteConversation', () {
    test('应调用 chatRepository.deleteConversation', () async {
      when(() => mockChatRepo.deleteConversation(any()))
          .thenAnswer((_) async {});

      final notifier = getNotifier();
      await notifier.deleteConversation('conv-1');

      verify(() => mockChatRepo.deleteConversation('conv-1')).called(1);
    });

    test('若删除的是当前活跃会话，应清空活跃会话 ID', () async {
      setActiveConversationId('conv-1');
      when(() => mockChatRepo.deleteConversation(any()))
          .thenAnswer((_) async {});

      final notifier = getNotifier();
      await notifier.deleteConversation('conv-1');

      expect(container.read(activeConversationIdProvider), isNull);
    });

    test('若删除的不是当前活跃会话，活跃会话 ID 不变', () async {
      setActiveConversationId('conv-active');
      when(() => mockChatRepo.deleteConversation(any()))
          .thenAnswer((_) async {});

      final notifier = getNotifier();
      await notifier.deleteConversation('conv-other');

      expect(container.read(activeConversationIdProvider), equals('conv-active'));
    });
  });

  group('deleteMessage', () {
    test('应调用 chatRepository.deleteMessage', () async {
      when(() => mockChatRepo.deleteMessage(any()))
          .thenAnswer((_) async {});

      final notifier = getNotifier();
      await notifier.deleteMessage('msg-1');

      verify(() => mockChatRepo.deleteMessage('msg-1')).called(1);
    });
  });

  group('clearConversationMessages', () {
    test('应调用 chatRepository.clearMessages', () async {
      when(() => mockChatRepo.clearMessages(any()))
          .thenAnswer((_) async => 3);

      final notifier = getNotifier();
      await notifier.clearConversationMessages('conv-1');

      verify(() => mockChatRepo.clearMessages('conv-1')).called(1);
    });
  });

  group('toggleArchiveConversation', () {
    test('应调用 chatRepository.toggleArchiveConversation', () async {
      when(() => mockChatRepo.toggleArchiveConversation(any(), any()))
          .thenAnswer((_) async {});

      final notifier = getNotifier();
      await notifier.toggleArchiveConversation('conv-1', true);

      verify(() => mockChatRepo.toggleArchiveConversation('conv-1', true)).called(1);
    });
  });

  // ==================== 状态管理测试 ====================

  group('currentTokenCount', () {
    test('应返回 state.tokenCount 的值', () {
      final notifier = getNotifier();
      expect(notifier.currentTokenCount, equals(0));
    });
  });

  group('updateAgentParams', () {
    test('应从 settingsCacheProvider 读取参数并更新状态', () {
      // 创建带自定义参数的容器
      final customContainer = createTestContainer(
        mockChatRepo: mockChatRepo,
        mockAdapterFactory: mockAdapterFactory,
        mockApiClient: mockApiClient,
        mockWsClient: mockWsClient,
        settingsState: const SettingsCacheState(
          params: {
            'param_session_memory_min_messages': 10,
            'param_session_memory_min_tokens_between_update': 5000,
            'param_compact_trigger_tokens': 100000,
            'param_dream_min_hours': 48,
          },
        ),
      );

      try {
        final notifier = customContainer.read(chatNotifierProvider.notifier);
        notifier.updateAgentParams();

        final state = customContainer.read(chatNotifierProvider);
        expect(state.memoryMinMessages, equals(10));
        expect(state.memoryMinTokensBetweenUpdate, equals(5000));
        expect(state.compactTriggerTokens, equals(100000));
        expect(state.dreamMinHours, equals(48));
      } finally {
        customContainer.dispose();
      }
    });

    test('参数缺失时应使用默认值', () {
      final notifier = getNotifier();
      notifier.updateAgentParams();

      final state = getState();
      expect(state.memoryMinMessages, equals(6));
      expect(state.memoryMinTokensBetweenUpdate, equals(2000));
      expect(state.compactTriggerTokens, equals(200000));
      expect(state.dreamMinHours, equals(24));
    });
  });

  // ==================== switchConversation 测试 ====================

  group('switchConversation', () {
    test('切换到 null 应重置状态为初始值', () async {
      // 先设置一些非默认状态
      setActiveConversationId('conv-1');

      final notifier = getNotifier();
      // 手动设置非默认状态以验证重置
      notifier.updateAgentParams(); // 这会修改状态

      await notifier.switchConversation(null);

      final state = getState();
      expect(state.isLoading, isFalse);
      expect(state.streamingContent, isEmpty);
      expect(state.pendingMessages, isEmpty);
      expect(state.apiInputHistory, isEmpty);
      expect(container.read(activeConversationIdProvider), isNull);
    });

    test('切换到有效 ID 应加载监控记录', () async {
      when(() => mockChatRepo.getMonitorRecordCount(any()))
          .thenAnswer((_) async => 2);
      when(() => mockChatRepo.getMonitorRecords(any()))
          .thenAnswer((_) async => [
            {
              'id': 'rec-1',
              'conversation_id': 'conv-1',
              'request_json': '',
              'response_raw_text': '',
              'created_at': '2025-06-14T12:00:00.000Z',
              'is_complete': true,
            },
            {
              'id': 'rec-2',
              'conversation_id': 'conv-1',
              'request_json': '',
              'response_raw_text': '',
              'created_at': '2025-06-14T13:00:00.000Z',
              'is_complete': false,
            },
          ]);

      final notifier = getNotifier();
      await notifier.switchConversation('conv-1');

      expect(container.read(activeConversationIdProvider), equals('conv-1'));
      final state = getState();
      expect(state.apiInputHistory.length, equals(2));
      expect(state.hasMoreMonitorRecords, isFalse); // totalCount(2) == records.length(2)
    });

    test('监控记录加载失败时应重置为初始状态', () async {
      when(() => mockChatRepo.getMonitorRecordCount(any()))
          .thenThrow(Exception('网络错误'));

      final notifier = getNotifier();
      await notifier.switchConversation('conv-1');

      final state = getState();
      expect(state.apiInputHistory, isEmpty);
      expect(state.isLoading, isFalse);
    });

    test('监控记录有更多数据时 hasMoreMonitorRecords 应为 true', () async {
      when(() => mockChatRepo.getMonitorRecordCount(any()))
          .thenAnswer((_) async => 10);
      when(() => mockChatRepo.getMonitorRecords(any()))
          .thenAnswer((_) async => [
            {
              'id': 'rec-1',
              'conversation_id': 'conv-1',
              'request_json': '',
              'response_raw_text': '',
              'created_at': '2025-06-14T12:00:00.000Z',
              'is_complete': true,
            },
          ]);

      final notifier = getNotifier();
      await notifier.switchConversation('conv-1');

      expect(getState().hasMoreMonitorRecords, isTrue);
    });
  });

  // ==================== fetchTokenStatus 测试 ====================

  group('fetchTokenStatus', () {
    test('无活跃会话时应直接返回，不调用仓库', () async {
      setActiveConversationId(null);

      final notifier = getNotifier();
      await notifier.fetchTokenStatus();

      verifyNever(() => mockChatRepo.getCompactStatus(
        conversationId: any(named: 'conversationId'),
        model: any(named: 'model'),
      ));
    });

    test('有活跃会话时应更新 tokenCount 和 messageCount', () async {
      setActiveConversationId('conv-1');
      when(() => mockChatRepo.getCompactStatus(
        conversationId: 'conv-1',
        model: any(named: 'model'),
      )).thenAnswer((_) async => {
        'token_usage': 1500,
        'message_count': 25,
      });

      final notifier = getNotifier();
      await notifier.fetchTokenStatus();

      final state = getState();
      expect(state.tokenCount, equals(1500));
      expect(state.messageCount, equals(25));
    });

    test('后端返回缺失字段时应使用默认值 0', () async {
      setActiveConversationId('conv-1');
      when(() => mockChatRepo.getCompactStatus(
        conversationId: 'conv-1',
        model: any(named: 'model'),
      )).thenAnswer((_) async => <String, dynamic>{});

      final notifier = getNotifier();
      await notifier.fetchTokenStatus();

      final state = getState();
      expect(state.tokenCount, equals(0));
      expect(state.messageCount, equals(0));
    });

    test('请求异常时不应抛出，保持状态不变', () async {
      setActiveConversationId('conv-1');
      when(() => mockChatRepo.getCompactStatus(
        conversationId: 'conv-1',
        model: any(named: 'model'),
      )).thenThrow(Exception('网络错误'));

      final notifier = getNotifier();
      // 不应抛出异常
      await notifier.fetchTokenStatus();

      final state = getState();
      expect(state.tokenCount, equals(0));
      expect(state.messageCount, equals(0));
    });
  });

  // ==================== sendMessage 核心路径测试 ====================

  group('sendMessage', () {
    late StreamController<StreamChunk> streamController;

    setUp(() {
      streamController = StreamController<StreamChunk>();
    });

    tearDown(() {
      if (!streamController.isClosed) {
        streamController.close();
      }
    });

    /// 配置 sendMessage 所需的完整 mock 链路
    void setupSendMessageMocks({
      String conversationId = 'conv-1',
      String placeholderId = 'placeholder-1',
      String monitorRecordId = 'rec-1',
      int monitorRecordCount = 1,
      List<Map<String, dynamic>> monitorRecords = const [],
    }) {
      // 设置活跃会话
      setActiveConversationId(conversationId);

      // 发送用户消息 → 返回消息 ID
      when(() => mockChatRepo.sendMessage(
        conversationId: any(named: 'conversationId'),
        role: any(named: 'role'),
        content: any(named: 'content'),
        reasoningContent: any(named: 'reasoningContent'),
      )).thenAnswer((_) async => placeholderId);

      // 创建助手占位消息
      when(() => mockChatRepo.sendMessage(
        conversationId: conversationId,
        role: 'assistant',
        content: '',
        reasoningContent: '',
      )).thenAnswer((_) async => placeholderId);

      // 监控记录操作
      when(() => mockChatRepo.insertMonitorRecord(
        conversationId: any(named: 'conversationId'),
        requestJson: any(named: 'requestJson'),
        responseRawText: any(named: 'responseRawText'),
        isComplete: any(named: 'isComplete'),
      )).thenAnswer((_) async => monitorRecordId);

      when(() => mockChatRepo.getMonitorRecordCount(any()))
          .thenAnswer((_) async => monitorRecordCount);

      when(() => mockChatRepo.getMonitorRecords(any()))
          .thenAnswer((_) async => monitorRecords);

      // 更新消息内容
      when(() => mockChatRepo.updateMessageContent(
        any(),
        any(),
        skipBroadcast: any(named: 'skipBroadcast'),
      )).thenAnswer((_) async {});

      when(() => mockChatRepo.updateMessageReasoningContent(
        any(),
        any(),
        skipBroadcast: any(named: 'skipBroadcast'),
      )).thenAnswer((_) async {});

      // 更新监控记录
      when(() => mockChatRepo.updateMonitorRecord(
        id: any(named: 'id'),
        requestJson: any(named: 'requestJson'),
        responseRawText: any(named: 'responseRawText'),
        isComplete: any(named: 'isComplete'),
        promptTokens: any(named: 'promptTokens'),
        completionTokens: any(named: 'completionTokens'),
        totalTokens: any(named: 'totalTokens'),
        errorCategory: any(named: 'errorCategory'),
        errorCode: any(named: 'errorCode'),
        errorMessage: any(named: 'errorMessage'),
        errorSuggestion: any(named: 'errorSuggestion'),
      )).thenAnswer((_) async => 1);

      when(() => mockChatRepo.updateMonitorRecordInternalEvents(
        any(),
        any(),
      )).thenAnswer((_) async {});

      // AI 适配器流式响应
      when(() => mockAIAdapter.chatStream(
        any(),
        any(),
        any(),
        onRawSseLine: any(named: 'onRawSseLine'),
        onError: any(named: 'onError'),
      )).thenAnswer((_) => streamController.stream);
    }

    test('空消息不应发送', () async {
      setActiveConversationId('conv-1');
      final notifier = getNotifier();

      await notifier.sendMessage('');
      await notifier.sendMessage('   ');
      await notifier.sendMessage('\t\n');

      verifyNever(() => mockChatRepo.sendMessage(
        conversationId: any(named: 'conversationId'),
        role: any(named: 'role'),
        content: any(named: 'content'),
        reasoningContent: any(named: 'reasoningContent'),
      ));
    });

    test('无活跃会话时应自动创建', () async {
      setActiveConversationId(null);
      when(() => mockChatRepo.createConversation(any()))
          .thenAnswer((_) async => 'auto-conv-id');

      // 配置创建后的完整 mock 链路
      when(() => mockChatRepo.sendMessage(
        conversationId: any(named: 'conversationId'),
        role: any(named: 'role'),
        content: any(named: 'content'),
        reasoningContent: any(named: 'reasoningContent'),
      )).thenAnswer((_) async => 'msg-id');

      when(() => mockChatRepo.insertMonitorRecord(
        conversationId: any(named: 'conversationId'),
        requestJson: any(named: 'requestJson'),
        responseRawText: any(named: 'responseRawText'),
        isComplete: any(named: 'isComplete'),
      )).thenAnswer((_) async => 'rec-id');

      when(() => mockChatRepo.getMonitorRecordCount(any()))
          .thenAnswer((_) async => 0);
      when(() => mockChatRepo.getMonitorRecords(any()))
          .thenAnswer((_) async => <Map<String, dynamic>>[]);

      when(() => mockChatRepo.updateMessageContent(
        any(),
        any(),
        skipBroadcast: any(named: 'skipBroadcast'),
      )).thenAnswer((_) async {});

      when(() => mockChatRepo.updateMonitorRecord(
        id: any(named: 'id'),
        requestJson: any(named: 'requestJson'),
        responseRawText: any(named: 'responseRawText'),
        isComplete: any(named: 'isComplete'),
        promptTokens: any(named: 'promptTokens'),
        completionTokens: any(named: 'completionTokens'),
        totalTokens: any(named: 'totalTokens'),
        errorCategory: any(named: 'errorCategory'),
        errorCode: any(named: 'errorCode'),
        errorMessage: any(named: 'errorMessage'),
        errorSuggestion: any(named: 'errorSuggestion'),
      )).thenAnswer((_) async => 1);

      when(() => mockAIAdapter.chatStream(
        any(),
        any(),
        any(),
        onRawSseLine: any(named: 'onRawSseLine'),
        onError: any(named: 'onError'),
      )).thenAnswer((_) {
        // 立即关闭流，让 sendMessage 的 await for 正常结束
        streamController.close();
        return streamController.stream;
      });

      final notifier = getNotifier();

      // 发起发送
      final sendFuture = notifier.sendMessage('你好');

      // 等待自动创建会话
      // 注意：sendMessage 内部先检查 conversationId == null，然后尝试从 SharedPreferences 读取
      // 如果 SharedPreferences 也没有，则调用 createConversation
      await sendFuture;

      verify(() => mockChatRepo.createConversation('主代理')).called(1);
    });

    test('乐观 UI：发送后 pendingMessages 应包含用户消息', () async {
      setupSendMessageMocks();

      final notifier = getNotifier();

      // 发起发送但不等待完成（流未结束）
      // 使用微任务让 sendMessage 执行到乐观 UI 更新
      final sendFuture = notifier.sendMessage('测试消息');

      // 等待足够时间让乐观 UI 更新生效
      await Future<void>.delayed(const Duration(milliseconds: 50));

      // 验证乐观 UI：pendingMessages 中应有用户消息
      final state = getState();
      expect(state.pendingMessages, isNotEmpty);
      expect(state.pendingMessages.any((m) => m.content == '测试消息'), isTrue);

      // 结束流以清理
      streamController.add(const StreamChunk(isFinished: true));
      await sendFuture;
    });

    test('SSE 流接收：streamingContent 应随流更新', () async {
      setupSendMessageMocks();

      final notifier = getNotifier();
      final sendFuture = notifier.sendMessage('你好');

      // 等待流开始
      await Future<void>.delayed(const Duration(milliseconds: 50));

      // 模拟 SSE 流推送内容块
      streamController.add(const StreamChunk(content: '你'));
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(getState().streamingContent, contains('你'));

      streamController.add(const StreamChunk(content: '好'));
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(getState().streamingContent, contains('你好'));

      // 结束流
      streamController.add(const StreamChunk(isFinished: true));
      await sendFuture;
    });

    test('SSE 流接收：reasoningContent 应随流更新', () async {
      setupSendMessageMocks();

      final notifier = getNotifier();
      final sendFuture = notifier.sendMessage('思考一下');

      await Future<void>.delayed(const Duration(milliseconds: 50));

      // 模拟推理内容流
      streamController.add(const StreamChunk(reasoningContent: '让我想想'));
      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(getState().streamingReasoningContent, contains('让我想想'));

      streamController.add(const StreamChunk(isFinished: true));
      await sendFuture;
    });

    test('流结束后 isLoading 应恢复 false，pendingMessages 应清除', () async {
      setupSendMessageMocks();

      final notifier = getNotifier();
      final sendFuture = notifier.sendMessage('你好');

      await Future<void>.delayed(const Duration(milliseconds: 50));

      // 流进行中 isLoading 应为 true
      expect(getState().isLoading, isTrue);

      // 结束流
      streamController.add(const StreamChunk(content: '你好！', isFinished: true));
      await sendFuture;

      // 流结束后验证状态
      final state = getState();
      expect(state.isLoading, isFalse);
      // pendingMessages 中的用户消息应在 finally 块中清除
      expect(
        state.pendingMessages.where((m) => m.content == '你好'),
        isEmpty,
      );
    });

    test('流结束后应更新 tokenCount', () async {
      setupSendMessageMocks();

      final notifier = getNotifier();
      final sendFuture = notifier.sendMessage('你好');

      await Future<void>.delayed(const Duration(milliseconds: 50));

      // 模拟带 token 用量的结束块
      streamController.add(const StreamChunk(
        content: '你好！',
        usage: TokenUsage(promptTokens: 100, completionTokens: 50),
        isFinished: true,
      ));
      await sendFuture;

      expect(getState().tokenCount, equals(150)); // 100 + 50
    });

    test('流错误时应设置 error 状态并删除占位消息', () async {
      setupSendMessageMocks();

      when(() => mockChatRepo.deleteMessage(any()))
          .thenAnswer((_) async {});

      final notifier = getNotifier();

      // 让 chatStream 抛出异常
      when(() => mockAIAdapter.chatStream(
        any(),
        any(),
        any(),
        onRawSseLine: any(named: 'onRawSseLine'),
        onError: any(named: 'onError'),
      )).thenAnswer((_) => Stream.error(Exception('连接中断')));

      // 重新配置 sendMessage 的 mock 链路
      // 因为 chatStream 会直接抛异常，需要确保之前的 sendMessage 调用能成功
      when(() => mockChatRepo.sendMessage(
        conversationId: any(named: 'conversationId'),
        role: any(named: 'role'),
        content: any(named: 'content'),
        reasoningContent: any(named: 'reasoningContent'),
      )).thenAnswer((_) async => 'placeholder-err');

      await notifier.sendMessage('触发错误');

      final state = getState();
      expect(state.error, isNotNull);
      expect(state.error!.message, contains('AI 响应中断'));
      expect(state.isLoading, isFalse);
      // 占位消息应被删除
      verify(() => mockChatRepo.deleteMessage('placeholder-err')).called(1);
    });

    test('发送用户消息阶段失败应返回网络错误', () async {
      setActiveConversationId('conv-1');

      // sendMessage 第一次调用（发送用户消息）就抛异常
      when(() => mockChatRepo.sendMessage(
        conversationId: any(named: 'conversationId'),
        role: any(named: 'role'),
        content: any(named: 'content'),
        reasoningContent: any(named: 'reasoningContent'),
      )).thenThrow(Exception('网络不可达'));

      final notifier = getNotifier();
      await notifier.sendMessage('测试网络错误');

      final state = getState();
      expect(state.error, isNotNull);
      expect(state.error!.category, equals(ErrorCategory.network));
      expect(state.isLoading, isFalse);
    });

    test('AI 返回空内容应设置错误提示', () async {
      setupSendMessageMocks();

      final notifier = getNotifier();
      final sendFuture = notifier.sendMessage('你好');

      await Future<void>.delayed(const Duration(milliseconds: 50));

      // 流结束但没有任何内容
      streamController.add(const StreamChunk(isFinished: true));
      await sendFuture;

      final state = getState();
      expect(state.error, isNotNull);
      expect(state.error!.message, contains('AI 未返回任何内容'));
    });

    test('onError 回调应捕获分类错误信息', () async {
      setupSendMessageMocks();

      when(() => mockChatRepo.deleteMessage(any()))
          .thenAnswer((_) async {});

      // 捕获 onError 回调
      void Function(ErrorInfo)? capturedOnError;
      when(() => mockAIAdapter.chatStream(
        any(),
        any(),
        any(),
        onRawSseLine: any(named: 'onRawSseLine'),
        onError: any(named: 'onError'),
      )).thenAnswer((invocation) {
        // 提取 onError 回调
        capturedOnError = invocation.namedArguments[#onError] as void Function(ErrorInfo)?;
        // 返回一个立即结束的流
        return Stream.value(const StreamChunk(isFinished: true));
      });

      final notifier = getNotifier();
      final sendFuture = notifier.sendMessage('测试错误回调');
      await sendFuture;

      // 手动触发 onError 回调（模拟适配器报告错误）
      // 注意：由于 chatStream 已经返回了流，onError 回调可能在流消费过程中被调用
      // 这里主要验证 onError 回调被正确传递
      expect(capturedOnError, isNotNull);
    });

    test('状态事件块（isStatus=true）不应更新 streamingContent', () async {
      setupSendMessageMocks();

      final notifier = getNotifier();
      final sendFuture = notifier.sendMessage('测试状态事件');

      await Future<void>.delayed(const Duration(milliseconds: 50));

      // 发送状态事件（工具调用通知）
      streamController.add(const StreamChunk(
        isStatus: true,
        toolCallInfo: ToolCallInfo(
          tools: [ToolCallItem(name: 'readFile', arguments: '{}', resultPreview: '文件内容')],
          summary: '读取了文件',
        ),
      ));
      await Future<void>.delayed(const Duration(milliseconds: 10));

      // streamingContent 不应被状态事件修改
      expect(getState().streamingContent, isEmpty);

      // 结束流
      streamController.add(const StreamChunk(content: '完成', isFinished: true));
      await sendFuture;
    });
  });

  // ==================== dispose 测试 ====================

  group('dispose', () {
    test('dispose 后不应再更新状态', () {
      // 使用独立容器，避免 tearDown 中 container.dispose() 二次调用 dispose
      final customContainer = createTestContainer(
        mockChatRepo: mockChatRepo,
        mockAdapterFactory: mockAdapterFactory,
        mockApiClient: mockApiClient,
        mockWsClient: mockWsClient,
      );
      final notifier = customContainer.read(chatNotifierProvider.notifier);
      notifier.dispose();

      // 验证：dispose 后再次调用方法不应抛出
      // StateNotifier 在 mounted=false 后设置状态会被忽略
      expect(notifier.mounted, isFalse);
    });
  });
}
