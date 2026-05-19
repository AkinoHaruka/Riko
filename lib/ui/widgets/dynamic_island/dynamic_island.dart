import 'dart:math' as math;
import 'package:flutter/material.dart';

/// 动态岛 — 顶部状态指示器，展示 Token 用量和子代理（会话记忆/压缩/整固）的累积进度
///
/// 点击展开/收起，展开后显示三个子代理的进度条和百分比环形指示器，收起时仅显示 Token 计数。
class DynamicIsland extends StatefulWidget {
  final int tokenCount;
  final int maxTokens;
  final double memoryProgress;
  final double compactProgress;
  final double dreamProgress;

  const DynamicIsland({
    super.key,
    this.tokenCount = 0,
    this.maxTokens = 1000000,
    this.memoryProgress = 0,
    this.compactProgress = 0,
    this.dreamProgress = 0,
  });

  @override
  State<DynamicIsland> createState() => _DynamicIslandState();
}

class _DynamicIslandState extends State<DynamicIsland>
    with SingleTickerProviderStateMixin {
  bool _expanded = false;
  late final AnimationController _ac;
  late final Animation<double> _curve;

  static const _compactW = 180.0;
  static const _compactH = 34.0;
  static const _expandedW = 300.0;
  static const _expandedH = 200.0;

  @override
  void initState() {
    super.initState();
    _ac = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 350),
    );
    _curve = CurvedAnimation(parent: _ac, curve: Curves.easeOutCubic);
    _ac.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _ac.dispose();
    super.dispose();
  }

  void _toggle() {
    setState(() {
      _expanded = !_expanded;
      if (_expanded) {
        _ac.forward();
      } else {
        _ac.reverse();
      }
    });
  }

  String _formatTokens(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return n.toString();
  }

  @override
  Widget build(BuildContext context) {
    final t = _curve.value;
    final w = _compactW + (_expandedW - _compactW) * t;
    final h = _compactH + (_expandedH - _compactH) * t;
    final r = 17 + (16 - 17) * t;
    final expandOpacity = (t - 0.4).clamp(0.0, 1.0) / 0.6;
    final compactOpacity = 1.0 - t;

    return Align(
      alignment: Alignment.topCenter,
      child: GestureDetector(
        onTap: _expanded ? null : _toggle,
        child: Container(
          width: w,
          height: h,
          decoration: BoxDecoration(
            color: const Color(0xE6111111),
            borderRadius: BorderRadius.circular(r),
            border: Border.all(color: const Color(0x30FFFFFF), width: 0.5),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.4),
                blurRadius: 20,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            children: [
              Opacity(opacity: compactOpacity, child: _buildCompact()),
              if (expandOpacity > 0)
                Positioned.fill(
                  child: OverflowBox(
                    alignment: Alignment.topCenter,
                    maxHeight: double.infinity,
                    child: Opacity(opacity: expandOpacity, child: _buildExpanded()),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCompact() {
    final tokenText = widget.tokenCount > 0
        ? '${_formatTokens(widget.tokenCount)} tokens'
        : '就绪';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const _StatusDot(color: Color(0xFF2ED573)),
          const SizedBox(width: 10),
          Text(
            '璃 · $tokenText',
            style: const TextStyle(
              color: Color(0xFFd5d5d5),
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildExpanded() {
    final tokenText = widget.tokenCount > 0
        ? '${_formatTokens(widget.tokenCount)} / ${_formatTokens(widget.maxTokens)} tokens'
        : '就绪';
    final t = _curve.value;
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const _StatusDot(color: Color(0xFF2ED573)),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  '璃 · $tokenText',
                  style: const TextStyle(
                    color: Color(0xFFd5d5d5),
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              GestureDetector(
                onTap: _toggle,
                child: Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    color: const Color(0x14FFFFFF),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(
                    Icons.close,
                    color: Color(0xFF999999),
                    size: 14,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Divider(height: 1, color: Color(0x1AFFFFFF)),
          const SizedBox(height: 12),
          _StatusRow(
            icon: Icons.note_outlined,
            label: '会话记忆',
            progress: widget.memoryProgress,
            delay: 0,
            t: t,
          ),
          const SizedBox(height: 10),
          _StatusRow(
            icon: Icons.compress_outlined,
            label: '压缩',
            progress: widget.compactProgress,
            delay: 0.08,
            t: t,
          ),
          const SizedBox(height: 10),
          _StatusRow(
            icon: Icons.nightlight_outlined,
            label: '整固',
            progress: widget.dreamProgress,
            delay: 0.16,
            t: t,
          ),
        ],
      ),
    );
  }
}

/// 状态圆点 — 带发光阴影的圆形指示器
class _StatusDot extends StatelessWidget {
  final Color color;
  const _StatusDot({required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.3),
            blurRadius: 4,
            spreadRadius: 1,
          ),
        ],
      ),
    );
  }
}

/// 进度状态行 — 图标、标签、百分比和环形进度条
class _StatusRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final double progress;
  final double delay;
  final double t;

  const _StatusRow({
    required this.icon,
    required this.label,
    required this.progress,
    required this.delay,
    required this.t,
  });

  @override
  Widget build(BuildContext context) {
    final rowOpacity = ((t - 0.35 - delay) / 0.25).clamp(0.0, 1.0);
    final pct = (progress * 100).round();
    final pctColor = progress >= 0.95
        ? const Color(0xFF2ED573)
        : const Color(0xFF777777);
    return Opacity(
      opacity: rowOpacity,
      child: Row(
        children: [
          Icon(icon, color: const Color(0xFF999999), size: 15),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(color: Color(0xFF999999), fontSize: 12),
          ),
          const Spacer(),
          Text(
            '$pct%',
            style: TextStyle(color: pctColor, fontSize: 11, fontWeight: FontWeight.w600),
          ),
          const SizedBox(width: 6),
          SizedBox(
            width: 28,
            height: 28,
            child: _ProgressRing(progress: progress),
          ),
        ],
      ),
    );
  }
}

/// 环形进度指示器 — 使用 CustomPaint 绘制弧形
class _ProgressRing extends StatelessWidget {
  final double progress;
  const _ProgressRing({required this.progress});

  @override
  Widget build(BuildContext context) {
    final clampedProgress = progress.clamp(0.0, 1.0);
    return RepaintBoundary(
      child: CustomPaint(
        size: const Size(28, 28),
        painter: _ProgressRingPainter(clampedProgress),
      ),
    );
  }
}

/// 环形进度 CustomPainter — 绘制弧形进度条，95% 以上时切换为绿色
class _ProgressRingPainter extends CustomPainter {
  final double progress;
  _ProgressRingPainter(this.progress);

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 2.5;

    final bgPaint = Paint()
      ..color = const Color(0x20FFFFFF)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5;
    canvas.drawCircle(center, radius, bgPaint);

    if (progress <= 0) return;

    final color =
        progress >= 0.95 ? const Color(0xFF2ED573) : const Color(0xFF3EB573);
    final arcPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round;

    final rect = Rect.fromCircle(center: center, radius: radius);
    canvas.drawArc(rect, -math.pi / 2, 2 * math.pi * progress, false, arcPaint);
  }

  @override
  bool shouldRepaint(covariant _ProgressRingPainter old) =>
      old.progress != progress;
}
