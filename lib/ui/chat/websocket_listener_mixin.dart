/// WebSocket 监听 Mixin — 处理子代理活动事件的订阅和精简
///
/// 管理 WebSocket 事件订阅，精简活动数据，维护活动记录列表。
/// 使用方需在 initState 中调用 [initWebSocketListener]，在 dispose 中调用 [disposeWebSocketListener]。
/// 可重写 [onWebSocketActivity] 以处理特定事件（如梦境完成）。
library;

import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/di/chat_provider.dart';
import '../../core/di/providers.dart';
import '../../infrastructure/websocket_client.dart';

/// WebSocket 子代理活动监听 Mixin
///
/// 混入 ConsumerState 后，在 initState 中调用 initWebSocketListener()，
/// 在 dispose 中调用 disposeWebSocketListener()。
/// 重写 onWebSocketActivity() 以响应特定事件类型。
mixin WebSocketListenerMixin<W extends ConsumerStatefulWidget>
    on ConsumerState<W> {
  StreamSubscription<WebSocketEvent>? _wsSub;

  /// 子代理活动记录列表，最多保留 20 条
  final List<Map<String, dynamic>> subAgentActivities = [];

  /// 初始化 WebSocket 监听，订阅子代理活动事件
  void initWebSocketListener() {
    final wsClient = ref.read(webSocketClientProvider);
    _wsSub = wsClient.events.listen((event) {
      if (event.type == 'session_memory_activity' ||
          event.type == 'compact_activity' ||
          event.type == 'dream_activity') {
        final activity = _compactActivity(event);
        if (!mounted) return;

        setState(() {
          subAgentActivities.insert(0, activity);
          if (subAgentActivities.length > 20) {
            subAgentActivities.removeLast();
          }
        });

        if (activity['trace'] != null) {
          ref
              .read(chatNotifierProvider.notifier)
              .addSubAgentActivityToHistory(activity);
          ref
              .read(chatNotifierProvider.notifier)
              .saveSubAgentOutputToConversation(activity);
        }

        onWebSocketActivity(activity, event.type);
      }
    });
  }

  /// 释放 WebSocket 监听资源
  void disposeWebSocketListener() {
    _wsSub?.cancel();
  }

  /// 子代理活动事件回调，子类可重写以处理特定逻辑（如梦境完成通知）
  void onWebSocketActivity(Map<String, dynamic> activity, String eventType) {}

  /// 精简 WebSocket activity 数据，只保留 UI 展示所需字段
  Map<String, dynamic> _compactActivity(WebSocketEvent event) {
    final payload = Map<String, dynamic>.from(event.payload);
    return {
      'activity_type': switch (event.type) {
        'session_memory_activity' => 'session_memory',
        'compact_activity' => 'compact',
        'dream_activity' => 'dream',
        _ => event.type,
      },
      'status': payload['status'],
      'trace': payload['trace'],
      'sessionsReviewed': payload['sessionsReviewed'],
    };
  }
}
