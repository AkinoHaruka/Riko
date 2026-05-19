import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/di/chat_provider.dart';
import '../core/di/providers.dart';
import '../core/di/settings_cache.dart';
import '../core/di/toast_provider.dart';
import '../core/theme/app_animations.dart';
import '../core/theme/app_colors.dart';
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
  bool _isDarkMode = true;
  bool _sessionMemoryEnabled = true;
  bool _autoCompactEnabled = true;
  bool _autoDreamEnabled = true;
  String _deepseekKey = '';
  bool _isKeyVisible = false;

  late final TextEditingController _deepseekKeyController;
  late final TextEditingController _systemPromptController;

  Map<String, int> _paramValues = {};
  final Map<String, TextEditingController> _paramControllers = {};

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

  List<Map<String, String>> _availableModels = [];

  static const List<Map<String, String>> _fallbackModels = [
    {'id': 'deepseek-v4-flash', 'name': 'DeepSeek V4 Flash'},
    {'id': 'deepseek-v4-pro', 'name': 'DeepSeek V4 Pro'},
  ];

  @override
  void initState() {
    super.initState();
    _deepseekKeyController = TextEditingController();
    _systemPromptController = TextEditingController();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadSettings());
  }

  @override
  void dispose() {
    _deepseekKeyController.dispose();
    _systemPromptController.dispose();
    for (final controller in _paramControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  void _loadSettings() {
    final cache = ref.read(settingsCacheProvider);
    final models = cache.models.isNotEmpty
        ? cache.models
        : List<Map<String, String>>.from(_fallbackModels);

    _paramValues = {};
    for (final entry in _paramDefs.entries) {
      final value = cache.params[entry.key] ?? entry.value.defaultValue;
      _paramValues[entry.key] = value;
      _paramControllers[entry.key]?.dispose();
      _paramControllers[entry.key] = TextEditingController(
        text: value.toString(),
      );
    }

    setState(() {
      _availableModels = models;
      _selectedModel = cache.selectedModel;
      if (!_availableModels.any((m) => m['id'] == _selectedModel)) {
        _selectedModel = _availableModels.isNotEmpty
            ? _availableModels.first['id']!
            : 'deepseek-v4-flash';
      }
      _temperature = cache.temperature;
      _maxTokens = cache.maxTokens;
      _thinkingEnabled = cache.thinkingType != 'disabled';
      _reasoningEffort = cache.reasoningEffort;
      _jsonMode = cache.jsonMode;
      _isDarkMode = cache.darkMode;
      _deepseekKey = cache.apiKey;
      _deepseekKeyController.text = cache.apiKey;
      _deepseekKeyController.selection = TextSelection.collapsed(
        offset: cache.apiKey.length,
      );
      _systemPromptController.text = cache.systemPrompt;
      _sessionMemoryEnabled = cache.sessionMemoryEnabled;
      _autoCompactEnabled = cache.autoCompactEnabled;
      _autoDreamEnabled = cache.autoDreamEnabled;
    });
  }

  Future<void> _saveSettings() async {
    _deepseekKey = _deepseekKeyController.text.trim();

    final cache = ref.read(settingsCacheProvider.notifier);
    cache.updateBasicSettings(
      selectedModel: _selectedModel,
      temperature: _temperature,
      maxTokens: _maxTokens,
      thinkingType: _thinkingEnabled ? 'enabled' : 'disabled',
      reasoningEffort: _reasoningEffort,
      jsonMode: _jsonMode,
      darkMode: _isDarkMode,
    );
    cache.updateApiKey(_deepseekKey);
    cache.updateSystemPrompt(_systemPromptController.text.trim());
    cache.updateFeatures(
      sessionMemory: _sessionMemoryEnabled,
      autoCompact: _autoCompactEnabled,
      autoDream: _autoDreamEnabled,
    );

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
    cache.updateParams(newParams);

    ref.read(selectedModelProvider.notifier).state = _selectedModel;

    final List<String> errors = [];
    final settingsRepo = ref.read(settingsRepositoryProvider);
    final apiClient = ref.read(apiClientProvider);

    try {
      await settingsRepo.batchSet({
        'selected_model': _selectedModel,
        'temperature': _temperature.toString(),
        'max_tokens': _maxTokens.toString(),
        'thinking_type': _thinkingEnabled ? 'enabled' : 'disabled',
        'reasoning_effort': _reasoningEffort,
        'json_mode': _jsonMode.toString(),
        'dark_mode': _isDarkMode.toString(),
        'system_prompt': _systemPromptController.text.trim(),
      });
    } catch (e) {
      errors.add('本地设置保存失败: ${formatSettingsError(e)}');
    }

    try {
      await apiClient.post('/settings/apikey', data: {'api_key': _deepseekKey});
    } catch (e) {
      errors.add('API Key 保存失败: ${formatSettingsError(e)}');
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

    try {
      if (paramsToSave.isNotEmpty) {
        await apiClient.put('/settings/params', data: {'params': paramsToSave});
      }
    } catch (e) {
      errors.add('触发参数保存失败: ${formatSettingsError(e)}');
    }

    if (!mounted) return;

    if (errors.isEmpty) {
      ref.read(toastProvider.notifier).show('设置已保存');
    } else {
      ref.read(toastProvider.notifier).show(errors.join('\n'));
    }
  }

  void _onParamChanged(String key, int? value) {
    if (value != null) {
      _paramValues[key] = value;
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
                icon: const Icon(Icons.arrow_back, color: AppColors.textSecondary),
                onPressed: () => context.pop(),
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
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: const Color(0xFFd5d5d5).withValues(alpha: 0.3),
                ),
              ),
              child: const Text(
                '保存',
                style: TextStyle(
                  color: Color(0xFFd5d5d5),
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                ),
              ),
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SettingsGroup(
              title: 'API 配置',
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
                            Icons.key,
                            color: const Color(0xFFd5d5d5).withValues(
                              alpha: 0.6,
                            ),
                            size: 18,
                          ),
                          const SizedBox(width: 8),
                          const Text(
                            'DeepSeek API Key',
                            style: TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _deepseekKeyController,
                        onChanged: (value) => _deepseekKey = value,
                        obscureText: !_isKeyVisible,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 14,
                        ),
                        decoration: InputDecoration(
                          hintText: '输入 DeepSeek API Key',
                          hintStyle: const TextStyle(
                            color: AppColors.textTertiary,
                            fontSize: 14,
                          ),
                          filled: true,
                          fillColor: AppColors.bgElevated,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: const BorderSide(
                              color: AppColors.border,
                            ),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: const BorderSide(
                              color: AppColors.border,
                            ),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: BorderSide(
                              color: const Color(0xFFd5d5d5).withValues(
                                alpha: 0.5,
                              ),
                            ),
                          ),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 12,
                          ),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _isKeyVisible
                                  ? Icons.visibility_off
                                  : Icons.visibility,
                              color: AppColors.textTertiary,
                              size: 20,
                            ),
                            onPressed: () {
                              setState(() => _isKeyVisible = !_isKeyVisible);
                            },
                          ),
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        '留空则使用后端配置的默认 Key',
                        style: TextStyle(
                          color: AppColors.textTertiary,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            SettingsGroup(
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
                            color: const Color(0xFFd5d5d5).withValues(
                              alpha: 0.6,
                            ),
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
                            borderRadius: BorderRadius.circular(10),
                            borderSide: const BorderSide(
                              color: AppColors.border,
                            ),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: const BorderSide(
                              color: AppColors.border,
                            ),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: BorderSide(
                              color: const Color(0xFFd5d5d5).withValues(
                                alpha: 0.5,
                              ),
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
            SettingsGroup(
              title: '模型选择',
              children: [
                ModelSelectorWidget(
                  selectedModel: _selectedModel,
                  availableModels: _availableModels,
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => _selectedModel = value);
                    }
                  },
                ),
              ],
            ),
            SettingsGroup(
              title: '模型参数',
              children: [
                SettingsSlider(
                  label: 'Temperature',
                  value: _temperature,
                  min: 0.0,
                  max: 2.0,
                  divisions: 20,
                  onChanged: (v) => setState(() => _temperature = v),
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
                  onChanged: (v) => setState(() => _maxTokens = v.toInt()),
                ),
              ],
            ),
            SettingsGroup(
              title: '子代理',
              children: [
                SettingsToggle(
                  label: '会话记忆',
                  subtitle: '自动维护会话摘要笔记，保持长期上下文',
                  value: _sessionMemoryEnabled,
                  icon: Icons.sticky_note_2_outlined,
                  onChanged: (v) =>
                      setState(() => _sessionMemoryEnabled = v),
                ),
                if (_sessionMemoryEnabled) ...[
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
                ],
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
                  onChanged: (v) =>
                      setState(() => _autoCompactEnabled = v),
                ),
                if (_autoCompactEnabled) ...[
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
                ],
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
                  onChanged: (v) =>
                      setState(() => _autoDreamEnabled = v),
                ),
                if (_autoDreamEnabled) ...[
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
                ],
              ],
            ),
            SettingsGroup(
              title: '思考模式',
              children: [
                SettingsToggle(
                  label: '启用思考模式',
                  subtitle: '模型先输出思维链再给出最终回答',
                  value: _thinkingEnabled,
                  icon: Icons.lightbulb_outline,
                  onChanged: (v) => setState(() => _thinkingEnabled = v),
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
                      setState(() => _reasoningEffort = value);
                    }
                  },
                ),
              ],
            ),
            SettingsGroup(
              title: '输出格式',
              children: [
                SettingsToggle(
                  label: 'JSON 输出模式',
                  subtitle: '强制模型输出合法 JSON 格式',
                  value: _jsonMode,
                  icon: Icons.code,
                  onChanged: (v) => setState(() => _jsonMode = v),
                ),
              ],
            ),
            SettingsGroup(
              title: '外观',
              children: [
                SettingsToggle(
                  label: '暗色模式',
                  subtitle: '使用深色主题',
                  value: _isDarkMode,
                  icon: Icons.dark_mode,
                  onChanged: (v) => setState(() => _isDarkMode = v),
                ),
              ],
            ),
            SettingsGroup(
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
            SettingsGroup(
              title: '关于',
              children: [
                ListTile(
                  dense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                  leading: Icon(
                    Icons.info_outline,
                    color: const Color(0xFFd5d5d5).withValues(alpha: 0.6),
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
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}
