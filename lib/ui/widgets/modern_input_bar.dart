import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// 聊天输入栏配色常量
class _Colors {
  static const Color inputBarBg = Color(0xFF121212);
  static const Color textFieldBg = Color(0xFF1E1E1E);
  static const Color primaryText = Color(0xFFd5d5d5);
  static const Color secondaryText = Color(0xFF8E8E93);
  static const Color iconColor = Color(0xFFd5d5d5);
  static const Color divider = Color(0xFF2C2C2C);
  static const Color cursor = Color(0xFF3eb573);
}

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
        color: _Colors.inputBarBg,
        border: Border(top: BorderSide(color: _Colors.divider, width: 0.5)),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_showOptions) _buildOptionsPanel(),
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: CallbackShortcuts(
                      bindings: {
                        const SingleActivator(LogicalKeyboardKey.enter):
                            () {
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
                        cursorColor: _Colors.cursor,
                        style: const TextStyle(
                          color: _Colors.primaryText,
                          fontSize: 15,
                        ),
                        decoration: InputDecoration(
                          filled: true,
                          fillColor: _Colors.textFieldBg,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: BorderSide.none,
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: BorderSide.none,
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
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
                  _hasText
                      ? GestureDetector(
                          onTap: widget.isLoading
                              ? null
                              : () => widget.onSend(),
                          child: Container(
                            height: 36,
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            decoration: BoxDecoration(
                              color: widget.isLoading
                                  ? _Colors.cursor.withAlpha(120)
                                  : _Colors.cursor,
                              borderRadius: BorderRadius.circular(18),
                            ),
                            child: const Center(
                              child: Text(
                                '发送',
                                style: TextStyle(
                                  color: Color(0xFF2C2C2C),
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ),
                        )
                      : _buildCircleIconButton(
                          customPainter: null,
                          icon: null,
                          customWidget: Container(
                            width: 36,
                            height: 36,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: _Colors.iconColor,
                                width: 1.5,
                              ),
                            ),
                            child: const Center(
                              child: FaIcon(
                                FontAwesomeIcons.plus,
                                color: _Colors.iconColor,
                                size: 18,
                              ),
                            ),
                          ),
                          onTap: () =>
                              setState(() => _showOptions = !_showOptions),
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
    IconData? icon,
    CustomPainter? customPainter,
    double iconSize = 20,
    Size customPaintSize = const Size(20, 20),
    Widget? customWidget,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: _Colors.iconColor, width: 1.5),
        ),
        child:
            customWidget ??
            (icon != null
                ? Icon(icon, color: _Colors.iconColor, size: iconSize)
                : customPainter != null
                ? CustomPaint(painter: customPainter, size: customPaintSize)
                : null),
      ),
    );
  }

  Widget _buildOptionsPanel() {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _Colors.textFieldBg,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.onSystemMessage != null)
            ListTile(
              dense: true,
              leading: const Icon(
                Icons.settings_applications,
                color: _Colors.secondaryText,
                size: 20,
              ),
              title: const Text(
                '发送系统消息',
                style: TextStyle(color: _Colors.primaryText, fontSize: 14),
              ),
              onTap: () {
                setState(() => _showOptions = false);
                widget.onSystemMessage!();
              },
            ),
          if (widget.onTemperatureChanged != null)
            _buildSlider(
              label: 'Temperature',
              value: widget.temperature,
              min: 0.0,
              max: 2.0,
              divisions: 20,
              onChanged: widget.onTemperatureChanged!,
            ),
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
                  color: _Colors.secondaryText,
                  fontSize: 12,
                ),
              ),
              Text(
                value is int || value == value.roundToDouble()
                    ? value.toInt().toString()
                    : value.toStringAsFixed(1),
                style: const TextStyle(
                  color: Color(0xFF3eb573),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          SliderTheme(
            data: SliderTheme.of(context).copyWith(
              activeTrackColor: const Color(0xFF3eb573),
              inactiveTrackColor: const Color(0xFF3C3C3C),
              thumbColor: const Color(0xFF3eb573),
              trackHeight: 3,
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
