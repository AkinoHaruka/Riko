import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';

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
    return ListTile(
      dense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16),
      leading: Icon(icon, color: const Color(0xFFd5d5d5).withValues(alpha: 0.6), size: 20),
      title: Text(
        label,
        style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
      ),
      subtitle: subtitle != null
          ? Text(
              subtitle!,
              style: const TextStyle(
                color: AppColors.textTertiary,
                fontSize: 12,
              ),
            )
          : null,
      trailing: Switch(
        value: value,
        onChanged: onChanged,
        activeThumbColor: const Color(0xFFd5d5d5),
        activeTrackColor: const Color(0xFFd5d5d5).withValues(alpha: 0.3),
        inactiveThumbColor: AppColors.textTertiary,
        inactiveTrackColor: AppColors.border,
      ),
    );
  }
}
