# 聊天深模块接口设计

> 替代 `ChatNotifier` + `ChatAgentMixin` + `ChatMonitorMixin` 的**最大化灵活性**架构。

---

## 1. 架构总览

```
┌─────────────────────────────────────────────┐
│              UI Layer (Widgets)               │
│   ChatPage / TerminalPanel / MonitorPage      │
├─────────────────────────────────────────────┤
│           Deep Module Interface             │
│         ┌─────────────────┐                   │
│         │   ChatFacade    │  ← 唯一操作入口   │
│         │   (深模块接口)   │                 │
│         └────────┬────────┘                 │
├──────────────────┼──────────────────────────┤
│   Facade 内部组合多个独立服务（纯 Dart）      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Session  │ │ Streaming│ │ Monitor  │   │
│  │ Service  │ │ Service  │ │ Service  │   │
│  └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐               │
│  │ Agent    │ │ Message  │               │
│  │ Tracking │ │ Service  │               │
│  │ Service  │ │          │               │
│  └──────────┘ └──────────┘               │
├─────────────────────────────────────────────┤
│         Riverpod State Notifiers            │
│  ChatStreamNotifier / PendingMessagesNotifier│
│  MonitorRecordsNotifier / AgentTrackingNotifier│
├─────────────────────────────────────────────┤
│        Infrastructure (Repositories)          │
│   RemoteChatRepository / AIAdapter / WS     │
└─────────────────────────────────────────────┘
```

---

## 2. 核心设计决策

### 2.1 拆分 God Object `ChatState`

原 `ChatState` 有 20+ 字段，被 Mixin 直接读写，导致：
- 任何字段变更都触发整个 UI 重建
- Mixin 之间通过 `state` 隐式耦合
- 无法独立测试子功能

**新设计**：拆分为 4 个独立的 Riverpod State：

| 状态 | 职责 | 对应原字段 |
|------|------|-----------|
| `ChatStreamState` | SSE 流式过程 | `isLoading`, `streamingContent`, `streamingReasoningContent`, `streamingAssistantMessageId`, `error` |
| `PendingMessageState` | 乐观 UI | `pendingMessages` |
| `MonitorState` | 监控面板 | `apiInputHistory`, `hasMoreMonitorRecords`, `isLoadingMoreMonitor` |
| `AgentTrackingState` | 子代理进度 | `lastMemoryAt`, `lastCompactAt`, `lastDreamAt`, `tokenCount`, `messageCount`, 阈值参数 |

### 2.2 用组合替代 Mixin

原架构：`ChatNotifier extends StateNotifier<ChatState> with ChatAgentMixin, ChatMonitorMixin`

问题：Mixin 直接读写 `state`，没有清晰的契约边界。

新架构：`ChatFacade` 通过构造函数**组合** 4 个 Service 接口：

```dart
class ChatFacadeImpl implements ChatFacade {
  final SessionService _sessionService;
  final StreamingService _streamingService;
  final MonitorService _monitorService;
  final AgentTrackingService _trackingService;
  // ...
}
```

每个 Service 是**纯 Dart 接口**，不依赖 Flutter/Riverpod，可独立单元测试。

### 2.3 可扩展的 AgentType（Sealed Class）

原架构：硬编码 `['main', 'memory', 'compact', 'dream']` 字符串数组。

新架构：使用 Dart 3 sealed class，未来添加新代理类型**无需修改现有代码**：

```dart
sealed class AgentType {
  String get key;
  String get defaultTitle;
}

// 内置类型
class MainAgentType extends AgentType { ... }
class MemoryAgentType extends AgentType { ... }
class CompactAgentType extends AgentType { ... }
class DreamAgentType extends AgentType { ... }

// 未来扩展：自定义代理
class CustomAgentType extends AgentType {
  final String key;
  final String defaultTitle;
  const CustomAgentType(this.key, this.defaultTitle);
}
```

### 2.4 流式协议抽象

原架构：直接调用 `adapter.chatStream()`，SSE 逻辑硬编码在 `ChatNotifier` 中。

新架构：`StreamingService` 内部封装 SSE，但对外只暴露状态回调。未来支持 WebSocket 流式时，只需替换内部实现，Facade 接口不变。

