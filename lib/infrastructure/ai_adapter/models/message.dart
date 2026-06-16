/// AI 消息模型
///
/// 定义发送给 AI 的消息结构，包含角色、内容、推理过程和压缩标记。
/// 是 [AIAdapter.chatStream] 的输入单元，也是上下文历史的基本组成。
library;

/// 消息角色常量（user / assistant / system / tool）
class MessageRole {
  static const String user = 'user';
  static const String assistant = 'assistant';
  static const String system = 'system';
  static const String tool = 'tool';
}

/// 将多种格式的 is_compact_summary 值统一转换为 bool
///
/// 后端可能返回 bool / int / String 类型的标记值，此函数统一处理：
/// - bool: 直接返回
/// - int: 1 为 true
/// - String: "1" 或 "true"（不区分大小写）为 true
bool parseCompactSummaryBool(dynamic value) {
  if (value == null) return false;
  if (value is bool) return value;
  if (value is int) return value == 1;
  if (value is String) return value == '1' || value.toLowerCase() == 'true';
  return false;
}

/// 发送给 AI 的消息单元，包含角色、内容、推理过程和压缩标记
class Message {
  /// 消息角色，取值见 [MessageRole]
  final String role;

  /// 消息文本内容
  final String content;

  /// 推理/思考过程内容（DeepSeek 思考模式返回）
  final String? reasoningContent;

  /// 是否为上下文压缩后的摘要消息
  final bool isCompactSummary;

  const Message({
    required this.role,
    required this.content,
    this.reasoningContent,
    this.isCompactSummary = false,
  });

  /// 序列化为 JSON，仅包含非空字段以减少传输量
  Map<String, dynamic> toJson() => {
    'role': role,
    'content': content,
    if (reasoningContent != null && reasoningContent!.isNotEmpty)
      'reasoning_content': reasoningContent,
    if (isCompactSummary) 'is_compact_summary': true,
  };

  /// 从 JSON 反序列化，兼容多种 is_compact_summary 格式
  factory Message.fromJson(Map<String, dynamic> json) => Message(
    role: json['role'] as String,
    content: json['content'] as String,
    reasoningContent: json['reasoning_content'] as String?,
    isCompactSummary: parseCompactSummaryBool(json['is_compact_summary']),
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Message &&
          runtimeType == other.runtimeType &&
          role == other.role &&
          content == other.content &&
          reasoningContent == other.reasoningContent &&
          isCompactSummary == other.isCompactSummary;

  @override
  int get hashCode => Object.hash(
        role,
        content,
        reasoningContent,
        isCompactSummary,
      );
}
