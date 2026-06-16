/// 现代输入栏 — 聊天消息输入组件
///
/// 支持多行文本输入、Enter 发送 / Shift+Enter 换行、发送按钮（有文本时绿色）/ 加号按钮（空文本时展开参数面板）。
/// 参数面板包含 Temperature 和 Max Tokens 滑块调节。
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import '../../core/theme/app_animations.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_radius.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';

/// 现代输入栏 — 多行文本输入、发送按钮、Temperature/Max Tokens 调节面板
///
/// 有文本时显示绿色发送按钮，空文本时显示圆形加号按钮以展开参数选项面板。
class ModernInputBar extends StatefulWidget {
  final TextEditingController controller;
  final bool isLoading;
  final VoidCallback onSend;
  final VoidCallback? onSystemMessage;
  final ValueChanged<double>? onTemperatureChanged;
  final ValueChanged<int>? onMaxTokensChanged;
  final double temperature;
  final int maxTokens;

  const ModernInputBar({
    super.key,
    required this.controller,
    required this.isLoading,
    required this.onSend,
    this.onSystemMessage,
    this.onTemperatureChanged,
    this.onMaxTokensChanged,
    this.temperature = 0.7,
    this.maxTokens = 384000,
  });

  @override
  State<ModernInputBar> createState() => _ModernInputBarState();
}

