import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/utils/collection_utils.dart';
import '../../data/models/chat_message.dart';
import '../../data/models/conversation.dart';
import '../../infrastructure/ai_adapter/models/error_info.dart';
import 'api_monitor_record.dart';
import 'providers.dart';
import 'settings_cache.dart';

/// 当前选中的模型 ID Provider
///
/// 监听 settingsCacheProvider 变化，确保 SettingsCache 初始化完成后自动同步模型选择。
final selectedModelProvider = StateProvider<String>(
  (ref) => ref.watch(settingsCacheProvider).selectedModel,
);

/// 当前活跃会话 ID Provider
final activeConversationIdProvider = StateProvider<String?>((ref) => null);

/// 指定会话的消息列表流 Provider，通过 WebSocket 事件自动刷新
final conversationMessagesProvider =
    StreamProvider.family<List<ChatMessage>, String>((ref, conversationId) {
      final repo = ref.watch(chatRepositoryProvider);
      return repo.watchMessages(conversationId, limit: 2000);
    });

/// 会话列表流 Provider，通过 WebSocket 事件自动刷新
final conversationsProvider = StreamProvider<List<Conversation>>((ref) {
  final repo = ref.watch(chatRepositoryProvider);
  return repo.watchConversations();
});

/// 聊天状态 — 包含流式内容、监控记录、子代理活动时间等
///
/// 由 [ChatNotifier] 管理，通过 [copyWith] 不可变更新。
/// 关键字段说明：
/// - [streamingContent] / [streamingReasoningContent]: SSE 流式接收中的实时内容
/// - [pendingMessages]: 乐观 UI 的待确认消息（负 ID，SSE 推送后移除）
/// - [apiInputHistory]: 监控面板的 API 调用记录列表
/// - [lastMemoryAt] / [lastCompactAt] / [lastDreamAt]: 子代理最近执行时间
class ChatState {
  /// 是否正在接收 AI 流式响应
  final bool isLoading;

  /// 最近一次错误信息，null 表示无错误
  final ErrorInfo? error;

  /// 当前流式接收中的 AI 响应内容
  final String streamingContent;

  /// 当前流式接收中的推理（思考）内容
  final String streamingReasoningContent;

  /// 当前流式响应对应的助手消息 ID（用于实时更新占位消息）
  final String? streamingAssistantMessageId;

  /// 乐观 UI 的待确认消息列表（SSE 推送确认后移除）
  final List<ChatMessage> pendingMessages;

  /// 监控面板的 API 调用记录（最新优先）
  final List<ApiMonitorRecord> apiInputHistory;

  /// 监控记录是否还有更多可加载
  final bool hasMoreMonitorRecords;

  /// 是否正在加载更多监控记录
  final bool isLoadingMoreMonitor;

  /// 当前会话已消耗的 token 总量
  final int tokenCount;

  /// 当前会话的消息数量
  final int messageCount;

  /// 上次记忆提取完成时间
  final DateTime? lastMemoryAt;

  /// 上次上下文压缩完成时间
  final DateTime? lastCompactAt;

  /// 上次梦境整理完成时间
  final DateTime? lastDreamAt;

  /// 触发记忆提取的最小消息数
  final int memoryMinMessages;

  /// 两次记忆提取之间的最小 token 增量
  final int memoryMinTokensBetweenUpdate;

  /// 上次记忆提取时的 token 计数
  final int lastMemoryTokenCount;

  /// 触发自动压缩的 token 阈值
  final int compactTriggerTokens;

  /// 触发梦境整理的最小间隔小时数
  final int dreamMinHours;

  const ChatState({
    this.isLoading = false,
    this.error,
    this.streamingContent = '',
    this.streamingReasoningContent = '',
    this.streamingAssistantMessageId,
    this.pendingMessages = const [],
    this.apiInputHistory = const [],
    this.hasMoreMonitorRecords = false,
    this.isLoadingMoreMonitor = false,
    this.tokenCount = 0,
    this.messageCount = 0,
    this.lastMemoryAt,
    this.lastCompactAt,
    this.lastDreamAt,
    this.memoryMinMessages = 6,
    this.memoryMinTokensBetweenUpdate = 2000,
    this.lastMemoryTokenCount = 0,
    this.compactTriggerTokens = 200000,
    this.dreamMinHours = 24,
  });

