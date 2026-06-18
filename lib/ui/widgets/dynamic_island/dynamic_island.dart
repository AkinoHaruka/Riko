/// 动态岛 — 顶部状态指示器组件
///
/// 仿 iOS 动态岛设计，收起时显示 Token 用量，展开后展示三个子代理
/// （会话记忆/压缩/整固）的累积进度条和百分比环形指示器。
/// 点击切换展开/收起，带平滑尺寸、圆角与内容过渡动画。
library;

import 'dart:math' as math;
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/input_bar_state_provider.dart';
import '../../../core/theme/app_animations.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_radius.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

/// 动态岛状态枚举
///
/// - [compact]：胶囊形态，仅显示核心状态
/// - [expanded]：展开形态，显示完整进度面板
enum DynamicIslandState { compact, expanded }

/// 动态岛 — 顶部状态指示器，展示 Token 用量和子代理（会话记忆/压缩/整固）的累积进度
///
/// 点击展开/收起，展开后显示三个子代理的进度条和百分比环形指示器，收起时仅显示 Token 计数。
/// [maxWidth] 由外层根据可用空间传入，避免在窄面板中溢出。
class DynamicIsland extends ConsumerStatefulWidget {
  final int tokenCount;
  final int maxTokens;
  final double memoryProgress;
  final double compactProgress;
  final double dreamProgress;

  /// 展开态允许的最大宽度，由外层 [LayoutBuilder] 根据可用空间计算
  final double maxWidth;

  const DynamicIsland({
    super.key,
    this.tokenCount = 0,
    this.maxTokens = 1000000,
    this.memoryProgress = 0,
    this.compactProgress = 0,
    this.dreamProgress = 0,
    this.maxWidth = double.infinity,
  });

  @override
  ConsumerState<DynamicIsland> createState() => _DynamicIslandState();
}

