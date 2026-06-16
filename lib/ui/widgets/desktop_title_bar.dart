
/// 桌面窗口标题栏 — 自定义无边框窗口控制区
///
/// 支持窗口拖动、双击最大化/还原、最小化/最大化/关闭按钮。
/// 仅在桌面平台显示，移动平台返回空组件。
/// 关闭按钮悬停时变红，最大化按钮根据当前状态切换图标。
library;

import 'package:flutter/foundation.dart' show defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

import '../../core/theme/app_animations.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';

/// 桌面窗口标题栏 — 支持窗口拖动、双击最大化/还原、最小化/最大化/关闭按钮
class DesktopTitleBar extends StatefulWidget {
  const DesktopTitleBar({super.key});

  @override
  State<DesktopTitleBar> createState() => _DesktopTitleBarState();
}

class _DesktopTitleBarState extends State<DesktopTitleBar> with WindowListener {
  bool _isMaximized = false;

  @override
  void initState() {
    super.initState();
    if (!_isDesktopPlatform) return;
    windowManager.addListener(this);
    _syncMaximizedState();
  }

  @override
  void dispose() {
    if (_isDesktopPlatform) {
      windowManager.removeListener(this);
    }
    super.dispose();
  }

  Future<void> _syncMaximizedState() async {
    try {
      final maximized = await windowManager.isMaximized();
      if (mounted) setState(() => _isMaximized = maximized);
    } catch (_) {
      // 测试环境中可能无法访问平台通道
    }
  }

  @override
  void onWindowMaximize() => setState(() => _isMaximized = true);

  @override
  void onWindowUnmaximize() => setState(() => _isMaximized = false);

  @override
  Widget build(BuildContext context) {
    if (!_isDesktopPlatform) return const SizedBox.shrink();

    return DefaultTextStyle(
      style: const TextStyle(decoration: TextDecoration.none),
      child: Container(
        height: 32,
        color: AppColors.bgTertiary,
        child: Row(
        children: [
          // 窗口拖拽区域
          Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onPanStart: (_) => windowManager.startDragging(),
              onDoubleTap: () async {
                if (_isMaximized) {
                  await windowManager.unmaximize();
                } else {
                  await windowManager.maximize();
                }
              },
              child: Padding(
                padding: const EdgeInsets.only(left: 12),
                child: Row(
                  children: [
                    const _LogoDot(),
                    AppSpacing.hSM,
                    const Text(
                      'RIKO',
                      style: TextStyle(
                        fontSize: AppTypography.caption,
                        fontWeight: FontWeight.w500,
                        color: AppColors.textSecondary,
                        fontFamily: 'MiSans',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // 窗口控制按钮
          _WindowButton(
            icon: Icons.minimize,
            onTap: () => windowManager.minimize(),
          ),
          _WindowButton(
            icon: _isMaximized ? Icons.filter_none : Icons.crop_square,
            onTap: () async {
              if (_isMaximized) {
                await windowManager.unmaximize();
              } else {
                await windowManager.maximize();
              }
            },
          ),
          _WindowButton(
            icon: Icons.close,
            hoverColor: AppColors.error,
            hoverIconColor: Colors.white,
            onTap: () => windowManager.close(),
          ),
        ],
        ),
      ),
    );
  }

  bool get _isDesktopPlatform =>
      defaultTargetPlatform == TargetPlatform.windows ||
      defaultTargetPlatform == TargetPlatform.macOS ||
      defaultTargetPlatform == TargetPlatform.linux;
}

/// 标题栏左侧绿色圆点 Logo
class _LogoDot extends StatelessWidget {
  const _LogoDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 12,
      height: 12,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        color: AppColors.green,
      ),
    );
  }
}

/// 窗口控制按钮（最小化/最大化/关闭）— 带悬停高亮效果
class _WindowButton extends StatefulWidget {
  const _WindowButton({
    required this.icon,
    required this.onTap,
    this.hoverColor = AppColors.surfaceHover,
    this.hoverIconColor,
  });

  final IconData icon;
  final VoidCallback onTap;
  final Color hoverColor;
  final Color? hoverIconColor;

  @override
  State<_WindowButton> createState() => _WindowButtonState();
}

class _WindowButtonState extends State<_WindowButton> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        onTap: widget.onTap,
        child: AnimatedContainer(
          duration: AppAnimations.micro,
          width: 46,
          height: 32,
          color: _hovered ? widget.hoverColor : Colors.transparent,
          alignment: Alignment.center,
          child: TweenAnimationBuilder<Color?>(
            tween: ColorTween(
              begin: AppColors.textSecondary,
              end: _hovered && widget.hoverIconColor != null
                  ? widget.hoverIconColor
                  : AppColors.textSecondary,
            ),
            duration: AppAnimations.micro,
            curve: AppAnimations.easeOut,
            builder: (context, color, _) => Icon(
              widget.icon,
              size: 14,
              color: color,
            ),
          ),
        ),
      ),
    );
  }
}
