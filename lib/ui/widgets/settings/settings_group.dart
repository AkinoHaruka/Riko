/// 设置分组容器 — 带大写标题的圆角卡片
///
/// 将一组相关设置项包裹在统一的圆角卡片中，顶部显示大写加粗的分组标题。
/// 用于设置页面的视觉分区（如"API 配置"、"模型参数"等）。
library;

import 'package:flutter/material.dart';

import '../../../core/theme/app_animations.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_radius.dart';
import '../../../core/theme/app_typography.dart';

/// 设置分组容器 — 带大写标题的圆角卡片，内部垂直排列一组设置项
class SettingsGroup extends StatelessWidget {
  final String title;
  final List<Widget> children;

  const SettingsGroup({
    super.key,
    required this.title,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return AppAnimations.scaleIn(
      child: Padding(
        padding: const EdgeInsets.only(bottom: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 4, bottom: 12),
              child: Text(
                title.toUpperCase(),
                style: TextStyle(
                  color: AppColors.textPrimary.withValues(alpha: 0.6),
                  fontSize: AppTypography.caption,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.5,
                ),
              ),
            ),
            Container(
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: AppRadius.lgAll,
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                children: children,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
