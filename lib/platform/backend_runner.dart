import 'dart:io';
import 'proot_runner.dart';

/// 后端启动器 — 兼容性封装，统一对外接口，实际委托给 ProotRunner。
///
/// 桌面平台直接返回成功（后端在外部启动），Android 平台调用 MethodChannel 启动 proot 内的 Node.js。
class BackendRunner {
  static bool get isStarted => ProotRunner.isStarted;

  static bool get isMobilePlatform =>
      Platform.isAndroid || Platform.isIOS;

  static Future<bool> start() => ProotRunner.start();
  static Future<void> stop() => ProotRunner.stop();
  static Future<bool> isRunning() => ProotRunner.isRunning();
}
