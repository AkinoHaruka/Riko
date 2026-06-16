/// Proot 子进程管理器模块
///
/// 通过 Flutter MethodChannel 与原生 Kotlin 层通信，管理 Android 上
/// proot 容器中的 Node.js 后端进程。
///
/// ## Android proot 运行机制
///
/// Android 系统不支持直接运行 Node.js，因此采用 proot 方案：
/// 1. **proot** 是一个用户空间实现的 chroot/mock root，无需 root 权限
///    即可在 Android 上创建一个类似 Linux 的文件系统环境
/// 2. 应用内置一个精简的 Ubuntu rootfs，包含 Node.js 运行时和后端代码
/// 3. Kotlin 原生层的 `ProotPlugin` 通过 `ProcessManager` 启动 proot 进程，
///    在其中运行 `node dist/main.js` 启动后端服务
/// 4. 后端监听 127.0.0.1:3000，Flutter 通过 HTTP/WebSocket 访问
/// 5. 首次启动时，`BootstrapManager` 负责下载 rootfs、安装 Node.js、
///    注入 bionic bypass（绕过 Android bionic libc 限制）
///
/// ## MethodChannel 通信协议
///
/// 通道名：`com.example.riko/backend`
/// - `startBackend` → 启动后端进程，返回 bool
/// - `stopBackend` → 停止后端进程
/// - `isBackendRunning` → 查询后端运行状态，返回 bool
/// - `runInProot` → 在 proot 环境中执行命令，返回命令输出字符串
/// - `getBootstrapStatus` → 获取引导状态，返回 Map
///
/// 桌面平台（Windows/macOS/Linux）跳过所有 MethodChannel 调用，
/// 假设后端已在外部启动。
library;

import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// 子进程管理器 — Android 上通过 MethodChannel 启动/停止 proot 中的 Node.js 后端
///
/// 桌面平台直接跳过（假设后端已在外部启动）
class ProotRunner {
  static const _channel = MethodChannel('com.example.riko/backend');

  static bool _started = false;

  /// 同步缓存的后端启动状态，仅反映上次操作后的本地标记。
  /// 优先使用 [isRunning()] 获取实时状态。
  static bool get isStarted => _started;

  static bool get isMobilePlatform => Platform.isAndroid || Platform.isIOS;

  /// 通过 MethodChannel 在 proot 内启动 Node.js 后端（仅 Android）
  ///
  /// 桌面平台直接返回 true（后端由外部启动）。
  /// 若 MethodChannel 不可用（如调试模式未注册插件），返回 false。
  static Future<bool> start() async {
    if (_started) return true;
    if (!isMobilePlatform) {
      _started = true;
      return true;
    }
    try {
      final result = await _channel.invokeMethod<bool>('startBackend');
      _started = result ?? false;
      return _started;
    } on MissingPluginException {
      debugPrint('警告：MethodChannel 不可用，后端启动失败');
      _started = false;
      return false;
    }
  }

  /// 通过 MethodChannel 停止后端进程
  static Future<void> stop() async {
    if (!_started) return;
    try {
      await _channel.invokeMethod('stopBackend');
    } on MissingPluginException {
      // 插件未注册时静默忽略
    }
    _started = false;
  }

  /// 检查后端进程是否正在运行（实时查询 MethodChannel）
  ///
  /// 移动平台通过原生层查询实际进程状态，桌面平台根据本地缓存返回。
  static Future<bool> isRunning() async {
    if (!isMobilePlatform) return _started;
    try {
      final running =
          await _channel.invokeMethod<bool>('isBackendRunning') ?? false;
      _started = running;
      return running;
    } on MissingPluginException {
      return false;
    }
  }

  /// 在 proot 环境内执行命令并返回输出
  ///
  /// [command] 要执行的 shell 命令字符串
  static Future<String> execCommand(String command) async {
    try {
      return await _channel.invokeMethod<String>('runInProot', {
            'command': command,
          }) ??
          '';
    } on MissingPluginException {
      return '';
    }
  }

  /// 从原生侧获取引导状态信息
  ///
  /// 返回包含 `complete` 等字段的 Map，表示引导流程是否已完成
  static Future<Map<String, dynamic>> getBootstrapStatus() async {
    try {
      final result = await _channel.invokeMapMethod<String, dynamic>(
        'getBootstrapStatus',
      );
      return Map<String, dynamic>.from(result ?? {});
    } on MissingPluginException {
      return {'complete': false};
    }
  }
}
