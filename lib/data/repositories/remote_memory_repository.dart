import '../api_client.dart';

/// 记忆数据模型
class MemoryItem {
  final String id;
  final String key;
  final String content;
  final String? source;
  final String type;
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

  Future<List<MemoryItem>> getAll() async {
    final response = await _apiClient.get('/memories');
    return _parseList(response);
  }

  Future<List<MemoryItem>> getByType(String type) async {
    final response = await _apiClient.get('/memories', queryParameters: {'type': type});
    return _parseList(response);
  }

  /// 关键字搜索（匹配 key 或 content）
  Future<List<MemoryItem>> search(String keyword) async {
    final response = await _apiClient.get('/memories/search', queryParameters: {'keyword': keyword});
    return _parseList(response);
  }

  Future<MemoryItem> addMemory({
    required String key,
    required String content,
    String? source,
    String type = 'fact',
  }) async {
    final json = await _apiClient.post('/memories', data: {
      'key': key,
      'content': content,
      'source': source ?? '',
      'type': type,
    });
    return MemoryItem.fromJson(json as Map<String, dynamic>);
  }

  Future<void> deleteMemory(String id) async {
    await _apiClient.delete('/memories/$id');
  }

  /// 根据来源删除记忆
  Future<void> deleteBySource(String source) async {
    await _apiClient.delete('/memories/by-source', queryParameters: {'source': source});
  }

  Future<void> clearAll() async {
    await _apiClient.delete('/memories/clear');
  }

  List<MemoryItem> _parseList(dynamic response) {
    final list = response['memories'] as List;
    return list.map((e) => MemoryItem.fromJson(e as Map<String, dynamic>)).toList();
  }
}
