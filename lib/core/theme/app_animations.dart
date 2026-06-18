import 'package:flutter/material.dart';
import 'app_colors.dart';
import 'app_haptics.dart';

/// 全局动效主题系统 — 统一管理应用中所有动画的时长、曲线和可复用组件
///
/// 设计原则：
/// - 入场动画：先快后慢（easeOut / easeInOutBack），有"落地感"
/// - 退出动画：稍快，整体比入场短 20–30%
/// - 列表 stagger：间隔 40–60ms，整体呈波浪感
/// - 避免 Curves.linear，除非有特殊需求
/// - 优先使用 ImplicitlyAnimatedWidget / AnimatedBuilder，避免动画中频繁 setState
/// - 统一响应系统 [MediaQueryData.disableAnimations] 设置，减少或禁用动画
class AppAnimations {
  AppAnimations._();

  // ============================================================
  // 时长规范
  // ============================================================

  /// 微交互（50ms）— 图标旋转、开关切换等极短反馈
  static const Duration instant = Duration(milliseconds: 50);

  /// 快速动画（120ms）— 按钮 press/hover 反馈
  static const Duration micro = Duration(milliseconds: 120);

  /// 中快速动画（180ms）— 小组件状态切换、tooltip
  static const Duration quick = Duration(milliseconds: 180);

  /// 标准动画（250ms）— 卡片入场、列表项动画
  static const Duration normal = Duration(milliseconds: 250);

  /// 页面级动画（350ms）— 路由切换、大面板展开
  static const Duration page = Duration(milliseconds: 350);

  /// 慢速动画（500ms）— 复杂面板展开、全屏过渡
  static const Duration slow = Duration(milliseconds: 500);

  // 向后兼容别名
  @Deprecated('Use micro instead')
  static const Duration fast = micro;

  /// 光标闪烁周期（530ms）
  static const Duration cursorBlink = Duration(milliseconds: 530);

  // ============================================================
  // 缓动曲线规范 — 对标 GSAP Power/Back/Elastic 系列
  // ============================================================

  /// 标准缓出 — 对标 GSAP Power2.out，一般入场、移动
  static const Curve easeOut = Curves.easeOut;

  /// 标准缓入 — 对标 GSAP Power2.in，退场、消失
  static const Curve easeIn = Curves.easeIn;

  /// 标准缓入缓出 — 对标 GSAP Power2.inOut，通用过渡
  static const Curve easeInOut = Curves.easeInOut;

  /// 指数缓出 — 对标 GSAP Power3.out，消息入场等需要快速到位的场景
  static const Curve easeOutExpo = Cubic(0.16, 1, 0.3, 1);

  /// 三次贝塞尔缓入缓出 — 对标 GSAP Power3.inOut，页面切换
  static const Curve easeInOutCubic = Cubic(0.65, 0, 0.35, 1);

  /// 微回弹缓出 — 对标 GSAP Back.out，卡片入场、强调性入场
  static const Curve easeOutBack = Cubic(0.34, 1.56, 0.64, 1);

  /// 微回弹缓入缓出 — 对标 GSAP Back.inOut，弹性过渡
  static const Curve easeInOutBack = Cubic(0.68, -0.6, 0.32, 1.6);

  /// 弹性曲线 — 真正的弹簧过冲效果，按钮回弹、弹窗入场等 Q 弹场景
  /// 比 easeOutBack 过冲更大（1.2x vs 1.56x），有明显的"弹弹弹"手感
  static const Curve spring = Cubic(0.175, 0.885, 0.32, 1.275);

  /// 强弹性曲线 — 更夸张的弹簧效果，用于大面板展开、页面级弹性过渡
  static const Curve springHeavy = Cubic(0.1, 1.3, 0.45, 1.05);

  /// 极致 Q 弹曲线 — 过冲约 1.4x，用于按钮回弹、重要反馈
  /// 对标 Framer Motion 的 type: "spring", stiffness: 300, damping: 10
  static const Curve bouncy = Cubic(0.175, 0.885, 0.32, 1.4);

  /// iOS 风格弹簧曲线 — 模拟 UIKit spring(damping: 0.78, stiffness: 120)
  /// 适用于大多数交互反馈，温和但有微妙弹性过冲
  static const Curve springIOS = Cubic(0.22, 0.68, 0.38, 1.12);

  /// 减速缓出 — 对标 GSAP Power4.out，大范围位移后减速
  static const Curve decelerate = Cubic(0, 0.8, 0.2, 1);

  // ============================================================
  // 无障碍：动画减少/禁用感知
  // ============================================================

