/// 会话数据模型
///
/// 对应后端 conversations 表的一条记录，包含会话标题、归档状态、
/// 代理类型和背景样式等信息。
class Conversation {
  /// 会话唯一 ID
  final String id;

  /// 会话标题
  final String title;

  /// 是否已归档
  final bool isArchived;

  /// 创建时间
  final DateTime createdAt;

  /// 最后更新时间
  final DateTime updatedAt;

  /// 代理类型（main / memory / compact / dream），null 为普通会话
  final String? agentType;

  /// 背景样式（如 `solid:#1a1a2e` 或 `gradient:#a|#b|#c`）
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

  /// 从后端 JSON 构造实例
  ///
  /// [isArchived] 兼容 int(0/1) 和 bool 两种格式。
  factory Conversation.fromJson(Map<String, dynamic> json) => Conversation(
    id: json['id'] as String,
    title: json['title'] as String,
    isArchived: json['is_archived'] == 1 || json['is_archived'] == true,
    createdAt: DateTime.parse(json['created_at'] as String),
    updatedAt: DateTime.parse(json['updated_at'] as String),
    agentType: json['agent_type'] as String?,
    background: json['background'] as String?,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Conversation &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          title == other.title &&
          isArchived == other.isArchived &&
          createdAt == other.createdAt &&
          updatedAt == other.updatedAt &&
          agentType == other.agentType &&
          background == other.background;

  @override
  int get hashCode => Object.hash(
    id,
    title,
    isArchived,
    createdAt,
    updatedAt,
    agentType,
    background,
  );

  Conversation copyWith({
    String? id,
    String? title,
    bool? isArchived,
    DateTime? createdAt,
    DateTime? updatedAt,
    String? agentType,
    bool clearAgentType = false,
    String? background,
    bool clearBackground = false,
  }) => Conversation(
    id: id ?? this.id,
    title: title ?? this.title,
    isArchived: isArchived ?? this.isArchived,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
    agentType: clearAgentType ? null : (agentType ?? this.agentType),
    background: clearBackground ? null : (background ?? this.background),
  );
}
