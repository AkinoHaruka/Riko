import 'token_usage.dart';

/// 单次工具调用的详情（名称、参数、结果预览）
class ToolCallItem {
  final String name;
  final String arguments;
  final String resultPreview;

  const ToolCallItem({
    required this.name,
    required this.arguments,
    required this.resultPreview,
  });

  factory ToolCallItem.fromJson(Map<String, dynamic> json) => ToolCallItem(
    name: json['name'] as String? ?? '',
    arguments: json['arguments'] as String? ?? '',
    resultPreview: json['result_preview'] as String? ?? '',
  );
}

/// 工具调用信息，包含一次响应中的多个工具调用及摘要
class ToolCallInfo {
  final List<ToolCallItem> tools;
  final String summary;

  const ToolCallInfo({required this.tools, required this.summary});

  factory ToolCallInfo.fromJson(Map<String, dynamic> json) => ToolCallInfo(
    tools: (json['tools'] as List<dynamic>?)
        ?.map((t) => ToolCallItem.fromJson(t as Map<String, dynamic>))
        .toList() ?? [],
    summary: json['summary'] as String? ?? '',
  );
}

/// 上下文压缩信息，包含压缩前后的 token 数和消息数
class CompactInfo {
  final String strategy;
  final int preCompactTokens;
  final int postCompactTokens;
  final int preCompactMessageCount;
  final int postCompactMessageCount;
  final bool isAuto;

  const CompactInfo({
    required this.strategy,
    required this.preCompactTokens,
    required this.postCompactTokens,
    required this.preCompactMessageCount,
    required this.postCompactMessageCount,
    required this.isAuto,
  });

  factory CompactInfo.fromJson(Map<String, dynamic> json) => CompactInfo(
    strategy: json['strategy'] as String? ?? '',
    preCompactTokens: json['pre_compact_tokens'] as int? ?? 0,
    postCompactTokens: json['post_compact_tokens'] as int? ?? 0,
    preCompactMessageCount: json['pre_compact_message_count'] as int? ?? 0,
    postCompactMessageCount: json['post_compact_message_count'] as int? ?? 0,
    isAuto: json['is_auto'] as bool? ?? true,
  );
}

/// 会话笔记初始化信息
class SessionNotesInitInfo {
  final String conversationId;
  final int messageCount;
  final String notesPath;

  const SessionNotesInitInfo({
    required this.conversationId,
    required this.messageCount,
    required this.notesPath,
  });

  factory SessionNotesInitInfo.fromJson(Map<String, dynamic> json) =>
      SessionNotesInitInfo(
        conversationId: json['conversation_id'] as String? ?? '',
        messageCount: json['message_count'] as int? ?? 0,
        notesPath: json['notes_path'] as String? ?? '',
      );
}

/// SSE 流式响应块
///
/// 承载 AI 返回的内容片段、推理过程、工具调用、Token 用量等。
/// isStatus = true 表示该块为状态事件（非用户可见内容）。
class StreamChunk {
  final String content;
  final String reasoningContent;
  final TokenUsage? usage;
  final bool isFinished;
  final String? finishReason;
  final bool isStatus;
  final ToolCallInfo? toolCallInfo;
  final CompactInfo? compactInfo;
  final SessionNotesInitInfo? sessionNotesInitInfo;
  final String? fullRequestJson;

  const StreamChunk({
    this.content = '',
    this.reasoningContent = '',
    this.usage,
    this.isFinished = false,
    this.finishReason,
    this.isStatus = false,
    this.toolCallInfo,
    this.compactInfo,
    this.sessionNotesInitInfo,
    this.fullRequestJson,
  });

  StreamChunk copyWith({
    String? content,
    String? reasoningContent,
    TokenUsage? usage,
    bool? isFinished,
    String? finishReason,
    bool? isStatus,
    ToolCallInfo? toolCallInfo,
    CompactInfo? compactInfo,
    SessionNotesInitInfo? sessionNotesInitInfo,
    String? fullRequestJson,
  }) {
    return StreamChunk(
      content: content ?? this.content,
      reasoningContent: reasoningContent ?? this.reasoningContent,
      usage: usage ?? this.usage,
      isFinished: isFinished ?? this.isFinished,
      finishReason: finishReason ?? this.finishReason,
      isStatus: isStatus ?? this.isStatus,
      toolCallInfo: toolCallInfo ?? this.toolCallInfo,
      compactInfo: compactInfo ?? this.compactInfo,
      sessionNotesInitInfo: sessionNotesInitInfo ?? this.sessionNotesInitInfo,
      fullRequestJson: fullRequestJson ?? this.fullRequestJson,
    );
  }
}