  /// 当前是否应禁用动画
  static bool disableAnimationsOf(BuildContext context) =>
      MediaQuery.of(context).disableAnimations;

  /// 根据 [MediaQueryData.disableAnimations] 返回实际时长
  /// 开启减少动画时返回 [Duration.zero]，否则返回 [normal]
  static Duration duration(BuildContext context, Duration normal) {
    return disableAnimationsOf(context) ? Duration.zero : normal;
  }

  /// 根据 [MediaQueryData.disableAnimations] 返回实际曲线
  /// 开启减少动画时返回 [Curves.linear]，否则返回 [curve]
  static Curve curve(BuildContext context, Curve curve) {
    return disableAnimationsOf(context) ? Curves.linear : curve;
  }

  // ============================================================
  // Stagger 间隔规范
  // ============================================================

  /// 列表项 stagger 间隔（50ms）
  static const Duration staggerInterval = Duration(milliseconds: 50);

  /// 计算第 index 个列表项的 stagger 延迟
  static Duration staggerDelay(int index) =>
      Duration(milliseconds: 50 * index);

  /// 计算第 index 个列表项的 Interval（用于 AnimationController + Interval）
  /// [totalDurationMs] 为总动画时长（ms），[controllerDurationMs] 为控制器时长（ms）
  static Interval staggerIntervalFor(
    int index, {
    int totalDurationMs = 600,
    int controllerDurationMs = 800,
  }) {
    final delay = 50 * index;
    final begin = delay / controllerDurationMs;
    final end = (delay + totalDurationMs) / controllerDurationMs;
    return Interval(begin.clamp(0.0, 1.0), end.clamp(0.0, 1.0));
  }

  // ============================================================
  // 路由转场构建器
  // ============================================================

  /// 水平滑入 + 淡入转场（从右侧进入）
  /// 用于 /chat、/settings 等同级页面的前进导航
  static Widget slideInFromRight(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (disableAnimationsOf(context)) return child;
    final slideAnim = Tween(
      begin: const Offset(1.0, 0.0),
      end: Offset.zero,
    ).chain(CurveTween(curve: easeOutBack));

    final fadeAnim = Tween(begin: 0.0, end: 1.0).chain(
      CurveTween(curve: easeOutExpo),
    );

    return SlideTransition(
      position: animation.drive(slideAnim),
      child: FadeTransition(
        opacity: animation.drive(fadeAnim),
        child: child,
      ),
    );
  }

  /// 垂直滑入 + 淡入转场（从底部进入）
  /// 用于 /archive、/memory 等辅助页面
  static Widget slideInFromBottom(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (disableAnimationsOf(context)) return child;
    final slideAnim = Tween(
      begin: const Offset(0.0, 0.3),
      end: Offset.zero,
    ).chain(CurveTween(curve: easeOutBack));

    final fadeAnim = Tween(begin: 0.0, end: 1.0).chain(
      CurveTween(curve: easeOutExpo),
    );

    return SlideTransition(
      position: animation.drive(slideAnim),
      child: FadeTransition(
        opacity: animation.drive(fadeAnim),
        child: child,
      ),
    );
  }

  /// 淡入淡出转场（fade through）
  /// 用于同层级页面切换，如 tab 切换
  static Widget fadeThrough(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (disableAnimationsOf(context)) return child;
    return FadeTransition(
      opacity: animation.drive(
        Tween(begin: 0.0, end: 1.0).chain(CurveTween(curve: easeOut)),
      ),
      child: child,
    );
  }

  /// 缩放淡入转场（从 0.92 缩放到 1.0 + 淡入 + 弹性过冲）
  /// 用于对话框、弹窗等
  static Widget scaleFadeIn(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (disableAnimationsOf(context)) return child;
    final scaleAnim = Tween(begin: 0.92, end: 1.0).chain(
      CurveTween(curve: spring),
    );
    final fadeAnim = Tween(begin: 0.0, end: 1.0).chain(
      CurveTween(curve: easeOutExpo),
    );

    return ScaleTransition(
      scale: animation.drive(scaleAnim),
      child: FadeTransition(
        opacity: animation.drive(fadeAnim),
        child: child,
      ),
    );
  }

  // ============================================================
  // 弹窗/对话框/底部面板工具方法
  // ============================================================

