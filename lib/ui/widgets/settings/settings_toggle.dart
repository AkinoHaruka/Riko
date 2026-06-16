/// 设置页开关组件 — 带图标和可选副标题的 Switch 切换列表项
///
/// 使用 ListTile 布局，左侧图标 + 标题/副标题，右侧绿色主题 Switch。
/// 用于子代理开关、思考模式、JSON 输出等布尔配置项。
library;

import 'package:flutter/material.dart';

import '../../../core/theme/app_animations.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_haptics.dart';
import '../../../core/theme/app_radius.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

/// 设置页开关组件 — 带图标和可选副标题的 Switch 切换列表项
class SettingsToggle extends StatelessWidget {
  final String label;
  final String? subtitle;
  final bool value;
  final IconData icon;
  final ValueChanged<bool> onChanged;

  const SettingsToggle({
    super.key,
    required this.label,
    this.subtitle,
    required this.value,
    required this.icon,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: AppAnimations.quick,
      curve: AppAnimations.easeOutBack,
      decoration: BoxDecoration(
        color: value ? AppColors.green.withAlpha(25) : Colors.transparent,
        borderRadius: AppRadius.mdAll,
      ),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
        leading: TweenAnimationBuilder<Color?>(
          tween: ColorTween(
            begin: AppColors.textPrimary.withValues(alpha: 0.6),
            end: value ? AppColors.green : AppColors.textPrimary.withValues(alpha: 0.6),
          ),
          duration: AppAnimations.quick,
          curve: Curves.easeOutCubic,
          builder: (context, color, child) => Icon(icon, color: color, size: 20),
        ),
        title: Text(
          label,
          style: const TextStyle(color: AppColors.textPrimary, fontSize: AppTypography.body),
        ),
        subtitle: subtitle != null
            ? Text(
                subtitle!,
                style: const TextStyle(
                  color: AppColors.textTertiary,
                  fontSize: AppTypography.caption,
                ),
              )
            : null,
        trailing: Switch(
          value: value,
          onChanged: (v) {
            AppHaptics.light();
            onChanged(v);
          },
          activeThumbColor: Colors.white,
          activeTrackColor: AppColors.green,
          inactiveThumbColor: AppColors.textTertiary,
          inactiveTrackColor: AppColors.border,
        ),
      ),
    );
  }
}