class _DynamicIslandState extends ConsumerState<DynamicIsland>
    with TickerProviderStateMixin {
  DynamicIslandState _state = DynamicIslandState.compact;

  late final AnimationController _controller;
  late final Animation<double> _curve;

  /// 等待回复时状态圆点的呼吸动画控制器
  late final AnimationController _pulseController;
  late final Animation<double> _pulse;

  /// 紧凑态最小宽度，实际宽度按文字内容自适应
  static const _compactMinW = 140.0;

  /// 紧凑态高度：更扁的胶囊，接近 iOS 动态岛比例
  /// 38 = 12+12 padding + 13 号字体行高，视觉更精致
  static const _compactH = 38.0;

  /// 紧凑态胶囊圆角（= 高度一半）
  static const _compactRadius = _compactH / 2;

  /// 展开态设计宽度，实际受 [maxWidth] 限制
  static const _expandedW = 320.0;

  /// 展开态最小宽度：内部固定内容至少需要约 230 宽度，280 保证安全余量
  static const _expandedMinW = 280.0;

  /// 展开态高度：原 210 无法容纳实际内容，220 保留少量余量
  static const _expandedH = 220.0;

  /// 展开态卡片圆角（20 足够圆滑，同时让内部可用宽度更大）
  static const _expandedRadius = 20.0;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: AppAnimations.page,
      reverseDuration: const Duration(milliseconds: 280),
      value: 0.0,
    );
    // 尺寸动画使用 easeOutBack：带一次回弹过冲，Q 弹但不震荡，
    // 比 springIOS 更快稳定，避免高刷桌面上尾端反复抖动带来的"卡顿感"。
    _curve = CurvedAnimation(
      parent: _controller,
      curve: AppAnimations.easeOutBack,
      reverseCurve: Curves.easeInOutCubic,
    );
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
      value: 0.0,
    );
    _pulse = CurvedAnimation(
      parent: _pulseController,
      curve: Curves.easeInOutSine,
    );
    // 初始化时同步一次等待状态，避免首帧未订阅到 Provider 变化
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _updatePulse(ref.read(inputBarStateProvider).isWaitingReply);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _pulseController.dispose();
    super.dispose();
  }

  /// 根据等待回复状态启停呼吸动画
  void _updatePulse(bool isWaitingReply) {
    if (isWaitingReply) {
      if (!_pulseController.isAnimating) {
        _pulseController.repeat(reverse: true);
      }
    } else {
      _pulseController.stop();
      _pulseController.value = 0.0;
    }
  }

  /// 切换展开/收起状态
  ///
  /// 状态切换与尺寸动画**同时**触发：setState 让 AnimatedSwitcher 开始交叉淡入淡出内容，
  /// _controller.forward/reverse 驱动容器尺寸（width/height/radius）平滑过渡。
  /// 两者并行实现灵动岛"边变形边换内容"的流畅效果。
  /// 超出容器的内容由外层 ClipRRect 裁剪，不会溢出。
  void _toggle() {
    if (_state == DynamicIslandState.compact) {
      setState(() => _state = DynamicIslandState.expanded);
      _controller.forward();
    } else {
      setState(() => _state = DynamicIslandState.compact);
      _controller.reverse();
    }
  }

  /// 数字简写：1000 -> 1.0K，1000000 -> 1.0M
  String _formatTokens(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return n.toString();
  }

  /// 测量紧凑态内容所需的宽度，避免文字截断
  ///
  /// 包含状态圆点、间距、文字以及左右内边距。
  /// 使用后必须 dispose TextPainter，避免 native 资源泄漏。
  double _measureCompactWidth(BuildContext context, String label) {
    // 必须与 _buildCompact 中的 Text widget 使用完全一致的样式（含字体族），
    // 否则 TextPainter 测量的宽度与真实渲染宽度不一致，导致 right overflow。
    final textSpan = TextSpan(
      text: '璃 · $label',
      style: const TextStyle(
        color: AppColors.textPrimary,
        fontSize: 13,
        fontWeight: FontWeight.w500,
        fontFamily: AppTypography.fontFamily,
        fontFamilyFallback: AppTypography.fontFamilyFallback,
      ),
    );
    final textPainter = TextPainter(
      text: textSpan,
      textDirection: TextDirection.ltr,
      textScaler: MediaQuery.textScalerOf(context),
    )..layout();
    // 圆点 8 + 圆点与文字间距 8 + 左右内边距（必须 >= 胶囊圆角半径）
    final width = math.max(
      _compactMinW,
      textPainter.width + 8 + 8 + _compactRadius * 2,
    );
    textPainter.dispose();
    return width;
  }

  @override
  Widget build(BuildContext context) {
    final disableAnimations = MediaQuery.of(context).disableAnimations;
    final inputState = ref.watch(inputBarStateProvider);
    // 监听等待回复状态变化，驱动呼吸动画（替代 didUpdateWidget 中的重复读取）
    ref.listen<InputBarState>(inputBarStateProvider, (previous, next) {
      if (previous?.isWaitingReply != next.isWaitingReply) {
        _updatePulse(next.isWaitingReply);
      }
    });
    final statusColor = _resolveStatusColor(inputState);
    final compactLabel = _resolveCompactLabel(inputState);
    // 紧凑态宽度按实际文字内容测量，避免截断
    final compactW = _measureCompactWidth(context, compactLabel);
    // 展开态宽度受外层可用空间限制，保证不超出父容器；
    // 同时限制不小于展开态最小宽度，避免内容因太窄而溢出
    final expandedW = math.max(
      _expandedMinW,
      math.min(_expandedW, widget.maxWidth),
    );

    return Semantics(
      label: _state == DynamicIslandState.expanded ? '系统状态面板' : '系统状态',
      button: true,
      onTapHint: _state == DynamicIslandState.expanded ? '收起' : '展开',
      child: AppAnimations.scaleTap(
        onTap: _toggle,
        scaleDown: 0.97,
        // child 只构建一次：BackdropFilter + 装饰 + AnimatedSwitcher
        // 避免每帧重建这些昂贵组件（尤其是 BackdropFilter 的模糊计算）
        child: AnimatedBuilder(
          animation: _curve,
          builder: (context, child) {
            final t = _curve.value;

            // 容器尺寸插值：紧凑态到展开态
            final width = compactW + (expandedW - compactW) * t;
            final height = _compactH + (_expandedH - _compactH) * t;

            // 圆角插值：紧凑态为胶囊，展开态为卡片圆角
            final radius =
                _compactRadius + (_expandedRadius - _compactRadius) * t;

            // Container 提供：尺寸 + border + boxShadow（boxShadow 在外部不会被裁剪）
            // ClipRRect 提供：圆角裁剪（BackdropFilter 和内容都跟随圆角）
            return Container(
              width: width,
              height: height,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(radius),
                border: Border.all(color: const Color(0x28FFFFFF), width: 0.5),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.45),
                    blurRadius: 24,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(radius),
                child: child,
              ),
            );
          },
          // child 只构建一次：Stack 底层是 BackdropFilter+背景色，上层是内容层
          child: Stack(
            fit: StackFit.expand,
            children: [
              BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
                child: ColoredBox(
                  color: AppColors.bgPrimary.withValues(alpha: 0.72),
                ),
              ),
              // 内容层：作为"蒙版内容"在固定安全区 expandedW×_expandedH 内布局，
              // 不受当前岛尺寸限制；外层 ClipRRect 负责把超出岛形状的部分裁掉。
              // 这样 AnimatedSwitcher 转场时新旧两个 child 不会互相挤压，彻底消除
              // Row/Column 的 right/bottom overflow 报错。
              OverflowBox(
                alignment: Alignment.topCenter,
                maxWidth: expandedW,
                maxHeight: _expandedH,
                child: AnimatedSwitcher(
                  // 与尺寸动画 [_controller] 时长保持一致，避免内容先结束、
                  // 岛尺寸后定型造成的末尾闪烁感。
                  duration: disableAnimations
                      ? Duration.zero
                      : AppAnimations.page,
                  // 内容进入用 easeOutExpo 快速到位；退出用 easeIn 干脆淡出。
                  switchInCurve: AppAnimations.easeOutExpo,
                  switchOutCurve: Curves.easeIn,
                  transitionBuilder: _buildTransition,
                  // loose 模式让内容自适应尺寸，不强制撑满
                  layoutBuilder: (currentChild, previousChildren) {
                    return Stack(
                      alignment: Alignment.topCenter,
                      children: [...previousChildren, ?currentChild],
                    );
                  },
                  child: _state == DynamicIslandState.expanded
                      ? SizedBox(
                          width: expandedW,
                          child: _buildExpanded(
                            key: const ValueKey('expanded'),
                            statusColor: statusColor,
                          ),
                        )
                      : _buildCompact(
                          key: const ValueKey('compact'),
                          statusColor: statusColor,
                          compactLabel: compactLabel,
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// AnimatedSwitcher 的转场构建器
  ///
  /// 展开内容：从上方 12px 处平移 + 0.96 缩放 + 淡入，营造"从胶囊处拉开面板"的动感。
  /// 紧凑内容：轻微向上淡出（y: 0 → -6），与展开内容的入场方向一致，
  /// 避免反向运动，整体过渡更连贯、不抖动。
  Widget _buildTransition(Widget child, Animation<double> animation) {
    final isExpanded = child.key == const ValueKey('expanded');
    return AnimatedBuilder(
      animation: animation,
      builder: (context, child) {
        final t = animation.value;
        // 展开进入：从 y=-12 滑到 0；紧凑退出：从 0 滑到 y=-6
        final translateY = isExpanded ? -12.0 * (1 - t) : -6.0 * t;
        final scale = isExpanded ? 0.96 + 0.04 * t : 1.0 - 0.02 * t;
        return Opacity(
          opacity: t.clamp(0.0, 1.0),
          child: Transform.translate(
            offset: Offset(0, translateY),
            child: Transform.scale(
              scale: scale,
              alignment: Alignment.topCenter,
              child: child,
            ),
          ),
        );
      },
      child: child,
    );
  }

  /// 根据输入栏状态解析动态岛状态圆点颜色
  Color _resolveStatusColor(InputBarState state) {
    if (state.isWaitingReply) return AppColors.cyan;
    if (state.isFocused) return AppColors.green;
    return AppColors.success;
  }

  /// 根据输入栏状态解析紧凑态标签文本
  String _resolveCompactLabel(InputBarState state) {
    if (state.isWaitingReply) return '思考中';
    if (state.isFocused && state.textLength > 0) return '输入中';
    if (state.hasLongText) return '长文本';
    if (widget.tokenCount > 0) {
      return '${_formatTokens(widget.tokenCount)} tokens';
    }
    return '就绪';
  }

  /// 紧凑态文本样式 — 与 [_measureCompactWidth] 保持完全一致
  static const _compactTextStyle = TextStyle(
    color: AppColors.textPrimary,
    fontSize: 13,
    fontWeight: FontWeight.w500,
    fontFamily: AppTypography.fontFamily,
    fontFamilyFallback: AppTypography.fontFamilyFallback,
    height: 1.0, // 消除额外行高，让文字在胶囊内精确垂直居中
  );

  /// 展开态头部文本样式
  static const _expandedHeaderTextStyle = TextStyle(
    color: AppColors.textPrimary,
    fontSize: 13,
    fontWeight: FontWeight.w600,
    fontFamily: AppTypography.fontFamily,
    fontFamilyFallback: AppTypography.fontFamilyFallback,
    height: 1.0,
  );

  /// 紧凑态：仅显示状态圆点和动态标签
  ///
  /// Row 使用 mainAxisSize.min 自适应内容宽度，文字不截断（宽度由 _measureCompactWidth 保证够用）。
  /// 圆点和文字都用 Center 包裹并强制同一高度，确保视觉中心严格对齐。
  Widget _buildCompact({
    required Key key,
    required Color statusColor,
    required String compactLabel,
  }) {
    return Padding(
      key: key,
      // 水平 padding 必须 >= 胶囊圆角半径，否则圆角会把文字切掉
      padding: const EdgeInsets.symmetric(horizontal: _compactRadius),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(
            height: 13,
            child: Center(
              child: _PulsingStatusDot(
                color: statusColor,
                pulse: _pulse,
                isPulsing: _pulseController.isAnimating,
              ),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            height: 13,
            child: Center(
              child: Text('璃 · $compactLabel', style: _compactTextStyle),
            ),
          ),
        ],
      ),
    );
  }

  /// 展开态：显示 Token 配额与三行子代理进度
  Widget _buildExpanded({required Key key, required Color statusColor}) {
    final tokenText = widget.tokenCount > 0
        ? '${_formatTokens(widget.tokenCount)} / ${_formatTokens(widget.maxTokens)} tokens'
        : '就绪';
    return Padding(
      key: key,
      // 水平 padding 固定 16，留出足够内容区域；圆角 20 不会切到文字
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              _PulsingStatusDot(
                color: statusColor,
                pulse: _pulse,
                isPulsing: _pulseController.isAnimating,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '璃 · $tokenText',
                  style: _expandedHeaderTextStyle,
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                ),
              ),
              const SizedBox(width: 4),
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
            animation: _curve,
          ),
          const SizedBox(height: 10),
          _StatusRow(
            icon: Icons.compress_outlined,
            label: '压缩',
            progress: widget.compactProgress,
            delay: 0.08,
            animation: _curve,
          ),
          const SizedBox(height: 10),
          _StatusRow(
            icon: Icons.nightlight_outlined,
            label: '整固',
            progress: widget.dreamProgress,
            delay: 0.16,
            animation: _curve,
          ),
        ],
      ),
    );
  }
}

