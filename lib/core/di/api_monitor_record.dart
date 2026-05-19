import '../../infrastructure/ai_adapter/ai_adapter.dart';
import 'internal_event.dart';

/// 监控面板的 API 调用记录模型
///
/// 记录每次 AI 请求的输入(requestJson)与输出(responseRawText)、
/// 错误分类信息及内部事件（工具调用、压缩等），用于调试面板展示。
class ApiMonitorRecord {
  final String? id;
  final String? conversationId;
  final String requestJson;
  final String responseRawText;
  final DateTime createdAt;
  final bool isComplete;
  final TokenUsage? tokenUsage;
  final String? errorCategory;
  final String? errorCode;
  final String? errorMessage;
  final String? errorSuggestion;
  final List<InternalEvent> internalEvents;

  const ApiMonitorRecord({
    this.id,
    this.conversationId,
    required this.requestJson,
    this.responseRawText = '',
    required this.createdAt,
    this.isComplete = false,
    this.tokenUsage,
    this.errorCategory,
    this.errorCode,
    this.errorMessage,
    this.errorSuggestion,
    this.internalEvents = const [],
  });

  ApiMonitorRecord copyWith({
    String? id,
    String? conversationId,
    String? requestJson,
    String? responseRawText,
    DateTime? createdAt,
    bool? isComplete,
    TokenUsage? tokenUsage,
    String? errorCategory,
    String? errorCode,
    String? errorMessage,
    String? errorSuggestion,
    List<InternalEvent>? internalEvents,
  }) {
    return ApiMonitorRecord(
      id: id ?? this.id,
      conversationId: conversationId ?? this.conversationId,
      requestJson: requestJson ?? this.requestJson,
      responseRawText: responseRawText ?? this.responseRawText,
      createdAt: createdAt ?? this.createdAt,
      isComplete: isComplete ?? this.isComplete,
      tokenUsage: tokenUsage ?? this.tokenUsage,
      errorCategory: errorCategory ?? this.errorCategory,
      errorCode: errorCode ?? this.errorCode,
      errorMessage: errorMessage ?? this.errorMessage,
      errorSuggestion: errorSuggestion ?? this.errorSuggestion,
      internalEvents: internalEvents ?? this.internalEvents,
    );
  }

  factory ApiMonitorRecord.fromJson(Map<String, dynamic> json) {
    TokenUsage? usage;
    final promptTokens = json['prompt_tokens'] as int?;
    final completionTokens = json['completion_tokens'] as int?;
    final totalTokens = json['total_tokens'] as int?;
    if (promptTokens != null || completionTokens != null || totalTokens != null) {
      usage = TokenUsage(
        promptTokens: promptTokens ?? 0,
        completionTokens: completionTokens ?? 0,
        promptCacheHitTokens: 0,
        promptCacheMissTokens: 0,
      );
    }
    final isComplete = json['is_complete'];
    return ApiMonitorRecord(
      id: json['id'] as String?,
      conversationId: json['conversation_id'] as String?,
      requestJson: (json['request_json'] as String?) ?? '',
      responseRawText: (json['response_raw_text'] as String?) ?? '',
      createdAt: DateTime.parse(json['created_at'] as String),
      isComplete: isComplete == 1 || isComplete == true,
      tokenUsage: usage,
      errorCategory: json['error_category'] as String?,
      errorCode: json['error_code'] as String?,
      errorMessage: json['error_message'] as String?,
      errorSuggestion: json['error_suggestion'] as String?,
      internalEvents: InternalEvent.decodeList(json['internal_events'] as String?),
    );
  }
}
