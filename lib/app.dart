/// RIKO 应用根组件模块
///
/// 定义应用的顶层 Widget，配置路由、主题和全局 UI 覆盖层。
/// 使用 MaterialApp.router + GoRouter 管理路由，仅提供暗色主题（无亮色模式）。
///
/// 全局配置：
/// - 路由：由 [routerProvider]（GoRouter）管理，支持 /settings, /archive, /memory, /admin
/// - 主题：暗色主题，基色 #111111，强调色 #3eb573，字体 MiSans
/// - Toast 覆盖层：通过 [ToastOverlay] 包裹整个应用，支持全局消息提示
/// - 默认文本样式：去除装饰线（适配自定义标题栏场景）
/// - 移动端后端等待：在 App 内部等待后端就绪后再显示主界面，避免双 Widget 树
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart' show debugPrint, defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/theme/app_theme.dart';

import 'ui/router.dart';
import 'ui/widgets/toast_overlay.dart';

/// RIKO 应用根组件
///
/// 使用 MaterialApp.router + GoRouter 管理路由，使用暗色主题（无亮色模式）。
/// 移动端在内部等待后端就绪后再显示主界面，桌面端直接显示。
class App extends ConsumerStatefulWidget {
  const App({super.key});

  @override
  ConsumerState<App> createState() => _AppState();
}

class _AppState extends ConsumerState<App> {
  /// 后端是否就绪（移动端需要等待，桌面端默认就绪）
  bool _backendReady = false;

  @override
  void initState() {
    super.initState();
    _initBackend();
  }

  /// 初始化后端连接：移动端等待后端就绪，桌面端直接标记就绪
  Future<void> _initBackend() async {
    if (defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS) {
      await _waitForBackend(Platform.isAndroid);
    }
    if (mounted) {
      setState(() => _backendReady = true);
    }
  }

  /// 等待后端服务就绪
  ///
  /// 通过 TCP Socket 探测后端端口是否可连接。
  /// [isAndroid] 为 true 时，额外尝试模拟器的 10.0.2.2 地址。
  Future<bool> _waitForBackend(bool isAndroid) async {
    final hosts = isAndroid ? ['10.0.2.2', '127.0.0.1'] : ['127.0.0.1'];
    for (final host in hosts) {
      for (var i = 0; i < 5; i++) {
        try {
          final sock = await Socket.connect(
            host,
            3000,
            timeout: const Duration(milliseconds: 800),
          );
          sock.destroy();
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('backend_url', 'http://$host:3000');
          await prefs.remove('backend_unreachable');
          return true;
        } catch (_) {}
        if (i < 4) {
          await Future<void>.delayed(Duration(milliseconds: 400 << i));
        }
      }
    }
    debugPrint('[App] 后端不可达：所有探测均超时');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('backend_unreachable', true);
    return false;
  }

  @override
  Widget build(BuildContext context) {
    // 移动端未就绪时显示 Splash
    if (!_backendReady &&
        (defaultTargetPlatform == TargetPlatform.android ||
            defaultTargetPlatform == TargetPlatform.iOS)) {
      return MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData.dark(),
        home: const _SplashPage(),
      );
    }
    // 主应用界面
    return MaterialApp.router(
      title: 'RIKO',
      debugShowCheckedModeBanner: false,
      darkTheme: AppTheme.buildDarkTheme(),
      themeMode: ThemeMode.dark,
      routerConfig: ref.watch(routerProvider),
      // builder 用于在路由页面外层添加全局覆盖组件
      builder: (context, child) => ToastOverlay(
        child: DefaultTextStyle(
          // 去除默认文本装饰线，避免在自定义无框窗口中出现下划线
          style: const TextStyle(decoration: TextDecoration.none),
          child: child!,
        ),
      ),
    );
  }
}

/// Splash 动画页面：移动端启动时显示 "AI Chat..." 加点号动画
class _SplashPage extends StatefulWidget {
  const _SplashPage();

  @override
  State<_SplashPage> createState() => _SplashPageState();
}

/// Splash 页面状态：控制 "..." 点号动画
class _SplashPageState extends State<_SplashPage> {
  int _dots = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 600), (t) {
      if (mounted) setState(() => _dots = (_dots + 1) % 4);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF121212),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.chat_bubble_outline,
              color: Color(0xFF3eb573),
              size: 48,
            ),
            const SizedBox(height: 24),
            Text(
              'AI Chat${List.filled(_dots, '.').join()}',
              style: const TextStyle(color: Color(0xFF8E8E93), fontSize: 18),
            ),
            const SizedBox(height: 12),
            const Text(
              '正在启动后端服务',
              style: TextStyle(color: Color(0xFF5C5C5C), fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}
