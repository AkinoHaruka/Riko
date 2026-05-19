import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';

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
    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 12),
            child: Text(
              title.toUpperCase(),
              style: TextStyle(
                color: const Color(0xFFd5d5d5).withValues(alpha: 0.6),
                fontSize: 12,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.5,
              ),
            ),
          ),
          Container(
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: children,
            ),
          ),
        ],
      ),
    );
  }
}
