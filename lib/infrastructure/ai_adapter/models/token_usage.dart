/// Token 使用统计，包含 prompt/completion 及缓存命中信息
class TokenUsage {
  final int promptTokens;
  final int completionTokens;
  final int promptCacheHitTokens;
  final int promptCacheMissTokens;

  const TokenUsage({
    this.promptTokens = 0,
    this.completionTokens = 0,
    this.promptCacheHitTokens = 0,
    this.promptCacheMissTokens = 0,
  });

  factory TokenUsage.fromJson(Map<String, dynamic> json) => TokenUsage(
    promptTokens: json['prompt_tokens'] as int? ?? 0,
    completionTokens: json['completion_tokens'] as int? ?? 0,
    promptCacheHitTokens: json['prompt_cache_hit_tokens'] as int? ?? 0,
    promptCacheMissTokens: json['prompt_cache_miss_tokens'] as int? ?? 0,
  );
}
