import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart' show defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:window_manager/window_manager.dart';

import 'app.dart';
import 'platform/backend_runner.dart';

/// RIKO 应用入口
///
/// 初始化 Flutter 引擎、桌面窗口（设置无框+透明背景），
/// 在 Android/iOS 上启动后端后先显示 Splash，等待后端就绪再进入主应用。
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // flutter_markdown 0.7.7 已知 bug：段落拆分后空 inline 触发断言
  final originalOnError = FlutterError.onError;
  FlutterError.onError = (FlutterErrorDetails details) {
    if (details.exceptionAsString().contains('_inlines.isEmpty')) return;
    originalOnError?.call(details);
  };
  ErrorWidget.builder = (FlutterErrorDetails details) {
    if (details.exceptionAsString().contains('_inlines.isEmpty')) {
      return const SizedBox.shrink();
    }
    return ErrorWidget(details.exception);
  };

  if (defaultTargetPlatform == TargetPlatform.windows ||
      defaultTargetPlatform == TargetPlatform.macOS ||
      defaultTargetPlatform == TargetPlatform.linux) {
    await windowManager.ensureInitialized();
    await windowManager.setAsFrameless();
    await windowManager.setBackgroundColor(Colors.transparent);
    await windowManager.setResizable(true);
    await windowManager.setMinimumSize(const Size(320, 240));
    await windowManager.setSize(const Size(1280, 720));
    await windowManager.center();
    await windowManager.show();
  }

  // 系统级启动后端进程（桌面端：子进程；移动端：proot / 原生）
  BackendRunner.start();

  // 移动端需要等后端就绪（桌面由包管理工具并行启动）
  if (defaultTargetPlatform == TargetPlatform.android ||
      defaultTargetPlatform == TargetPlatform.iOS) {
    runApp(const _SplashApp());
    await _waitForBackend(Platform.isAndroid);
  }

  runApp(const ProviderScope(child: App()));
}

Future<void> _waitForBackend(bool isAndroid) async {
  // Android 模拟器用 10.0.2.2 连宿主机，真机用 127.0.0.1 连 proot
  final hosts = isAndroid
      ? ['10.0.2.2', '127.0.0.1']
      : ['127.0.0.1'];
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
        return;
      } catch (_) {}
      if (i < 4) {
        await Future<void>.delayed(Duration(milliseconds: 400 << i));
      }
    }
  }
}

/// 移动端启动 Splash，在后端服务准备就绪前显示
class _SplashApp extends StatelessWidget {
  const _SplashApp();

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      home: _SplashPage(),
      debugShowCheckedModeBanner: false,
    );
  }
}

/// Splash 动画页面：启动时显示 "AI Chat..." 加点号动画
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
            const Icon(Icons.chat_bubble_outline, color: Color(0xFF3eb573), size: 48),
            const SizedBox(height: 24),
            Text(
              'AI Chat${List.filled(_dots, '.').join()}',
              style: const TextStyle(
                color: Color(0xFF8E8E93),
                fontSize: 18,
              ),
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
