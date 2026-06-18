/// 应用启动页 — 媒体化品牌首屏与初始化
///
/// 底层使用原生 CustomPainter 绘制流动的极光渐变，品牌 Logo 与文字居中叠加。
/// 动画在首帧后启动，避免与系统启动闪屏冲突；开启减少动画时显示静态最终帧。
/// 初始化完成后整体淡出并自动跳转到主页面。
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lottie/lottie.dart';

import '../core/di/providers.dart';
import '../core/di/settings_cache.dart';
import '../core/theme/app_animations.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_spacing.dart';
import '../core/theme/app_typography.dart';

/// 应用启动页 — 媒体化品牌首屏、初始化完成后自动跳转主页面
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen>
    with TickerProviderStateMixin {
  late final AnimationController _logoController;
  late final AnimationController _textController;
  late final AnimationController _fadeOutController;
  late final AnimationController _auroraController;

  late final Animation<double> _logoScale;
  late final Animation<double> _logoOpacity;
  late final Animation<double> _textSlide;
  late final Animation<double> _textOpacity;
  late final Animation<double> _fadeOut;

  String _statusText = '正在初始化...';
  bool _isReady = false;
  bool _mediaAnimationStarted = false;

  @override
  void initState() {
    super.initState();
    _initAnimations();
    // 首帧后开始动画，避免与系统启动闪屏冲突
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      setState(() => _mediaAnimationStarted = true);
      _startAnimations();
      _startInitialization();
    });
  }

  /// 初始化所有动画控制器
  void _initAnimations() {
    _logoController = AnimationController(
      vsync: this,
      duration: AppAnimations.slow,
    );

    _textController = AnimationController(
      vsync: this,
      duration: AppAnimations.page,
    );

    _fadeOutController = AnimationController(
      vsync: this,
      duration: AppAnimations.page,
    );

    _auroraController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 8),
    );

    _logoScale = Tween<double>(begin: 0.75, end: 1.0).animate(
      CurvedAnimation(parent: _logoController, curve: AppAnimations.spring),
    );

    _logoOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _logoController,
        curve: const Interval(0.0, 0.5, curve: AppAnimations.easeOutExpo),
      ),
    );

    _textSlide = Tween<double>(begin: 16.0, end: 0.0).animate(
      CurvedAnimation(parent: _textController, curve: AppAnimations.springIOS),
    );

    _textOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _textController,
        curve: const Interval(0.0, 0.7, curve: AppAnimations.easeOut),
      ),
    );

    _fadeOut = Tween<double>(begin: 1.0, end: 0.0).animate(
      CurvedAnimation(parent: _fadeOutController, curve: Curves.easeInCubic),
    );
  }

  /// 启动动画，若系统减少动画则直接跳至终态
  void _startAnimations() {
    final disable = MediaQuery.of(context).disableAnimations;
    if (disable) {
      _logoController.value = 1.0;
      _textController.value = 1.0;
      _auroraController.value = 1.0;
      return;
    }
    _auroraController.repeat();
    _logoController.forward();
    _logoController.addListener(() {
      if (_logoController.value >= 0.4 &&
          !_textController.isAnimating &&
          _textController.value == 0.0) {
        _textController.forward();
      }
    });
  }

  /// 构建 Lottie 媒体化背景动画，首帧后启动，循环播放
  Widget _buildMediaAnimation() {
    return Center(
      child: SizedBox(
        width: 320,
        height: 320,
        child: Lottie.asset(
          'assets/animations/splash_brand.json',
          animate: _mediaAnimationStarted,
          repeat: true,
          fit: BoxFit.contain,
          // Lottie 文件仅 ~3KB，远低于 500KB 限制；低端设备使用静态渐变兜底
        ),
      ),
    );
  }

  /// 并行执行初始化任务（延迟、后端健康检查、设置缓存），完成后触发淡出跳转
  Future<void> _startInitialization() async {
    final results = await Future.wait([
      Future<void>.delayed(const Duration(milliseconds: 200)),
      _checkBackendHealth(),
      _initSettingsCache(),
    ]);

    final isHealthy = results[1] as bool;

    if (mounted) {
      setState(() {
        _statusText = isHealthy ? '准备就绪' : '后端未连接，部分功能受限';
        _isReady = true;
      });
      final disable = MediaQuery.of(context).disableAnimations;
      if (disable) {
        if (mounted) context.go('/');
        return;
      }
      _fadeOutController.forward().then((_) {
        if (mounted) {
          context.go('/');
        }
      });
    }
  }

  Future<bool> _checkBackendHealth() async {
    try {
      final apiClient = ref.read(apiClientProvider);
      return await apiClient.healthCheckFast();
    } catch (_) {
      return false;
    }
  }

  Future<void> _initSettingsCache() async {
    try {
      await ref.read(settingsCacheInitProvider.future);
    } catch (e) {
      debugPrint('[SplashScreen] settings cache init failed: $e');
    }
  }

  @override
  void dispose() {
    _logoController.dispose();
    _textController.dispose();
    _fadeOutController.dispose();
    _auroraController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final disable = MediaQuery.of(context).disableAnimations;
    return Scaffold(
      body: AnimatedBuilder(
        animation: _fadeOut,
        builder: (context, child) {
          return Opacity(
            opacity: _fadeOut.value,
            child: Container(
              color: AppColors.bgPrimary,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  // 底层：流动的极光渐变
                  _AuroraBackground(
                    animation: _auroraController,
                    static: disable,
                  ),
                  // 底层媒体化矢量动画（Lottie），在减少动画模式下不播放
                  if (!disable) _buildMediaAnimation(),
                  // 居中品牌内容
                  Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        AnimatedBuilder(
                          animation: _logoController,
                          builder: (context, child) {
                            return Transform.scale(
                              scale: _logoScale.value,
                              child: Opacity(
                                opacity: _logoOpacity.value,
                                child: const _LogoWidget(),
                              ),
                            );
                          },
                        ),
                        AppSpacing.vXL,
                        AnimatedBuilder(
                          animation: _textController,
                          builder: (context, child) {
                            return Transform.translate(
                              offset: Offset(0, _textSlide.value),
                              child: Opacity(
                                opacity: _textOpacity.value,
                                child: Column(
                                  children: [
                                    const Text(
                                      'RIKO',
                                      style: TextStyle(
                                        color: AppColors.textPrimary,
                                        fontSize: AppTypography.display,
                                        fontWeight: FontWeight.w600,
                                        letterSpacing: 3,
                                      ),
                                    ),
                                    AppSpacing.vSM,
                                    const Text(
                                      '智能对话伙伴',
                                      style: TextStyle(
                                        color: AppColors.textTertiary,
                                        fontSize: AppTypography.body,
                                        letterSpacing: 1,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                        AppSpacing.vXXL,
                        if (!_isReady) ...[
                          const SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor: AlwaysStoppedAnimation<Color>(
                                AppColors.green,
                              ),
                            ),
                          ),
                          AppSpacing.vMD,
                          AnimatedSwitcher(
                            duration: AppAnimations.duration(
                              context,
                              AppAnimations.normal,
                            ),
                            child: Text(
                              _statusText,
                              key: ValueKey<String>(_statusText),
                              style: const TextStyle(
                                color: AppColors.textDisabled,
                                fontSize: 13,
                                letterSpacing: 0.5,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
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

/// 极光流动背景 — 使用 CustomPainter 绘制多层径向渐变
///
/// 通过 [animation] 驱动渐变中心位置与透明度变化，形成缓慢的呼吸流动感。
/// [static] 为 true 时直接绘制最终静态帧，供减少动画模式使用。
class _AuroraBackground extends StatelessWidget {
  final Animation<double> animation;
  final bool static;

  const _AuroraBackground({required this.animation, required this.static});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: animation,
      builder: (context, child) {
        return CustomPaint(
          painter: _AuroraPainter(
            progress: static ? 1.0 : animation.value,
          ),
          size: Size.infinite,
        );
      },
    );
  }
}

/// 极光绘制器 — 三层径向渐变叠加
class _AuroraPainter extends CustomPainter {
  final double progress;

  _AuroraPainter({required this.progress});

  @override
  void paint(Canvas canvas, Size size) {
    // 深色底
    canvas.drawRect(
      Offset.zero & size,
      Paint()..color = AppColors.bgPrimary,
    );

    final width = size.width;
    final height = size.height;

    // 绿色光晕：沿左上 → 右下缓慢移动
    final greenCenter = Offset(
      width * (0.25 + 0.15 * math.sin(progress * 2 * math.pi)),
      height * (0.35 + 0.1 * math.cos(progress * 2 * math.pi)),
    );
    _drawGlow(
      canvas,
      size,
      center: greenCenter,
      radius: math.max(width, height) * 0.7,
      color: AppColors.green.withValues(alpha: 0.22),
    );

    // 青色光晕：沿右上 → 左下反向移动，带相位差
    final cyanCenter = Offset(
      width * (0.75 + 0.12 * math.sin(progress * 2 * math.pi + 2.0)),
      height * (0.45 + 0.12 * math.cos(progress * 2 * math.pi + 2.0)),
    );
    _drawGlow(
      canvas,
      size,
      center: cyanCenter,
      radius: math.max(width, height) * 0.65,
      color: AppColors.cyan.withValues(alpha: 0.16),
    );

    // 底部环境光：固定微绿底色
    final bottomGradient = ui.Gradient.linear(
      Offset(0, height * 0.6),
      Offset(0, height),
      [
        AppColors.green.withValues(alpha: 0.0),
        AppColors.green.withValues(alpha: 0.08),
      ],
    );
    canvas.drawRect(
      Offset.zero & size,
      Paint()..shader = bottomGradient,
    );
  }

  void _drawGlow(
    Canvas canvas,
    Size size, {
    required Offset center,
    required double radius,
    required Color color,
  }) {
    final gradient = ui.Gradient.radial(
      center,
      radius,
      [
        color,
        color.withValues(alpha: 0.0),
      ],
      [0.0, 1.0],
      TileMode.clamp,
    );
    canvas.drawRect(
      Offset.zero & size,
      Paint()
        ..shader = gradient
        ..blendMode = BlendMode.screen,
    );
  }

  @override
  bool shouldRepaint(covariant _AuroraPainter oldDelegate) =>
      oldDelegate.progress != progress;
}

/// Logo 绘制组件 — 圆形边框内绘制聊天气泡图标（CustomPaint）
class _LogoWidget extends StatelessWidget {
  const _LogoWidget();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 80,
      height: 80,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.green.withAlpha(77), width: 1.5),
      ),
      child: RepaintBoundary(
        child: CustomPaint(painter: _LogoPainter(), size: const Size(80, 80)),
      ),
    );
  }
}

/// Logo 画笔 — 绘制发光底圆 + 圆角聊天气泡轮廓 + 内部两条横线
class _LogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final centerX = size.width / 2;
    final centerY = size.height / 2;

    final glowPaint = Paint()
      ..color = AppColors.greenGlow
      ..style = PaintingStyle.fill;

    canvas.drawCircle(Offset(centerX, centerY), size.width * 0.35, glowPaint);

    final bubblePaint = Paint()
      ..color = AppColors.green
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final bubblePath = Path();
    final r = size.width * 0.22;
    final left = centerX - r;
    final top = centerY - r * 0.9;
    final right = centerX + r;
    final bottom = centerY + r * 0.7;
    final cornerRadius = r * 0.4;

    bubblePath.moveTo(left + cornerRadius, top);
    bubblePath.lineTo(right - cornerRadius, top);
    bubblePath.arcToPoint(
      Offset(right, top + cornerRadius),
      radius: Radius.circular(cornerRadius),
      clockwise: true,
    );
    bubblePath.lineTo(right, bottom - cornerRadius);
    bubblePath.arcToPoint(
      Offset(right - cornerRadius, bottom),
      radius: Radius.circular(cornerRadius),
      clockwise: true,
    );
    bubblePath.lineTo(centerX + r * 0.3, bottom);
    bubblePath.lineTo(centerX, bottom + r * 0.4);
    bubblePath.lineTo(centerX - r * 0.3, bottom);
    bubblePath.lineTo(left + cornerRadius, bottom);
    bubblePath.arcToPoint(
      Offset(left, bottom - cornerRadius),
      radius: Radius.circular(cornerRadius),
      clockwise: true,
    );
    bubblePath.lineTo(left, top + cornerRadius);
    bubblePath.arcToPoint(
      Offset(left + cornerRadius, top),
      radius: Radius.circular(cornerRadius),
      clockwise: true,
    );

    canvas.drawPath(bubblePath, bubblePaint);

    final linePaint = Paint()
      ..color = AppColors.green.withAlpha(128)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..strokeCap = StrokeCap.round;

    final lineY1 = centerY - r * 0.15;
    final lineY2 = centerY + r * 0.15;
    final lineLeft = centerX - r * 0.5;
    final lineRight1 = centerX + r * 0.4;
    final lineRight2 = centerX + r * 0.25;

    canvas.drawLine(
      Offset(lineLeft, lineY1),
      Offset(lineRight1, lineY1),
      linePaint,
    );
    canvas.drawLine(
      Offset(lineLeft, lineY2),
      Offset(lineRight2, lineY2),
      linePaint,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
