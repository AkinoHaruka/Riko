/// MCP 状态管理 Provider
///
/// 提供 MCP API 客户端、服务器列表的 Riverpod Provider，
/// 并通过 WebSocket 事件监听自动刷新服务器列表。
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/mcp_api.dart';
import '../../infrastructure/websocket_client.dart';
import 'providers.dart';

/// MCP API 客户端 Provider（依赖 ApiClient）
final mcpApiProvider = Provider<McpApiClient>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return McpApiClient(apiClient);
});

/// MCP 服务器列表 Notifier
///
/// 管理服务器列表的加载、刷新，并监听 WebSocket 事件自动更新。
class McpServersNotifier extends StateNotifier<AsyncValue<List<McpConnectionInfo>>> {
  final McpApiClient _mcpApi;
  final WebSocketClient _wsClient;
  StreamSubscription<dynamic>? _wsSubscription;

  McpServersNotifier(this._mcpApi, this._wsClient)
      : super(const AsyncValue.loading()) {
    _listenWebSocket();
  }

  /// 监听 WebSocket 事件，当 MCP 服务器状态变化时自动刷新列表
  void _listenWebSocket() {
    _wsSubscription = _wsClient.events.listen((WebSocketEvent event) {
      final type = event.type;
      // MCP 服务器连接/断开/错误事件触发列表刷新
      if (type == 'mcp:server:connected' ||
          type == 'mcp:server:disconnected' ||
          type == 'mcp:server:error') {
        refresh();
      }
    });
  }

  /// 加载服务器列表
  Future<void> loadServers() async {
    state = const AsyncValue.loading();
    try {
      final servers = await _mcpApi.listServers();
      if (mounted) {
        state = AsyncValue.data(servers);
      }
    } catch (e, st) {
      if (mounted) {
        state = AsyncValue.error(e, st);
      }
    }
  }

  /// 刷新服务器列表（不重置为 loading 状态，保留旧数据）
  Future<void> refresh() async {
    try {
      final servers = await _mcpApi.listServers();
      if (mounted) {
        state = AsyncValue.data(servers);
      }
    } catch (e) {
      // 刷新失败时保留旧数据，仅打印日志
      debugPrint('[McpProviders] 刷新服务器列表失败: $e');
    }
  }

  /// 添加 MCP 服务器
  Future<McpServerActionResponse> addServer(
    String name,
    McpServerConfig config,
  ) async {
    final response = await _mcpApi.addServer(name, config);
    // 添加成功后刷新列表
    await refresh();
    return response;
  }

  /// 删除 MCP 服务器
  Future<void> removeServer(String name) async {
    await _mcpApi.removeServer(name);
    // 删除成功后刷新列表
    await refresh();
  }

  /// 重连 MCP 服务器
  Future<McpServerActionResponse> reconnectServer(String name) async {
    final response = await _mcpApi.reconnectServer(name);
    // 重连后刷新列表以获取最新状态
    await refresh();
    return response;
  }

  @override
  void dispose() {
    _wsSubscription?.cancel();
    super.dispose();
  }
}

/// MCP 服务器列表 Provider
///
/// 自动加载服务器列表，并通过 WebSocket 事件监听实时更新。
final mcpServersProvider =
    StateNotifierProvider<McpServersNotifier, AsyncValue<List<McpConnectionInfo>>>(
  (ref) {
    final mcpApi = ref.watch(mcpApiProvider);
    final wsClient = ref.watch(webSocketClientProvider);
    final notifier = McpServersNotifier(mcpApi, wsClient);
    // 初始化时自动加载
    notifier.loadServers();
    return notifier;
  },
);
