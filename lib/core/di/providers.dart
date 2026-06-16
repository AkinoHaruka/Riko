import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/api_client.dart';
import '../../data/repositories/remote_chat_repository.dart';
import '../../data/repositories/remote_settings_repository.dart';
import '../../data/repositories/remote_memory_repository.dart';
import '../../infrastructure/ai_adapter/adapter_factory.dart';
import '../../infrastructure/websocket_client.dart';

/// 【重要】本应用为单用户本地应用，不需要登录/注册/认证功能。
/// 不要添加 AuthState、AuthNotifier、authProvider 或任何认证守卫。
/// API 客户端通过 bootstrap 自动获取令牌，无需用户交互。

/// API 客户端 Provider
///
/// 创建 [ApiClient] 实例并通过微任务异步初始化：
/// 1. 在 Android 上自动探测后端地址（模拟器 vs 真机）
/// 2. 尝试从安全存储读取已有令牌
/// 3. 若无令牌则尝试 bootstrap 获取初始令牌
/// 4. 无论成功或失败，调用 [ApiClient.completeInit] 通知等待者
final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient();

  Future.microtask(() async {
    try {
      // Android 上自动探测正确的后端地址（模拟器 vs 真机）
      final resolved = await ApiClient.resolveBackendUrl();
      client.setBaseUrl(resolved);

      // 尝试从安全存储读取已有令牌
      final existingToken = client.currentToken;
      if (existingToken != null && existingToken.isNotEmpty) {
        return;
      }

      for (int i = 0; i < 5; i++) {
        if (await client.healthCheckFast()) break;
        await Future<void>.delayed(const Duration(milliseconds: 500));
      }

      // 首次启动：尝试 bootstrap 获取初始令牌
      final response = await client.get('/auth/bootstrap');
      if (response is Map && response['token'] is String) {
        await client.setToken(response['token'] as String);
      }
    } catch (e) {
      debugPrint('[ApiClient] 初始化失败: $e');
    } finally {
      // 通知所有等待者：异步初始化已完成（无论成功或失败）
      client.completeInit();
    }
  });
  return client;
});

/// 聊天仓库 Provider（使用远程后端）
final chatRepositoryProvider = Provider<RemoteChatRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  final wsClient = ref.watch(webSocketClientProvider);
  final repo = RemoteChatRepository(apiClient, wsClient);
  ref.onDispose(() => repo.dispose());
  return repo;
});

/// 设置仓库 Provider（使用远程后端）
final settingsRepositoryProvider = Provider<RemoteSettingsRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return RemoteSettingsRepository(apiClient);
});

/// 适配器工厂 Provider（单例）
///
/// 所有 AI 请求均通过本地后端服务（localhost:3000）转发，
/// 无需在前端持有 DeepSeek API Key。
final adapterFactoryProvider = Provider<AdapterFactory>((ref) {
  return AdapterFactory();
});

/// 远程记忆仓库 Provider（使用后端 /memories 接口）
final memoryRepositoryProvider = Provider<RemoteMemoryRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return RemoteMemoryRepository(apiClient);
});

/// 面板比例持久化 Notifier（使用本地 shared_preferences）
///
/// 管理聊天面板与监控面板的分割比例，通过防抖写入 SharedPreferences 持久化。
class PanelRatioNotifier extends StateNotifier<double> {
  static const _key = 'panel_ratio';
  Timer? _debounceTimer;

  PanelRatioNotifier() : super(0.6);

  /// 从 SharedPreferences 加载已保存的比例值
  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getDouble(_key);
    if (saved != null && saved > 0.0 && saved < 1.0) {
      state = saved;
    }
  }

  /// 设置面板比例，防抖 500ms 后持久化到 SharedPreferences
  void setRatio(double ratio) {
    state = ratio;
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 500), () async {
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setDouble(_key, ratio);
      } catch (e) {
        debugPrint('[PanelRatio] Failed to persist ratio: $e');
      }
    });
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    super.dispose();
  }
}

/// 面板比例 Provider（本地持久化）
final panelRatioProvider = StateNotifierProvider<PanelRatioNotifier, double>((
  ref,
) {
  final notifier = PanelRatioNotifier();
  notifier.init();
  return notifier;
});

/// 当前活跃的子代理类型（main / memory / compact / dream）
final activeAgentTypeProvider = StateProvider<String>((ref) => 'main');

/// WebSocket 客户端 Provider
///
/// 等待 apiClient 异步初始化完成后再设置 token 并自动连接，
/// 避免构造时 currentToken 为 null 的竞态问题。
final webSocketClientProvider = Provider<WebSocketClient>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  var disposed = false;
  final client = WebSocketClient(
    urlProvider: () => '${apiClient.wsBaseUrl}/ws/events',
  );

  // 初始化完成后注入 token 并自动连接
  apiClient.initReady.then((_) {
    if (disposed) return;
    client.setToken(apiClient.currentToken);
    client.connect();
  });

  ref.onDispose(() {
    disposed = true;
    client.dispose();
  });
  return client;
});
