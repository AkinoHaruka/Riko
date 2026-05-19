/// 聊天消息数据模型
class ChatMessage {
  final String id;
  final String conversationId;
  final String role;
  final String content;
  final String? reasoningContent;
  final bool isCompactSummary;
  final String? compactMetadata;
  final int? tokenCount;
  final DateTime createdAt;

  const ChatMessage({
    required this.id,
    required this.conversationId,
    required this.role,
    required this.content,
    this.reasoningContent,
    this.isCompactSummary = false,
    this.compactMetadata,
    this.tokenCount,
    required this.createdAt,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        id: json['id'] as String,
        conversationId: json['conversation_id'] as String,
        role: json['role'] as String,
        content: json['content'] as String,
        reasoningContent: json['reasoning_content'] as String?,
        isCompactSummary:
            json['is_compact_summary'] == 1 || json['is_compact_summary'] == true,
        compactMetadata: json['compact_metadata'] as String?,
        tokenCount: json['token_count'] as int?,
        createdAt: DateTime.parse(json['created_at'] as String),
      );

  ChatMessage copyWith({
    String? id,
    String? conversationId,
    String? role,
    String? content,
    String? reasoningContent,
    bool? isCompactSummary,
    String? compactMetadata,
    int? tokenCount,
    DateTime? createdAt,
  }) =>
      ChatMessage(
        id: id ?? this.id,
        conversationId: conversationId ?? this.conversationId,
        role: role ?? this.role,
        content: content ?? this.content,
        reasoningContent: reasoningContent ?? this.reasoningContent,
        isCompactSummary: isCompactSummary ?? this.isCompactSummary,
        compactMetadata: compactMetadata ?? this.compactMetadata,
        tokenCount: tokenCount ?? this.tokenCount,
        createdAt: createdAt ?? this.createdAt,
      );
}
