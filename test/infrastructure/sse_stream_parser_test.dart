/// SSE 流解析器单元测试
///
/// 覆盖 parseSseStream 的核心解析逻辑，包括：
/// - 基础 SSE 协议（空流、DONE 标记、注释行、非 data 前缀、空内容）
/// - 无效 JSON 的 FormatException 回退
/// - OpenAI 格式（finish_reason="null" 字符串、纯 usage 块、完整 delta）
/// - Python 后端简化格式（content / reasoning_content / finish / usage / error /
///   tool_call / compact / session_notes_init / full_request / connected / 未知 type）
/// - onRawSseLine 回调
/// - 缓冲区尾部无换行符的边界情况
library;

import 'dart:async';
import 'dart:convert';

import 'package:riko/infrastructure/ai_adapter/models/stream_chunk.dart';
import 'package:riko/infrastructure/ai_adapter/sse_stream_parser.dart';
import 'package:flutter_test/flutter_test.dart';

/// 辅助：将多行 SSE 文本编码为单块字节流
Stream<List<int>> _encode(String text) =>
    Stream.value(utf8.encode(text));

/// 辅助：将完整 SSE 流收集为 `List<StreamChunk>`
Future<List<StreamChunk>> _collect(Stream<StreamChunk> stream) =>
    stream.toList();

