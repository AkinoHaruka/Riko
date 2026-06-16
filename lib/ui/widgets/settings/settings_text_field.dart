/// 设置页文本输入框 — 带图标、标签和密码可见性切换
///
/// 支持普通文本和密码模式，密码模式下右侧显示眼睛图标切换可见性。
/// 外部 value 变更时自动同步到内部 TextEditingController。
library;

import 'package:flutter/material.dart';

import '../../../core/theme/app_animations.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_radius.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

/// 设置页文本输入框 — 带图标和标签，支持密码可见性切换（眼睛按钮）
class SettingsTextField extends StatefulWidget {
  final String label;
  final String hint;
  final String value;
  final bool obscureText;
  final IconData icon;
  final ValueChanged<String> onChanged;

  const SettingsTextField({
    super.key,
    required this.label,
    required this.hint,
    required this.value,
    this.obscureText = false,
    required this.icon,
    required this.onChanged,
  });

  @override
  State<SettingsTextField> createState() => _SettingsTextFieldState();
}

class _SettingsTextFieldState extends State<SettingsTextField> {
  late TextEditingController _controller;
  bool _isObscured = true;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value);
  }

  @override
  void didUpdateWidget(SettingsTextField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.value != widget.value && _controller.text != widget.value) {
      _controller.text = widget.value;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                widget.icon,
                color: AppColors.textPrimary.withValues(alpha: 0.6),
                size: 18,
              ),
              AppSpacing.hSM,
              Text(
                widget.label,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 13,
                ),
              ),
            ],
          ),
          AppSpacing.vSM,
          TextField(
            controller: _controller,
            obscureText: widget.obscureText && _isObscured,
            style: const TextStyle(color: AppColors.textPrimary, fontSize: AppTypography.body),
            onChanged: widget.onChanged,
            decoration: InputDecoration(
              hintText: widget.hint,
              hintStyle: const TextStyle(color: AppColors.textTertiary),
              filled: true,
              fillColor: AppColors.bgElevated,
              border: OutlineInputBorder(
                borderRadius: AppRadius.mdAll,
                borderSide: const BorderSide(color: AppColors.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: AppRadius.mdAll,
                borderSide: const BorderSide(color: AppColors.border),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: AppRadius.mdAll,
                borderSide: BorderSide(
                  color: AppColors.textPrimary.withValues(alpha: 0.5),
                  width: 1.5,
                ),
              ),
              suffixIcon: widget.obscureText
                  ? AnimatedSwitcher(
                      duration: AppAnimations.quick,
                      switchInCurve: Curves.easeOutCubic,
                      child: IconButton(
                        key: ValueKey(_isObscured),
                        icon: Icon(
                          _isObscured ? Icons.visibility_off : Icons.visibility,
                          color: AppColors.textTertiary,
                          size: 20,
                        ),
                        onPressed: () =>
                            setState(() => _isObscured = !_isObscured),
                      ),
                    )
                  : null,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
