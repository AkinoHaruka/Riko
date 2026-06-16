import 'package:flutter/foundation.dart';

/// 子代理活动进度 — UI 直接消费的数据对象
///
/// 由 [AgentTrackingService.calculateProgress] 计算得出，
/// 包含三个子代理的进度百分比和运行状态。
@immutable
class AgentProgress {
  /// 记忆提取进度（0.0 ~ 1.0）
  final double memoryProgress;

  /// 上下文压缩进度（0.0 ~ 1.0）
  final double compactProgress;

  /// 梦境整理进度（0.0 ~ 1.0）
  final double dreamProgress;

  /// 记忆提取是否正在运行
  final bool isMemoryRunning;

  /// 上下文压缩是否正在运行
  final bool isCompactRunning;

  /// 梦境整理是否正在运行
  final bool isDreamRunning;

  const AgentProgress({
    this.memoryProgress = 0.0,
    this.compactProgress = 0.0,
    this.dreamProgress = 0.0,
    this.isMemoryRunning = false,
    this.isCompactRunning = false,
    this.isDreamRunning = false,
  });

  AgentProgress copyWith({
    double? memoryProgress,
    double? compactProgress,
    double? dreamProgress,
    bool? isMemoryRunning,
    bool? isCompactRunning,
    bool? isDreamRunning,
  }) {
    return AgentProgress(
      memoryProgress: memoryProgress ?? this.memoryProgress,
      compactProgress: compactProgress ?? this.compactProgress,
      dreamProgress: dreamProgress ?? this.dreamProgress,
      isMemoryRunning: isMemoryRunning ?? this.isMemoryRunning,
      isCompactRunning: isCompactRunning ?? this.isCompactRunning,
      isDreamRunning: isDreamRunning ?? this.isDreamRunning,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AgentProgress &&
          memoryProgress == other.memoryProgress &&
          compactProgress == other.compactProgress &&
          dreamProgress == other.dreamProgress &&
          isMemoryRunning == other.isMemoryRunning &&
          isCompactRunning == other.isCompactRunning &&
          isDreamRunning == other.isDreamRunning;

  @override
  int get hashCode => Object.hash(
        memoryProgress,
        compactProgress,
        dreamProgress,
        isMemoryRunning,
        isCompactRunning,
        isDreamRunning,
      );
}
