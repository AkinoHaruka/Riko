/// Toast 提示叠加层 — 全局轻量消息提示
///
/// 在页面顶部居中显示短暂提示消息，支持多条堆叠。
/// 每条 Toast 带毛玻璃背景、状态图标和滑入淡入动画，由 toastProvider 管理生命周期。
/// 使用 IgnorePointer 确保不阻挡底层交互。
library;

import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/di/toast_provider.dart';
import '../../core/theme/app_animations.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_radius.dart';
import '../../core/theme/app_typography.dart';

/// Toast 叠加层组件 — 包裹子组件并在顶部显示 Toast 消息
class ToastOverlay extends ConsumerWidget {
  final Widget child;

  const ToastOverlay({super.key, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final toasts = ref.watch(toastProvider);

    return Stack(
      children: [
        child,
        if (toasts.isNotEmpty)
          IgnorePointer(
            child: DefaultTextStyle(
              style: const TextStyle(decoration: TextDecoration.none),
              child: Align(
                alignment: Alignment.topCenter,
                child: Padding(
                  padding: EdgeInsets.only(
                    top: MediaQuery.of(context).padding.top + 16,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (final toast in toasts)
                        _ToastItem(
                          key: ValueKey(toast.id),
                          text: toast.text,
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// 单条 Toast 项 — 带滑入淡入/淡出动画的提示气泡
class _ToastItem extends StatefulWidget {
  final String text;

  const _ToastItem({super.key, required this.text});

  @override
  State<_ToastItem> createState() => _ToastItemState();
}

class _ToastItemState extends State<_ToastItem>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _opacity;
  late final Animation<Offset> _slide;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: AppAnimations.quick,
      reverseDuration: AppAnimations.micro,
      vsync: this,
    );
    _opacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: AppAnimations.easeOutExpo),
    );
    _slide = Tween<Offset>(
      begin: const Offset(0, -1.0),
      end: Offset.zero,
    ).animate(
      CurvedAnimation(
        parent: _controller,
        curve: AppAnimations.easeOutBack,
        reverseCurve: Curves.easeIn,
      ),
    );
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> dismiss() async {
    if (!_controller.isCompleted) return;
    await _controller.reverse();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Opacity(
          opacity: _opacity.value,
          child: Transform.translate(
            offset: _slide.value.scale(0, 24),
            child: child,
          ),
        );
      },
      child: ClipRRect(
        borderRadius: AppRadius.xlAll,
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 40, vertical: 4),
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.surfaceGlass,
              borderRadius: AppRadius.xlAll,
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.1),
                width: 0.5,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.check_circle_rounded,
                  color: AppColors.green,
                  size: 18,
                ),
                const SizedBox(width: 10),
                Flexible(
                  child: Text(
                    widget.text,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: AppTypography.body,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