  /// 弹性对话框 — 使用 spring 缩放 + 淡入入场，替代原生 showDialog
  ///
  /// 用法：`AppAnimations.showSpringDialog(context: context, builder: (_) => AlertDialog(...))`
  static Future<T?> showSpringDialog<T>({
    required BuildContext context,
    required WidgetBuilder builder,
    bool barrierDismissible = true,
    Color? barrierColor,
    String? barrierLabel,
  }) {
    final disable = disableAnimationsOf(context);
    return showGeneralDialog<T>(
      context: context,
      barrierDismissible: barrierDismissible,
      barrierColor: barrierColor ?? Colors.black54,
      barrierLabel: barrierLabel ?? MaterialLocalizations.of(context).modalBarrierDismissLabel,
      transitionDuration: disable ? Duration.zero : page,
      transitionBuilder: (context, animation, secondaryAnimation, child) {
        if (disable) return child;
        final scaleAnim = Tween(begin: 0.92, end: 1.0).chain(
          CurveTween(curve: spring),
        );
        final fadeAnim = Tween(begin: 0.0, end: 1.0).chain(
          CurveTween(curve: easeOutExpo),
        );
        return ScaleTransition(
          scale: animation.drive(scaleAnim),
          child: FadeTransition(
            opacity: animation.drive(fadeAnim),
            child: child,
          ),
        );
      },
      pageBuilder: (context, animation, secondaryAnimation) {
        return builder(context);
      },
    );
  }

  /// 弹性底部弹窗 — 从底部滑入 + 弹性过冲，替代原生 showModalBottomSheet
  ///
  /// 用法：`AppAnimations.showSpringBottomSheet(context: context, builder: (_) => ...)`
  static Future<T?> showSpringBottomSheet<T>({
    required BuildContext context,
    required WidgetBuilder builder,
    bool isScrollControlled = false,
    Color? backgroundColor,
  }) {
    final disable = disableAnimationsOf(context);
    return showGeneralDialog<T>(
      context: context,
      barrierDismissible: true,
      barrierColor: Colors.black54,
      transitionDuration: disable ? Duration.zero : page,
      transitionBuilder: (context, animation, secondaryAnimation, child) {
        if (disable) return child;
        final slideAnim = Tween(
          begin: const Offset(0.0, 1.0),
          end: Offset.zero,
        ).chain(CurveTween(curve: spring));
        final fadeAnim = Tween(begin: 0.0, end: 1.0).chain(
          CurveTween(curve: easeOutExpo),
        );
        return SlideTransition(
          position: animation.drive(slideAnim),
          child: FadeTransition(
            opacity: animation.drive(fadeAnim),
            child: child,
          ),
        );
      },
      pageBuilder: (context, animation, secondaryAnimation) {
        return Align(
          alignment: Alignment.bottomCenter,
          child: Material(
            color: backgroundColor ?? AppColors.bgElevated,
            borderRadius: const BorderRadius.vertical(
              top: Radius.circular(20),
            ),
            child: builder(context),
          ),
        );
      },
    );
  }

  // ============================================================
  // 可复用动画组件
  // ============================================================

  /// 消息入场动画：用户消息从右滑入，AI 消息从左滑入，带淡入效果
  static Widget messageEntrance({required Widget child, required bool isUser}) {
    return Builder(
      builder: (context) {
        final disable = disableAnimationsOf(context);
        return TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.0, end: 1.0),
          duration: duration(context, normal),
          curve: curve(context, spring),
          builder: (context, value, childWidget) {
            final offset = isUser ? 20.0 : -20.0;
            return Opacity(
              opacity: disable ? 1.0 : value.clamp(0.0, 1.0),
              child: Transform.translate(
                offset: Offset(offset * (1 - value), 0),
                child: childWidget,
              ),
            );
          },
          child: child,
        );
      },
    );
  }

  /// AI 流式响应时的闪烁光标组件
  static Widget blinkingCursor() {
    return const BlinkingCursorWidget();
  }

  /// 按压缩放反馈动画：按下时缩小，松开时弹性回弹
  static Widget scaleTap({
    required Widget child,
    required VoidCallback onTap,
    double scaleDown = 0.93,
  }) {
    return ScaleTapWidget(onTap: onTap, scaleDown: scaleDown, child: child);
  }

  /// 列表项 stagger 入场动画 — 依次淡入 + 上滑
  /// [index] 为列表项索引，[staggerMs] 为间隔毫秒数（默认 50ms）
  static Widget staggerItem({
    required int index,
    required Widget child,
    int staggerMs = 50,
  }) {
    return _StaggerItem(index: index, staggerMs: staggerMs, child: child);
  }

  /// 展开/收起动画容器 — 用于面板展开折叠
  static Widget expandable({
    required bool expanded,
    required Widget child,
    Duration? duration,
    Curve? curve,
  }) {
    return Builder(
      builder: (context) {
        return AnimatedSize(
          duration: duration ?? AppAnimations.page,
          curve: curve ?? easeOutBack,
          alignment: Alignment.topCenter,
          child: expanded ? child : const SizedBox.shrink(),
        );
      },
    );
  }

  /// 淡入动画 — 组件首次构建时淡入
  static Widget fadeIn({
    required Widget child,
    Duration? duration,
    Curve? curve,
  }) {
    return Builder(
      builder: (context) {
        final disable = disableAnimationsOf(context);
        return TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.0, end: 1.0),
          duration: duration ?? normal,
          curve: curve ?? easeOut,
          builder: (context, value, childWidget) {
            return Opacity(opacity: disable ? 1.0 : value, child: childWidget);
          },
          child: child,
        );
      },
    );
  }

  /// 缩放淡入动画 — 组件首次构建时缩放 + 淡入
  static Widget scaleIn({
    required Widget child,
    Duration? duration,
    Curve? curve,
    double from = 0.92,
  }) {
    return Builder(
      builder: (context) {
        final disable = disableAnimationsOf(context);
        return TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.0, end: 1.0),
          duration: duration ?? normal,
          curve: curve ?? easeOutBack,
          builder: (context, value, childWidget) {
            final scale = disable ? 1.0 : from + (1.0 - from) * value;
            return Opacity(
              opacity: disable ? 1.0 : value,
              child: Transform.scale(scale: scale, child: childWidget),
            );
          },
          child: child,
        );
      },
    );
  }
}

