/// 设置页参数组件 — 模型选择、思考强度选择、参数输入字段和参数组
///
/// ModelSelectorWidget：模型下拉选择框。
/// ReasoningEffortSelectorWidget：思考强度（高/最高）下拉选择框。
/// ParamFieldWidget：单个参数输入字段，带范围校验。
/// ParamGroupWidget：一组参数字段的容器，带分隔线。
library;

import 'package:flutter/material.dart';
import '../../../core/theme/app_animations.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_radius.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import 'settings_import_dialog.dart';

/// 模型选择下拉框
class ModelSelectorWidget extends StatelessWidget {
  final String selectedModel;
  final List<Map<String, String>> availableModels;
  final ValueChanged<String?> onChanged;

  const ModelSelectorWidget({
    super.key,
    required this.selectedModel,
    required this.availableModels,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
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
              AppSpacing.hSM,
              const Text(
                '模型',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 13,
                ),
              ),
            ],
          ),
          AppSpacing.vSM,
          Container(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.mdSm),
            decoration: BoxDecoration(
              color: AppColors.bgElevated,
              borderRadius: AppRadius.mdAll,
              border: Border.all(color: AppColors.border),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: selectedModel,
                isExpanded: true,
                dropdownColor: AppColors.bgElevated,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: AppTypography.body,
                ),
                icon: const Icon(
                  Icons.arrow_drop_down,
                  color: AppColors.textTertiary,
                ),
                items: availableModels.map((model) {
                  return DropdownMenuItem<String>(
                    value: model['id'],
                    child: Text(model['name']!),
                  );
                }).toList(),
                onChanged: onChanged,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 思考强度选择下拉框
class ReasoningEffortSelectorWidget extends StatelessWidget {
  final String reasoningEffort;
  final bool thinkingEnabled;
  final ValueChanged<String?> onChanged;

  static const List<Map<String, String>> _reasoningEfforts = [
    {'value': 'high', 'label': '高'},
    {'value': 'max', 'label': '最高'},
  ];

  const ReasoningEffortSelectorWidget({
    super.key,
    required this.reasoningEffort,
    required this.thinkingEnabled,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.psychology,
                color: AppColors.textPrimary.withValues(alpha: 0.6),
                size: 18,
              ),
              AppSpacing.hSM,
              const Text(
                '思考强度',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 13,
                ),
              ),
            ],
          ),
          AppSpacing.vSM,
          TweenAnimationBuilder<double>(
            tween: Tween(end: thinkingEnabled ? 1.0 : 0.5),
            duration: AppAnimations.quick,
            curve: AppAnimations.easeOutBack,
            builder: (context, opacity, child) => Opacity(
              opacity: opacity.clamp(0.0, 1.0),
              child: child,
            ),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.mdSm),
              decoration: BoxDecoration(
                color: AppColors.bgElevated,
                borderRadius: AppRadius.mdAll,
                border: Border.all(color: AppColors.border),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: reasoningEffort,
                  isExpanded: true,
                  dropdownColor: AppColors.bgElevated,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: AppTypography.body,
                  ),
                  icon: const Icon(
                    Icons.arrow_drop_down,
                    color: AppColors.textTertiary,
                  ),
                  items: _reasoningEfforts.map((effort) {
                    return DropdownMenuItem<String>(
                      value: effort['value'],
                      child: Text(effort['label']!),
                    );
                  }).toList(),
                  onChanged: thinkingEnabled ? onChanged : null,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 参数输入字段
class ParamFieldWidget extends StatelessWidget {
  final String label;
  final String paramKey;
  final int defaultValue;
  final int min;
  final int max;
  final TextEditingController? controller;
  final ValueChanged<int?> onChanged;

  const ParamFieldWidget({
    super.key,
    required this.label,
    required this.paramKey,
    required this.defaultValue,
    required this.min,
    required this.max,
    required this.controller,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 13,
              ),
            ),
          ),
          AppSpacing.hMDSm,
          SizedBox(
            width: 120,
            height: 36,
            child: TextField(
              controller: controller,
              keyboardType: TextInputType.number,
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 13,
              ),
              decoration: InputDecoration(
                hintText: defaultValue.toString(),
                hintStyle: const TextStyle(
                  color: AppColors.textTertiary,
                  fontSize: 13,
                ),
                filled: true,
                fillColor: AppColors.bgElevated,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 8,
                ),
                border: OutlineInputBorder(
                  borderRadius: AppRadius.smAll,
                  borderSide: const BorderSide(color: AppColors.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: AppRadius.smAll,
                  borderSide: const BorderSide(color: AppColors.border),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: AppRadius.smAll,
                  borderSide: BorderSide(
                    color: AppColors.textPrimary.withValues(alpha: 0.5),
                  ),
                ),
                errorBorder: OutlineInputBorder(
                  borderRadius: AppRadius.smAll,
                  borderSide: const BorderSide(color: AppColors.error),
                ),
                focusedErrorBorder: OutlineInputBorder(
                  borderRadius: AppRadius.smAll,
                  borderSide: const BorderSide(color: AppColors.error),
                ),
              ),
              onChanged: (value) {
                final parsed = int.tryParse(value.trim());
                onChanged(parsed?.clamp(min, max));
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// 参数组 — 展示一组参数输入字段
class ParamGroupWidget extends StatelessWidget {
  final List<String> paramKeys;
  final Map<String, ParamDef> paramDefs;
  final Map<String, TextEditingController> controllers;
  final void Function(String key, int? value) onChanged;

  const ParamGroupWidget({
    super.key,
    required this.paramKeys,
    required this.paramDefs,
    required this.controllers,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (int i = 0; i < paramKeys.length; i++) ...[
          if (i > 0)
            const Divider(
              height: 1,
              color: AppColors.divider,
              indent: 32,
              endIndent: 16,
            ),
          Builder(
            builder: (context) {
              final key = paramKeys[i];
              final def = paramDefs[key]!;
              return ParamFieldWidget(
                label: def.label,
                paramKey: key,
                defaultValue: def.defaultValue,
                min: def.min,
                max: def.max,
                controller: controllers[key],
                onChanged: (value) => onChanged(key, value),
              );
            },
          ),
        ],
      ],
    );
  }
}
