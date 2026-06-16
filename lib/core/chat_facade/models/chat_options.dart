import 'package:flutter/foundation.dart';

/// AI 聊天请求选项 — 从 SettingsCache 解耦后的纯数据对象
///
/// 由 [ChatFacade] 从当前设置组装，传递给 [StreamingService]。
/// 不依赖任何 Provider，可在 Service 层自由传递和测试。
@immutable
class ChatOptions {
  /// 模型 ID
  final String modelId;

  /// 思考类型（如 'deepseek' / 'openai'）
  final String thinkingType;

  /// 推理努力程度（如 'low' / 'medium' / 'high'）
  final String reasoningEffort;

  /// 温度参数
  final double temperature;

  /// 最大 token 数
  final int maxTokens;

  /// 是否启用 JSON 模式
  final bool jsonMode;

  /// 会话 ID（用于后端路由）
  final String conversationId;

  const ChatOptions({
    required this.modelId,
    required this.thinkingType,
    this.reasoningEffort = '',
    required this.temperature,
    required this.maxTokens,
    required this.jsonMode,
    required this.conversationId,
  });

  /// 转换为适配器所需的 Map 格式
  Map<String, dynamic> toAdapterOptions() {
    final options = <String, dynamic>{
      'model': modelId,
      'thinking_type': thinkingType,
      'temperature': temperature,
      'maxTokens': maxTokens,
      'json_mode': jsonMode,
      'conversation_id': conversationId,
    };
    if (reasoningEffort.isNotEmpty) {
      options['reasoning_effort'] = reasoningEffort;
    }
    return options;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ChatOptions &&
          modelId == other.modelId &&
          thinkingType == other.thinkingType &&
          reasoningEffort == other.reasoningEffort &&
          temperature == other.temperature &&
          maxTokens == other.maxTokens &&
          jsonMode == other.jsonMode &&
          conversationId == other.conversationId;

  @override
  int get hashCode => Object.hash(
        modelId,
        thinkingType,
        reasoningEffort,
        temperature,
        maxTokens,
        jsonMode,
        conversationId,
      );
}
