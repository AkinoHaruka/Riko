/// 本地存储端口 —— 抽象键值持久化
///
/// 职责边界：
/// - 代理会话 ID 的持久化
/// - 用户设置的本地缓存
/// - 面板比例等 UI 状态的持久化
///
/// 实现方：生产环境为 [SharedPrefsLocalStorageAdapter]（SharedPreferences），
/// 测试环境为 [InMemoryLocalStorageAdapter]。
///
/// 设计意图：将 SharedPreferences 的异步、类型安全、异常处理等复杂度
/// 封装在适配器内部，深模块只面对简单的键值接口。
abstract class LocalStoragePort {
  /// 读取字符串值，键不存在或类型不匹配时返回 null
  Future<String?> getString(String key);

  /// 写入字符串值
  Future<void> setString(String key, String value);

  /// 读取整数值，键不存在或类型不匹配时返回 null
  Future<int?> getInt(String key);

  /// 写入整数值
  Future<void> setInt(String key, int value);

  /// 读取双精度浮点值，键不存在或类型不匹配时返回 null
  Future<double?> getDouble(String key);

  /// 写入双精度浮点值
  Future<void> setDouble(String key, double value);

  /// 读取布尔值，键不存在或类型不匹配时返回 null
  Future<bool?> getBool(String key);

  /// 写入布尔值
  Future<void> setBool(String key, bool value);

  /// 删除指定键
  Future<void> remove(String key);

  /// 清空所有数据（测试环境常用）
  Future<void> clear();
}
