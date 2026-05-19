import 'dart:io';
import 'package:flutter/services.dart';

/// 子进程管理器 — Android 上通过 MethodChannel 启动/停止 proot 中的 Node.js 后端
///
/// 桌面平台直接跳过（假设后端已在外部启动）
class ProotRunner {
  static const _channel = MethodChannel('com.example.riko/backend');

  static bool _started = false;
  static bool get isStarted => _started;

  static bool get isMobilePlatform => Platform.isAndroid || Platform.isIOS;

  /// 通过 MethodChannel 在 proot 内启动 Node.js 后端（仅 Android）
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
      _started = true;
      return true;
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

  /// 检查后端进程是否正在运行
  static Future<bool> isRunning() async {
    try {
      return await _channel.invokeMethod<bool>('isBackendRunning') ?? false;
    } on MissingPluginException {
      return false;
    }
  }

  /// 在 proot 环境内执行命令并返回输出
  static Future<String> execCommand(String command) async {
    try {
      return await _channel.invokeMethod<String>('runInProot', {
        'command': command,
      }) ?? '';
    } on MissingPluginException {
      return '';
    }
  }

  /// 从原生侧获取引导状态信息
  static Future<Map<String, dynamic>> getBootstrapStatus() async {
    try {
      final result = await _channel.invokeMapMethod<String, dynamic>('getBootstrapStatus');
      return Map<String, dynamic>.from(result ?? {});
    } on MissingPluginException {
      return {'complete': false};
    }
  }
}
