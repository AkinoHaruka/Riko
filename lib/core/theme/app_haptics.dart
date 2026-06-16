/// 全局触觉反馈工具 — iOS 风格 Haptic Feedback
///
/// 封装 HapticFeedback，提供语义化触觉反馈方法。
/// 在按钮点击、开关切换、重要操作等场景调用，提升交互质感。
library;

import 'package:flutter/services.dart';

/// 全局触觉反馈工具 — 提供 light/medium/selection/success 四档触觉反馈
class AppHaptics {
  AppHaptics._();

  /// 轻触觉 — 开关切换、选项切换等轻交互
  static void light() => HapticFeedback.lightImpact();

  /// 中等触觉 — 重要按钮点击、确认操作
  static void medium() => HapticFeedback.mediumImpact();

  /// 选择触觉 — 列表项点击、滚动吸附等选择类交互
  static void selection() => HapticFeedback.selectionClick();

  /// 重触觉 — 成功提交、删除确认等强反馈场景
  static void success() => HapticFeedback.heavyImpact();
}