---

## 3. 接口签名

### 3.1 门面接口 `ChatFacade`

```dart
/// 聊天门面 — 深模块接口
///
/// 对外隐藏 SSE 连接、乐观 UI 生命周期、监控记录分页、
/// 子代理会话持久化、节流更新等全部复杂度。
abstract interface class ChatFacade {
  // ─── 初始化 ───
  Future<void> initialize();

  // ─── 会话管理 ───
  Future<void> switchAgent(AgentType type);
  Future<void> createSession(String title);
  Future<void> clearAgentSession(AgentType type);
  String? get activeConversationId;
  AgentType get activeAgentType;

  // ─── 消息发送 ───
  Future<void> sendMessage(String content);
  void cancelStreaming();

  // ─── 监控 ───
  Future<void> clearMonitorHistory();
  Future<void> loadMoreMonitorHistory();

  // ─── 子代理活动 ───
  void trackSubAgentActivity(Map<String, dynamic> rawActivity);
  Future<void> saveSubAgentOutputToConversation(Map<String, dynamic> rawActivity);

  // ─── 工具 ───
  Future<void> fetchTokenStatus();
  void updateAgentParams(AgentParams params);
}
```

### 3.2 服务层接口

```dart
// SessionService — 代理会话的创建、查找、持久化
abstract interface class SessionService {
  Future<String> resolveSession(AgentType type);
  Future<void> persistSession(AgentType type, String conversationId);
  Future<void> clearSession(AgentType type);
  Future<List<Conversation>> listExistingSessions();
}

// StreamingService — SSE 流式发送，纯 Dart，无 Riverpod 依赖
abstract interface class StreamingService {
  Future<void> sendMessage({
    required String conversationId,
    required String content,
    required AIAdapter adapter,
    required ChatOptions options,
    required void Function(String placeholderId) onPlaceholderCreated,
    required void Function(ChatStreamState state) onStateChange,
    required void Function() onComplete,
    required void Function(ErrorInfo error) onError,
  });
  void cancel();
}

// MonitorService — 监控记录的完整生命周期
abstract interface class MonitorService {
  Future<MonitorRecord> startRecord(String conversationId);
  Future<void> updateRecord(String id, MonitorUpdate update);
  Future<void> appendEvent(String recordId, InternalEvent event);
  Future<MonitorPage> loadRecords(String conversationId, {int limit = 200, int offset = 0});
  Future<void> clearRecords(String conversationId);
  Future<void> finalizeRecord(String id, {TokenUsage? usage, ErrorInfo? error});
}

// AgentTrackingService — 子代理活动时间与进度计算
abstract interface class AgentTrackingService {
  void recordActivity(AgentActivity activity);
  DateTime? getLastRunTime(AgentType type);
  int? getLastTokenCount(AgentType type);
  AgentProgress calculateProgress({
    required int currentTokenCount,
    required int messageCount,
    required AgentParams params,
  });
}
```

### 3.3 状态模型

```dart
// 流式状态 — 独立、精简
class ChatStreamState {
  final bool isLoading;
  final ErrorInfo? error;
  final String streamingContent;
  final String streamingReasoningContent;
  final String? streamingAssistantMessageId;
  
  const ChatStreamState({...});
  ChatStreamState copyWith({...});
}

// 监控状态 — 包含分页元数据
class MonitorState {
  final List<MonitorRecord> records;
  final int totalCount;
  final bool isLoadingMore;
  
  bool get hasMore => records.length < totalCount;
  
  const MonitorState({...});
}

// 子代理进度 — UI 直接消费
class AgentProgress {
  final double memoryProgress;   // 0.0 ~ 1.0
  final double compactProgress;
  final double dreamProgress;
  final bool isMemoryRunning;
  final bool isCompactRunning;
  final bool isDreamRunning;
  
  const AgentProgress({...});
}

// 代理参数 — 从 SettingsCache 解耦后的纯数据对象
class AgentParams {
  final int memoryMinMessages;
  final int memoryMinTokensBetweenUpdate;
  final int compactTriggerTokens;
  final int dreamMinHours;
  
  const AgentParams({...});
}
```

