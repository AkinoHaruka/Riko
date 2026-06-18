import 'dart:ui';
import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'app_radius.dart';

/// RIKO 毛玻璃效果系统 — 对标 iOS / Apple Music 悬浮层质感
///
/// 设计原理：iOS 的导航栏、工具栏、弹窗使用 `UIVisualEffectView` 实时模糊
/// 背景内容，产生"磨砂玻璃"质感。Flutter 通过 `BackdropFilter` +
/// `ImageFilter.blur` 实现，叠加半透明色调与噪点感。
///
/// 性能取舍：BackdropFilter 每帧采样背景并高斯模糊，是较重的 GPU 操作，
/// 但视觉质感优先（见任务约束），不为此砍掉模糊效果。
class AppGlass {
  AppGlass._();

  /// 标准毛玻璃容器 — 用于输入栏、标题栏、悬浮面板
  ///
  /// [sigmaX/Y] 控制模糊强度（iOS 通常 20-30）
  /// [tint] 叠加的半透明色调（默认 surfaceGlass）
  /// [radius] 圆角
  static Widget container({
    required Widget child,
    double sigmaX = 24,
    double sigmaY = 24,
    Color? tint,
    BorderRadius? radius,
    EdgeInsets padding = EdgeInsets.zero,
    List<BoxShadow>? boxShadow,
  }) {
    final br = radius ?? AppRadius.lgAll;
    return ClipRRect(
      borderRadius: br,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: sigmaX, sigmaY: sigmaY),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            color: tint ?? AppColors.surfaceGlass,
            borderRadius: br,
            border: Border.all(
              color: Colors.white.withValues(alpha: 0.08),
              width: 0.5,
            ),
            boxShadow: boxShadow,
          ),
          child: child,
        ),
      ),
    );
  }

  /// 输入栏毛玻璃 — 较强模糊 + 深色调，从底部浮起
  static Widget inputBar({required Widget child}) {
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 30, sigmaY: 30),
        child: Container(
          decoration: BoxDecoration(
            // 深色半透明，让背景隐约可见但不干扰阅读
            color: AppColors.bgTertiary.withValues(alpha: 0.78),
            border: Border(
              top: BorderSide(
                color: Colors.white.withValues(alpha: 0.06),
                width: 0.5,
              ),
            ),
          ),
          child: child,
        ),
      ),
    );
  }

  /// 标题栏毛玻璃 — 顶部悬浮，滚动内容透出
  static Widget titleBar({required Widget child}) {
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.bgTertiary.withValues(alpha: 0.72),
            border: Border(
              bottom: BorderSide(
                color: Colors.white.withValues(alpha: 0.05),
                width: 0.5,
              ),
            ),
          ),
          child: child,
        ),
      ),
    );
  }

  /// 弹窗毛玻璃 — 强模糊 + 高对比度，聚焦内容
  static Widget dialog({required Widget child, BorderRadius? radius}) {
    final br = radius ?? AppRadius.xlAll;
    return ClipRRect(
      borderRadius: br,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 40, sigmaY: 40),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.bgElevated.withValues(alpha: 0.92),
            borderRadius: br,
            border: Border.all(
              color: Colors.white.withValues(alpha: 0.10),
              width: 0.5,
            ),
          ),
          child: child,
        ),
      ),
    );
  }

  /// 动态岛毛玻璃 — 胶囊形悬浮，强模糊
  static Widget pill({required Widget child}) {
    return ClipRRect(
      borderRadius: AppRadius.fullAll,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 28, sigmaY: 28),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.surface.withValues(alpha: 0.65),
            border: Border.all(
              color: Colors.white.withValues(alpha: 0.10),
              width: 0.5,
            ),
          ),
          child: child,
        ),
      ),
    );
  }
}
