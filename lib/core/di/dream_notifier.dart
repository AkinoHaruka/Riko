import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../infrastructure/websocket_client.dart';
import 'dream_status.dart';
import 'providers.dart';

/// 梦境整理任务的状态，由 WebSocket 事件驱动更新
class DreamState {
  final DreamStatus status;
  final String? summary;
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
      completedAt:
          clearCompletedAt ? null : (completedAt ?? this.completedAt),
    );
  }
}

/// 梦境整理状态管理
///
/// 监听 WebSocket 的 dream_started / dream_activity 事件，
/// 状态在 5 秒后自动重置回 idle。
class DreamNotifier extends StateNotifier<DreamState> {
  final WebSocketClient _wsClient;
  StreamSubscription<WebSocketEvent>? _dreamEventSubscription;
  Timer? _fadeTimer;

  DreamNotifier(this._wsClient) : super(const DreamState()) {
    // connect() 由 webSocketClientProvider 在 initReady 后自动调用，
    // 此处只需订阅事件流即可。
    _dreamEventSubscription = _wsClient.events.listen(_handleEvent);
  }

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

final dreamNotifierProvider = StateNotifierProvider<DreamNotifier, DreamState>(
  (ref) {
    final wsClient = ref.watch(webSocketClientProvider);
    return DreamNotifier(wsClient);
  },
);
