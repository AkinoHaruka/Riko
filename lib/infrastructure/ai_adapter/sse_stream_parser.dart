/// SSE 流解析器模块
///
/// 将后端推送的字节流解析为结构化的 [StreamChunk] 序列。
/// 是 AI 对话流式响应的核心解析层，连接 Dio 响应流与上层 ChatNotifier。
///
/// 支持两种 SSE 数据格式：
/// 1. **OpenAI/DeepSeek 原始格式**：choices[0].delta.content / reasoning_content / usage
/// 2. **Python 后端简化格式**：通过 type 字段区分 content / reasoning_content / finish / usage / error / tool_call / compact 等
///
/// 协议细节：
/// - SSE 规范：每条数据以 "data: " 前缀开头，以空行分隔
/// - 流结束标记：data: [DONE]
/// - 心跳保活：": keep-alive" 注释行（DeepSeek 限速期间持续发送）
/// - 编码处理：手动逐块 UTF-8 解码，兼容 Flutter Web 端（避免 Utf8Decoder 作为 StreamTransformer 的类型问题）
library;

import 'dart:async';
import 'dart:convert';

import 'ai_adapter.dart';

/// 将字节流解析为 SSE 数据块，支持 DeepSeek API 的扩展字段以及 Python 后端简化 SSE 格式
///
/// 特性：
/// - 过滤 `: keep-alive` 注释行（限速等待期间服务器持续发送）
/// - 解析 `reasoning_content` 思维链内容
/// - 解析 `usage` 字段（缓存命中统计）
/// - 解析 `finish_reason` 标记
/// - 兼容 Flutter Web 端（避免 Utf8Decoder 作为 StreamTransformer 的类型问题）
/// - 自动检测并兼容 Python 后端简化格式（含 type 字段）与原始 OpenAI 格式
Stream<StreamChunk> parseSseStream(
  Stream<List<int>> byteStream, {
  void Function(String rawLine)? onRawSseLine,
}) async* {
  // 手动逐块解码字节流，避免 Utf8Decoder 在 Web 端作为 StreamTransformer 的类型兼容问题
  String buffer = '';

  await for (final chunk in byteStream) {
    buffer += utf8.decode(chunk, allowMalformed: true);

    // 按换行符分割处理完整行
    while (buffer.contains('\n')) {
      final newlineIndex = buffer.indexOf('\n');
      final line = buffer.substring(0, newlineIndex);
      buffer = buffer.substring(newlineIndex + 1);

      // 先调用原始文本回调（输出未经解析的原始 SSE 行）
      if (onRawSseLine != null) {
        onRawSseLine(line);
      }

      yield* _parseLine(line);
    }
  }

  // 处理缓冲区中剩余的不完整行（服务器未以换行符结尾的情况）
  if (buffer.trim().isNotEmpty) {
    if (onRawSseLine != null) {
      onRawSseLine(buffer);
    }
    yield* _parseLine(buffer);
  }
}

/// 解析单行 SSE 数据，自动根据 JSON 结构分发到对应解析器
Stream<StreamChunk> _parseLine(String line) {
  final trimmed = line.trim();

  if (trimmed.isEmpty) {
    return const Stream<StreamChunk>.empty();
  }

  // [DONE] 是 SSE 流的结束标记
  if (trimmed == '[DONE]') {
    return Stream.value(const StreamChunk(isFinished: true));
  }

  // 过滤 SSE keep-alive 注释行（DeepSeek 限速期间发送 `: keep-alive`）
  if (trimmed.startsWith(':')) {
    return const Stream<StreamChunk>.empty();
  }

  // 非 data: 前缀的行不符合 SSE 规范，直接忽略
  if (!trimmed.startsWith('data:')) {
    return const Stream<StreamChunk>.empty();
  }

  // 提取 "data:" 后的内容
  final dataContent = trimmed.substring(5).trim();
  if (dataContent.isEmpty) {
    return const Stream<StreamChunk>.empty();
  }

  try {
    final json = jsonDecode(dataContent) as Map<String, dynamic>;

    // 若 JSON 中存在 type 字段，则使用 Python 后端简化格式解析
    if (json.containsKey('type')) {
      return _parseSimplifiedFormat(json);
    }

    // 否则使用原始 OpenAI 格式解析
    return _parseOpenAIFormat(json);
  } on FormatException {
    // JSON 解析失败时，返回原始数据作为 content（可能是非标准 SSE 输出）
    return Stream.value(StreamChunk(content: dataContent));
  }
}

