/// 设置页滑块组件 — 带标签和实时数值显示
///
/// 自定义样式的 Slider，顶部显示标签和当前值（绿色高亮背景），
/// 滑块轨道和拇指使用应用绿色主题色。
library;

import 'package:flutter/material.dart';

import '../../../core/theme/app_animations.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_radius.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

/// 设置页滑块组件 — 带标签和实时数值显示的自定义 Slider
class SettingsSlider extends StatelessWidget {
  final String label;
  final double value;
  final double min;
  final double max;
  final int divisions;
  final String suffix;
  final ValueChanged<double> onChanged;

  const SettingsSlider({
    super.key,
    required this.label,
    required this.value,
    required this.min,
    required this.max,
    required this.divisions,
    this.suffix = '',
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                label,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 13,
                ),
              ),
              TweenAnimationBuilder<double>(
                tween: Tween(end: value),
                duration: AppAnimations.quick,
                curve: AppAnimations.easeOutBack,
                builder: (context, animValue, _) {
                  final dv = animValue == animValue.roundToDouble()
                      ? animValue.toInt().toString()
                      : animValue.toStringAsFixed(1);
                  return Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.green.withValues(alpha: 0.1),
                      borderRadius: AppRadius.smAll,
                    ),
                    child: Text(
                      '$dv$suffix',
                      style: const TextStyle(
                        color: AppColors.green,
                        fontSize: AppTypography.caption,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  );
                },
              ),
            ],
          ),
          SliderTheme(
            data: SliderTheme.of(context).copyWith(
              activeTrackColor: AppColors.green,
              inactiveTrackColor: AppColors.border,
              thumbColor: AppColors.green,
              overlayColor: AppColors.greenGlow,
              trackHeight: 4,
              thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 8),
              overlayShape: const RoundSliderOverlayShape(overlayRadius: 18),
            ),
            child: Slider(
              value: value,
              min: min,
              max: max,
              divisions: divisions,
              onChanged: onChanged,
            ),
          ),
        ],
      ),
    );
  }
}
