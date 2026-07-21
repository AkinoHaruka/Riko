import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api_client.dart';
import 'providers.dart';

/// 后端设置的本地镜像状态
///
/// 包含模型选择、温度、max_tokens、思考模式、功能开关及子代理参数。
/// 所有字段均从后端 /settings/page-data 接口加载，前端修改后同步回后端。
class SettingsCacheState {
  /// 当前选中的模型 ID
  final String selectedModel;

  /// AI 生成温度（0.0 ~ 2.0）
  final double temperature;

  /// 最大生成 token 数
  final int maxTokens;

  /// 思考模式类型（enabled / disabled / budget）
  final String thinkingType;

  /// 推理力度（low / medium / high）
  final String reasoningEffort;

  /// 是否启用 JSON 输出模式
  final bool jsonMode;

  /// 是否启用暗色模式（本项目仅支持暗色）
  final bool darkMode;

  /// 是否已配置 DeepSeek API Key（仅标记，不存储明文）
  final bool hasApiKey;

  /// 系统提示词
  final String systemPrompt;

  /// 是否启用会话记忆提取
  final bool sessionMemoryEnabled;

  /// 是否启用自动上下文压缩
  final bool autoCompactEnabled;

  /// 是否启用自动梦境整理
  final bool autoDreamEnabled;

  /// AI 头像本地文件路径
  final String? avatarPath;

  /// AI 头像 Base64 数据
  final String? avatarData;

  /// 子代理触发参数（key → 阈值映射）
  final Map<String, int> params;

  /// 可用模型列表
  final List<Map<String, String>> models;

  /// 多 Provider 信息列表，每项含 id、name、hasApiKey
  final List<Map<String, dynamic>> providers;

  /// 多 Provider API Key 状态，key 为 provider ID，value 为是否已配置
  final Map<String, bool> apiKeys;

  /// 当前活跃的 Provider ID
  final String activeProviderId;

  /// 每个 Provider 的自定义 Base URL，key 为 provider ID
  final Map<String, String> baseUrls;

  /// 是否已完成初始化加载
  final bool isInitialized;

  const SettingsCacheState({
    this.selectedModel = 'deepseek-v4-flash',
    this.temperature = 0.7,
    // 默认 16384：与后端 MAX_TOKENS_DEFAULT 对齐。
    // 原默认 384000 远超所有主流模型的实际 max_output_tokens（通常 4K-8K），
    // 会导致 token 预估与上下文压缩判断失真，且超出后端 131072 硬上限。
    this.maxTokens = 16384,
    this.thinkingType = 'enabled',
    this.reasoningEffort = 'high',
    this.jsonMode = false,
    this.darkMode = true,
    this.avatarPath,
    this.avatarData,
    this.hasApiKey = false,
    this.systemPrompt = '',
    this.sessionMemoryEnabled = true,
    this.autoCompactEnabled = true,
    this.autoDreamEnabled = true,
    this.params = const {},
    this.models = const [],
    this.providers = const [],
    this.apiKeys = const {},
    this.activeProviderId = 'deepseek',
    this.baseUrls = const {},
    this.isInitialized = false,
  });

  SettingsCacheState copyWith({
    String? selectedModel,
    double? temperature,
    int? maxTokens,
    String? thinkingType,
    String? reasoningEffort,
    bool? jsonMode,
    bool? darkMode,
    String? avatarPath,
    bool clearAvatarPath = false,
    String? avatarData,
    bool clearAvatarData = false,
    bool? hasApiKey,
    String? systemPrompt,
    bool clearSystemPrompt = false,
    bool? sessionMemoryEnabled,
    bool? autoCompactEnabled,
    bool? autoDreamEnabled,
    Map<String, int>? params,
    List<Map<String, String>>? models,
    List<Map<String, dynamic>>? providers,
    Map<String, bool>? apiKeys,
    String? activeProviderId,
    Map<String, String>? baseUrls,
    bool? isInitialized,
  }) {
    return SettingsCacheState(
      selectedModel: selectedModel ?? this.selectedModel,
      temperature: temperature ?? this.temperature,
      maxTokens: maxTokens ?? this.maxTokens,
      thinkingType: thinkingType ?? this.thinkingType,
      reasoningEffort: reasoningEffort ?? this.reasoningEffort,
      jsonMode: jsonMode ?? this.jsonMode,
      darkMode: darkMode ?? this.darkMode,
      avatarPath: clearAvatarPath ? null : (avatarPath ?? this.avatarPath),
      avatarData: clearAvatarData ? null : (avatarData ?? this.avatarData),
      hasApiKey: hasApiKey ?? this.hasApiKey,
      systemPrompt: clearSystemPrompt
          ? ''
          : (systemPrompt ?? this.systemPrompt),
      sessionMemoryEnabled: sessionMemoryEnabled ?? this.sessionMemoryEnabled,
      autoCompactEnabled: autoCompactEnabled ?? this.autoCompactEnabled,
      autoDreamEnabled: autoDreamEnabled ?? this.autoDreamEnabled,
      params: Map.unmodifiable(params ?? this.params),
      models: List.unmodifiable(models ?? this.models),
      providers: List.unmodifiable(providers ?? this.providers),
      apiKeys: Map.unmodifiable(apiKeys ?? this.apiKeys),
      activeProviderId: activeProviderId ?? this.activeProviderId,
      baseUrls: Map.unmodifiable(baseUrls ?? this.baseUrls),
      isInitialized: isInitialized ?? this.isInitialized,
    );
  }
}