// ============================================================
// 内部动画组件实现
// ============================================================

/// 闪烁光标组件 — AI 流式响应时显示的青色竖线光标
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
    final disable = AppAnimations.disableAnimationsOf(context);
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Opacity(
          opacity: disable ? 1.0 : _controller.value,
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

/// 按压缩放组件 — 按下时缩小，松开时弹性回弹
class ScaleTapWidget extends StatefulWidget {
  /// 子组件
  final Widget child;

  /// 点击回调
  final VoidCallback onTap;

  /// 按下时的缩放比例（默认 0.95）
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
      duration: AppAnimations.micro,
      value: 1.0,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onTapDown(_) {
    AppHaptics.selection();
    _controller.animateTo(
      widget.scaleDown,
      curve: AppAnimations.easeIn,
    );
  }
  void _onTapUp(_) =>
      _controller.animateTo(1.0, curve: AppAnimations.springHeavy);
  void _onTapCancel() => _controller.animateTo(1.0);

  @override
  Widget build(BuildContext context) {
    final disable = AppAnimations.disableAnimationsOf(context);
    return GestureDetector(
      onTap: widget.onTap,
      onTapDown: disable ? null : _onTapDown,
      onTapUp: disable ? null : _onTapUp,
      onTapCancel: disable ? null : _onTapCancel,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          return Transform.scale(scale: disable ? 1.0 : _controller.value, child: child);
        },
        child: widget.child,
      ),
    );
  }
}

/// 列表项 stagger 入场动画组件 — 依次淡入 + 上滑
class _StaggerItem extends StatefulWidget {
  final int index;
  final int staggerMs;
  final Widget child;

  const _StaggerItem({
    required this.index,
    required this.staggerMs,
    required this.child,
  });

  @override
  State<_StaggerItem> createState() => _StaggerItemState();
}

class _StaggerItemState extends State<_StaggerItem>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _fadeAnim;
  late Animation<double> _slideAnim;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: AppAnimations.normal,
    );

    // 根据 index 计算延迟，限制最大延迟避免尾部等待过久
    final maxDelay = (widget.staggerMs * 8).clamp(0, 400);
    final delay = (widget.staggerMs * widget.index).clamp(0, maxDelay);

    _fadeAnim = Tween(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: Interval(
          (delay / (delay + 250)).clamp(0.0, 0.8),
          1.0,
          curve: AppAnimations.spring,
        ),
      ),
    );

    _slideAnim = Tween(begin: 18.0, end: 0.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: Interval(
          (delay / (delay + 250)).clamp(0.0, 0.8),
          1.0,
          curve: AppAnimations.spring,
        ),
      ),
    );

    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final disable = AppAnimations.disableAnimationsOf(context);
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Opacity(
          // spring 等弹性曲线会过冲，clamp 到 [0,1] 避免断言失败
          opacity: disable ? 1.0 : _fadeAnim.value.clamp(0.0, 1.0),
          child: Transform.translate(
            offset: Offset(0, disable ? 0 : _slideAnim.value),
            child: child,
          ),
        );
      },
      child: widget.child,
    );
  }
}
