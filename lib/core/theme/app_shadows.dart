import 'package:flutter/material.dart';

import 'app_colors.dart';

/// RIKO 多层级扩散阴影系统 — 对标 iOS / Apple Music 柔和扩散阴影
///
/// 设计原理：单一黑色硬阴影会产生"贴边"生硬感，iOS 通过 2-3 层不同
/// blurRadius / spreadRadius / 透明度的阴影叠加，模拟光线在物体周围扩散，
/// 形成"浮起"的柔和质感。
///
/// 层级规范（每层均为低透明度黑色，避免脏黑）：
/// - 近层（ambient）：小 offset、小 blur，提供基础接地感
/// - 中层（key）：中 offset、中 blur，主体投影
/// - 远层（diffuse）：大 offset、大 blur、极低透明度，扩散光晕
///
/// 性能取舍：多层 BoxShadow 会增加 GPU 合成开销，但视觉质感优先（见任务约束）。
class AppShadows {
  AppShadows._();

  // ===== 层级预设 =====

  /// 卡片浮起阴影 — 3 层叠加，用于卡片、对话框、悬浮面板
  /// 近层接地 + 中层主体 + 远层扩散光晕
  static List<BoxShadow> get card => const [
        BoxShadow(
          color: Color(0x14000000), // 8% 黑
          offset: Offset(0, 2),
          blurRadius: 6,
          spreadRadius: 0,
        ),
        BoxShadow(
          color: Color(0x10000000), // 6% 黑
          offset: Offset(0, 8),
          blurRadius: 16,
          spreadRadius: -2,
        ),
        BoxShadow(
          color: Color(0x0A000000), // 4% 黑
          offset: Offset(0, 20),
          blurRadius: 40,
          spreadRadius: -4,
        ),
      ];

  /// 消息气泡阴影 — 用户气泡（绿色辉光）+ 助手气泡（中性浮起）
  /// 用户气泡使用主色辉光，强化"我发出的"存在感
  static List<BoxShadow> userBubble(Color glow) => [
        BoxShadow(
          color: glow.withValues(alpha: 0.35),
          offset: const Offset(0, 4),
          blurRadius: 12,
          spreadRadius: 0,
        ),
        BoxShadow(
          color: glow.withValues(alpha: 0.18),
          offset: const Offset(0, 10),
          blurRadius: 24,
          spreadRadius: -4,
        ),
      ];

  /// 助手气泡阴影 — 中性柔和浮起，2 层即可（避免过度阴影干扰阅读）
  static List<BoxShadow> get assistantBubble => const [
        BoxShadow(
          color: Color(0x18000000), // 9% 黑
          offset: Offset(0, 3),
          blurRadius: 8,
          spreadRadius: -1,
        ),
        BoxShadow(
          color: Color(0x0D000000), // 5% 黑
          offset: Offset(0, 12),
          blurRadius: 24,
          spreadRadius: -6,
        ),
      ];

  /// 输入栏浮起阴影 — 较强扩散，让输入栏从背景"浮起"
  static List<BoxShadow> get inputBar => const [
        BoxShadow(
          color: Color(0x1A000000), // 10% 黑
          offset: Offset(0, -2),
          blurRadius: 12,
          spreadRadius: -2,
        ),
        BoxShadow(
          color: Color(0x10000000), // 6% 黑
          offset: Offset(0, -8),
          blurRadius: 28,
          spreadRadius: -6,
        ),
      ];

  /// 按钮阴影 — 主按钮（绿色）按下时收缩、抬起时辉光扩散
  static List<BoxShadow> button(Color glow, {bool pressed = false}) {
    if (pressed) {
      return [
        BoxShadow(
          color: glow.withValues(alpha: 0.15),
          offset: const Offset(0, 1),
          blurRadius: 3,
          spreadRadius: 0,
        ),
      ];
    }
    return [
      BoxShadow(
        color: glow.withValues(alpha: 0.30),
        offset: const Offset(0, 4),
        blurRadius: 10,
        spreadRadius: -1,
      ),
      BoxShadow(
        color: glow.withValues(alpha: 0.15),
        offset: const Offset(0, 10),
        blurRadius: 20,
        spreadRadius: -4,
      ),
    ];
  }

  /// 动态岛 / 悬浮胶囊阴影 — 强扩散，营造悬浮感
  static List<BoxShadow> get floating => const [
        BoxShadow(
          color: Color(0x20000000), // 12% 黑
          offset: Offset(0, 6),
          blurRadius: 16,
          spreadRadius: 0,
        ),
        BoxShadow(
          color: Color(0x14000000), // 8% 黑
          offset: Offset(0, 16),
          blurRadius: 40,
          spreadRadius: -8,
        ),
      ];

  /// 弹窗 / 对话框阴影 — 最强扩散，全屏聚焦
  static List<BoxShadow> get dialog => const [
        BoxShadow(
          color: Color(0x29000000), // 16% 黑
          offset: Offset(0, 12),
          blurRadius: 28,
          spreadRadius: -4,
        ),
        BoxShadow(
          color: Color(0x1F000000), // 12% 黑
          offset: Offset(0, 32),
          blurRadius: 64,
          spreadRadius: -12,
        ),
      ];

  /// 搜索匹配高亮阴影 — 绿色辉光强调
  static List<BoxShadow> get searchHighlight => [
        BoxShadow(
          color: AppColors.green.withValues(alpha: 0.45),
          offset: const Offset(0, 0),
          blurRadius: 14,
          spreadRadius: 2,
        ),
      ];

  /// 错误态阴影 — 红色辉光
  static List<BoxShadow> get error => [
        BoxShadow(
          color: AppColors.error.withValues(alpha: 0.35),
          offset: const Offset(0, 4),
          blurRadius: 12,
          spreadRadius: -1,
        ),
      ];
}
