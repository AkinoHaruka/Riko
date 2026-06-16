/// 设置页面 — 应用完整配置中心
///
/// 包含 API Key 配置、System Prompt、模型选择、模型参数（Temperature/MaxTokens）、
/// 子代理开关（会话记忆/自动压缩/自动整固）及其触发参数、思考模式、JSON 输出模式、
/// 外观设置、数据管理（导出/导入/清空）和版本信息。
/// 支持未保存变更提示，离开页面时可选择放弃或继续编辑。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/di/chat_provider.dart';
import '../core/di/providers.dart';
import '../core/di/settings_cache.dart';
import '../core/di/toast_provider.dart';
import '../core/theme/app_animations.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_radius.dart';
import 'widgets/settings/settings_action_button.dart';
import 'widgets/settings/settings_data_mixin.dart';
import 'widgets/settings/settings_group.dart';
import 'widgets/settings/settings_import_dialog.dart';
import 'widgets/settings/settings_param_widgets.dart';
import 'widgets/settings/settings_slider.dart';
import 'widgets/settings/settings_toggle.dart';

/// 设置页面 — 模型选择、API Key、System Prompt、模型参数、子代理开关、数据导出/导入等完整配置
class SettingsPage extends ConsumerStatefulWidget {
  final bool showBackButton;
  const SettingsPage({super.key, this.showBackButton = true});

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage>
    with SettingsDataMixin<SettingsPage> {
  String _selectedModel = 'deepseek-v4-flash';
  double _temperature = 0.7;
  int _maxTokens = 384000;
  bool _thinkingEnabled = true;
  String _reasoningEffort = 'high';
  bool _jsonMode = false;
  bool _sessionMemoryEnabled = true;
  bool _autoCompactEnabled = true;
  bool _autoDreamEnabled = true;
  bool _hasUnsavedChanges = false;

  late final TextEditingController _systemPromptController;

  /// 当前选中的 Provider ID
  String _selectedProviderId = 'deepseek';

  /// 当前 Provider 的 API Key 输入控制器
  late final TextEditingController _apiKeyController;

  /// 模型名称自由输入控制器
  late final TextEditingController _modelInputController;

  /// Base URL 输入控制器
  late final TextEditingController _baseUrlController;

  /// API Key 可见状态
  bool _apiKeyVisible = false;

  /// 连通性测试状态（null=未测试, true=成功, false=失败）
  bool? _testStatus;

  /// 测试中状态
  bool _isTesting = false;

  Map<String, int> _paramValues = {};
  final Map<String, TextEditingController> _paramControllers = {};

  /// 子代理触发参数定义 — 键名、标签、默认值和取值范围
  static const Map<String, ParamDef> _paramDefs = {
    'param_session_memory_min_messages': ParamDef(
      label: '初始化最小消息数',
      defaultValue: 6,
      min: 1,
      max: 100,
    ),
    'param_session_memory_min_tokens_between_update': ParamDef(
      label: '更新间最小 Token 增长',
      defaultValue: 2000,
      min: 100,
      max: 100000,
    ),
    'param_session_memory_tool_calls_between_updates': ParamDef(
      label: '更新间最小工具调用次数',
      defaultValue: 3,
      min: 1,
      max: 50,
    ),
    'param_compact_trigger_tokens': ParamDef(
      label: '触发压缩 Token 阈值',
      defaultValue: 200000,
      min: 10000,
      max: 1000000,
    ),
    'param_compact_recent_dialogue_tokens': ParamDef(
      label: '压缩后保留最近对话 Token 数',
      defaultValue: 20000,
      min: 1000,
      max: 200000,
    ),
    'param_dream_min_hours': ParamDef(
      label: '最小间隔小时数',
      defaultValue: 24,
      min: 1,
      max: 720,
    ),
    'param_dream_min_sessions': ParamDef(
      label: '最小新会话数',
      defaultValue: 5,
      min: 1,
      max: 100,
    ),
  };

  /// 建议模型列表（仅作 Autocomplete 建议，不限制用户输入）
  static const List<String> _fallbackModelIds = [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'gpt-4o',
    'gpt-4o-mini',
    'o3',
    'o4-mini',
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'moonshot-v1-auto',
    'qwen3-235b-a22b',
  ];

  /// Provider 默认 Base URL 映射
  static const Map<String, String> _providerDefaultBaseUrls = {
    'deepseek': 'https://api.deepseek.com',
    'openai': 'https://api.openai.com/v1',
    'anthropic': 'https://api.anthropic.com',
    'gemini': 'https://generativelanguage.googleapis.com',
    'openrouter': 'https://openrouter.ai/api/v1',
    'moonshot': 'https://api.moonshot.cn/v1',
    'ollama': 'http://localhost:11434/v1',
    'custom': '',
  };

  @override
  void initState() {
    super.initState();
    _systemPromptController = TextEditingController();
    _apiKeyController = TextEditingController();
    _modelInputController = TextEditingController();
    _baseUrlController = TextEditingController();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadSettings());
  }