### 3.4 Riverpod Provider 设计

```dart
// 1. 原子化状态 Provider（UI 按需 watch，避免过度重建）
final chatStreamStateProvider = StateNotifierProvider<ChatStreamNotifier, ChatStreamState>((ref) {
  return ChatStreamNotifier();
});

final pendingMessagesProvider = StateNotifierProvider<PendingMessagesNotifier, List<ChatMessage>>((ref) {
  return PendingMessagesNotifier();
});

final monitorStateProvider = StateNotifierProvider<MonitorRecordsNotifier, MonitorState>((ref) {
  return MonitorRecordsNotifier(repository: ref.watch(chatRepositoryProvider));
});

final agentTrackingProvider = StateNotifierProvider<AgentTrackingNotifier, AgentTrackingState>((ref) {
  return AgentTrackingNotifier();
});

// 2. 派生 Provider（UI 直接消费，零成本组合）
final agentProgressProvider = Provider<AgentProgress>((ref) {
  final tracking = ref.watch(agentTrackingProvider);
  final tokenCount = tracking.currentTokenCount;
  final messageCount = tracking.currentMessageCount;
  final params = tracking.params;
  // 内部调用 calculateProgress
  return ref.read(agentTrackingProvider.notifier).calculateProgress(
    currentTokenCount: tokenCount,
    messageCount: messageCount,
    params: params,
  );
});

// 3. 门面 Provider（提供操作入口）
final chatFacadeProvider = Provider<ChatFacade>((ref) {
  return ChatFacadeImpl(
    ref: ref,
    sessionService: ref.watch(sessionServiceProvider),
    streamingService: ref.watch(streamingServiceProvider),
    monitorService: ref.watch(monitorServiceProvider),
    trackingService: ref.watch(agentTrackingServiceProvider),
  );
});
```

---

## 4. 使用示例

### 4.1 页面初始化（替代原 `initState` 中的 7 步初始化）

```dart
@override
void initState() {
  super.initState();
  Future.microtask(() async {
    // 一行替代：ensureAgentConversations + updateAgentParams + fetchTokenStatus
    await ref.read(chatFacadeProvider).initialize();
  });
}
```

### 4.2 发送消息（UI 层完全看不到 SSE、节流、占位消息）

```dart
Future<void> _sendMessage() async {
  final text = _messageController.text.trim();
  if (text.isEmpty) return;
  _messageController.clear();
  
  // Facade 内部处理：乐观 UI → SSE → 节流更新 → 最终保存 → 清理 pending
  await ref.read(chatFacadeProvider).sendMessage(text);
  
  _scrollToBottom();
}
```

### 4.3 监听流式内容（只重建消息列表相关部分）

```dart
// 原架构：watch 整个 ChatState（20+ 字段全部重建）
// final chatState = ref.watch(chatNotifierProvider);

// 新架构：只 watch 流式内容
final streamingContent = ref.watch(
  chatStreamStateProvider.select((s) => s.streamingContent),
);
```

### 4.4 切换代理（自动加载监控记录、重置流式状态）

```dart
Future<void> _switchToMemoryAgent() async {
  await ref.read(chatFacadeProvider).switchAgent(const MemoryAgentType());
  // Facade 内部完成：
  // 1. 从 SharedPreferences 读取/创建 memory 会话
  // 2. 加载该会话的监控记录到 monitorStateProvider
  // 3. 重置 chatStreamStateProvider
}
```

### 4.5 处理 WebSocket 子代理活动

```dart
_wsSub = wsClient.events.listen((event) {
  if (event.type == 'session_memory_activity' ||
      event.type == 'compact_activity' ||
      event.type == 'dream_activity') {
    
    final facade = ref.read(chatFacadeProvider);
    
    // 1. 追踪活动时间
    facade.trackSubAgentActivity(event.payload);
    
    // 2. 保存输出到对应代理会话
    facade.saveSubAgentOutputToConversation(event.payload);
    
    // 3. UI 通过 agentProgressProvider 自动重建进度条
  }
});
```

### 4.6 监控面板（独立状态，不影响聊天区域）

