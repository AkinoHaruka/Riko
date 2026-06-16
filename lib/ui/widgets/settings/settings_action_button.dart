/// 设置页操作按钮 — 带图标和右箭头指示的可点击行
///
/// 支持普通（灰色）和危险（红色）两种样式，用于导出、导入、清空等操作入口。
/// 使用 scaleTap 动画提供按下反馈。
library;

import 'package:flutter/material.dart';

import '../../../core/theme/app_animations.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_radius.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

/// 设置页操作按钮 — 带图标和右箭头指示的可点击行，支持普通和危险（红色）两种样式
class SettingsActionButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool isDanger;
  final VoidCallback onTap;

  const SettingsActionButton({
    super.key,
    required this.label,
    required this.icon,
    this.isDanger = false,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = isDanger ? AppColors.error : AppColors.textPrimary;

    return AppAnimations.scaleTap(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: isDanger ? AppColors.errorBg : AppColors.textPrimary.withValues(alpha: 0.05),
          borderRadius: AppRadius.mdAll,
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            Icon(icon, color: color, size: 20),
            AppSpacing.hMDSm,
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  color: color,
                  fontSize: AppTypography.body,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            Icon(
              Icons.arrow_forward_ios,
              color: color.withValues(alpha: 0.5),
              size: 14,
            ),
          ],
        ),
      ),
    );
  }
}
