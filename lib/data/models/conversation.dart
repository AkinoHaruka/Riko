/// 会话数据模型
class Conversation {
  final String id;
  final String title;
  final bool isArchived;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? agentType;
  final String? background;

  const Conversation({
    required this.id,
    required this.title,
    this.isArchived = false,
    required this.createdAt,
    required this.updatedAt,
    this.agentType,
    this.background,
  });

  factory Conversation.fromJson(Map<String, dynamic> json) => Conversation(
        id: json['id'] as String,
        title: json['title'] as String,
        isArchived: json['is_archived'] == 1 || json['is_archived'] == true,
        createdAt: DateTime.parse(json['created_at'] as String),
        updatedAt: DateTime.parse(json['updated_at'] as String),
        agentType: json['agent_type'] as String?,
        background: json['background'] as String?,
      );

  Conversation copyWith({
    String? id,
    String? title,
    bool? isArchived,
    DateTime? createdAt,
    DateTime? updatedAt,
    String? agentType,
    String? background,
  }) =>
      Conversation(
        id: id ?? this.id,
        title: title ?? this.title,
        isArchived: isArchived ?? this.isArchived,
        createdAt: createdAt ?? this.createdAt,
        updatedAt: updatedAt ?? this.updatedAt,
        agentType: agentType ?? this.agentType,
        background: background ?? this.background,
      );
}
