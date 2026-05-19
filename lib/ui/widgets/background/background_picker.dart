import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';

/// 背景预设定义
class _BgPreset {
  final String id;
  final String label;
  final Color color;
  final List<Color>? gradientColors;

  const _BgPreset(this.id, this.label, this.color, [this.gradientColors]);

  bool get isGradient => gradientColors != null;
}

const _presets = [
  _BgPreset('', '默认', Color(0xFF111111)),
  _BgPreset('solid:#1a1a2e', '海军蓝', Color(0xFF1a1a2e)),
  _BgPreset('solid:#16213e', '深蓝', Color(0xFF16213e)),
  _BgPreset('solid:#0f3460', '钴蓝', Color(0xFF0f3460)),
  _BgPreset('solid:#2b2b2b', '炭灰', Color(0xFF2b2b2b)),
  _BgPreset('solid:#1b1b2f', '暗紫', Color(0xFF1b1b2f)),
  _BgPreset(
    'gradient:#0f0c29|#302b63|#24243e',
    '午夜',
    Color(0xFF0f0c29),
    [Color(0xFF0f0c29), Color(0xFF302b63), Color(0xFF24243e)],
  ),
  _BgPreset(
    'gradient:#0f2027|#203a43|#2c5364',
    '海洋',
    Color(0xFF0f2027),
    [Color(0xFF0f2027), Color(0xFF203a43), Color(0xFF2c5364)],
  ),
  _BgPreset(
    'gradient:#1a1a2e|#16213e|#0f3460',
    '极光',
    Color(0xFF1a1a2e),
    [Color(0xFF1a1a2e), Color(0xFF16213e), Color(0xFF0f3460)],
  ),
  _BgPreset(
    'gradient:#0b0c10|#1f2833|#1a3a3a',
    '森林',
    Color(0xFF0b0c10),
    [Color(0xFF0b0c10), Color(0xFF1f2833), Color(0xFF1a3a3a)],
  ),
];

/// 聊天背景选择器 — 弹出对话框，网格展示纯色和渐变预设
class BackgroundPicker extends StatelessWidget {
  const BackgroundPicker({super.key});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppColors.bgElevated,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: const Text('聊天背景', style: TextStyle(color: AppColors.textPrimary, fontSize: 18)),
      content: SizedBox(
        width: 320,
        child: Wrap(
          spacing: 12,
          runSpacing: 12,
          children: _presets.map((p) {
            return GestureDetector(
              onTap: () => Navigator.pop(context, p.id),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.border),
                      gradient: p.isGradient
                          ? LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: p.gradientColors!,
                            )
                          : null,
                      color: p.isGradient ? null : p.color,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    p.label,
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                  ),
                ],
              ),
            );
          }).toList(),
        ),
      ),
    );
  }
}
