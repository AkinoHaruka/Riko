import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/chat_message.dart';
import '../../data/models/conversation.dart';
import 'api_monitor_record.dart';
import 'providers.dart';
import 'settings_cache.dart';

/// 当前选中的模型 ID Provider
final selectedModelProvider = StateProvider<String>(
  (ref) => ref.read(settingsCacheProvider).selectedModel,
);

/// 当前活跃会话 ID Provider
final activeConversationIdProvider = StateProvider<String?>((ref) => null);

/// 指定会话的消息列表流 Provider，通过 WebSocket 事件自动刷新
final conversationMessagesProvider =
    StreamProvider.family<List<ChatMessage>, String>((ref, conversationId) {
      final repo = ref.watch(chatRepositoryProvider);
      return repo.watchMessages(conversationId, limit: 50);
    });

/// 会话列表流 Provider，通过 WebSocket 事件自动刷新
final conversationsProvider = StreamProvider<List<Conversation>>((
  ref,
) {
  final repo = ref.watch(chatRepositoryProvider);
  return repo.watchConversations();
});

/// 聊天状态 — 包含流式内容、监控记录、子代理活动时间等
class ChatState {
  final bool isLoading;
  final String? error;
  final String streamingContent;
  final String streamingReasoningContent;
  final String? streamingAssistantMessageId;
  final List<ChatMessage> pendingMessages;
  final List<ApiMonitorRecord> apiInputHistory;
  final bool hasMoreMonitorRecords;
  final bool isLoadingMoreMonitor;
  final int tokenCount;
  final int messageCount;
  final DateTime? lastMemoryAt;
  final DateTime? lastCompactAt;
  final DateTime? lastDreamAt;
  final int memoryMinMessages;
  final int memoryMinTokensBetweenUpdate;
  final int lastMemoryTokenCount;
  final int compactTriggerTokens;
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
    String? error,
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
    DateTime? lastCompactAt,
    DateTime? lastDreamAt,
    int? memoryMinMessages,
    int? memoryMinTokensBetweenUpdate,
    int? lastMemoryTokenCount,
    int? compactTriggerTokens,
    int? dreamMinHours,
  }) {
    return ChatState(
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      streamingContent: streamingContent ?? this.streamingContent,
      streamingReasoningContent:
          streamingReasoningContent ?? this.streamingReasoningContent,
      streamingAssistantMessageId: clearStreamingAssistantMessageId
          ? null
          : (streamingAssistantMessageId ?? this.streamingAssistantMessageId),
      pendingMessages: clearPendingMessages
          ? []
          : (pendingMessages ?? this.pendingMessages),
      apiInputHistory: clearApiInputHistory
          ? []
          : (apiInputHistory ?? this.apiInputHistory),
      hasMoreMonitorRecords:
          hasMoreMonitorRecords ?? this.hasMoreMonitorRecords,
      isLoadingMoreMonitor: isLoadingMoreMonitor ?? this.isLoadingMoreMonitor,
      tokenCount: tokenCount ?? this.tokenCount,
      messageCount: messageCount ?? this.messageCount,
      lastMemoryAt: lastMemoryAt ?? this.lastMemoryAt,
      lastCompactAt: lastCompactAt ?? this.lastCompactAt,
      lastDreamAt: lastDreamAt ?? this.lastDreamAt,
      memoryMinMessages: memoryMinMessages ?? this.memoryMinMessages,
      memoryMinTokensBetweenUpdate:
          memoryMinTokensBetweenUpdate ?? this.memoryMinTokensBetweenUpdate,
      lastMemoryTokenCount:
          lastMemoryTokenCount ?? this.lastMemoryTokenCount,
      compactTriggerTokens:
          compactTriggerTokens ?? this.compactTriggerTokens,
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
          _listEquals(pendingMessages, other.pendingMessages) &&
          _listEquals(apiInputHistory, other.apiInputHistory) &&
          hasMoreMonitorRecords == other.hasMoreMonitorRecords &&
          isLoadingMoreMonitor == other.isLoadingMoreMonitor &&
          tokenCount == other.tokenCount &&
          messageCount == other.messageCount &&
          lastMemoryAt == other.lastMemoryAt &&
          lastCompactAt == other.lastCompactAt &&
          lastDreamAt == other.lastDreamAt &&
          memoryMinMessages == other.memoryMinMessages &&
          memoryMinTokensBetweenUpdate ==
              other.memoryMinTokensBetweenUpdate &&
          lastMemoryTokenCount == other.lastMemoryTokenCount &&
          compactTriggerTokens == other.compactTriggerTokens &&
          dreamMinHours == other.dreamMinHours;

  static bool _listEquals<T>(List<T>? a, List<T>? b) {
    if (identical(a, b)) return true;
    if (a == null || b == null) return a == b;
    if (a.length != b.length) return false;
    for (int i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(
        isLoading,
        error,
        streamingContent,
        streamingReasoningContent,
        streamingAssistantMessageId,
        Object.hashAll(pendingMessages),
        Object.hashAll(apiInputHistory),
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