class _ModernInputBarState extends State<ModernInputBar> {
  bool _showOptions = false;
  bool _hasText = false;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onTextChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onTextChanged);
    super.dispose();
  }

  void _onTextChanged() {
    final hasText = widget.controller.text.trim().isNotEmpty;
    if (hasText != _hasText) {
      setState(() => _hasText = hasText);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.bgTertiary,
        border: Border(top: BorderSide(color: AppColors.border, width: 0.5)),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedSize(
                duration: AppAnimations.page,
                curve: AppAnimations.easeOutBack,
                alignment: Alignment.topCenter,
                child: _showOptions ? _buildOptionsPanel() : const SizedBox.shrink(),
              ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: CallbackShortcuts(
                      bindings: {
                        const SingleActivator(LogicalKeyboardKey.enter): () {
                          if (!widget.isLoading &&
                              widget.controller.text.trim().isNotEmpty) {
                            widget.onSend();
                          }
                        },
                        const SingleActivator(
                          LogicalKeyboardKey.enter,
                          shift: true,
                        ): () {
                          final text = widget.controller.text;
                          final selection = widget.controller.selection;
                          final newText = text.replaceRange(
                            selection.start,
                            selection.end,
                            '\n',
                          );
                          widget.controller.value = TextEditingValue(
                            text: newText,
                            selection: TextSelection.collapsed(
                              offset: selection.start + 1,
                            ),
                          );
                        },
                      },
                      child: TextField(
                        controller: widget.controller,
                        enabled: !widget.isLoading,
                        minLines: 1,
                        maxLines: 6,
                        keyboardType: TextInputType.multiline,
                        // 有文本时显示"发送"动作按钮，否则显示换行
                        textInputAction: _hasText
                            ? TextInputAction.send
                            : TextInputAction.newline,
                        onSubmitted: (_) {
                          if (!widget.isLoading &&
                              widget.controller.text.trim().isNotEmpty) {
                            widget.onSend();
                          }
                        },
                        cursorColor: AppColors.green,
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: AppTypography.bodyLg,
                        ),
                        decoration: InputDecoration(
                          filled: true,
                          fillColor: AppColors.bgElevated,
                          border: OutlineInputBorder(
                            borderRadius: AppRadius.smAll,
                            borderSide: BorderSide.none,
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: AppRadius.smAll,
                            borderSide: BorderSide.none,
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: AppRadius.smAll,
                            borderSide: BorderSide.none,
                          ),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 10,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  // 有文本时显示绿色发送按钮，否则显示圆形加号按钮
                  AnimatedSwitcher(
                    duration: AppAnimations.quick,
                    switchInCurve: Curves.easeOutCubic,
                    switchOutCurve: AppAnimations.easeInOut,
                    child: _hasText
                        ? AppAnimations.scaleTap(
                            onTap: widget.isLoading
                                ? () {}
                                : () => widget.onSend(),
                            child: Container(
                              key: const ValueKey('send'),
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: widget.isLoading
                                    ? AppColors.green.withAlpha(120)
                                    : AppColors.green,
                              ),
                              child: const Center(
                                child: Icon(
                                  Icons.arrow_upward,
                                  color: Colors.white,
                                  size: 20,
                                ),
                              ),
                            ),
                          )
                        : _buildCircleIconButton(
                            key: const ValueKey('plus'),
                            customPainter: null,
                            icon: null,
                            customWidget: Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: AppColors.textPrimary,
                                  width: 1.0,
                                ),
                              ),
                              child: const Center(
                                child: FaIcon(
                                  FontAwesomeIcons.plus,
                                  color: AppColors.textPrimary,
                                  size: 18,
                                ),
                              ),
                            ),
                            onTap: () =>
                                setState(() => _showOptions = !_showOptions),
                          ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCircleIconButton({
    Key? key,
    IconData? icon,
    CustomPainter? customPainter,
    double iconSize = 20,
    Size customPaintSize = const Size(20, 20),
    Widget? customWidget,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      key: key,
      onTap: onTap,
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.textPrimary, width: 1.0),
        ),
        child:
            customWidget ??
            (icon != null
                ? Icon(icon, color: AppColors.textPrimary, size: iconSize)
                : customPainter != null
                ? CustomPaint(painter: customPainter, size: customPaintSize)
                : null),
      ),
    );
  }

  /// 参数选项面板 — Temperature 和 Max Tokens 滑块
  Widget _buildOptionsPanel() {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(AppSpacing.mdSm),
      decoration: BoxDecoration(
        color: AppColors.bgElevated,
        borderRadius: AppRadius.mdAll,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.onSystemMessage != null)
            ListTile(
              dense: true,
              leading: const Icon(
                Icons.settings_applications,
                color: AppColors.textSecondary,
                size: 20,
              ),
              title: const Text(
                '发送系统消息',
                style: TextStyle(color: AppColors.textPrimary, fontSize: AppTypography.body),
              ),
              onTap: () {
                setState(() => _showOptions = false);
                widget.onSystemMessage!();
              },
            ),
          if (widget.onTemperatureChanged != null) ...[
            _buildSlider(
              label: 'Temperature',
              value: widget.temperature,
              min: 0.0,
              max: 2.0,
              divisions: 20,
              onChanged: widget.onTemperatureChanged!,
            ),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 8),
              child: Divider(height: 1, thickness: 0.5, color: AppColors.borderLight),
            ),
          ],
          if (widget.onMaxTokensChanged != null)
            _buildSlider(
              label: 'Max Tokens',
              value: widget.maxTokens.toDouble(),
              min: 256,
              max: 384000,
              divisions: 383,
              onChanged: (v) => widget.onMaxTokensChanged!(v.toInt()),
            ),
        ],
      ),
    );
  }

  Widget _buildSlider({
    required String label,
    required double value,
    required double min,
    required double max,
    required int divisions,
    required ValueChanged<double> onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
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
                  fontSize: AppTypography.caption,
                ),
              ),
              Text(
                value is int || value == value.roundToDouble()
                    ? value.toInt().toString()
                    : value.toStringAsFixed(1),
                style: const TextStyle(
                  color: AppColors.green,
                  fontSize: AppTypography.caption,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          SliderTheme(
            data: SliderTheme.of(context).copyWith(
              activeTrackColor: AppColors.green,
              inactiveTrackColor: AppColors.borderLight,
              thumbColor: AppColors.green,
              trackHeight: 4,
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
