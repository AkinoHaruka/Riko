/// AI 适配器工厂模块
///
/// 提供统一的适配器创建入口，根据模型 ID 生成对应的 [AIAdapter] 实例。
/// 所有请求通过本地后端转发，前端不直接持有 API Key。
///
/// 采用单例缓存策略：当 baseUrl 和 authToken 未变化时复用已有适配器实例，
/// 避免重复创建 Dio 客户端和拦截器带来的资源开销。
library;

import 'ai_adapter.dart';
import 'deepseek_adapter.dart';

/// 适配器工厂：创建并缓存 AI 适配器实例
///
/// 所有请求均转发到本地后端服务，地址由 ApiClient 解析后传入。
/// 缓存策略：仅当 baseUrl 变化时重建适配器，token 变化时原地更新。
/// 后端根据 model 参数自动路由到对应的 AI Provider。
class AdapterFactory {
  DeepSeekAdapter? _cachedAdapter;
  String? _lastBaseUrl;
  String? _lastAuthToken;

  /// 常用模型名称建议（仅用于输入提示，不限制用户选择）
  static const List<String> fallbackModelSuggestions = [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
  ];

  /// 获取指定模型的适配器实例
  ///
  /// [modelId] 模型标识
  /// [backendBaseUrl] 后端服务地址，变化时重建适配器
  /// [authToken] JWT 认证令牌，变化时原地更新（不重建 Dio 实例）
  ///
  /// 返回缓存的 [AIAdapter] 实例，保证同一配置下不会重复创建
  AIAdapter getAdapter(
    String modelId, {
    String? backendBaseUrl,
    String? authToken,
  }) {
    final urlChanged = backendBaseUrl != null && backendBaseUrl != _lastBaseUrl;
    final tokenChanged = authToken != _lastAuthToken;
    // baseUrl 变化时必须重建 Dio 实例（BaseOptions 不可变）
    if (urlChanged || _cachedAdapter == null) {
      _cachedAdapter = DeepSeekAdapter(
        baseUrl: backendBaseUrl,
        authToken: authToken,
      );
      _lastBaseUrl = backendBaseUrl;
      _lastAuthToken = authToken;
    } else if (tokenChanged) {
      // 仅 token 变化时，利用拦截器动态读取最新 token，无需重建 Dio
      _cachedAdapter!.updateToken(authToken);
      _lastAuthToken = authToken;
    }
    return _cachedAdapter!;
  }
}
