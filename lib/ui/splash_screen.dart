/// 应用启动页 — 品牌动画与初始化
///
/// 显示 Logo 缩放淡入 + 标语上滑动画，同时并行执行后端健康检查和设置缓存初始化。
/// 初始化完成后整体淡出并自动跳转到主页面。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/di/providers.dart';
import '../core/di/settings_cache.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_spacing.dart';
import '../core/theme/app_typography.dart';
import '../core/theme/app_animations.dart';

/// 应用启动页 — 显示品牌动画（Logo 缩放淡入 + 标语上滑）、加载状态，初始化完成后自动跳转主页面
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

  late final Animation<double> _logoScale;
  late final Animation<double> _logoOpacity;
  late final Animation<double> _textSlide;
  late final Animation<double> _textOpacity;
  late final Animation<double> _fadeOut;

  String _statusText = '正在初始化...';
  bool _isReady = false;

  @override
  void initState() {
    super.initState();
    _initAnimations();
    _startInitialization();
  }

  /// 初始化三组动画控制器：Logo 缩放淡入、标语上滑淡入、整体淡出
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

    _logoController.forward();

    // Logo 动画进行到 40% 时文字开始入场，比固定延迟更协调
    _logoController.addListener(() {
      if (_logoController.value >= 0.4 && !_textController.isAnimating && _textController.value == 0.0) {
        _textController.forward();
      }
    });
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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: AnimatedBuilder(
        animation: _fadeOut,
        builder: (context, child) {
          return Opacity(
            opacity: _fadeOut.value,
            child: Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [AppColors.bgSecondary, AppColors.bgPrimary],
                ),
              ),
              child: Center(
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
                                Text(
                                  'RIKO',
                                  style: TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: AppTypography.display,
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: 3,
                                  ),
                                ),
                                AppSpacing.vSM,
                                Text(
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
                        duration: AppAnimations.normal,
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
            ),
          );
        },
      ),
    );
  }
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
