/// SSE 流式响应块模型
///
/// 定义 AI 流式响应中的各类数据结构，包括内容片段、推理过程、
/// 工具调用、上下文压缩、会话笔记等。是 SSE 解析器与上层 ChatNotifier
/// 之间的数据契约。
library;

import 'token_usage.dart';

/// 单次工具调用的详情（名称、参数、结果预览）
class ToolCallItem {
  /// 工具名称（如 readFile、grep）
  final String name;

  /// 工具调用参数（JSON 字符串）
  final String arguments;

  /// 工具返回结果的截断预览
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
  /// 本次响应中调用的所有工具列表
  final List<ToolCallItem> tools;

  /// 工具调用结果的自然语言摘要
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
  /// 压缩策略名称（如 micro-compact、full-compact）
  final String strategy;

  /// 压缩前的 token 数
  final int preCompactTokens;

  /// 压缩后的 token 数
  final int postCompactTokens;

  /// 压缩前的消息数
  final int preCompactMessageCount;

  /// 压缩后的消息数
  final int postCompactMessageCount;

  /// 是否为自动触发（而非用户手动）
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
///
/// 后端开始提取会话笔记时推送，告知前端关联的会话 ID、消息数和笔记路径
class SessionNotesInitInfo {
  /// 关联的会话 ID
  final String conversationId;

  /// 参与笔记提取的消息数量
  final int messageCount;

  /// 笔记文件在服务器上的存储路径
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
/// [isStatus] = true 表示该块为状态事件（非用户可见内容），如工具调用、压缩通知等。
class StreamChunk {
  /// AI 生成的文本内容片段
  final String content;

  /// AI 推理/思考过程片段（DeepSeek 思考模式）
  final String reasoningContent;

  /// Token 使用统计（通常在流结束时返回）
  final TokenUsage? usage;

  /// 流是否已结束
  final bool isFinished;

  /// 结束原因（如 "stop"、"length"、"tool_calls"）
  final String? finishReason;

  /// 是否为状态事件（工具调用、压缩通知等，非用户可见内容）
  final bool isStatus;

  /// 工具调用详情（type=tool_call 时携带）
  final ToolCallInfo? toolCallInfo;

  /// 上下文压缩详情（type=compact 时携带）
  final CompactInfo? compactInfo;

  /// 会话笔记初始化详情（type=session_notes_init 时携带）
  final SessionNotesInitInfo? sessionNotesInitInfo;

  /// 完整请求 JSON（type=full_request 时携带，用于调试）
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

  /// 创建副本，未指定的字段保持原值
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

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is StreamChunk &&
          runtimeType == other.runtimeType &&
          content == other.content &&
          reasoningContent == other.reasoningContent &&
          usage == other.usage &&
          isFinished == other.isFinished &&
          finishReason == other.finishReason &&
          isStatus == other.isStatus &&
          toolCallInfo == other.toolCallInfo &&
          compactInfo == other.compactInfo &&
          sessionNotesInitInfo == other.sessionNotesInitInfo &&
          fullRequestJson == other.fullRequestJson;

  @override
  int get hashCode => Object.hash(
        content,
        reasoningContent,
        usage,
        isFinished,
        finishReason,
        isStatus,
        toolCallInfo,
        compactInfo,
        sessionNotesInitInfo,
        fullRequestJson,
      );
}