```dart
class TerminalPanel extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final monitorState = ref.watch(monitorStateProvider);
    
    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            itemCount: monitorState.records.length,
            itemBuilder: (_, i) => MonitorRecordTile(monitorState.records[i]),
          ),
        ),
        if (monitorState.hasMore)
          TextButton(
            onPressed: () => ref.read(chatFacadeProvider).loadMoreMonitorHistory(),
            child: const Text('Load More'),
          ),
      ],
    );
  }
}
```

---

## 5. 内部隐藏的复杂度

| 复杂度 | 原位置 | 新位置 | 隐藏方式 |
|--------|--------|--------|----------|
| **SSE 流式连接管理** | `ChatNotifier.sendMessage()` 内 80+ 行 | `StreamingServiceImpl` | Facade 只暴露 `sendMessage(content)` |
| **150ms 节流更新** | `ChatNotifier._updateThrottle` | `StreamingServiceImpl` | 封装在 Service 内部，UI 无感知 |
| **占位消息生命周期** | `ChatNotifier` 内创建→更新→删除 | `StreamingServiceImpl` | 通过 `onPlaceholderCreated` 回调暴露 ID |
| **乐观 UI 清理** | `ChatNotifier.clearPendingIfMatched()` | `PendingMessagesNotifier` | 流完成后自动清理，UI 只 watch 状态 |
| **监控记录分页 SQL** | `ChatMonitorMixin.loadMoreMonitorRecords()` | `MonitorServiceImpl` | Facade 只暴露 `loadMoreMonitorHistory()` |
| **SharedPreferences 类型兼容** | `ChatAgentMixin.getPrefString()` | `SessionServiceImpl` | 完全封装在会话服务中 |
| **子代理活动时间追踪** | `ChatMonitorMixin.addSubAgentActivityToHistory()` | `AgentTrackingServiceImpl` | 封装为 `AgentProgress` 纯数据对象 |
| **AI 内容加日期标记** | `ChatNotifier.sendMessage()` 内 15 行 | `ChatFacadeImpl._prepareAiContent()` | 私有方法，调用方无感知 |
| **Token 用量聚合** | `ChatNotifier` 流结束处 | `MonitorService.finalizeRecord()` | 自动计算 prompt + completion |
| **错误阶段分类** | `ChatNotifier` catch 块 30+ 行 | `StreamingServiceImpl` | 统一映射为 `ErrorInfo` |

---

## 6. 依赖策略

### 6.1 分层依赖规则（严格单向）

```
UI Layer ──watch──→ Riverpod Notifiers ──call──→ Services ──call──→ Repositories
     ↑                                                    ↑
     └──────────────── 绝不反向 ──────────────────────────┘
```

- **Services 层**：纯 Dart，零 Flutter/Riverpod 依赖 → **可单元测试**
- **Notifiers 层**：仅依赖 Riverpod + Services → **可 Widget 测试**
- **Facade 层**：持有 `Ref`，但只用于读写 Provider，不直接调用 Repository

### 6.2 依赖注入方式

```dart
// Service Provider（工厂函数，每次创建新实例）
final sessionServiceProvider = Provider<SessionService>((ref) {
  return SessionServiceImpl(
    repository: ref.watch(chatRepositoryProvider),
    prefs: ref.watch(sharedPreferencesProvider),
  );
});

// Facade Provider（组合所有 Service）
final chatFacadeProvider = Provider<ChatFacade>((ref) {
  return ChatFacadeImpl(
    ref: ref,  // 仅用于读写原子化 Provider
    sessionService: ref.watch(sessionServiceProvider),
    streamingService: ref.watch(streamingServiceProvider),
    monitorService: ref.watch(monitorServiceProvider),
    trackingService: ref.watch(agentTrackingServiceProvider),
  );
});
```

### 6.3 测试时的依赖替换

```dart
// 单元测试：直接 Mock Service
class MockStreamingService implements StreamingService {
  @override
  Future<void> sendMessage({...}) async {
    onPlaceholderCreated?.call('placeholder_1');
    onStateChange?.call(const ChatStreamState(streamingContent: 'Hello'));
    onComplete?.call();
  }
  @override void cancel() {}
}

// Widget 测试：使用 Provider override
await tester.pumpWidget(
  ProviderScope(
    overrides: [
      chatFacadeProvider.overrideWithValue(mockFacade),
    ],
    child: const ChatPage(),
  ),
);
```