void main() {
  // ============================================================
  // 基础 SSE 协议
  // ============================================================

  group('基础 SSE 协议', () {
    test('空字节流产生空输出', () async {
      final result = await _collect(parseSseStream(const Stream.empty()));
      expect(result, isEmpty);
    });

    test('[DONE] 标记产生 isFinished=true', () async {
      // 解析器在 data: 前缀检查之前匹配裸 [DONE] 行
      final result = await _collect(parseSseStream(_encode('[DONE]\n')));
      expect(result, hasLength(1));
      expect(result.first.isFinished, isTrue);
      expect(result.first.content, isEmpty);
    });

    test('data: [DONE] 因 JSON 解析失败回退为 content', () async {
      // SSE 规范中 [DONE] 以 data: 前缀发送，但解析器仅匹配裸 [DONE]
      final result = await _collect(
        parseSseStream(_encode('data: [DONE]\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.content, equals('[DONE]'));
      expect(result.first.isFinished, isFalse);
    });

    test(': keep-alive 注释行被过滤', () async {
      final result = await _collect(
        parseSseStream(_encode(': keep-alive\n')),
      );
      expect(result, isEmpty);
    });

    test(': 开头的任意注释行均被过滤', () async {
      final result = await _collect(
        parseSseStream(_encode(': some comment\n')),
      );
      expect(result, isEmpty);
    });

    test('非 data: 前缀行被忽略', () async {
      final result = await _collect(
        parseSseStream(_encode('event: message\n')),
      );
      expect(result, isEmpty);
    });

    test('data: 后为空内容被忽略', () async {
      final result = await _collect(
        parseSseStream(_encode('data: \n')),
      );
      expect(result, isEmpty);
    });

    test('data: 后仅空白被忽略', () async {
      final result = await _collect(
        parseSseStream(_encode('data:   \n')),
      );
      expect(result, isEmpty);
    });

    test('空行被忽略', () async {
      final result = await _collect(
        parseSseStream(_encode('\n\n')),
      );
      expect(result, isEmpty);
    });
  });

  // ============================================================
  // 无效 JSON 回退
  // ============================================================

  group('无效 JSON 回退', () {
    test('无效 JSON 触发 FormatException 回退，原始内容作为 content 返回', () async {
      final result = await _collect(
        parseSseStream(_encode('data: not-json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.content, equals('not-json'));
      expect(result.first.isFinished, isFalse);
    });
  });

  // ============================================================
  // OpenAI 格式
  // ============================================================

  group('OpenAI 格式', () {
    test('标准 content delta', () async {
      final json = jsonEncode({
        'choices': [
          {
            'delta': {'content': 'Hello'},
            'finish_reason': null,
          },
        ],
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.content, equals('Hello'));
      expect(result.first.isFinished, isFalse);
    });

    test('reasoning_content delta', () async {
      final json = jsonEncode({
        'choices': [
          {
            'delta': {
              'content': '',
              'reasoning_content': 'Let me think...',
            },
            'finish_reason': null,
          },
        ],
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.reasoningContent, equals('Let me think...'));
      expect(result.first.content, isEmpty);
    });

    test('finish_reason = "null" 字符串视为未结束', () async {
      // DeepSeek 偶尔返回字符串 "null" 而非 JSON null
      final json = jsonEncode({
        'choices': [
          {
            'delta': {'content': 'text'},
            'finish_reason': 'null',
          },
        ],
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isFinished, isFalse);
      expect(result.first.content, equals('text'));
    });

    test('finish_reason = "stop" 视为已结束', () async {
      final json = jsonEncode({
        'choices': [
          {
            'delta': {'content': ''},
            'finish_reason': 'stop',
          },
        ],
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isFinished, isTrue);
      expect(result.first.finishReason, equals('stop'));
    });

    test('只有 usage 无 choices', () async {
      final json = jsonEncode({
        'usage': {
          'prompt_tokens': 100,
          'completion_tokens': 50,
          'prompt_cache_hit_tokens': 80,
          'prompt_cache_miss_tokens': 20,
        },
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.usage, isNotNull);
      expect(result.first.usage!.promptTokens, equals(100));
      expect(result.first.usage!.completionTokens, equals(50));
      expect(result.first.usage!.promptCacheHitTokens, equals(80));
      expect(result.first.usage!.promptCacheMissTokens, equals(20));
    });

    test('choices 为空列表且无 usage 时返回空', () async {
      final json = jsonEncode({'choices': <Map<String, dynamic>>[]});
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, isEmpty);
    });

    test('delta 为 null 且有 finish_reason 时返回结束标记', () async {
      final json = jsonEncode({
        'choices': [
          {'delta': null, 'finish_reason': 'stop'},
        ],
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isFinished, isTrue);
      expect(result.first.finishReason, equals('stop'));
    });

    test('delta 为 null 且无 finish_reason 时返回空', () async {
      final json = jsonEncode({
        'choices': [
          {'delta': null, 'finish_reason': null},
        ],
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, isEmpty);
    });

    test('带 usage 的完整结束块', () async {
      final json = jsonEncode({
        'choices': [
          {
            'delta': {'content': ''},
            'finish_reason': 'stop',
          },
        ],
        'usage': {
          'prompt_tokens': 200,
          'completion_tokens': 100,
          'prompt_cache_hit_tokens': 150,
          'prompt_cache_miss_tokens': 50,
        },
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isFinished, isTrue);
      expect(result.first.finishReason, equals('stop'));
      expect(result.first.usage, isNotNull);
      expect(result.first.usage!.promptTokens, equals(200));
    });
  });

  // ============================================================
  // 简化格式
  // ============================================================

  group('简化格式', () {
    test('type=content 返回文本内容', () async {
      final json = jsonEncode({'type': 'content', 'content': 'Hello world'});
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.content, equals('Hello world'));
      expect(result.first.isFinished, isFalse);
    });

    test('type=content 缺少 content 字段时默认为空字符串', () async {
      final json = jsonEncode({'type': 'content'});
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.content, isEmpty);
    });

    test('type=reasoning_content 返回推理内容', () async {
      final json = jsonEncode({
        'type': 'reasoning_content',
        'content': '思考中...',
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.reasoningContent, equals('思考中...'));
    });

    test('type=finish 返回结束标记和 finish_reason', () async {
      final json = jsonEncode({
        'type': 'finish',
        'data': {'finish_reason': 'stop'},
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isFinished, isTrue);
      expect(result.first.finishReason, equals('stop'));
    });

    test('type=finish 缺少 data 时仍标记结束', () async {
      final json = jsonEncode({'type': 'finish'});
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isFinished, isTrue);
      expect(result.first.finishReason, isNull);
    });

    test('type=usage 返回 Token 统计', () async {
      final json = jsonEncode({
        'type': 'usage',
        'data': {
          'prompt_tokens': 50,
          'completion_tokens': 25,
          'prompt_cache_hit_tokens': 40,
          'prompt_cache_miss_tokens': 10,
        },
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.usage, isNotNull);
      expect(result.first.usage!.promptTokens, equals(50));
      expect(result.first.usage!.completionTokens, equals(25));
      expect(result.first.usage!.promptCacheHitTokens, equals(40));
      expect(result.first.usage!.promptCacheMissTokens, equals(10));
    });

    test('type=usage 缺少 data 时返回空', () async {
      final json = jsonEncode({'type': 'usage'});
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, isEmpty);
    });

    test('type=error 返回错误内容并标记结束', () async {
      final json = jsonEncode({
        'type': 'error',
        'content': '服务器内部错误',
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.content, equals('服务器内部错误'));
      expect(result.first.isFinished, isTrue);
    });

    test('type=error 缺少 content 时使用默认错误信息', () async {
      final json = jsonEncode({'type': 'error'});
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.content, equals('未知错误'));
      expect(result.first.isFinished, isTrue);
    });

    test('type=tool_call 返回工具调用信息', () async {
      final json = jsonEncode({
        'type': 'tool_call',
        'content': '正在读取文件',
        'data': {
          'tools': [
            {
              'name': 'readFile',
              'arguments': '{"path": "/tmp/test.txt"}',
              'result_preview': 'file content...',
            },
          ],
          'summary': '读取了 test.txt',
        },
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isStatus, isTrue);
      expect(result.first.toolCallInfo, isNotNull);
      // 外层 content 优先于 data.summary
      expect(result.first.toolCallInfo!.summary, equals('正在读取文件'));
      expect(result.first.toolCallInfo!.tools, hasLength(1));
      expect(result.first.toolCallInfo!.tools.first.name, equals('readFile'));
    });

    test('type=tool_call 外层 content 为空时回退到 data.summary', () async {
      final json = jsonEncode({
        'type': 'tool_call',
        'content': '',
        'data': {
          'tools': <Map<String, dynamic>>[],
          'summary': '回退摘要',
        },
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.toolCallInfo!.summary, equals('回退摘要'));
    });

    test('type=tool_call 缺少 data 时 toolCallInfo 为 null', () async {
      final json = jsonEncode({'type': 'tool_call', 'content': '无数据'});
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isStatus, isTrue);
      expect(result.first.toolCallInfo, isNull);
    });

    test('type=compact 返回上下文压缩信息', () async {
      final json = jsonEncode({
        'type': 'compact',
        'data': {
          'strategy': 'micro-compact',
          'pre_compact_tokens': 1000,
          'post_compact_tokens': 500,
          'pre_compact_message_count': 20,
          'post_compact_message_count': 10,
          'is_auto': true,
        },
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isStatus, isTrue);
      expect(result.first.compactInfo, isNotNull);
      expect(result.first.compactInfo!.strategy, equals('micro-compact'));
      expect(result.first.compactInfo!.preCompactTokens, equals(1000));
      expect(result.first.compactInfo!.postCompactTokens, equals(500));
      expect(result.first.compactInfo!.isAuto, isTrue);
    });

    test('type=compact 缺少 data 时 compactInfo 为 null', () async {
      final json = jsonEncode({'type': 'compact'});
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isStatus, isTrue);
      expect(result.first.compactInfo, isNull);
    });

    test('type=session_notes_init 返回会话笔记初始化信息', () async {
      final json = jsonEncode({
        'type': 'session_notes_init',
        'data': {
          'conversation_id': 'conv-123',
          'message_count': 5,
          'notes_path': '/notes/conv-123.md',
        },
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isStatus, isTrue);
      expect(result.first.sessionNotesInitInfo, isNotNull);
      expect(
        result.first.sessionNotesInitInfo!.conversationId,
        equals('conv-123'),
      );
      expect(result.first.sessionNotesInitInfo!.messageCount, equals(5));
      expect(
        result.first.sessionNotesInitInfo!.notesPath,
        equals('/notes/conv-123.md'),
      );
    });

    test('type=full_request 返回完整请求 JSON', () async {
      final requestJson = jsonEncode({'model': 'deepseek-v4-flash'});
      final json = jsonEncode({
        'type': 'full_request',
        'data': {'request_json': requestJson},
      });
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isStatus, isTrue);
      expect(result.first.fullRequestJson, equals(requestJson));
    });

    test('type=connected 返回状态标记', () async {
      final json = jsonEncode({'type': 'connected'});
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.isStatus, isTrue);
      expect(result.first.content, isEmpty);
      expect(result.first.isFinished, isFalse);
    });

    test('未知 type 返回空 Stream', () async {
      final json = jsonEncode({'type': 'unknown_type', 'content': '???'});
      final result = await _collect(
        parseSseStream(_encode('data: $json\n')),
      );
      expect(result, isEmpty);
    });
  });

  // ============================================================
  // onRawSseLine 回调
  // ============================================================

  group('onRawSseLine 回调', () {
    test('每行 SSE 数据都触发回调', () async {
      final rawLines = <String>[];
      final input = 'data: hello\n: keep-alive\ndata: world\n';
      await _collect(
        parseSseStream(
          _encode(input),
          onRawSseLine: rawLines.add,
        ),
      );
      // 每行（含注释行）都应触发回调
      expect(rawLines, equals(['data: hello', ': keep-alive', 'data: world']));
    });

    test('缓冲区尾部无换行符时也触发回调', () async {
      final rawLines = <String>[];
      // 末尾没有换行符
      final input = 'data: tail';
      await _collect(
        parseSseStream(
          _encode(input),
          onRawSseLine: rawLines.add,
        ),
      );
      expect(rawLines, equals(['data: tail']));
    });
  });

  // ============================================================
  // 边界情况
  // ============================================================

  group('边界情况', () {
    test('缓冲区尾部无换行符时仍能解析最后一行', () async {
      final json = jsonEncode({'type': 'content', 'content': '尾部内容'});
      // 故意不加换行符
      final result = await _collect(
        parseSseStream(_encode('data: $json')),
      );
      expect(result, hasLength(1));
      expect(result.first.content, equals('尾部内容'));
    });

    test('多块字节流拼接后正确解析', () async {
      // 模拟字节流被拆分为多个 chunk 的场景
      final chunk1 = utf8.encode('data: ');
      final chunk2 = utf8.encode('{"type":"content","content":"跨块"}\n');
      final byteStream = Stream.fromIterable([chunk1, chunk2]);

      final result = await _collect(parseSseStream(byteStream));
      expect(result, hasLength(1));
      expect(result.first.content, equals('跨块'));
    });

    test('混合多种 SSE 行类型', () async {
      final lines = [
        ': keep-alive',
        'data: {"type":"content","content":"你好"}',
        '',
        '[DONE]',
        'event: ignored',
      ];
      final input = lines.join('\n');
      final result = await _collect(parseSseStream(_encode(input)));
      // 只应产出 content 块和 DONE 块
      expect(result, hasLength(2));
      expect(result.first.content, equals('你好'));
      expect(result.last.isFinished, isTrue);
    });

    test('data: 前缀后无空格也能解析', () async {
      // SSE 规范是 "data:" 后可选择性加空格
      final json = jsonEncode({'type': 'content', 'content': '无空格'});
      final result = await _collect(
        parseSseStream(_encode('data:$json\n')),
      );
      expect(result, hasLength(1));
      expect(result.first.content, equals('无空格'));
    });
  });
}