  @override
  void dispose() {
    _systemPromptController.dispose();
    _apiKeyController.dispose();
    _modelInputController.dispose();
    _baseUrlController.dispose();
    for (final controller in _paramControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  /// 从设置缓存加载所有配置项到本地状态
  void _loadSettings() {
    final cache = ref.read(settingsCacheProvider);

    _paramValues = {};
    for (final entry in _paramDefs.entries) {
      final value = cache.params[entry.key] ?? entry.value.defaultValue;
      _paramValues[entry.key] = value;
      _paramControllers[entry.key]?.dispose();
      _paramControllers[entry.key] = TextEditingController(
        text: value.toString(),
      );
    }

    // 根据当前选中模型推断 Provider
    final modelId = cache.selectedModel;
    String inferredProvider = 'deepseek';
    if (modelId.startsWith('gpt-') || modelId.startsWith('o3') || modelId.startsWith('o4')) {
      inferredProvider = 'openai';
    } else if (modelId.startsWith('claude-')) {
      inferredProvider = 'anthropic';
    } else if (modelId.startsWith('gemini-')) {
      inferredProvider = 'gemini';
    } else if (modelId.startsWith('moonshot-')) {
      inferredProvider = 'moonshot';
    } else if (modelId.contains('/')) {
      inferredProvider = 'openrouter';
    }

    // 加载选中 Provider 的 API Key 状态
    final hasKey = cache.apiKeys[inferredProvider] ?? false;

    setState(() {
      _selectedProviderId = inferredProvider;
      _selectedModel = modelId;
      _modelInputController.text = modelId;
      _apiKeyController.text = hasKey ? '••••••••' : '';
      _apiKeyVisible = false;
      _baseUrlController.text = _providerDefaultBaseUrls[inferredProvider] ?? '';
      _testStatus = null;
      _temperature = cache.temperature;
      _maxTokens = cache.maxTokens;
      _thinkingEnabled = cache.thinkingType != 'disabled';
      _reasoningEffort = cache.reasoningEffort;
      _jsonMode = cache.jsonMode;
      _systemPromptController.text = cache.systemPrompt;
      _sessionMemoryEnabled = cache.sessionMemoryEnabled;
      _autoCompactEnabled = cache.autoCompactEnabled;
      _autoDreamEnabled = cache.autoDreamEnabled;
    });
  }

  /// 保存所有设置到后端，成功后更新本地缓存；部分失败时从后端重新加载确保一致性
  Future<void> _saveSettings() async {
    final cache = ref.read(settingsCacheProvider.notifier);
    final settingsRepo = ref.read(settingsRepositoryProvider);
    final apiClient = ref.read(apiClientProvider);

    final List<String> errors = [];
    // 使用模型输入框的文本作为选中模型
    final selectedModel = _modelInputController.text.trim();
    final effectiveModel = selectedModel.isNotEmpty ? selectedModel : _selectedModel;

    // 先写后端，成功后再更新本地缓存
    try {
      await settingsRepo.batchSet({
        'selected_model': effectiveModel,
        'temperature': _temperature.toString(),
        'max_tokens': _maxTokens.toString(),
        'thinking_type': _thinkingEnabled ? 'enabled' : 'disabled',
        'reasoning_effort': _reasoningEffort,
        'json_mode': _jsonMode.toString(),
        'system_prompt': _systemPromptController.text.trim(),
      });
    } catch (e) {
      errors.add('本地设置保存失败: ${formatSettingsError(e)}');
    }

    // 保存当前选中 Provider 的 API Key
    final keyText = _apiKeyController.text.trim();
    if (keyText.isNotEmpty && keyText != '••••••••') {
      try {
        await apiClient.post('/settings/apikey', data: {
          'api_key': keyText,
          'provider_id': _selectedProviderId,
        });
      } catch (e) {
        errors.add('${_getProviderName()} API Key 保存失败: ${formatSettingsError(e)}');
      }
    }

    // 保存 Base URL（如果与默认值不同）
    final currentBaseUrl = _baseUrlController.text.trim();
    final defaultBaseUrl = _providerDefaultBaseUrls[_selectedProviderId] ?? '';
    if (currentBaseUrl != defaultBaseUrl) {
      try {
        await settingsRepo.batchSet({
          'base_url_$_selectedProviderId': currentBaseUrl,
        });
      } catch (e) {
        errors.add('Base URL 保存失败: ${formatSettingsError(e)}');
      }
    }

    try {
      await settingsRepo.batchSet({
        'feature_session_memory': _sessionMemoryEnabled.toString(),
        'feature_auto_compact': _autoCompactEnabled.toString(),
        'feature_auto_dream': _autoDreamEnabled.toString(),
      });
    } catch (e) {
      errors.add('子代理设置保存失败: ${formatSettingsError(e)}');
    }

    final paramsToSave = <Map<String, dynamic>>[];
    final newParams = <String, int>{};
    for (final entry in _paramDefs.entries) {
      final key = entry.key;
      final def = entry.value;
      final controller = _paramControllers[key];
      if (controller == null) continue;
      final parsed = int.tryParse(controller.text.trim());
      final value = parsed?.clamp(def.min, def.max) ?? def.defaultValue;
      _paramValues[key] = value;
      newParams[key] = value;
      paramsToSave.add({'key': key, 'value': value});
    }

    try {
      if (paramsToSave.isNotEmpty) {
        await apiClient.put('/settings/params', data: {'params': paramsToSave});
      }
    } catch (e) {
      errors.add('触发参数保存失败: ${formatSettingsError(e)}');
    }

    // 后端全部成功时更新本地缓存；部分失败时从后端重新加载确保一致性
    if (errors.isEmpty) {
      cache.updateBasicSettings(
        selectedModel: effectiveModel,
        temperature: _temperature,
        maxTokens: _maxTokens,
        thinkingType: _thinkingEnabled ? 'enabled' : 'disabled',
        reasoningEffort: _reasoningEffort,
        jsonMode: _jsonMode,
      );
      // 更新当前 Provider 的 API Key 状态
      final hasKey = _apiKeyController.text.trim().isNotEmpty;
      cache.updateProviderApiKey(_selectedProviderId, hasKey);
      cache.updateSystemPrompt(_systemPromptController.text.trim());
      cache.updateFeatures(
        sessionMemory: _sessionMemoryEnabled,
        autoCompact: _autoCompactEnabled,
        autoDream: _autoDreamEnabled,
      );
      cache.updateParams(newParams);
      ref.read(selectedModelProvider.notifier).state = effectiveModel;
      _selectedModel = effectiveModel;
    } else {
      // 部分失败，从后端重新加载设置确保缓存与后端一致
      try {
        await cache.init();
      } catch (_) {
        // 回滚加载也失败，保持当前缓存状态
      }
    }

    if (!mounted) return;

    if (errors.isEmpty) {
      ref.read(toastProvider.notifier).show('设置已保存');
      setState(() => _hasUnsavedChanges = false);
    } else {
      ref.read(toastProvider.notifier).show(errors.join('\n'));
    }
  }

  /// 根据 Provider ID 获取显示名称（默认使用当前选中 Provider）
  String _getProviderName([String? providerId]) {
    final id = providerId ?? _selectedProviderId;
    final cache = ref.read(settingsCacheProvider);
    for (final provider in cache.providers) {
      if (provider['id'] == id) {
        return provider['name'] as String? ?? id;
      }
    }
    // 兜底：从静态映射获取
    const nameMap = {
      'deepseek': 'DeepSeek',
      'openai': 'OpenAI',
      'anthropic': 'Anthropic',
      'gemini': 'Google Gemini',
      'openrouter': 'OpenRouter',
      'moonshot': 'Moonshot (Kimi)',
      'ollama': 'Ollama (本地)',
      'custom': '自定义 (OpenAI 兼容)',
    };
    return nameMap[id] ?? id;
  }

  /// 测试当前选中 Provider 的 API Key 连通性
  Future<void> _testProviderConnection() async {
    final apiClient = ref.read(apiClientProvider);
    setState(() {
      _isTesting = true;
      _testStatus = null;
    });

    try {
      final result = await apiClient.post('/providers/$_selectedProviderId/test') as Map<String, dynamic>;
      final success = result['success'] as bool? ?? false;
      if (!mounted) return;
      setState(() {
        _isTesting = false;
        _testStatus = success;
      });
      if (success) {
        ref.read(toastProvider.notifier).show('${_getProviderName()} 连接成功');
      } else {
        final error = result['error'] as String? ?? '连接失败';
        ref.read(toastProvider.notifier).show('${_getProviderName()}: $error');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isTesting = false;
        _testStatus = false;
      });
      ref.read(toastProvider.notifier).show('${_getProviderName()} 测试失败: $e');
    }
  }

  void _onParamChanged(String key, int? value) {
    if (value != null) {
      _paramValues[key] = value;
    }
  }

  /// Provider 图标映射
  IconData _getProviderIcon(String providerId) {
    switch (providerId) {
      case 'deepseek':
        return Icons.psychology;
      case 'openai':
        return Icons.smart_toy;
      case 'anthropic':
        return Icons.auto_awesome;
      case 'gemini':
        return Icons.diamond;
      case 'openrouter':
        return Icons.route;
      case 'moonshot':
        return Icons.nightlight;
      case 'ollama':
        return Icons.computer;
      default:
        return Icons.key;
    }
  }

  /// 构建 Provider 配置区：Provider 选择器 + API Key + Base URL + 测试按钮
  Widget _buildProviderConfigSection() {
    final cache = ref.read(settingsCacheProvider);
    final providers = cache.providers;
    final hasKey = cache.apiKeys[_selectedProviderId] ?? false;

    // 构建下拉选项（后端 providers 为空时使用静态列表）
    final List<DropdownMenuItem<String>> providerItems;
    if (providers.isNotEmpty) {
      providerItems = providers.map((p) {
        final id = p['id'] as String;
        final name = p['name'] as String? ?? id;
        return DropdownMenuItem<String>(
          value: id,
          child: Row(
            children: [
              Icon(_getProviderIcon(id), color: AppColors.textPrimary.withValues(alpha: 0.6), size: 16),
              const SizedBox(width: 8),
              Text(name, style: const TextStyle(color: AppColors.textPrimary, fontSize: 14)),
            ],
          ),
        );
      }).toList();
    } else {
      providerItems = _providerDefaultBaseUrls.keys.map((id) {
        return DropdownMenuItem<String>(
          value: id,
          child: Row(
            children: [
              Icon(_getProviderIcon(id), color: AppColors.textPrimary.withValues(alpha: 0.6), size: 16),
              const SizedBox(width: 8),
              Text(_getProviderName(id), style: const TextStyle(color: AppColors.textPrimary, fontSize: 14)),
            ],
          ),
        );
      }).toList();
    }

    // 确保当前选中项在列表中
    if (!providerItems.any((item) => item.value == _selectedProviderId)) {
      providerItems.insert(0, DropdownMenuItem<String>(
        value: _selectedProviderId,
        child: Text(_getProviderName(), style: const TextStyle(color: AppColors.textPrimary, fontSize: 14)),
      ));
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Provider 选择器
          Row(
            children: [
              Icon(
                Icons.cloud_outlined,
                color: AppColors.textPrimary.withValues(alpha: 0.6),
                size: 18,
              ),
              const SizedBox(width: 8),
              const Text(
                'Provider',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 13,
                ),
              ),
              const Spacer(),
              // 连接状态指示器
              if (_testStatus == true)
                const Icon(Icons.check_circle, color: AppColors.green, size: 16)
              else if (_testStatus == false)
                const Icon(Icons.error, color: AppColors.error, size: 16)
              else if (hasKey)
                Icon(Icons.circle, color: AppColors.green.withValues(alpha: 0.5), size: 8),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: AppColors.bgElevated,
              borderRadius: AppRadius.mdAll,
              border: Border.all(color: AppColors.border),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _selectedProviderId,
                isExpanded: true,
                dropdownColor: AppColors.bgElevated,
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
                icon: const Icon(Icons.arrow_drop_down, color: AppColors.textTertiary),
                items: providerItems,
                onChanged: (value) {
                  if (value == null || value == _selectedProviderId) return;
                  // 切换 Provider 时更新 API Key 和 Base URL
                  final newHasKey = cache.apiKeys[value] ?? false;
                  setState(() {
                    _selectedProviderId = value;
                    _apiKeyController.text = newHasKey ? '••••••••' : '';
                    _apiKeyVisible = false;
                    _baseUrlController.text = _providerDefaultBaseUrls[value] ?? '';
                    _testStatus = null;
                    _hasUnsavedChanges = true;
                  });
                },
              ),
            ),
          ),
          const SizedBox(height: 16),

          // API Key 输入框
          Row(
            children: [
              Icon(
                Icons.key,
                color: AppColors.textPrimary.withValues(alpha: 0.6),
                size: 18,
              ),
              const SizedBox(width: 8),
              const Text(
                'API Key',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 13,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _apiKeyController,
                  onChanged: (value) => _hasUnsavedChanges = true,
                  obscureText: !_apiKeyVisible,
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
                  decoration: InputDecoration(
                    hintText: '输入 ${_getProviderName()} API Key',
                    hintStyle: const TextStyle(color: AppColors.textTertiary, fontSize: 14),
                    filled: true,
                    fillColor: AppColors.bgElevated,
                    border: OutlineInputBorder(
                      borderRadius: AppRadius.mdAll,
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: AppRadius.mdAll,
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: AppRadius.mdAll,
                      borderSide: BorderSide(color: AppColors.textPrimary.withValues(alpha: 0.5)),
                    ),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    suffixIcon: AnimatedSwitcher(
                      duration: AppAnimations.quick,
                      switchInCurve: Curves.easeOutCubic,
                      child: IconButton(
                        key: ValueKey(_apiKeyVisible),
                        icon: Icon(
                          _apiKeyVisible ? Icons.visibility_off : Icons.visibility,
                          color: AppColors.textTertiary,
                          size: 20,
                        ),
                        onPressed: () => setState(() => _apiKeyVisible = !_apiKeyVisible),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              // 测试连接按钮
              SizedBox(
                height: 44,
                child: AppAnimations.scaleTap(
                  onTap: () {
                    if (!_isTesting) _testProviderConnection();
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      color: AppColors.bgElevated,
                      borderRadius: AppRadius.mdAll,
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Center(
                      child: _isTesting
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppColors.textTertiary,
                              ),
                            )
                          : const Text(
                              '测试',
                              style: TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 13,
                              ),
                            ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            '留空则使用后端环境变量配置的默认 Key',
            style: TextStyle(color: AppColors.textTertiary, fontSize: 12),
          ),
          const SizedBox(height: 16),

          // Base URL 输入框
          Row(
            children: [
              Icon(
                Icons.link,
                color: AppColors.textPrimary.withValues(alpha: 0.6),
                size: 18,
              ),
              const SizedBox(width: 8),
              const Text(
                'Base URL',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 13,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _baseUrlController,
            onChanged: (value) => _hasUnsavedChanges = true,
            style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
            decoration: InputDecoration(
              hintText: _providerDefaultBaseUrls[_selectedProviderId] ?? 'https://api.example.com/v1',
              hintStyle: const TextStyle(color: AppColors.textTertiary, fontSize: 14),
              filled: true,
              fillColor: AppColors.bgElevated,
              border: OutlineInputBorder(
                borderRadius: AppRadius.mdAll,
                borderSide: const BorderSide(color: AppColors.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: AppRadius.mdAll,
                borderSide: const BorderSide(color: AppColors.border),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: AppRadius.mdAll,
                borderSide: BorderSide(color: AppColors.textPrimary.withValues(alpha: 0.5)),
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            '留空则使用默认地址',
            style: TextStyle(color: AppColors.textTertiary, fontSize: 12),
          ),
        ],
      ),
    );
  }

  /// 构建模型名称自由输入框（带 Autocomplete 建议）
  Widget _buildModelInput() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.smart_toy,
                color: AppColors.textPrimary.withValues(alpha: 0.6),
                size: 18,
              ),
              const SizedBox(width: 8),
              const Text(
                '模型名称',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 13,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          RawAutocomplete<String>(
            textEditingController: _modelInputController,
            focusNode: FocusNode(),
            optionsBuilder: (TextEditingValue textEditingValue) {
              final query = textEditingValue.text.toLowerCase();
              if (query.isEmpty) return _fallbackModelIds;
              return _fallbackModelIds.where(
                (option) => option.toLowerCase().contains(query),
              );
            },
            onSelected: (String selection) {
              setState(() {
                _selectedModel = selection;
                _hasUnsavedChanges = true;
              });
            },
            fieldViewBuilder: (context, controller, focusNode, onFieldSubmitted) {
              return TextField(
                controller: controller,
                focusNode: focusNode,
                onChanged: (value) {
                  _hasUnsavedChanges = true;
                },
                onSubmitted: (_) => onFieldSubmitted(),
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
                decoration: InputDecoration(
                  hintText: '输入模型名称，如 deepseek-v4-flash、gpt-4o',
                  hintStyle: const TextStyle(color: AppColors.textTertiary, fontSize: 14),
                  filled: true,
                  fillColor: AppColors.bgElevated,
                  border: OutlineInputBorder(
                    borderRadius: AppRadius.mdAll,
                    borderSide: const BorderSide(color: AppColors.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: AppRadius.mdAll,
                    borderSide: const BorderSide(color: AppColors.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: AppRadius.mdAll,
                    borderSide: BorderSide(color: AppColors.textPrimary.withValues(alpha: 0.5)),
                  ),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                ),
              );
            },
            optionsViewBuilder: (context, onSelected, options) {
              return Align(
                alignment: Alignment.topLeft,
                child: Material(
                  color: AppColors.bgElevated,
                  elevation: 4.0,
                  borderRadius: AppRadius.mdAll,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxHeight: 200),
                    child: ListView.builder(
                      padding: EdgeInsets.zero,
                      shrinkWrap: true,
                      itemCount: options.length,
                      itemBuilder: (context, index) {
                        final option = options.elementAt(index);
                        return ListTile(
                          dense: true,
                          title: Text(
                            option,
                            style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
                          ),
                          onTap: () => onSelected(option),
                        );
                      },
                    ),
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: 4),
          const Text(
            '直接输入任意模型名称，建议列表仅供参考',
            style: TextStyle(color: AppColors.textTertiary, fontSize: 12),
          ),
        ],
      ),
    );
  }

  /// 返回导航处理 — 有未保存变更时弹出确认对话框
  Future<void> _handleBackNavigation(BuildContext context) async {
    if (!_hasUnsavedChanges) {
      context.pop();
      return;
    }
    final shouldDiscard = await AppAnimations.showSpringDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.lgAll),
        title: const Text(
          '未保存的更改',
          style: TextStyle(color: AppColors.textPrimary),
        ),
        content: const Text(
          '你有未保存的更改，确定要离开吗？',
          style: TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('继续编辑'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('放弃更改', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (shouldDiscard == true && context.mounted) {
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(
        backgroundColor: AppColors.bgTertiary,
        elevation: 0,
        leading: widget.showBackButton
            ? IconButton(
                icon: const Icon(
                  Icons.arrow_back,
                  color: AppColors.textSecondary,
                ),
                onPressed: () => _handleBackNavigation(context),
              )
            : null,
        title: const Text(
          '设置',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          AppAnimations.scaleTap(
            onTap: _saveSettings,
            child: Container(
              margin: const EdgeInsets.only(right: 16),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.transparent,
                borderRadius: AppRadius.mdAll,
                border: Border.all(
                  color: AppColors.textPrimary.withValues(alpha: 0.3),
                ),
              ),
              child: const Text(
                '保存',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                ),
              ),
            ),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 640),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AppAnimations.staggerItem(
                  index: 0,
                  child: SettingsGroup(
                  title: 'API 配置',
                  children: [
                    _buildProviderConfigSection(),
                  ],
                ),
                ),
                AppAnimations.staggerItem(
                  index: 1,
                  child: SettingsGroup(
                  title: 'System Prompt',
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                Icons.chat_bubble_outline,
                                color: AppColors.textPrimary.withValues(alpha: 0.6),
                                size: 18,
                              ),
                              const SizedBox(width: 8),
                              const Text(
                                '系统指令',
                                style: TextStyle(
                                  color: AppColors.textSecondary,
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          TextField(
                            controller: _systemPromptController,
                            onChanged: (value) {
                              _hasUnsavedChanges = true;
                            },
                            maxLines: 5,
                            minLines: 3,
                            keyboardType: TextInputType.multiline,
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 14,
                            ),
                            decoration: InputDecoration(
                              hintText: '输入 System Prompt，将自动注入到每次对话中',
                              hintStyle: const TextStyle(
                                color: AppColors.textTertiary,
                                fontSize: 14,
                              ),
                              filled: true,
                              fillColor: AppColors.bgElevated,
                              border: OutlineInputBorder(
                                borderRadius: AppRadius.mdAll,
                                borderSide: const BorderSide(
                                  color: AppColors.border,
                                ),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: AppRadius.mdAll,
                                borderSide: const BorderSide(
                                  color: AppColors.border,
                                ),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: AppRadius.mdAll,
                                borderSide: BorderSide(
                                  color: AppColors.textPrimary.withValues(alpha: 0.5),
                                ),
                              ),
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 12,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                ),
                AppAnimations.staggerItem(
                  index: 2,
                  child: SettingsGroup(
                  title: '模型选择',
                  children: [
                    _buildModelInput(),
                  ],
                ),
                ),
                AppAnimations.staggerItem(
                  index: 3,
                  child: SettingsGroup(
                  title: '模型参数',
                  children: [
                    SettingsSlider(
                      label: 'Temperature',
                      value: _temperature,
                      min: 0.0,
                      max: 2.0,
                      divisions: 20,
                      onChanged: (v) => setState(() {
                        _temperature = v;
                        _hasUnsavedChanges = true;
                      }),
                    ),
                    const Divider(
                      height: 1,
                      color: AppColors.divider,
                      indent: 16,
                      endIndent: 16,
                    ),
                    SettingsSlider(
                      label: 'Max Tokens',
                      value: _maxTokens.toDouble(),
                      min: 256,
                      max: 384000,
                      divisions: 383,
                      suffix: ' tokens',
                      onChanged: (v) => setState(() {
                        _maxTokens = v.toInt();
                        _hasUnsavedChanges = true;
                      }),
                    ),
                  ],
                ),
                ),
                AppAnimations.staggerItem(
                  index: 4,
                  child: SettingsGroup(
                  title: '子代理',
                  children: [
                    SettingsToggle(
                      label: '会话记忆',
                      subtitle: '自动维护会话摘要笔记，保持长期上下文',
                      value: _sessionMemoryEnabled,
                      icon: Icons.sticky_note_2_outlined,
                      onChanged: (v) => setState(() {
                        _sessionMemoryEnabled = v;
                        _hasUnsavedChanges = true;
                      }),
                    ),
                    AnimatedSize(
                      duration: AppAnimations.page,
                      curve: AppAnimations.easeOutBack,
                      child: _sessionMemoryEnabled
                          ? Column(children: [
                              const Divider(
                                height: 1,
                                color: AppColors.divider,
                                indent: 32,
                                endIndent: 16,
                              ),
                              ParamGroupWidget(
                                paramKeys: const [
                                  'param_session_memory_min_messages',
                                  'param_session_memory_min_tokens_between_update',
                                  'param_session_memory_tool_calls_between_updates',
                                ],
                                paramDefs: _paramDefs,
                                controllers: _paramControllers,
                                onChanged: _onParamChanged,
                              ),
                            ])
                          : const SizedBox.shrink(),
                    ),
                    const Divider(
                      height: 1,
                      color: AppColors.divider,
                      indent: 16,
                      endIndent: 16,
                    ),
                    SettingsToggle(
                      label: '自动压缩',
                      subtitle: '对话过长时自动压缩历史消息',
                      value: _autoCompactEnabled,
                      icon: Icons.compress_outlined,
                      onChanged: (v) => setState(() {
                        _autoCompactEnabled = v;
                        _hasUnsavedChanges = true;
                      }),
                    ),
                    AnimatedSize(
                      duration: AppAnimations.page,
                      curve: AppAnimations.easeOutBack,
                      child: _autoCompactEnabled
                          ? Column(children: [
                              const Divider(
                                height: 1,
                                color: AppColors.divider,
                                indent: 32,
                                endIndent: 16,
                              ),
                              ParamGroupWidget(
                                paramKeys: const [
                                  'param_compact_trigger_tokens',
                                  'param_compact_recent_dialogue_tokens',
                                ],
                                paramDefs: _paramDefs,
                                controllers: _paramControllers,
                                onChanged: _onParamChanged,
                              ),
                            ])
                          : const SizedBox.shrink(),
                    ),
                    const Divider(
                      height: 1,
                      color: AppColors.divider,
                      indent: 16,
                      endIndent: 16,
                    ),
                    SettingsToggle(
                      label: '自动整固',
                      subtitle: '定期整合跨会话记忆，形成长期知识',
                      value: _autoDreamEnabled,
                      icon: Icons.auto_fix_high_outlined,
                      onChanged: (v) => setState(() {
                        _autoDreamEnabled = v;
                        _hasUnsavedChanges = true;
                      }),
                    ),
                    AnimatedSize(
                      duration: AppAnimations.page,
                      curve: AppAnimations.easeOutBack,
                      child: _autoDreamEnabled
                          ? Column(children: [
                              const Divider(
                                height: 1,
                                color: AppColors.divider,
                                indent: 32,
                                endIndent: 16,
                              ),
                              ParamGroupWidget(
                                paramKeys: const [
                                  'param_dream_min_hours',
                                  'param_dream_min_sessions',
                                ],
                                paramDefs: _paramDefs,
                                controllers: _paramControllers,
                                onChanged: _onParamChanged,
                              ),
                            ])
                          : const SizedBox.shrink(),
                    ),
                  ],
                ),
                ),
                AppAnimations.staggerItem(
                  index: 5,
                  child: SettingsGroup(
                  title: '思考模式',
                  children: [
                    SettingsToggle(
                      label: '启用思考模式',
                      subtitle: '模型先输出思维链再给出最终回答',
                      value: _thinkingEnabled,
                      icon: Icons.lightbulb_outline,
                      onChanged: (v) => setState(() {
                        _thinkingEnabled = v;
                        _hasUnsavedChanges = true;
                      }),
                    ),
                    const Divider(
                      height: 1,
                      color: AppColors.divider,
                      indent: 16,
                      endIndent: 16,
                    ),
                    ReasoningEffortSelectorWidget(
                      reasoningEffort: _reasoningEffort,
                      thinkingEnabled: _thinkingEnabled,
                      onChanged: (value) {
                        if (value != null) {
                          setState(() {
                            _reasoningEffort = value;
                            _hasUnsavedChanges = true;
                          });
                        }
                      },
                    ),
                  ],
                ),
                ),
                AppAnimations.staggerItem(
                  index: 6,
                  child: SettingsGroup(
                  title: '输出格式',
                  children: [
                    SettingsToggle(
                      label: 'JSON 输出模式',
                      subtitle: '强制模型输出合法 JSON 格式',
                      value: _jsonMode,
                      icon: Icons.code,
                      onChanged: (v) => setState(() {
                        _jsonMode = v;
                        _hasUnsavedChanges = true;
                      }),
                    ),
                  ],
                ),
                ),
                AppAnimations.staggerItem(
                  index: 7,
                  child: SettingsGroup(
                  title: '外观',
                  children: [
                    ListTile(
                      dense: true,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                      ),
                      leading: Icon(
                        Icons.dark_mode,
                        color: AppColors.textPrimary.withValues(alpha: 0.6),
                        size: 20,
                      ),
                      title: const Text(
                        '暗色模式',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 14,
                        ),
                      ),
                      subtitle: const Text(
                        '始终开启',
                        style: TextStyle(
                          color: AppColors.textTertiary,
                          fontSize: 12,
                        ),
                      ),
                      trailing: const Icon(
                        Icons.check_circle,
                        color: AppColors.green,
                        size: 20,
                      ),
                    ),
                  ],
                ),
                ),
                AppAnimations.staggerItem(
                  index: 8,
                  child: SettingsGroup(
                  title: '数据管理',
                  children: [
                    SettingsActionButton(
                      label: '导出所有数据',
                      icon: Icons.download,
                      onTap: () => exportData(),
                    ),
                    SettingsActionButton(
                      label: '导入数据',
                      icon: Icons.upload,
                      onTap: () => importData(),
                    ),
                    SettingsActionButton(
                      label: '清空所有对话',
                      icon: Icons.delete_sweep,
                      isDanger: true,
                      onTap: () => confirmAndClear(
                        '清空所有对话',
                        '此操作将删除所有会话和消息，不可恢复。确认继续？',
                        () => clearAllConversations(),
                      ),
                    ),
                    SettingsActionButton(
                      label: '清空记忆',
                      icon: Icons.psychology_alt,
                      isDanger: true,
                      onTap: () => confirmAndClear(
                        '清空记忆',
                        '此操作将删除所有记忆数据，不可恢复。确认继续？',
                        () => clearAllMemories(),
                      ),
                    ),
                  ],
                ),
                ),
                AppAnimations.staggerItem(
                  index: 9,
                  child: SettingsGroup(
                  title: '关于',
                  children: [
                    ListTile(
                      dense: true,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                      ),
                      leading: Icon(
                        Icons.info_outline,
                        color: AppColors.textPrimary.withValues(alpha: 0.6),
                        size: 20,
                      ),
                      title: const Text(
                        '版本',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 14,
                        ),
                      ),
                      trailing: const Text(
                        'v1.0.0',
                        style: TextStyle(
                          color: AppColors.textTertiary,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ],
                ),
                ),
                const SizedBox(height: 32),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
