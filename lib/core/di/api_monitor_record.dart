import '../../core/utils/collection_utils.dart';
import '../../infrastructure/ai_adapter/ai_adapter.dart';
import 'internal_event.dart';

/// 监控面板的 API 调用记录模型
///
/// 记录每次 AI 请求的输入(requestJson)与输出(responseRawText)、
/// 错误分类信息及内部事件（工具调用、压缩等），用于调试面板展示。
///
/// 每条记录对应一次 /chat/completions 请求，在流式响应过程中逐步更新，
/// 流结束后标记 [isComplete] = true 并写入最终 token 用量。
class ApiMonitorRecord {
  /// 数据库主键（后端生成）
  final String? id;

  /// 所属会话 ID
  final String? conversationId;

  /// 发送给 AI 的完整请求 JSON（含上下文消息）
  final String requestJson;

  /// AI 返回的原始响应文本（含 [Reasoning] / [Response] 分段标记）
  final String responseRawText;

  /// 记录创建时间
  final DateTime createdAt;

  /// 流式响应是否已完成
  final bool isComplete;

  /// 本次请求的 token 用量（流结束后由 API 返回）
  final TokenUsage? tokenUsage;

  /// 错误分类（如 network、rate_limit、unknown 等）
  final String? errorCategory;

  /// 错误代码（来自 API 响应）
  final String? errorCode;

  /// 错误消息
  final String? errorMessage;

  /// 错误修复建议
  final String? errorSuggestion;

  /// 运行时内部事件列表（工具调用、压缩、会话笔记初始化等）
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

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ApiMonitorRecord &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          conversationId == other.conversationId &&
          requestJson == other.requestJson &&
          responseRawText == other.responseRawText &&
          createdAt == other.createdAt &&
          isComplete == other.isComplete &&
          tokenUsage == other.tokenUsage &&
          errorCategory == other.errorCategory &&
          errorCode == other.errorCode &&
          errorMessage == other.errorMessage &&
          errorSuggestion == other.errorSuggestion &&
          listEquals(internalEvents, other.internalEvents);

  @override
  int get hashCode => Object.hash(
    id,
    conversationId,
    requestJson,
    responseRawText,
    createdAt,
    isComplete,
    tokenUsage,
    errorCategory,
    errorCode,
    errorMessage,
    errorSuggestion,
    Object.hashAll(internalEvents),
  );

  ApiMonitorRecord copyWith({
    String? id,
    String? conversationId,
    String? requestJson,
    String? responseRawText,
    DateTime? createdAt,
    bool? isComplete,
    TokenUsage? tokenUsage,
    String? errorCategory,
    bool clearErrorCategory = false,
    String? errorCode,
    bool clearErrorCode = false,
    String? errorMessage,
    bool clearErrorMessage = false,
    String? errorSuggestion,
    bool clearErrorSuggestion = false,
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
      errorCategory: clearErrorCategory
          ? null
          : (errorCategory ?? this.errorCategory),
      errorCode: clearErrorCode ? null : (errorCode ?? this.errorCode),
      errorMessage: clearErrorMessage
          ? null
          : (errorMessage ?? this.errorMessage),
      errorSuggestion: clearErrorSuggestion
          ? null
          : (errorSuggestion ?? this.errorSuggestion),
      internalEvents: internalEvents ?? this.internalEvents,
    );
  }

  /// 从后端 JSON 构造实例
  ///
  /// [isComplete] 兼容 int(0/1) 和 bool 两种格式；
  /// [internalEvents] 从 JSON 字符串解码为 [InternalEvent] 列表。
  factory ApiMonitorRecord.fromJson(Map<String, dynamic> json) {
    TokenUsage? usage;
    final promptTokens = json['prompt_tokens'] as int?;
    final completionTokens = json['completion_tokens'] as int?;
    final totalTokens = json['total_tokens'] as int?;
    if (promptTokens != null ||
        completionTokens != null ||
        totalTokens != null) {
      usage = TokenUsage(
        promptTokens: promptTokens ?? 0,
        completionTokens: completionTokens ?? 0,
        promptCacheHitTokens: json['prompt_cache_hit_tokens'] as int? ?? 0,
        promptCacheMissTokens: json['prompt_cache_miss_tokens'] as int? ?? 0,
      );
    }
    // 后端可能返回 int(0/1) 或 bool，需兼容处理
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
      internalEvents: InternalEvent.decodeList(
        json['internal_events'] as String?,
      ),
    );
  }
}
