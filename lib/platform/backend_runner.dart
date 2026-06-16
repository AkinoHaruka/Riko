/// 后端启动器模块 — 兼容性封装层
///
/// 统一对外提供后端进程的启动/停止/状态查询接口，
/// 内部委托给 [ProotRunner] 实现，屏蔽平台差异：
/// - **桌面平台**（Windows/macOS/Linux）：后端由外部脚本或包管理工具启动，
///   此模块直接返回成功
/// - **Android/iOS**：通过 MethodChannel 调用原生层，在 proot 容器中启动 Node.js 后端
///
/// 此封装层存在的意义：保持上层调用代码的简洁性，无需关心平台分支逻辑。
library;

import 'dart:io';
import 'proot_runner.dart';

/// 后端启动器 — 兼容性封装，统一对外接口，实际委托给 ProotRunner。
///
/// 桌面平台直接返回成功（后端在外部启动），Android 平台调用 MethodChannel 启动 proot 内的 Node.js。
class BackendRunner {
  /// 后端是否已标记为启动状态
  static bool get isStarted => ProotRunner.isStarted;

  /// 当前是否为移动平台（Android / iOS）
  static bool get isMobilePlatform =>
      Platform.isAndroid || Platform.isIOS;

  /// 启动后端进程
  ///
  /// 桌面平台直接返回 true（假设后端已在外部启动），
  /// 移动平台通过 MethodChannel 启动 proot 内的 Node.js
  static Future<bool> start() => ProotRunner.start();

  /// 停止后端进程
  static Future<void> stop() => ProotRunner.stop();

  /// 检查后端进程是否正在运行
  static Future<bool> isRunning() => ProotRunner.isRunning();
}
