
/// 可拖动分割线 — 左右面板比例调整器
///
/// 宽度 8px 的拖拽热区，中间 1px 竖线作为视觉分隔。
/// 拖拽时背景变为半透明绿色，松开后恢复透明。
/// 根据父容器宽度和最小/最大比例约束计算新比例。
library;

import 'package:flutter/material.dart';

import '../../core/theme/app_animations.dart';
import '../../core/theme/app_colors.dart';

/// 可拖动分割线组件 — 宽度 8px 的热区，中间 1px 竖线，支持水平拖动调整左右面板比例
class DraggableSplitter extends StatefulWidget {
  final double parentWidth;
  final double leftRatio;
  final double minRatio;
  final double maxRatio;
  final ValueChanged<double> onRatioChanged;

  const DraggableSplitter({
    super.key,
    required this.parentWidth,
    required this.leftRatio,
    required this.minRatio,
    required this.maxRatio,
    required this.onRatioChanged,
  });

  @override
  State<DraggableSplitter> createState() => _DraggableSplitterState();
}

class _DraggableSplitterState extends State<DraggableSplitter> {
  bool _isDragging = false;

  /// 拖动期间本地累积的比例值，避免依赖尚未重建的 widget.leftRatio
  late double _localRatio;

  @override
  void initState() {
    super.initState();
    _localRatio = widget.leftRatio;
  }

  @override
  void didUpdateWidget(covariant DraggableSplitter oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_isDragging) {
      _localRatio = widget.leftRatio;
    }
  }

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.resizeColumn,
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onHorizontalDragStart: (_) {
          _localRatio = widget.leftRatio;
          setState(() => _isDragging = true);
        },
        onHorizontalDragEnd: (_) => setState(() => _isDragging = false),
        onHorizontalDragCancel: () => setState(() => _isDragging = false),
        onHorizontalDragUpdate: (details) {
          final parentWidth = widget.parentWidth;
          if (parentWidth <= 0) return;

          _localRatio += details.delta.dx / parentWidth;
          _localRatio = _localRatio.clamp(widget.minRatio, widget.maxRatio);

          widget.onRatioChanged(_localRatio);
        },
        child: AnimatedContainer(
          duration: AppAnimations.micro,
          curve: AppAnimations.easeOut,
          width: 8,
          color: _isDragging
              ? AppColors.green.withValues(alpha: 0.3)
              : Colors.transparent,
          child: Center(
            child: AnimatedContainer(
              duration: AppAnimations.micro,
              curve: AppAnimations.easeOut,
              width: _isDragging ? 2 : 1,
              height: double.infinity,
              color: _isDragging ? AppColors.green : AppColors.border,
            ),
          ),
        ),
      ),
    );
  }
}
