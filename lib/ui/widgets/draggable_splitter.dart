
import 'package:flutter/material.dart';

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

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.resizeColumn,
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onHorizontalDragStart: (_) => setState(() => _isDragging = true),
        onHorizontalDragEnd: (_) => setState(() => _isDragging = false),
        onHorizontalDragCancel: () => setState(() => _isDragging = false),
        onHorizontalDragUpdate: (details) {
          final parentWidth = widget.parentWidth;
          if (parentWidth <= 0) return;

          final deltaRatio = details.delta.dx / parentWidth;
          var newRatio = widget.leftRatio + deltaRatio;
          newRatio = newRatio.clamp(widget.minRatio, widget.maxRatio);

          widget.onRatioChanged(newRatio);
        },
        child: Container(
          width: 8,
          color: _isDragging
              ? const Color(0xFF3eb573).withValues(alpha: 0.3)
              : Colors.transparent,
          child: Center(
            child: Container(
              width: 1,
              height: double.infinity,
              color: const Color(0xFF2C2C2C),
            ),
          ),
        ),
      ),
    );
  }
}
