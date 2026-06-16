import 'package:flutter/foundation.dart';

import '../../../../infrastructure/ai_adapter/ai_adapter.dart';

/// SSE 流式过程中的 UI 状态
///
/// 从原 [ChatState] 中拆分出的独立状态，只包含流式相关字段。
/// UI 通过 `ref.watch(chatStreamStateProvider.select((s) => s.streamingContent))`
/// 实现细粒度重建。
@immutable
class ChatStreamState {
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

  const ChatStreamState({
    this.isLoading = false,
    this.error,
    this.streamingContent = '',
    this.streamingReasoningContent = '',
    this.streamingAssistantMessageId,
  });

  ChatStreamState copyWith({
    bool? isLoading,
    ErrorInfo? error,
    String? streamingContent,
    String? streamingReasoningContent,
    String? streamingAssistantMessageId,
    bool clearError = false,
    bool clearStreamingAssistantMessageId = false,
  }) {
    return ChatStreamState(
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      streamingContent: streamingContent ?? this.streamingContent,
      streamingReasoningContent:
          streamingReasoningContent ?? this.streamingReasoningContent,
      streamingAssistantMessageId: clearStreamingAssistantMessageId
          ? null
          : (streamingAssistantMessageId ?? this.streamingAssistantMessageId),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ChatStreamState &&
          isLoading == other.isLoading &&
          error == other.error &&
          streamingContent == other.streamingContent &&
          streamingReasoningContent == other.streamingReasoningContent &&
          streamingAssistantMessageId == other.streamingAssistantMessageId;

  @override
  int get hashCode => Object.hash(
        isLoading,
        error,
        streamingContent,
        streamingReasoningContent,
        streamingAssistantMessageId,
      );
}
