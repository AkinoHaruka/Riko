/// 消息角色常量（user / assistant / system / tool）
class MessageRole {
  static const String user = 'user';
  static const String assistant = 'assistant';
  static const String system = 'system';
  static const String tool = 'tool';
}

/// 将多种格式的 is_compact_summary 值统一转换为 bool
bool parseCompactSummaryBool(dynamic value) {
  if (value == null) return false;
  if (value is bool) return value;
  if (value is int) return value == 1;
  if (value is String) return value == '1' || value.toLowerCase() == 'true';
  return false;
}

/// 发送给 AI 的消息单元，包含角色、内容、推理过程和压缩标记
class Message {
  final String role;
  final String content;
  final String? reasoningContent;
  final bool isCompactSummary;

  const Message({
    required this.role,
    required this.content,
    this.reasoningContent,
    this.isCompactSummary = false,
  });

  Map<String, dynamic> toJson() => {
    'role': role,
    'content': content,
    if (reasoningContent != null && reasoningContent!.isNotEmpty)
      'reasoning_content': reasoningContent,
    if (isCompactSummary) 'is_compact_summary': true,
  };

  factory Message.fromJson(Map<String, dynamic> json) => Message(
    role: json['role'] as String,
    content: json['content'] as String,
    reasoningContent: json['reasoning_content'] as String?,
    isCompactSummary: parseCompactSummaryBool(json['is_compact_summary']),
  );
}