/// 后端设置的本地镜像 Notifier
///
/// 通过 /settings/page-data 接口批量加载所有设置，
/// 提供 updateBasicSettings / updateFeatures 等方法供前端更新后同步到后端。
class SettingsCache extends StateNotifier<SettingsCacheState> {
  final ApiClient _apiClient;

  SettingsCache(this._apiClient) : super(const SettingsCacheState());

  /// 批量加载后端设置
  ///
  /// 从 /settings/page-data 接口加载所有设置，解析后更新状态。
  /// 模型列表保留为空（模型名称由用户自由输入），不再请求 /providers/models。
  /// 失败时保持默认值，不标记为已初始化。
  Future<void> init() async {
    try {
      final pageData =
          await _apiClient.get('/settings/page-data').catchError((_) => null);

      String? selectedModel;
      double? temperature;
      int? maxTokens;
      String? thinkingType;
      String? reasoningEffort;
      bool? jsonMode;
      bool? darkMode;
      String? systemPrompt;
      String? avatarPath;
      String? avatarData;
      bool? hasApiKey;
      bool? sessionMemoryEnabled;
      bool? autoCompactEnabled;
      bool? autoDreamEnabled;
      Map<String, int>? params;
      List<Map<String, dynamic>>? providers;
      Map<String, bool>? apiKeys;
      String? activeProviderId;
      Map<String, String>? baseUrls;

      if (pageData != null) {
        final settings = pageData['settings'] as Map<String, dynamic>?;
        if (settings != null) {
          selectedModel = settings['selected_model'] as String?;
          temperature = double.tryParse(settings['temperature'].toString());
          maxTokens = int.tryParse(settings['max_tokens'].toString());
          thinkingType = settings['thinking_type'] as String?;
          reasoningEffort = settings['reasoning_effort'] as String?;
          jsonMode = settings['json_mode']?.toString() == 'true';
          darkMode = settings['dark_mode']?.toString() == 'true';
          systemPrompt = settings['system_prompt'] as String?;
          avatarPath = settings['agent_avatar_path'] as String?;
          avatarData = settings['agent_avatar_data'] as String?;

          // 解析当前活跃 Provider ID
          activeProviderId = settings['active_provider_id'] as String?;

          // 解析各 Provider 的自定义 Base URL（key 格式：base_url_${providerId}）
          final baseUrlEntries = <String, String>{};
          for (final entry in settings.entries) {
            final key = entry.key;
            if (key.startsWith('base_url_') && entry.value is String) {
              final providerId = key.substring('base_url_'.length);
              final url = entry.value as String;
              if (url.isNotEmpty) {
                baseUrlEntries[providerId] = url;
              }
            }
          }
          if (baseUrlEntries.isNotEmpty) {
            baseUrls = baseUrlEntries;
          }
        }

        // 判断是否已配置 API Key，不存储明文
        final rawApiKey = pageData['api_key'] as String?;
        hasApiKey = rawApiKey != null && rawApiKey.isNotEmpty;

        // 解析多 Provider API Key 状态
        final rawApiKeys = pageData['api_keys'] as Map<String, dynamic>?;
        if (rawApiKeys != null) {
          apiKeys = {
            for (final entry in rawApiKeys.entries)
              entry.key: entry.value != null && entry.value.toString().isNotEmpty,
          };
        }

        // 解析多 Provider 信息列表
        final rawProviders = pageData['providers'] as List<dynamic>?;
        if (rawProviders != null) {
          providers = rawProviders
              .whereType<Map<String, dynamic>>()
              .map((p) => {
                    'id': p['id']?.toString() ?? '',
                    'name': p['name']?.toString() ?? '',
                    'hasApiKey': p['hasApiKey'] as bool? ?? false,
                  })
              .toList();
        }

        final features = pageData['features'] as Map<String, dynamic>?;
        if (features != null) {
          sessionMemoryEnabled = features['session_memory'] as bool?;
          autoCompactEnabled = features['auto_compact'] as bool?;
          autoDreamEnabled = features['auto_dream'] as bool?;
        }

        final rawParams = pageData['params'] as List<dynamic>?;
        if (rawParams != null) {
          params = {
            for (final p in rawParams)
              if (p is Map<String, dynamic> &&
                  p['key'] is String &&
                  p['value'] is int)
                p['key'] as String: p['value'] as int,
          };
        }
      }

      state = state.copyWith(
        selectedModel: selectedModel,
        temperature: temperature,
        maxTokens: maxTokens,
        thinkingType: thinkingType,
        reasoningEffort: reasoningEffort,
        jsonMode: jsonMode,
        darkMode: darkMode,
        avatarPath: avatarPath,
        avatarData: avatarData,
        hasApiKey: hasApiKey,
        systemPrompt: systemPrompt,
        sessionMemoryEnabled: sessionMemoryEnabled,
        autoCompactEnabled: autoCompactEnabled,
        autoDreamEnabled: autoDreamEnabled,
        params: params,
        // models 保留为空列表，模型名称由用户自由输入
        providers: providers,
        apiKeys: apiKeys,
        activeProviderId: activeProviderId,
        baseUrls: baseUrls,
      );
    } catch (e) {
      debugPrint('[SettingsCache] 初始化失败: $e');
      // 保持默认值，但不标记为已初始化以告知用户加载失败
      state = state.copyWith(isInitialized: false);
      return;
    }

    state = state.copyWith(isInitialized: true);
  }