---

## 7. 权衡取舍

### 7.1 优势

| 维度 | 原架构 | 新架构 |
|------|--------|--------|
| **测试性** | 0 个测试文件，Mixin 直接耦合 StateNotifier | 每个 Service 可独立 Mock 测试 |
| **可扩展性** | 新增代理类型需改 `ChatAgentMixin._agentTitles` 和多处 switch | 新增 `CustomAgentType extends AgentType` 即可 |
| **UI 重建粒度** | watch 整个 `ChatState`（20+ 字段） | 按需 `select` 单个字段 |
| **职责边界** | Mixin 互相读写 state，隐式耦合 | Service 通过接口契约交互，显式依赖 |
| **流式协议替换** | 修改 636 行的 `ChatNotifier` | 只替换 `StreamingServiceImpl` |
| **监控指标扩展** | 修改 `ApiMonitorRecord` 和 Mixin | 添加 `MonitorMetric` 子类 |

### 7.2 代价

| 代价 | 说明 | 缓解措施 |
|------|------|----------|
| **文件数量增加** | 从 3 个文件 → 15+ 个文件 | 按功能分目录，IDE 导航无压力 |
| **接口层代码量** | 需要定义 Service 接口 + 实现 + Provider | 使用代码生成（如 freezed）减少样板 |
| **Facade 成为上帝类风险** | 如果 Facade 方法过多 | 保持 Facade 只协调，不实现逻辑；方法数 ≈ 原 `ChatNotifier` 公开方法数 |
| **状态一致性** | 4 个独立 State 需要同步 | Facade 作为唯一写入入口，保证事务性更新 |
| **学习成本** | 开发者需要理解分层 | 提供 `DESIGN.md` 和示例代码 |

### 7.3 与纯 Riverpod 方案的对比

另一种极端设计是**完全不用 Facade**，让 UI 直接调用各个 Service Provider：

```dart
// 纯 Riverpod 方案（不推荐）
await ref.read(streamingServiceProvider).sendMessage(...);
ref.read(monitorServiceProvider).startRecord(...);
```

**不采用的原因**：
- UI 需要了解 4 个 Service 的调用顺序和依赖关系
- 发送消息需要 5+ 步调用，容易遗漏（如忘记创建监控记录）
- 乐观 UI 和流式状态的同步逻辑泄漏到 UI 层

**Facade 的价值**：把"发送消息"这个**用例**封装为单一操作，隐藏内部的 5+ 步协调。

---

## 8. 迁移路径

建议按以下顺序逐步替换，而非一次性重写：

1. **Phase 1**：创建 `ChatFacade` 接口和空实现，让 `ChatNotifier` 委托给 Facade
2. **Phase 2**：逐个提取 Service（先 `SessionService`，再 `MonitorService`）
3. **Phase 3**：拆分 `ChatState` 为独立 Provider，UI 逐步改用 `select`
4. **Phase 4**：删除 `ChatAgentMixin` 和 `ChatMonitorMixin`，`ChatNotifier` 变为薄包装
5. **Phase 5**：删除 `ChatNotifier`，UI 直接消费 Facade + 原子化 Provider

---

## 9. 文件清单

```
lib/core/chat_facade/
├── DESIGN.md                          # 本文档
├── chat_facade.dart                   # ChatFacade 接口 + 实现
├── providers.dart                     # 所有 Riverpod Provider
├── models/
│   ├── agent_type.dart                # Sealed class AgentType
│   ├── chat_stream_state.dart         # 流式状态
│   ├── monitor_state.dart             # 监控状态
│   ├── agent_progress.dart            # 子代理进度
│   ├── chat_options.dart              # AI 请求选项
│   └── agent_params.dart              # 代理触发参数
└── services/
    ├── session_service.dart           # 会话管理接口 + 实现
    ├── streaming_service.dart         # SSE 流式接口 + 实现
    ├── monitor_service.dart           # 监控记录接口 + 实现
    └── agent_tracking_service.dart    # 子代理追踪接口 + 实现
```
