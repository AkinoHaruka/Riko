import '../api_client.dart';

/// 记忆数据模型
///
/// 对应后端 memories 表的一条记录，存储 AI 提取的长期记忆条目。
class MemoryItem {
  /// 记忆唯一 ID
  final String id;

  /// 记忆键名（用于检索和去重）
  final String key;

  /// 记忆内容
  final String content;

  /// 记忆来源（如 session_notes、dream 等）
  final String? source;

  /// 记忆类型（如 fact、preference、procedure 等）
  final String type;

  /// 创建时间
  final DateTime createdAt;

  MemoryItem({
    required this.id,
    required this.key,
    required this.content,
    this.source,
    required this.type,
    required this.createdAt,
  });

  factory MemoryItem.fromJson(Map<String, dynamic> json) => MemoryItem(
    id: json['id'] as String,
    key: json['key'] as String,
    content: json['content'] as String,
    source: json['source'] as String?,
    type: json['type'] as String,
    createdAt: DateTime.parse(json['created_at'] as String),
  );
}

/// 远程记忆仓库（单用户模式）
///
/// 通过 HTTP API 与后端 /memories 接口交互。
class RemoteMemoryRepository {
  final ApiClient _apiClient;

  RemoteMemoryRepository(this._apiClient);

  /// 获取所有记忆条目
  Future<List<MemoryItem>> getAll() async {
    final response = await _apiClient.get('/memories');
    return _parseList(response);
  }

  /// 按类型获取记忆条目
  Future<List<MemoryItem>> getByType(String type) async {
    final response = await _apiClient.get(
      '/memories',
      queryParameters: {'type': type},
    );
    return _parseList(response);
  }

  /// 关键字搜索（匹配 key 或 content）
  Future<List<MemoryItem>> search(String keyword) async {
    final response = await _apiClient.get(
      '/memories/search',
      queryParameters: {'keyword': keyword},
    );
    return _parseList(response);
  }

  /// 添加一条记忆，返回创建的 [MemoryItem]
  Future<MemoryItem> addMemory({
    required String key,
    required String content,
    String? source,
    String type = 'fact',
  }) async {
    final json = await _apiClient.post(
      '/memories',
      data: {
        'key': key,
        'content': content,
        'source': source ?? '',
        'type': type,
      },
    );
    return MemoryItem.fromJson(json as Map<String, dynamic>);
  }

  /// 按 ID 删除一条记忆
  Future<void> deleteMemory(String id) async {
    await _apiClient.delete('/memories/$id');
  }

  /// 根据来源删除记忆
  Future<void> deleteBySource(String source) async {
    await _apiClient.delete(
      '/memories/by-source',
      queryParameters: {'source': source},
    );
  }

  /// 清空所有记忆
  Future<void> clearAll() async {
    await _apiClient.delete('/memories/clear');
  }

  /// 解析记忆列表响应，兼容 `{ memories: [...] }` 和纯数组格式
  List<MemoryItem> _parseList(dynamic response) {
    final raw = response is Map ? response['memories'] : null;
    if (raw is! List) return [];
    return raw
        .map((e) => MemoryItem.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }
}