  /// 更新基础设置（模型、温度、token 上限、思考模式等）
  void updateBasicSettings({
    String? selectedModel,
    double? temperature,
    int? maxTokens,
    String? thinkingType,
    String? reasoningEffort,
    bool? jsonMode,
    bool? darkMode,
  }) {
    state = state.copyWith(
      selectedModel: selectedModel,
      temperature: temperature,
      maxTokens: maxTokens,
      thinkingType: thinkingType,
      reasoningEffort: reasoningEffort,
      jsonMode: jsonMode,
      darkMode: darkMode,
    );
  }

  /// 更新 API Key 状态标记（不存储明文，仅标记是否已配置）
  void updateApiKeyStatus(bool hasKey) {
    state = state.copyWith(hasApiKey: hasKey);
  }

  /// 更新指定 Provider 的 API Key 状态
  void updateProviderApiKey(String providerId, bool hasKey) {
    final updated = Map<String, bool>.from(state.apiKeys);
    updated[providerId] = hasKey;
    state = state.copyWith(apiKeys: updated);
  }

  /// 更新当前活跃 Provider
  void updateActiveProvider(String providerId) {
    state = state.copyWith(activeProviderId: providerId);
  }

  /// 更新指定 Provider 的 Base URL
  void updateBaseUrl(String providerId, String baseUrl) {
    final updated = Map<String, String>.from(state.baseUrls);
    if (baseUrl.isEmpty) {
      updated.remove(providerId);
    } else {
      updated[providerId] = baseUrl;
    }
    state = state.copyWith(baseUrls: updated);
  }

  /// 更新系统提示词
  void updateSystemPrompt(String prompt) {
    state = state.copyWith(systemPrompt: prompt);
  }

  /// 更新功能开关（会话记忆、自动压缩、自动梦境）
  void updateFeatures({
    bool? sessionMemory,
    bool? autoCompact,
    bool? autoDream,
  }) {
    state = state.copyWith(
      sessionMemoryEnabled: sessionMemory,
      autoCompactEnabled: autoCompact,
      autoDreamEnabled: autoDream,
    );
  }

  /// 更新子代理触发参数
  void updateParams(Map<String, int> params) {
    state = state.copyWith(params: params);
  }

  /// 更新 AI 头像本地路径
  void updateAvatarPath(String? path) {
    state = state.copyWith(avatarPath: path);
  }

  /// 更新 AI 头像 Base64 数据
  void updateAvatarData(String? data) {
    state = state.copyWith(avatarData: data);
  }
}

/// 设置缓存 Notifier Provider
///
/// 依赖 [apiClientProvider] 获取 API 客户端实例。
final settingsCacheProvider =
    StateNotifierProvider<SettingsCache, SettingsCacheState>((ref) {
      final apiClient = ref.watch(apiClientProvider);
      return SettingsCache(apiClient);
    });

/// 设置缓存初始化 Provider（等待 token 就绪后加载后端设置）
///
/// 等待 apiClient.initReady 确保 bootstrap token 已就绪后再加载后端设置。
final settingsCacheInitProvider = FutureProvider<void>((ref) async {
  final apiClient = ref.read(apiClientProvider);
  await apiClient.initReady;
  final cache = ref.read(settingsCacheProvider.notifier);
  await cache.init();
});
