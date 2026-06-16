/// 桌面外壳 — 无边框窗口的根容器
///
/// 在桌面平台（Windows/macOS/Linux）为应用添加圆角裁剪、自定义标题栏和可拖拽缩放边框；
/// 移动平台直接透传子组件，不做额外包装。
library;

import 'package:flutter/foundation.dart' show defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

import '../core/theme/app_radius.dart';
import 'widgets/desktop_title_bar.dart';

/// 桌面外壳 — 无边框窗口的根容器，添加圆角裁剪和可拖拽缩放边框
///
/// 桌面平台添加自定义标题栏和 Resize 热区，移动端直接透传 child。
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.child});

  final Widget child;

  bool get _isDesktopPlatform =>
      defaultTargetPlatform == TargetPlatform.windows ||
      defaultTargetPlatform == TargetPlatform.macOS ||
      defaultTargetPlatform == TargetPlatform.linux;

  @override
  Widget build(BuildContext context) {
    if (!_isDesktopPlatform) return child;

    return ClipRRect(
      borderRadius: AppRadius.mdAll,
      child: _ResizableBorder(
        child: Container(
          color: const Color(0xFF111111),
          child: Column(
            children: [
              const DesktopTitleBar(),
              Expanded(child: child),
            ],
          ),
        ),
      ),
    );
  }
}

/// 窗口边缘的 Resize 热区叠加层 — 在四边和四角放置鼠标拖拽缩放手势区域
class _ResizableBorder extends StatelessWidget {
  final Widget child;
  const _ResizableBorder({required this.child});

  static const _edgeSize = 4.0;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        child,
        // 四边
        const Positioned(
          top: 0, left: _edgeSize, right: _edgeSize, height: _edgeSize,
          child: _ResizeHandle(edge: ResizeEdge.top),
        ),
        const Positioned(
          bottom: 0, left: _edgeSize, right: _edgeSize, height: _edgeSize,
          child: _ResizeHandle(edge: ResizeEdge.bottom),
        ),
        const Positioned(
          left: 0, top: _edgeSize, bottom: _edgeSize, width: _edgeSize,
          child: _ResizeHandle(edge: ResizeEdge.left),
        ),
        const Positioned(
          right: 0, top: _edgeSize, bottom: _edgeSize, width: _edgeSize,
          child: _ResizeHandle(edge: ResizeEdge.right),
        ),
        // 四角
        const Positioned(
          top: 0, left: 0, width: _edgeSize * 2, height: _edgeSize * 2,
          child: _ResizeHandle(edge: ResizeEdge.topLeft),
        ),
        const Positioned(
          top: 0, right: 0, width: _edgeSize * 2, height: _edgeSize * 2,
          child: _ResizeHandle(edge: ResizeEdge.topRight),
        ),
        const Positioned(
          bottom: 0, left: 0, width: _edgeSize * 2, height: _edgeSize * 2,
          child: _ResizeHandle(edge: ResizeEdge.bottomLeft),
        ),
        const Positioned(
          bottom: 0, right: 0, width: _edgeSize * 2, height: _edgeSize * 2,
          child: _ResizeHandle(edge: ResizeEdge.bottomRight),
        ),
      ],
    );
  }
}

/// 单个 Resize 热区 — 根据边缘方向设置对应的鼠标光标样式
class _ResizeHandle extends StatelessWidget {
  final ResizeEdge edge;
  const _ResizeHandle({required this.edge});

  MouseCursor _cursor(ResizeEdge e) {
    return switch (e) {
      ResizeEdge.top => SystemMouseCursors.resizeUp,
      ResizeEdge.bottom => SystemMouseCursors.resizeDown,
      ResizeEdge.left => SystemMouseCursors.resizeLeft,
      ResizeEdge.right => SystemMouseCursors.resizeRight,
      ResizeEdge.topLeft => SystemMouseCursors.resizeUpLeft,
      ResizeEdge.topRight => SystemMouseCursors.resizeUpRight,
      ResizeEdge.bottomLeft => SystemMouseCursors.resizeDownLeft,
      ResizeEdge.bottomRight => SystemMouseCursors.resizeDownRight,
    };
  }

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: _cursor(edge),
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onPanStart: (_) => windowManager.startResizing(edge),
      ),
    );
  }
}
