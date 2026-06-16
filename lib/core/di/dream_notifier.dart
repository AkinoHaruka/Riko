import 'dart:async';

import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/repositories/remote_chat_repository.dart';
import '../../infrastructure/websocket_client.dart';
import 'dream_status.dart';
import 'providers.dart';

/// 梦境整理任务的状态，由 WebSocket 事件驱动更新
class DreamState {
  /// 当前梦境任务状态（idle / running / completed）
  final DreamStatus status;

  /// 梦境整理完成后的摘要文本
  final String? summary;

  /// 梦境整理完成时间
  final DateTime? completedAt;

  const DreamState({
    this.status = DreamStatus.idle,
    this.summary,
    this.completedAt,
  });

  DreamState copyWith({
    DreamStatus? status,
    String? summary,
    DateTime? completedAt,
    bool clearSummary = false,
    bool clearCompletedAt = false,
  }) {
    return DreamState(
      status: status ?? this.status,
      summary: clearSummary ? null : (summary ?? this.summary),
      completedAt: clearCompletedAt ? null : (completedAt ?? this.completedAt),
    );
  }
}

/// 梦境整理状态管理
///
/// 监听 WebSocket 的 dream_started / dream_activity 事件，
/// 状态在 5 秒后自动重置回 idle。
/// 初始化时主动查询后端 Dream 任务状态，避免页面刷新后丢失运行中任务信息。
class DreamNotifier extends StateNotifier<DreamState> {
  final WebSocketClient _wsClient;
  final RemoteChatRepository _chatRepo;
  StreamSubscription<WebSocketEvent>? _dreamEventSubscription;

  /// 完成后自动淡出的定时器
  Timer? _fadeTimer;

  DreamNotifier(this._wsClient, this._chatRepo) : super(const DreamState()) {
    // 订阅 WebSocket 事件流
    _dreamEventSubscription = _wsClient.events.listen(
      _handleEvent,
      onError: (Object e) => debugPrint('[DreamNotifier] WS stream error: $e'),
    );
    // 初始化时查询当前 Dream 状态
    _loadInitialStatus();
  }

  /// 主动查询后端 Dream 任务状态
  ///
  /// 页面初始化时调用，恢复已有 Dream 任务的运行状态。
  /// 查询失败不影响正常使用，静默忽略。
  Future<void> _loadInitialStatus() async {
    try {
      final result = await _chatRepo.getDreamStatus();
      final status = result['status'] as String?;
      if (status == 'running') {
        state = state.copyWith(status: DreamStatus.running);
      } else if (status == 'completed') {
        state = state.copyWith(
          status: DreamStatus.completed,
          summary: result['summary'] as String?,
          completedAt: DateTime.now(),
        );
        // 完成状态 5 秒后淡出
        _fadeTimer = Timer(const Duration(seconds: 5), () {
          if (!mounted || state.status != DreamStatus.completed) return;
          state = const DreamState();
        });
      }
    } catch (_) {
      // 查询失败不影响正常使用，静默忽略
    }
  }

  /// 处理 WebSocket 事件，仅响应 dream_started 和 dream_activity
  void _handleEvent(WebSocketEvent event) {
    if (event.type != 'dream_started' && event.type != 'dream_activity') {
      return;
    }

    _fadeTimer?.cancel();
    _fadeTimer = null;

    if (event.type == 'dream_started') {
      state = state.copyWith(
        status: DreamStatus.running,
        clearSummary: true,
        clearCompletedAt: true,
      );
    } else if (event.type == 'dream_activity') {
      final status = event.payload['status'] as String?;
      if (status != 'completed') return;

      state = state.copyWith(
        status: DreamStatus.completed,
        summary: event.payload['summary'] as String?,
        completedAt: DateTime.now(),
      );
      // 完成后 5 秒自动淡出，回到 idle 状态
      _fadeTimer = Timer(const Duration(seconds: 5), () {
        if (!mounted || state.status != DreamStatus.completed) return;
        state = const DreamState();
      });
    }
  }

  @override
  void dispose() {
    _fadeTimer?.cancel();
    _dreamEventSubscription?.cancel();
    super.dispose();
  }
}

/// 梦境状态 Notifier Provider
///
/// 依赖 [webSocketClientProvider] 获取 WebSocket 连接，
/// 依赖 [chatRepositoryProvider] 查询 Dream 初始状态。
final dreamNotifierProvider = StateNotifierProvider<DreamNotifier, DreamState>((
  ref,
) {
  final wsClient = ref.watch(webSocketClientProvider);
  final chatRepo = ref.watch(chatRepositoryProvider);
  return DreamNotifier(wsClient, chatRepo);
});
