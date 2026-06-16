import '../api_client.dart';

/// 远程设置仓库（单用户模式）
///
/// 通过 HTTP API 与后端服务器交互。
/// 所有设置值以字符串形式存储，提供类型安全的 get/set 便捷方法。
/// 敏感值（如 API Key）在后端自动加密存储。
class RemoteSettingsRepository {
  final ApiClient _apiClient;

  RemoteSettingsRepository(this._apiClient);

  /// 获取字符串设置值，失败返回 null
  Future<String?> getString(String key) async {
    try {
      final response = await _apiClient.get('/settings/$key');
      return response['value'] as String?;
    } catch (e) {
      return null;
    }
  }

  /// 设置字符串值
  Future<void> setString(String key, String value) async {
    await _apiClient.post('/settings', data: {'key': key, 'value': value});
  }

  /// 获取浮点数设置值（内部以字符串存储）
  Future<double?> getDouble(String key) async {
    final value = await getString(key);
    if (value == null) return null;
    return double.tryParse(value);
  }

  Future<void> setDouble(String key, double value) async {
    await setString(key, value.toString());
  }

  /// 获取整数设置值（内部以字符串存储）
  Future<int?> getInt(String key) async {
    final value = await getString(key);
    if (value == null) return null;
    return int.tryParse(value);
  }

  Future<void> setInt(String key, int value) async {
    await setString(key, value.toString());
  }

  /// 获取布尔设置值（内部以字符串 "true"/"false" 存储）
  Future<bool?> getBool(String key) async {
    final value = await getString(key);
    if (value == null) return null;
    return value.toLowerCase() == 'true';
  }

  Future<void> setBool(String key, bool value) async {
    await setString(key, value.toString());
  }

  /// 批量保存设置（一次请求保存多个 key-value）
  Future<void> batchSet(Map<String, String> items) async {
    if (items.isEmpty) return;
    final list = items.entries
        .map((e) => {'key': e.key, 'value': e.value})
        .toList();
    await _apiClient.post('/settings/batch', data: {'items': list});
  }

  /// 删除指定设置项
  Future<void> remove(String key) async {
    await _apiClient.delete('/settings/$key');
  }

  /// 获取所有设置项（用于数据导出），失败返回空列表
  Future<List<Map<String, dynamic>>> getAll() async {
    try {
      final response = await _apiClient.get('/settings');
      return (response['settings'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
    } catch (e) {
      return [];
    }
  }
}
