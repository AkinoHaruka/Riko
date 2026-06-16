/// Token 使用统计模型
///
/// 记录单次 AI 请求的 Token 消耗，包含 prompt/completion 计数
/// 及 DeepSeek 特有的缓存命中统计，用于用量监控和成本估算。
library;

/// Token 使用统计，包含 prompt/completion 及缓存命中信息
class TokenUsage {
  /// 输入 Token 数（含缓存命中和未命中）
  final int promptTokens;

  /// 输出 Token 数
  final int completionTokens;

  /// 缓存命中的 prompt Token 数（命中部分费用更低）
  final int promptCacheHitTokens;

  /// 缓存未命中的 prompt Token 数
  final int promptCacheMissTokens;

  const TokenUsage({
    this.promptTokens = 0,
    this.completionTokens = 0,
    this.promptCacheHitTokens = 0,
    this.promptCacheMissTokens = 0,
  });

  /// 从后端 JSON 反序列化
  factory TokenUsage.fromJson(Map<String, dynamic> json) => TokenUsage(
    promptTokens: json['prompt_tokens'] as int? ?? 0,
    completionTokens: json['completion_tokens'] as int? ?? 0,
    promptCacheHitTokens: json['prompt_cache_hit_tokens'] as int? ?? 0,
    promptCacheMissTokens: json['prompt_cache_miss_tokens'] as int? ?? 0,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TokenUsage &&
          runtimeType == other.runtimeType &&
          promptTokens == other.promptTokens &&
          completionTokens == other.completionTokens &&
          promptCacheHitTokens == other.promptCacheHitTokens &&
          promptCacheMissTokens == other.promptCacheMissTokens;

  @override
  int get hashCode => Object.hash(
        promptTokens,
        completionTokens,
        promptCacheHitTokens,
        promptCacheMissTokens,
      );
}
