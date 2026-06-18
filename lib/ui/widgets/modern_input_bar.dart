/// 现代输入栏 — 聊天消息输入组件
///
/// 支持多行文本输入、Enter 发送 / Shift+Enter 换行、发送按钮（有文本时绿色）/ 加号按钮（空文本时展开参数面板）。
/// 参数面板包含 Temperature 和 Max Tokens 滑块调节。
/// 通过 [inputBarStateProvider] 将焦点、文本长度、加载状态暴露给 DynamicIsland，避免深层传参。
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import '../../core/di/input_bar_state_provider.dart';
import '../../core/theme/app_animations.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_glass.dart';
import '../../core/theme/app_radius.dart';
import '../../core/theme/app_shadows.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_spring.dart';
import '../../core/theme/app_typography.dart';

/// 现代输入栏 — 多行文本输入、发送按钮、Temperature/Max Tokens 调节面板
///
/// 有文本时显示绿色发送按钮，空文本时显示圆形加号按钮以展开参数选项面板。
class ModernInputBar extends ConsumerStatefulWidget {
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
  ConsumerState<ModernInputBar> createState() => _ModernInputBarState();
}

class _ModernInputBarState extends ConsumerState<ModernInputBar> {
  bool _showOptions = false;
  bool _hasText = false;
  late final FocusNode _focusNode;

  @override
  void initState() {
    super.initState();
    _focusNode = FocusNode();
    _focusNode.addListener(_onFocusChanged);
    widget.controller.addListener(_onTextChanged);
  }

  @override
  void didUpdateWidget(covariant ModernInputBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isLoading != oldWidget.isLoading) {
      ref.read(inputBarStateProvider.notifier).setLoading(widget.isLoading);
      // 进入加载态表示消息已发出，正处于等待回复阶段；结束时清除等待标记
      ref
          .read(inputBarStateProvider.notifier)
          .setWaitingReply(widget.isLoading);
    }
  }

  @override
  void dispose() {
    _focusNode.removeListener(_onFocusChanged);
    _focusNode.dispose();
    widget.controller.removeListener(_onTextChanged);
    super.dispose();
  }

  /// 焦点变化时同步到 Provider，触发 Island 脉动
  void _onFocusChanged() {
    ref.read(inputBarStateProvider.notifier).setFocused(_focusNode.hasFocus);
  }

  /// 文本变化时同步长度到 Provider，并更新本地发送按钮状态
  void _onTextChanged() {
    final text = widget.controller.text;
    final hasText = text.trim().isNotEmpty;
    ref.read(inputBarStateProvider.notifier).setTextLength(text.length);
    if (hasText != _hasText) {
      setState(() => _hasText = hasText);
    }
  }

  /// 发送后清空输入，等待 ChatNotifier 设置 isLoading 后由 didUpdateWidget 同步等待状态
  void _handleSend() {
    if (!widget.isLoading && widget.controller.text.trim().isNotEmpty) {
      widget.onSend();
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppGlass.inputBar(
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedSize(
                duration: AppAnimations.duration(context, AppAnimations.page),
                curve: AppAnimations.curve(context, AppSprings.bouncyCurve),
                alignment: Alignment.topCenter,
                child: _showOptions
                    ? _buildOptionsPanel()
                    : const SizedBox.shrink(),
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
                            _handleSend();
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
                        focusNode: _focusNode,
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
                            _handleSend();
                          }
                        },
                        cursorColor: AppColors.green,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: AppTypography.bodyLg,
                        ),
                        decoration: InputDecoration(
                          filled: true,
                          fillColor: AppColors.bgElevated,
                          hintText: '输入消息，Shift+Enter 换行',
                          hintStyle: const TextStyle(
                            color: AppColors.textTertiary,
                            fontSize: AppTypography.bodyLg,
                          ),
                          border: OutlineInputBorder(
                            borderRadius: AppRadius.mdAll,
                            borderSide: BorderSide.none,
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: AppRadius.mdAll,
                            borderSide: BorderSide(
                              color: AppColors.green.withValues(alpha: 0.5),
                              width: 1.5,
                            ),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: AppRadius.mdAll,
                            borderSide: BorderSide.none,
                          ),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 12,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  // 有文本时显示绿色发送按钮，否则显示圆形加号按钮
                  AnimatedSwitcher(
                    duration: AppAnimations.duration(
                      context,
                      AppAnimations.normal,
                    ),
                    switchInCurve: AppAnimations.curve(
                      context,
                      AppSprings.bouncyCurve,
                    ),
                    switchOutCurve: AppAnimations.curve(
                      context,
                      AppAnimations.easeIn,
                    ),
                    transitionBuilder: (child, animation) => FadeTransition(
                      opacity: animation,
                      child: ScaleTransition(
                        scale: animation.drive(
                          Tween(
                            begin: 0.5,
                            end: 1.0,
                          ).chain(CurveTween(curve: AppSprings.bouncyCurve)),
                        ),
                        child: child,
                      ),
                    ),
                    child: _hasText
                        ? Semantics(
                            label: widget.isLoading ? '发送中' : '发送消息',
                            button: true,
                            child: SpringScaleTap(
                              key: const ValueKey('send'),
                              onTap: widget.isLoading ? () {} : _handleSend,
                              scaleDown: 0.85,
                              spring: AppSprings.bouncyHeavy,
                              child: AnimatedContainer(
                                duration: AppAnimations.duration(
                                  context,
                                  AppAnimations.quick,
                                ),
                                curve: AppAnimations.curve(
                                  context,
                                  AppAnimations.easeOut,
                                ),
                                width: 40,
                                height: 40,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  gradient: LinearGradient(
                                    colors: widget.isLoading
                                        ? [
                                            AppColors.green.withAlpha(120),
                                            AppColors.greenDark.withAlpha(120),
                                          ]
                                        : [
                                            AppColors.greenLight,
                                            AppColors.green,
                                          ],
                                    begin: Alignment.topLeft,
                                    end: Alignment.bottomRight,
                                  ),
                                  boxShadow: AppShadows.button(
                                    AppColors.green,
                                    pressed: false,
                                  ),
                                ),
                                child: const Center(
                                  child: Icon(
                                    Icons.arrow_upward,
                                    color: Colors.white,
                                    size: 20,
                                  ),
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
    return SpringScaleTap(
      key: key,
      onTap: onTap,
      scaleDown: 0.88,
      spring: AppSprings.bouncy,
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

  /// 参数选项面板 — Temperature 和 Max Tokens 滑块，浮起卡片式
  Widget _buildOptionsPanel() {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(AppSpacing.mdSm),
      decoration: BoxDecoration(
        color: AppColors.bgElevated,
        borderRadius: AppRadius.lgAll,
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.06),
          width: 0.5,
        ),
        boxShadow: AppShadows.card,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.onSystemMessage != null)
            SpringScaleTap(
              scaleDown: 0.97,
              onTap: () {
                setState(() => _showOptions = false);
                widget.onSystemMessage!();
              },
              child: const ListTile(
                dense: true,
                leading: Icon(
                  Icons.settings_applications,
                  color: AppColors.textSecondary,
                  size: 20,
                ),
                title: Text(
                  '发送系统消息',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: AppTypography.body,
                  ),
                ),
              ),
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
              child: Divider(
                height: 1,
                thickness: 0.5,
                color: AppColors.borderLight,
              ),
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
