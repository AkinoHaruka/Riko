/// 动态岛 — 顶部状态指示器组件
///
/// 仿 iOS 动态岛设计，收起时显示 Token 用量，展开后展示三个子代理
/// （会话记忆/压缩/整固）的累积进度条和百分比环形指示器。
/// 点击切换展开/收起，带平滑尺寸和透明度过渡动画。
library;

import 'dart:math' as math;
import 'dart:ui';
import 'package:flutter/material.dart';

import '../../../core/theme/app_animations.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_radius.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

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
      duration: AppAnimations.page,
    );
    _curve = CurvedAnimation(
      parent: _ac,
      curve: AppAnimations.easeOutBack,
      reverseCurve: AppAnimations.easeInOutCubic,
    );
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
    return Align(
      alignment: Alignment.topCenter,
      child: AppAnimations.scaleTap(
        onTap: _toggle,
        scaleDown: 0.97,
        child: AnimatedBuilder(
          animation: _curve,
          builder: (context, _) {
            final t = _curve.value;
            final w = _compactW + (_expandedW - _compactW) * t;
            final h = _compactH + (_expandedH - _compactH) * t;
            final r = 17 + (16 - 17) * t;
            final expandOpacity = ((t - 0.4) / 0.6).clamp(0.0, 1.0);
            final compactOpacity = (1.0 - t).clamp(0.0, 1.0);

            return ClipRRect(
              borderRadius: BorderRadius.circular(r),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
                child: Container(
                  width: w,
                  height: h,
                  decoration: BoxDecoration(
                    color: AppColors.bgPrimary.withValues(alpha: 0.7),
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
                            child: Opacity(opacity: expandOpacity, child: _buildExpanded(t)),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildCompact() {
    final tokenText = widget.tokenCount > 0
        ? '${_formatTokens(widget.tokenCount)} tokens'
        : '就绪';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const _StatusDot(color: AppColors.success),
          const SizedBox(width: 10),
          Text(
            '璃 · $tokenText',
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildExpanded(double t) {
    final tokenText = widget.tokenCount > 0
        ? '${_formatTokens(widget.tokenCount)} / ${_formatTokens(widget.maxTokens)} tokens'
        : '就绪';
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const _StatusDot(color: AppColors.success),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  '璃 · $tokenText',
                  style: const TextStyle(
                    color: AppColors.textPrimary,
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
                    color: AppColors.highlight,
                    borderRadius: AppRadius.mdAll,
                  ),
                  child: const Icon(
                    Icons.close,
                    color: AppColors.textSecondary,
                    size: 14,
                  ),
                ),
              ),
            ],
          ),
          AppSpacing.vMDSm,
          const Divider(height: 1, color: AppColors.surfaceGlass),
          AppSpacing.vMDSm,
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
        ? AppColors.success
        : AppColors.textTertiary;
    return Opacity(
      opacity: rowOpacity,
      child: Row(
        children: [
          Icon(icon, color: AppColors.textSecondary, size: 15),
          AppSpacing.hSM,
          Text(
            label,
            style: const TextStyle(color: AppColors.textSecondary, fontSize: AppTypography.caption),
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
      ..color = AppColors.surfaceGlass
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5;
    canvas.drawCircle(center, radius, bgPaint);

    if (progress <= 0) return;

    final color =
        progress >= 0.95 ? AppColors.success : AppColors.green;
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
