import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api_client.dart';
import 'providers.dart';

/// 后端设置的本地镜像状态
///
/// 包含模型选择、温度、max_tokens、思考模式、功能开关及子代理参数。
class SettingsCacheState {
  final String selectedModel;
  final double temperature;
  final int maxTokens;
  final String thinkingType;
  final String reasoningEffort;
  final bool jsonMode;
  final bool darkMode;
  final String apiKey;
  final String systemPrompt;
  final bool sessionMemoryEnabled;
  final bool autoCompactEnabled;
  final bool autoDreamEnabled;
  final String? avatarPath;
  final String? avatarData;
  final Map<String, int> params;
  final List<Map<String, String>> models;
  final bool isInitialized;

  const SettingsCacheState({
    this.selectedModel = 'deepseek-v4-flash',
    this.temperature = 0.7,
    this.maxTokens = 384000,
    this.thinkingType = 'enabled',
    this.reasoningEffort = 'high',
    this.jsonMode = false,
    this.darkMode = true,
    this.avatarPath,
    this.avatarData,
    this.apiKey = '',
    this.systemPrompt = '',
    this.sessionMemoryEnabled = true,
    this.autoCompactEnabled = true,
    this.autoDreamEnabled = true,
    this.params = const {},
    this.models = const [],
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
    String? avatarData,
    String? apiKey,
    String? systemPrompt,
    bool? sessionMemoryEnabled,
    bool? autoCompactEnabled,
    bool? autoDreamEnabled,
    Map<String, int>? params,
    List<Map<String, String>>? models,
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
      avatarPath: avatarPath ?? this.avatarPath,
      avatarData: avatarData ?? this.avatarData,
      apiKey: apiKey ?? this.apiKey,
      systemPrompt: systemPrompt ?? this.systemPrompt,
      sessionMemoryEnabled: sessionMemoryEnabled ?? this.sessionMemoryEnabled,
      autoCompactEnabled: autoCompactEnabled ?? this.autoCompactEnabled,
      autoDreamEnabled: autoDreamEnabled ?? this.autoDreamEnabled,
      params: params ?? this.params,
      models: models ?? this.models,
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

  Future<void> init() async {
    try {
      final results = await Future.wait([
        _apiClient.get('/settings/page-data').catchError((_) => null),
        _apiClient.get('/models').catchError((_) => null),
      ]);

      final pageData = results[0] as Map<String, dynamic>?;
      final modelsData = results[1] as Map<String, dynamic>?;

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
      String? apiKey;
      bool? sessionMemoryEnabled;
      bool? autoCompactEnabled;
      bool? autoDreamEnabled;
      Map<String, int>? params;

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
        }

        apiKey = pageData['api_key'] as String?;

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

      List<Map<String, String>>? models;
      if (modelsData != null) {
        final rawModels = modelsData['models'] as List<dynamic>?;
        if (rawModels != null) {
          models = rawModels
              .whereType<Map<String, dynamic>>()
              .map((m) => {
                    'id': m['id']?.toString() ?? '',
                    'name': m['name']?.toString() ?? '',
                    'owned_by': m['owned_by']?.toString() ?? '',
                  })
              .toList();
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
        apiKey: apiKey,
        systemPrompt: systemPrompt,
        sessionMemoryEnabled: sessionMemoryEnabled,
        autoCompactEnabled: autoCompactEnabled,
        autoDreamEnabled: autoDreamEnabled,
        params: params,
        models: models,
      );
    } catch (e) {
      debugPrint('[SettingsCache] 初始化失败: $e');
      // 保持默认值，但不标记为已初始化以告知用户加载失败
      state = state.copyWith(isInitialized: false);
      return;
    }

    state = state.copyWith(isInitialized: true);
  }

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

  void updateApiKey(String key) {
    state = state.copyWith(apiKey: key);
  }

  void updateSystemPrompt(String prompt) {
    state = state.copyWith(systemPrompt: prompt);
  }

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

  void updateParams(Map<String, int> params) {
    state = state.copyWith(params: params);
  }

  void updateModels(List<Map<String, String>> models) {
    state = state.copyWith(models: models);
  }

  void updateAvatarPath(String? path) {
    state = state.copyWith(avatarPath: path);
  }

  void updateAvatarData(String? data) {
    state = state.copyWith(avatarData: data);
  }
}

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