/// 解析 Python 后端简化 SSE 格式
///
/// 支持的 type：
/// - content: 普通文本内容
/// - reasoning_content: 思维链内容
/// - finish: 流结束标记，携带 finish_reason
/// - usage: Token 使用统计
/// - error: 错误信息
/// - tool_call: 工具调用信息
/// - compact: 上下文压缩信息
/// - session_notes_init: 会话笔记初始化
/// - full_request: 完整请求 JSON（调试用）
/// - connected: 连接确认
Stream<StreamChunk> _parseSimplifiedFormat(Map<String, dynamic> json) {
  final type = json['type'] as String?;

  switch (type) {
    case 'content':
      final content = json['content'] as String? ?? '';
      return Stream.value(StreamChunk(content: content));

    case 'reasoning_content':
      final reasoningContent = json['content'] as String? ?? '';
      return Stream.value(StreamChunk(reasoningContent: reasoningContent));

    case 'finish':
      final data = json['data'] as Map<String, dynamic>?;
      final finishReason = data?['finish_reason'] as String?;
      return Stream.value(
        StreamChunk(isFinished: true, finishReason: finishReason),
      );

    case 'usage':
      final data = json['data'] as Map<String, dynamic>?;
      if (data == null) {
        return const Stream<StreamChunk>.empty();
      }
      final usage = TokenUsage(
        promptTokens: data['prompt_tokens'] as int? ?? 0,
        completionTokens: data['completion_tokens'] as int? ?? 0,
        promptCacheHitTokens: data['prompt_cache_hit_tokens'] as int? ?? 0,
        promptCacheMissTokens: data['prompt_cache_miss_tokens'] as int? ?? 0,
      );
      return Stream.value(StreamChunk(usage: usage));

    case 'error':
      final errorContent = json['content'] as String? ?? '未知错误';
      // 将错误作为 content 返回并标记结束，由上层决定如何展示
      return Stream.value(StreamChunk(content: errorContent, isFinished: true));

    case 'tool_call':
      final data = json['data'] as Map<String, dynamic>?;
      ToolCallInfo? toolCallInfo;
      if (data != null) {
        toolCallInfo = ToolCallInfo.fromJson(data);
      }
      final content = json['content'] as String? ?? '';
      // 优先使用外层 content 作为摘要，回退到 data.summary
      if (toolCallInfo != null) {
        toolCallInfo = ToolCallInfo(
          tools: toolCallInfo.tools,
          summary: content.isNotEmpty ? content : toolCallInfo.summary,
        );
      }
      return Stream.value(StreamChunk(
        isStatus: true,
        toolCallInfo: toolCallInfo,
      ));

    case 'compact':
      final data = json['data'] as Map<String, dynamic>?;
      CompactInfo? compactInfo;
      if (data != null) {
        compactInfo = CompactInfo.fromJson(data);
      }
      return Stream.value(StreamChunk(
        isStatus: true,
        compactInfo: compactInfo,
      ));

    case 'session_notes_init':
      final data = json['data'] as Map<String, dynamic>?;
      SessionNotesInitInfo? sessionNotesInitInfo;
      if (data != null) {
        sessionNotesInitInfo = SessionNotesInitInfo.fromJson(data);
      }
      return Stream.value(StreamChunk(
        isStatus: true,
        sessionNotesInitInfo: sessionNotesInitInfo,
      ));

    case 'full_request':
      final data = json['data'] as Map<String, dynamic>?;
      final requestJson = data?['request_json'] as String?;
      return Stream.value(StreamChunk(
        isStatus: true,
        fullRequestJson: requestJson,
      ));

    case 'connected':
      return Stream.value(const StreamChunk(isStatus: true));

    default:
      return const Stream<StreamChunk>.empty();
  }
}

/// 解析原始 OpenAI / DeepSeek SSE 格式
///
/// 字段结构：choices[0].delta.content / reasoning_content / finish_reason / usage
Stream<StreamChunk> _parseOpenAIFormat(Map<String, dynamic> json) {
  // usage 字段通常在最后一个数据块中返回
  TokenUsage? usage;
  final usageJson = json['usage'] as Map<String, dynamic>?;
  if (usageJson != null) {
    usage = TokenUsage.fromJson(usageJson);
  }

  final choices = json['choices'] as List<dynamic>?;
  if (choices == null || choices.isEmpty) {
    // 可能只有 usage 字段，没有 choices（最终统计块）
    if (usage != null) {
      return Stream.value(StreamChunk(usage: usage));
    }
    return const Stream<StreamChunk>.empty();
  }

  final firstChoice = choices[0] as Map<String, dynamic>?;
  if (firstChoice == null) {
    return const Stream<StreamChunk>.empty();
  }

  final finishReason = firstChoice['finish_reason'] as String?;
  // DeepSeek 偶尔返回字符串 "null" 而非 null，需一并排除
  final isFinished = finishReason != null && finishReason != 'null';

  final delta = firstChoice['delta'] as Map<String, dynamic>?;
  if (delta == null) {
    // 非流式格式或结束块
    if (isFinished) {
      return Stream.value(
        StreamChunk(isFinished: true, finishReason: finishReason, usage: usage),
      );
    }
    return const Stream<StreamChunk>.empty();
  }

  final content = delta['content'] as String? ?? '';

  // 提取 reasoning_content（DeepSeek 思考模式）
  final reasoningContent = delta['reasoning_content'] as String? ?? '';

  return Stream.value(
    StreamChunk(
      content: content,
      reasoningContent: reasoningContent,
      usage: usage,
      isFinished: isFinished,
      finishReason: finishReason,
    ),
  );
}
