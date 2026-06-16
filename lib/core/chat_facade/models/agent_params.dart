import 'package:flutter/foundation.dart';

/// 子代理触发参数 — 从 SettingsCache 解耦后的纯数据对象
///
/// 由 UI 或 Facade 从设置缓存读取后传入，用于计算 [AgentProgress]。
@immutable
class AgentParams {
  /// 触发记忆提取的最小消息数
  final int memoryMinMessages;

  /// 两次记忆提取之间的最小 token 增量
  final int memoryMinTokensBetweenUpdate;

  /// 触发自动压缩的 token 阈值
  final int compactTriggerTokens;

  /// 触发梦境整理的最小间隔小时数
  final int dreamMinHours;

  const AgentParams({
    this.memoryMinMessages = 6,
    this.memoryMinTokensBetweenUpdate = 2000,
    this.compactTriggerTokens = 200000,
    this.dreamMinHours = 24,
  });

  /// 从后端参数 Map 构造（兼容原 settingsCache.params）
  factory AgentParams.fromMap(Map<String, dynamic> map) {
    return AgentParams(
      memoryMinMessages:
          (map['param_session_memory_min_messages'] as int?) ?? 6,
      memoryMinTokensBetweenUpdate:
          (map['param_session_memory_min_tokens_between_update'] as int?) ??
              2000,
      compactTriggerTokens:
          (map['param_compact_trigger_tokens'] as int?) ?? 200000,
      dreamMinHours: (map['param_dream_min_hours'] as int?) ?? 24,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AgentParams &&
          memoryMinMessages == other.memoryMinMessages &&
          memoryMinTokensBetweenUpdate ==
              other.memoryMinTokensBetweenUpdate &&
          compactTriggerTokens == other.compactTriggerTokens &&
          dreamMinHours == other.dreamMinHours;

  @override
  int get hashCode => Object.hash(
        memoryMinMessages,
        memoryMinTokensBetweenUpdate,
        compactTriggerTokens,
        dreamMinHours,
      );
}
