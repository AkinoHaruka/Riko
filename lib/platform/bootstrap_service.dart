/// 首次启动引导服务模块
///
/// 负责 Android 平台首次启动时的环境初始化流程，包括：
/// 1. 下载 Ubuntu rootfs（proot 运行所需的最小 Linux 根文件系统）
/// 2. 解压并配置 rootfs
/// 3. 下载并安装 Node.js 运行时
/// 4. 注入 bionic bypass（绕过 Android 的 bionic libc 限制）
/// 5. 复制后端代码到 proot 环境
/// 6. 安装 npm 依赖
///
/// 引导流程的实际执行由原生侧（Kotlin ProotPlugin）完成，
/// Flutter 侧负责进度展示和状态协调。
///
/// 进度通过 ChangeNotifier 通知 UI 层更新，避免轮询。
library;

import 'dart:async';
import 'package:flutter/foundation.dart';
import 'proot_runner.dart';

/// 首次启动引导流程的进度状态
enum BootstrapStep {
  idle,
  checking,
  downloadingRootfs,
  extractingRootfs,
  configuringRootfs,
  downloadingNode,
  extractingNode,
  installingBionicBypass,
  copyingBackend,
  installingNpmDeps,
  verifying,
  complete,
  error,
}

/// 引导进度快照，包含当前步骤、百分比和描述信息
class BootstrapProgress {
  /// 当前引导步骤
  final BootstrapStep step;

  /// 进度百分比（0.0 - 1.0）
  final double progress;

  /// 面向用户的进度描述
  final String message;

  /// 错误信息（仅 step=error 时有值）
  final String? error;

  const BootstrapProgress({
    required this.step,
    this.progress = 0.0,
    this.message = '',
    this.error,
  });
}

/// 首次启动引导服务 — 负责下载 rootfs、安装 Node.js、复制后端代码、配置 proot 环境
///
/// 通过 ChangeNotifier 将进度变更通知 UI 层，实现实时进度展示。
/// 实际的下载、解压、安装操作由原生侧完成，Flutter 侧仅协调进度反馈。
class BootstrapService extends ChangeNotifier {
  BootstrapProgress _state = const BootstrapProgress(step: BootstrapStep.idle);
  BootstrapProgress get state => _state;

  Timer? _progressTimer;

  /// 检查引导状态并更新进度（不执行实际引导操作）
  ///
  /// 返回 true 表示环境已就绪，false 表示需要执行引导流程
  Future<bool> checkBootstrapStatus() async {
    _updateState(BootstrapStep.checking, 0.0, '正在检查环境...');

    try {
      final status = await ProotRunner.getBootstrapStatus();
      final complete = status['complete'] as bool? ?? false;

      if (complete) {
        _updateState(BootstrapStep.complete, 1.0, '环境就绪');
        return true;
      }

      // 需要引导 —— 真正的初始化工作（解压、配置）由原生侧完成，Flutter 侧协调下载和进度反馈

      _updateState(BootstrapStep.checking, 0.05, '需要初始化环境');
      return false;
    } catch (e) {
      _updateState(BootstrapStep.error, 0.0, '检查失败', error: e.toString());
      return false;
    }
  }

  /// 快速检查是否已完成引导（不更新进度状态，不触发 UI 刷新）
  Future<bool> isBootstrapped() async {
    try {
      final status = await ProotRunner.getBootstrapStatus();
      return status['complete'] as bool? ?? false;
    } catch (_) {
      return false;
    }
  }

  void _updateState(BootstrapStep step, double progress, String message, {String? error}) {
    _state = BootstrapProgress(
      step: step,
      progress: progress,
      message: message,
      error: error,
    );
    notifyListeners();
  }

  @override
  void dispose() {
    _progressTimer?.cancel();
    super.dispose();
  }
}
