import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';
import 'package:flutter/services.dart';

/// RIKO 物理弹簧系统 — 真正的 SpringSimulation，替代 Cubic 模拟曲线
///
/// 设计原理：Cubic 贝塞尔曲线无法产生真实的"过冲-回弹"物理手感，
/// 而 SpringSimulation 基于胡克定律 + 阻尼，能产生自然的 Q 弹回弹。
///
/// 推荐参数（对标任务要求 SpringDescription.withDampingRatio）：
/// - bouncy：mass 1, stiffness 300, ratio 0.6 — 明显 Q 弹过冲
/// - snappy：mass 1, stiffness 400, ratio 0.8 — 快速回弹，过冲较小
/// - gentle：mass 1, stiffness 200, ratio 0.7 — 温和弹性
///
/// 用法：
/// 1. 物理驱动动画：[SpringPhysicsController] / [springTo]
/// 2. 转 Curve 用于 ImplicitlyAnimatedWidget：[SpringCurve]
/// 3. 按压回弹：[SpringScaleTap]
class AppSprings {
  AppSprings._();

  // ===== 弹簧预设（SpringDescription.withDampingRatio）=====

  /// Q 弹 — 明显过冲，用于按钮回弹、消息入场、重要反馈
  /// mass:1, stiffness:300, damping ratio:0.6
  static final SpringDescription bouncy = SpringDescription.withDampingRatio(
    mass: 1,
    stiffness: 300,
    ratio: 0.6,
  );

  /// 快速回弹 — 过冲较小，用于频繁交互（列表项、开关）
  /// mass:1, stiffness:400, ratio:0.8
  static final SpringDescription snappy = SpringDescription.withDampingRatio(
    mass: 1,
    stiffness: 400,
    ratio: 0.8,
  );

  /// 温和弹性 — 用于大面板展开、页面级过渡
  /// mass:1, stiffness:200, ratio:0.7
  static final SpringDescription gentle = SpringDescription.withDampingRatio(
    mass: 1,
    stiffness: 200,
    ratio: 0.7,
  );

  /// 强 Q 弹 — 夸张过冲，用于强调性入场（弹窗、成功反馈）
  /// mass:1, stiffness:260, ratio:0.55
  static final SpringDescription bouncyHeavy = SpringDescription.withDampingRatio(
    mass: 1,
    stiffness: 260,
    ratio: 0.55,
  );

  // ===== 预采样 Curve =====
  // SpringSimulation 无法直接作为 Curve（Curve 要求 0..1 单调映射，而弹簧会过冲），
  // 这里通过预采样把弹簧位移曲线封装为可过冲的 Curve，供 Tween/AnimatedWidget 使用。

  /// Q 弹曲线（可过冲）— 用于 ScaleEffect / ScaleTransition
  static Curve get bouncyCurve => _SpringCurve(bouncy);

  /// 温和弹性曲线（可过冲）— 用于位移、淡入
  static Curve get gentleCurve => _SpringCurve(gentle);

  /// 强 Q 弹曲线（可过冲）— 用于强调入场
  static Curve get bouncyHeavyCurve => _SpringCurve(bouncyHeavy);
}

/// 把 SpringSimulation 预采样为可过冲的 Curve
///
/// 原理：以 from=0 → to=1 跑一次弹簧仿真，按时间采样 0..1 的位移值。
/// 由于弹簧会过冲，采样值可能 >1 或 <0，这正是 Q 弹手感的来源。
class _SpringCurve extends Curve {
  final SpringDescription description;
  late final List<double> _samples;
  static const int _sampleCount = 120; // 60fps × 2s 足够覆盖大多数弹簧

  _SpringCurve(this.description) {
    final sim = SpringSimulation(description, 0, 1, 0);
    _samples = List.generate(_sampleCount, (i) {
      final t = (i / (_sampleCount - 1)) * 1.2; // 采样到 1.2s 覆盖完整回弹
      return sim.x(t);
    });
  }

  @override
  double transformInternal(double t) {
    if (t <= 0) return 0;
    if (t >= 1) return _samples.last;
    final idx = (t * (_sampleCount - 1)).floor();
    return _samples[idx];
  }
}

/// 弹簧驱动的缩放按压组件 — 按下缩小，松开真弹簧回弹（明显 Q 弹过冲）
///
/// 相比 AppAnimations.ScaleTapWidget（使用 Cubic 曲线），本组件使用
/// SpringSimulation 驱动，松开时会有真实的过冲回弹，手感更"Q"。
class SpringScaleTap extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// 按下时的缩放比例（默认 0.90，比 0.93 更明显）
  final double scaleDown;

  /// 使用的弹簧预设（null 时使用 bouncy）
  final SpringDescription? spring;

  const SpringScaleTap({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.scaleDown = 0.90,
    this.spring,
  });

  @override
  State<SpringScaleTap> createState() => _SpringScaleTapState();
}