/// 状态圆点 — 带发光阴影的圆形指示器，等待回复时呼吸闪烁
class _PulsingStatusDot extends StatelessWidget {
  final Color color;
  final Animation<double> pulse;
  final bool isPulsing;

  // Animation 为运行时对象，无法声明为 const 构造
  // ignore: prefer_const_constructors_in_immutables
  _PulsingStatusDot({
    required this.color,
    required this.pulse,
    required this.isPulsing,
  });

  @override
  Widget build(BuildContext context) {
    final disable = MediaQuery.of(context).disableAnimations;
    // RepaintBoundary 隔离呼吸动画的重绘，避免影响外层尺寸动画
    return RepaintBoundary(
      child: AnimatedBuilder(
        animation: pulse,
        builder: (context, _) {
          final t = disable || !isPulsing ? 0.0 : pulse.value;
          final scale = 1.0 + t * 0.35;
          final glowOpacity = 0.3 + t * 0.4;
          return Transform.scale(
            scale: scale,
            child: Container(
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
                  BoxShadow(
                    color: color.withValues(alpha: glowOpacity),
                    blurRadius: 6 + t * 6,
                    spreadRadius: 1 + t * 2,
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

/// 进度状态行 — 图标、标签、百分比和环形进度条
///
/// 使用 AnimatedBuilder + Opacity 实现淡入，Row 作为 child 只构建一次，
/// 避免每帧重建整行内容（尤其是 _ProgressRing 的 CustomPaint）。
class _StatusRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final double progress;
  final double delay;

  /// 展开动画的曲线动画，用于驱动行的淡入
  final Animation<double> animation;

  const _StatusRow({
    required this.icon,
    required this.label,
    required this.progress,
    required this.delay,
    required this.animation,
  });

  @override
  Widget build(BuildContext context) {
    final pct = (progress * 100).round();
    final pctColor = progress >= 0.95
        ? AppColors.success
        : AppColors.textTertiary;
    // Row 作为 child 只构建一次，AnimatedBuilder 只更新 Opacity 值
    return AnimatedBuilder(
      animation: animation,
      builder: (context, child) {
        // 三行进度按延迟 stagger 淡入，区间放到 0.35~0.85，
        // 既等岛尺寸基本展开到位再出现，又不会全部挤在结尾同时达到 opacity=1。
        final opacity = ((animation.value - 0.35 - delay) / 0.35).clamp(
          0.0,
          1.0,
        );
        return Opacity(opacity: opacity, child: child);
      },
      child: Row(
        children: [
          Icon(icon, color: AppColors.textSecondary, size: 15),
          AppSpacing.hSM,
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: AppTypography.caption,
              ),
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '$pct%',
            style: TextStyle(
              color: pctColor,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
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

    final color = progress >= 0.95 ? AppColors.success : AppColors.green;
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
