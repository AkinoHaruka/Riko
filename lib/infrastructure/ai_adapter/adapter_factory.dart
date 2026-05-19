import 'ai_adapter.dart';
import 'deepseek_adapter.dart';

/// 适配器工厂：创建 AI 适配器实例
///
/// 所有请求均转发到本地后端服务，地址由 ApiClient 解析后传入。
class AdapterFactory {
  DeepSeekAdapter? _cachedAdapter;
  String? _lastBaseUrl;

  List<String> get supportedModels => ['deepseek-v4-flash', 'deepseek-v4-pro'];

  AIAdapter getAdapter(String modelId, {String? backendBaseUrl}) {
    if (!supportedModels.contains(modelId)) {
      throw Exception('不支持的模型: $modelId');
    }
    if (backendBaseUrl != null && backendBaseUrl != _lastBaseUrl) {
      _cachedAdapter = DeepSeekAdapter(baseUrl: backendBaseUrl);
      _lastBaseUrl = backendBaseUrl;
    }
    return _cachedAdapter ??= DeepSeekAdapter();
  }
}