  ChatState copyWith({
    bool? isLoading,
    ErrorInfo? error,
    String? streamingContent,
    String? streamingReasoningContent,
    String? streamingAssistantMessageId,
    List<ChatMessage>? pendingMessages,
    List<ApiMonitorRecord>? apiInputHistory,
    bool? hasMoreMonitorRecords,
    bool? isLoadingMoreMonitor,
    bool clearStreamingAssistantMessageId = false,
    bool clearPendingMessages = false,
    bool clearApiInputHistory = false,
    bool clearError = false,
    int? tokenCount,
    int? messageCount,
    DateTime? lastMemoryAt,
    bool clearLastMemoryAt = false,
    DateTime? lastCompactAt,
    bool clearLastCompactAt = false,
    DateTime? lastDreamAt,
    bool clearLastDreamAt = false,
    int? memoryMinMessages,
    int? memoryMinTokensBetweenUpdate,
    int? lastMemoryTokenCount,
    int? compactTriggerTokens,
    int? dreamMinHours,
  }) {
    // 仅在列表实际变更时创建新副本，未变更时直接引用原列表
    final newPendingMessages = clearPendingMessages
        ? const <ChatMessage>[]
        : (pendingMessages != null
              ? List<ChatMessage>.unmodifiable(pendingMessages)
              : this.pendingMessages);
    final newApiInputHistory = clearApiInputHistory
        ? const <ApiMonitorRecord>[]
        : (apiInputHistory != null
              ? List<ApiMonitorRecord>.unmodifiable(apiInputHistory)
              : this.apiInputHistory);

    return ChatState(
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      streamingContent: streamingContent ?? this.streamingContent,
      streamingReasoningContent:
          streamingReasoningContent ?? this.streamingReasoningContent,
      streamingAssistantMessageId: clearStreamingAssistantMessageId
          ? null
          : (streamingAssistantMessageId ?? this.streamingAssistantMessageId),
      pendingMessages: newPendingMessages,
      apiInputHistory: newApiInputHistory,
      hasMoreMonitorRecords:
          hasMoreMonitorRecords ?? this.hasMoreMonitorRecords,
      isLoadingMoreMonitor: isLoadingMoreMonitor ?? this.isLoadingMoreMonitor,
      tokenCount: tokenCount ?? this.tokenCount,
      messageCount: messageCount ?? this.messageCount,
      lastMemoryAt: clearLastMemoryAt
          ? null
          : (lastMemoryAt ?? this.lastMemoryAt),
      lastCompactAt: clearLastCompactAt
          ? null
          : (lastCompactAt ?? this.lastCompactAt),
      lastDreamAt: clearLastDreamAt ? null : (lastDreamAt ?? this.lastDreamAt),
      memoryMinMessages: memoryMinMessages ?? this.memoryMinMessages,
      memoryMinTokensBetweenUpdate:
          memoryMinTokensBetweenUpdate ?? this.memoryMinTokensBetweenUpdate,
      lastMemoryTokenCount: lastMemoryTokenCount ?? this.lastMemoryTokenCount,
      compactTriggerTokens: compactTriggerTokens ?? this.compactTriggerTokens,
      dreamMinHours: dreamMinHours ?? this.dreamMinHours,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ChatState &&
          runtimeType == other.runtimeType &&
          isLoading == other.isLoading &&
          error == other.error &&
          streamingContent == other.streamingContent &&
          streamingReasoningContent == other.streamingReasoningContent &&
          streamingAssistantMessageId == other.streamingAssistantMessageId &&
          (identical(pendingMessages, other.pendingMessages) ||
              listEquals(pendingMessages, other.pendingMessages)) &&
          (identical(apiInputHistory, other.apiInputHistory) ||
              listEquals(apiInputHistory, other.apiInputHistory)) &&
          hasMoreMonitorRecords == other.hasMoreMonitorRecords &&
          isLoadingMoreMonitor == other.isLoadingMoreMonitor &&
          tokenCount == other.tokenCount &&
          messageCount == other.messageCount &&
          lastMemoryAt == other.lastMemoryAt &&
          lastCompactAt == other.lastCompactAt &&
          lastDreamAt == other.lastDreamAt &&
          memoryMinMessages == other.memoryMinMessages &&
          memoryMinTokensBetweenUpdate == other.memoryMinTokensBetweenUpdate &&
          lastMemoryTokenCount == other.lastMemoryTokenCount &&
          compactTriggerTokens == other.compactTriggerTokens &&
          dreamMinHours == other.dreamMinHours;

  @override
  int get hashCode => Object.hash(
    isLoading,
    error,
    streamingContent,
    streamingReasoningContent,
    streamingAssistantMessageId,
    pendingMessages.length, // 用长度代替完整哈希，减少计算量
    apiInputHistory.length,
    hasMoreMonitorRecords,
    isLoadingMoreMonitor,
    tokenCount,
    messageCount,
    lastMemoryAt,
    lastCompactAt,
    lastDreamAt,
    memoryMinMessages,
    memoryMinTokensBetweenUpdate,
    lastMemoryTokenCount,
    compactTriggerTokens,
    dreamMinHours,
  );
}
