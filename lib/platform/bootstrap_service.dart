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

class BootstrapProgress {
  final BootstrapStep step;
  final double progress; // 0.0 - 1.0
  final String message;
  final String? error;

  const BootstrapProgress({
    required this.step,
    this.progress = 0.0,
    this.message = '',
    this.error,
  });
}

/// 首次启动引导服务 — 负责下载 rootfs、安装 Node.js、复制后端代码、配置 proot 环境
class BootstrapService extends ChangeNotifier {
  BootstrapProgress _state = const BootstrapProgress(step: BootstrapStep.idle);
  BootstrapProgress get state => _state;

  Timer? _progressTimer;

  /// 检查是否已完成引导，如果未完成则启动引导流程
  Future<bool> ensureBootstrapped() async {
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

  /// 快速检查是否已完成引导（不更新进度状态）
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