class _SpringScaleTapState extends State<SpringScaleTap>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  // 用 1.0 作为动画值域上界，实际缩放通过弹簧仿真驱动
  double _scale = 1.0;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController.unbounded(vsync: this);
    _controller.addListener(() {
      setState(() => _scale = _controller.value);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _springTo(double target) {
    final desc = widget.spring ?? AppSprings.bouncy;
    final sim = SpringSimulation(
      desc,
      _scale,
      target,
      _controller.velocity,
    );
    _controller.animateWith(sim);
  }

  @override
  Widget build(BuildContext context) {
    final disable = MediaQuery.disableAnimationsOf(context);
    return GestureDetector(
      onTap: widget.onTap,
      onLongPress: widget.onLongPress,
      onTapDown: disable
          ? null
          : (_) {
              HapticFeedbackUtility.selection();
              _springTo(widget.scaleDown);
            },
      onTapUp: disable ? null : (_) => _springTo(1.0),
      onTapCancel: disable ? null : () => _springTo(1.0),
      child: Transform.scale(
        scale: disable ? 1.0 : _scale,
        child: widget.child,
      ),
    );
  }
}

/// 触觉反馈工具（避免与 app_haptics 循环依赖，内联最小实现）
class HapticFeedbackUtility {
  HapticFeedbackUtility._();
  static void selection() => HapticFeedback.selectionClick();
}

/// 弹簧驱动的入场动画 — 缩放 + 淡入 + 位移，真物理过冲
///
/// 用于消息气泡、卡片、弹窗等首次构建时的入场。
/// 相比 TweenAnimationBuilder + Cubic，弹簧过冲让入场更有"生命力"。
class SpringEntrance extends StatefulWidget {
  final Widget child;

  /// 起始缩放（默认 0.85，过冲到 1.0）
  final double fromScale;

  /// 起始位移（默认从下方 24px 滑入）
  final Offset fromOffset;

  /// 弹簧预设（null 时使用 bouncy）
  final SpringDescription? spring;

  /// 延迟（毫秒），用于 stagger 交错
  final int delayMs;

  const SpringEntrance({
    super.key,
    required this.child,
    this.fromScale = 0.85,
    this.fromOffset = const Offset(0, 24),
    this.spring,
    this.delayMs = 0,
  });

  @override
  State<SpringEntrance> createState() => _SpringEntranceState();
}

class _SpringEntranceState extends State<SpringEntrance>
    with TickerProviderStateMixin {
  late final AnimationController _scaleController;
  late final AnimationController _offsetController;
  late final AnimationController _fadeController;
  double _scale = 0;
  double _fade = 0;
  Offset _offset = Offset.zero;
  bool _started = false;

  @override
  void initState() {
    super.initState();
    _scale = widget.fromScale;
    _fade = 0;
    _offset = widget.fromOffset;
    _scaleController = AnimationController.unbounded(vsync: this);
    _offsetController = AnimationController.unbounded(vsync: this);
    _fadeController = AnimationController.unbounded(vsync: this);
    _scaleController.addListener(() => _scale = _scaleController.value);
    _offsetController.addListener(() => _offset = Offset(
          widget.fromOffset.dx * _offsetController.value,
          widget.fromOffset.dy * _offsetController.value,
        ));
    _fadeController.addListener(() => _fade = _fadeController.value);

    if (widget.delayMs == 0) {
      _run();
    } else {
      Future.delayed(Duration(milliseconds: widget.delayMs), () {
        if (mounted) _run();
      });
    }
  }

  void _run() {
    if (_started) return;
    _started = true;
    final desc = widget.spring ?? AppSprings.bouncy;
    // 缩放与位移用弹簧（过冲），淡入用快速线性避免闪烁
    _scaleController.animateWith(
      SpringSimulation(desc, widget.fromScale, 1.0, 0),
    );
    _offsetController.animateWith(
      SpringSimulation(desc, 1.0, 0.0, 0),
    );
    _fadeController.animateTo(1.0, duration: const Duration(milliseconds: 200));
  }

  @override
  void dispose() {
    _scaleController.dispose();
    _offsetController.dispose();
    _fadeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final disable = MediaQuery.disableAnimationsOf(context);
    if (disable) return widget.child;
    return Opacity(
      opacity: _fade.clamp(0.0, 1.0),
      child: Transform.translate(
        offset: _offset,
        child: Transform.scale(scale: _scale, child: widget.child),
      ),
    );
  }
}

/// 弹簧转场构建器 — 页面/弹窗缩放 + 弹性过冲转场
///
/// 用于 PageRouteBuilder.transitionsBuilder，产生比 Cubic 更 Q 弹的转场。
class SpringPageTransitions {
  SpringPageTransitions._();

  /// 缩放淡入转场（弹簧过冲）— 用于弹窗、对话框
  static Widget scaleFadeIn(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    // 用弹簧曲线驱动缩放（可过冲），淡入用快速 ease
    final scaleTween = Tween(begin: 0.88, end: 1.0)
        .chain(CurveTween(curve: AppSprings.bouncyCurve));
    final fadeTween = Tween(begin: 0.0, end: 1.0)
        .chain(CurveTween(curve: Curves.easeOut));
    return FadeTransition(
      opacity: animation.drive(fadeTween),
      child: ScaleTransition(
        scale: animation.drive(scaleTween),
        child: child,
      ),
    );
  }

  /// 滑入 + 弹性过冲转场 — 用于页面导航
  static Widget slideInFromRight(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final slideTween = Tween(
      begin: const Offset(1.0, 0.0),
      end: Offset.zero,
    ).chain(CurveTween(curve: AppSprings.bouncyCurve));
    final fadeTween = Tween(begin: 0.0, end: 1.0)
        .chain(CurveTween(curve: Curves.easeOut));
    return SlideTransition(
      position: animation.drive(slideTween),
      child: FadeTransition(
        opacity: animation.drive(fadeTween),
        child: child,
      ),
    );
  }

  /// 从底部滑入 + 弹性过冲 — 用于辅助页面、底部弹窗
  static Widget slideInFromBottom(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final slideTween = Tween(
      begin: const Offset(0.0, 0.35),
      end: Offset.zero,
    ).chain(CurveTween(curve: AppSprings.bouncyCurve));
    final fadeTween = Tween(begin: 0.0, end: 1.0)
        .chain(CurveTween(curve: Curves.easeOut));
    return SlideTransition(
      position: animation.drive(slideTween),
      child: FadeTransition(
        opacity: animation.drive(fadeTween),
        child: child,
      ),
    );
  }
}
