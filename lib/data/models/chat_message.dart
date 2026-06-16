/// 聊天消息数据模型
///
/// 对应后端 messages 表的一条记录，包含消息内容、推理内容、
/// 压缩标记和 token 计数等信息。
class ChatMessage {
  /// 消息唯一 ID（后端生成，乐观 UI 使用负数 ID）
  final String id;

  /// 所属会话 ID
  final String conversationId;

  /// 消息角色（user / assistant / system）
  final String role;

  /// 消息正文内容
  final String content;

  /// 推理（思考）内容，仅 assistant 消息有值
  final String? reasoningContent;

  /// 是否为上下文压缩后的摘要消息
  final bool isCompactSummary;

  /// 压缩元数据（JSON 字符串，记录压缩策略等信息）
  final String? compactMetadata;

  /// 消息消耗的 token 数
  final int? tokenCount;

  /// 消息创建时间
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

  /// 从后端 JSON 构造实例
  ///
  /// [isCompactSummary] 兼容 int(0/1) 和 bool 两种格式。
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

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ChatMessage &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          conversationId == other.conversationId &&
          role == other.role &&
          content == other.content &&
          reasoningContent == other.reasoningContent &&
          isCompactSummary == other.isCompactSummary &&
          compactMetadata == other.compactMetadata &&
          tokenCount == other.tokenCount &&
          createdAt == other.createdAt;

  @override
  int get hashCode => Object.hash(
    id,
    conversationId,
    role,
    content,
    reasoningContent,
    isCompactSummary,
    compactMetadata,
    tokenCount,
    createdAt,
  );

  ChatMessage copyWith({
    String? id,
    String? conversationId,
    String? role,
    String? content,
    String? reasoningContent,
    bool clearReasoningContent = false,
    bool? isCompactSummary,
    String? compactMetadata,
    int? tokenCount,
    DateTime? createdAt,
  }) => ChatMessage(
    id: id ?? this.id,
    conversationId: conversationId ?? this.conversationId,
    role: role ?? this.role,
    content: content ?? this.content,
    reasoningContent: clearReasoningContent
        ? null
        : (reasoningContent ?? this.reasoningContent),
    isCompactSummary: isCompactSummary ?? this.isCompactSummary,
    compactMetadata: compactMetadata ?? this.compactMetadata,
    tokenCount: tokenCount ?? this.tokenCount,
    createdAt: createdAt ?? this.createdAt,
  );
}
