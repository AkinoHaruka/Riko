import 'package:flutter/material.dart';

import '../../../core/theme/app_animations.dart';
import '../../../core/theme/app_colors.dart';

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
    final color = isDanger ? AppColors.error : const Color(0xFFd5d5d5);

    return AppAnimations.scaleTap(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: isDanger ? AppColors.errorBg : const Color(0xFFd5d5d5).withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            Icon(icon, color: color, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  color: color,
                  fontSize: 14,
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
