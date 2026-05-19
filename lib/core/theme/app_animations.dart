import 'package:flutter/material.dart';
import 'app_colors.dart';

/// 全局动画常量与预设
class AppAnimations {
  AppAnimations._();

  static const Duration fast = Duration(milliseconds: 150);
  static const Duration normal = Duration(milliseconds: 300);
  static const Duration slow = Duration(milliseconds: 500);
  static const Duration cursorBlink = Duration(milliseconds: 530);

  static const Curve easeOutExpo = Cubic(0.16, 1, 0.3, 1);
  static const Curve easeInOutCubic = Cubic(0.65, 0, 0.35, 1);
  static const Curve spring = Cubic(0.34, 1.56, 0.64, 1);

  static Widget messageEntrance({
    required Widget child,
    required bool isUser,
  }) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.0, end: 1.0),
      duration: normal,
      curve: easeOutExpo,
      builder: (context, value, childWidget) {
        final offset = isUser ? 30.0 : -30.0;
        return Opacity(
          opacity: value,
          child: Transform.translate(
            offset: Offset(offset * (1 - value), 0),
            child: childWidget,
          ),
        );
      },
      child: child,
    );
  }

  static Widget blinkingCursor() {
    return const BlinkingCursorWidget();
  }

  static Widget scaleTap({
    required Widget child,
    required VoidCallback onTap,
    double scaleDown = 0.95,
  }) {
    return ScaleTapWidget(
      onTap: onTap,
      scaleDown: scaleDown,
      child: child,
    );
  }
}

class BlinkingCursorWidget extends StatefulWidget {
  const BlinkingCursorWidget({super.key});

  @override
  State<BlinkingCursorWidget> createState() => _BlinkingCursorWidgetState();
}

class _BlinkingCursorWidgetState extends State<BlinkingCursorWidget>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: AppAnimations.cursorBlink,
    );
    _controller.repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Opacity(
          opacity: _controller.value,
          child: const Text(
            '|',
            style: TextStyle(
              color: AppColors.cyan,
              fontWeight: FontWeight.w300,
            ),
          ),
        );
      },
    );
  }
}

class ScaleTapWidget extends StatefulWidget {
  final Widget child;
  final VoidCallback onTap;
  final double scaleDown;

  const ScaleTapWidget({
    super.key,
    required this.child,
    required this.onTap,
    required this.scaleDown,
  });

  @override
  State<ScaleTapWidget> createState() => _ScaleTapWidgetState();
}

class _ScaleTapWidgetState extends State<ScaleTapWidget>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: AppAnimations.fast,
      value: 1.0,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onTapDown(_) => _controller.animateTo(widget.scaleDown);
  void _onTapUp(_) => _controller.animateTo(1.0, curve: AppAnimations.spring);
  void _onTapCancel() => _controller.animateTo(1.0);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: widget.onTap,
      onTapDown: _onTapDown,
      onTapUp: _onTapUp,
      onTapCancel: _onTapCancel,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          return Transform.scale(
            scale: _controller.value,
            child: child,
          );
        },
        child: widget.child,
      ),
    );
  }
}
