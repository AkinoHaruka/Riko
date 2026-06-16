/// 设置端口 —— 抽象用户配置与模型参数
///
/// 职责边界：
/// - 提供当前选中的模型 ID、温度、最大 token 数等推理参数
/// - 提供子代理触发阈值（记忆最小消息数、压缩触发 token 数等）
///
/// 实现方：生产环境为 [SettingsCacheAdapter]（读取 SettingsCache），
/// 测试环境为 [InMemorySettingsAdapter]（硬编码或手动注入）。
///
/// 设计意图：避免深模块直接依赖 Riverpod 的 settingsCacheProvider，
/// 使业务逻辑可在无 Flutter 上下文的环境中运行和测试。
abstract class SettingsPort {
  /// 当前选中的模型 ID（如 deepseek-v4-pro）
  String get selectedModel;

  /// 温度参数
  double get temperature;

  /// 最大生成 token 数
  int? get maxTokens;

  /// 思考类型（如 deepseek_reasoning）
  String get thinkingType;

  /// 推理努力程度
  String get reasoningEffort;

  /// 是否启用 JSON 模式
  bool get jsonMode;

  /// 触发记忆提取的最小消息数
  int get memoryMinMessages;

  /// 两次记忆提取之间的最小 token 增量
  int get memoryMinTokensBetweenUpdate;

  /// 触发自动压缩的 token 阈值
  int get compactTriggerTokens;

  /// 触发梦境整理的最小间隔小时数
  int get dreamMinHours;
}
