/// RIKO 应用入口模块
///
/// 负责 Flutter 引擎初始化、桌面窗口配置、后端进程启动。
///
/// 启动流程：
/// 1. 初始化 Flutter 引擎绑定
/// 2. 修补 flutter_markdown 0.7.7 已知 bug（空 inline 断言错误）
/// 3. 桌面平台：配置无框透明窗口（1280×720，最小 320×240）
/// 4. 启动后端进程（桌面由外部启动，移动端通过 proot 启动），
///    失败时仅记录日志，不阻断 runApp（移动端 App 内部有就绪探测 UI 兜底）
/// 5. 统一使用单一 runApp，移动端在 App 内部等待后端就绪
///
/// 后端就绪探测（仅移动端，在 App 内部执行）：
/// - Android 模拟器：尝试 10.0.2.2:3000（宿主机映射）和 127.0.0.1:3000（proot）
/// - iOS/真机：仅尝试 127.0.0.1:3000
/// - 每个地址最多重试 5 次，间隔递增（400ms → 800ms → 1.6s → 3.2s）
/// - 探测成功后将后端地址写入 SharedPreferences，供 ApiClient 读取
library;

import 'dart:ui' show PlatformDispatcher;
import 'package:flutter/foundation.dart' show debugPrint, defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:window_manager/window_manager.dart';

import 'app.dart';
import 'platform/backend_runner.dart';

/// 判断是否为 flutter_markdown 0.7.7 已知 _inlines.isEmpty 断言 bug
///
/// 通过检查异常字符串和 stack trace 来源，确认来自 flutter_markdown 包内部
/// 才返回 true，避免吞掉其他真实的 _inlines.isEmpty 错误。
bool _isMarkdownInlineBug(FlutterErrorDetails details) {
  final message = details.exceptionAsString();
  if (!message.contains('_inlines.isEmpty')) return false;
  // stack 中需包含 flutter_markdown 包路径，确保异常来源正确
  final stack = details.stack?.toString() ?? '';
  return stack.contains('flutter_markdown') || stack.contains('markdown.dart');
}

/// RIKO 应用入口
///
/// 初始化 Flutter 引擎、桌面窗口（设置无框+透明背景），
/// 统一使用单一 runApp，移动端在 App 内部等待后端就绪后再显示主界面。
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // flutter_markdown 0.7.7 已知 bug：段落拆分后空 inline 触发断言
  // 仅在异常确实来自 flutter_markdown 包内部时才吞掉，避免掩盖其他真实问题
  final originalOnError = FlutterError.onError;
  FlutterError.onError = (FlutterErrorDetails details) {
    if (_isMarkdownInlineBug(details)) return;
    originalOnError?.call(details);
  };
  ErrorWidget.builder = (FlutterErrorDetails details) {
    if (_isMarkdownInlineBug(details)) {
      return const SizedBox.shrink();
    }
    return ErrorWidget(details.exception);
  };

  // 捕获未处理的平台级错误（dart:async Zone 之外的异常）
  PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
    debugPrint('Uncaught platform error: $error\n$stack');
    return true;
  };

  // 桌面平台：配置无框透明窗口（自定义标题栏由 AppShell 提供）
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

  // 启动后端进程：
  // - 桌面平台：直接返回 true（后端由外部脚本启动）
  // - 移动平台：通过 MethodChannel 调用原生层，可能因 proot 损坏/Node.js 缺失等失败
  //
  // 失败处理：仅记录日志，不阻断 runApp。移动端 App 内部有后端就绪探测 UI，
  // 启动失败时用户会看到"等待后端就绪"超时提示，可重新触发引导。
  try {
    final ok = await BackendRunner.start();
    if (!ok) {
      debugPrint('警告：后端启动失败，应用将在等待后端就绪时超时');
    }
  } catch (e) {
    // 兜底：即使 BackendRunner.start 内部已捕获，也防止未预期异常阻断 runApp
    debugPrint('后端启动异常（已被吞掉，应用继续启动）: $e');
  }

  // 统一使用单一 runApp，移动端在 App 内部等待后端就绪
  runApp(const ProviderScope(child: App()));
}
