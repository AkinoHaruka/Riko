/// ApiMonitorRecord.fromJson 单元测试
///
/// 重点验证：
/// - is_complete 字段的 int/bool 兼容解析
/// - internal_events 字段的 null / JSON 字符串解码
/// - tokenUsage 的条件构造逻辑
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:riko/core/di/api_monitor_record.dart';
import 'package:riko/core/di/internal_event.dart';

void main() {
  /// 构造最小合法 JSON Map，仅覆盖必填字段
  Map<String, dynamic> baseJson({
    dynamic isComplete,
    String? internalEvents,
    int? promptTokens,
    int? completionTokens,
    int? totalTokens,
    int? promptCacheHitTokens,
    int? promptCacheMissTokens,
  }) => {
    'id': 'rec-1',
    'conversation_id': 'conv-1',
    'request_json': '{"model":"deepseek-v4-flash"}',
    'response_raw_text': '[Response] 你好',
    'created_at': '2025-06-14T12:00:00.000Z',
    'is_complete': ?isComplete,
    'internal_events': ?internalEvents,
    'prompt_tokens': ?promptTokens,
    'completion_tokens': ?completionTokens,
    'total_tokens': ?totalTokens,
    'prompt_cache_hit_tokens': ?promptCacheHitTokens,
    'prompt_cache_miss_tokens': ?promptCacheMissTokens,
  };

  group('ApiMonitorRecord.fromJson — is_complete', () {
    test('is_complete = 0 时应解析为 false', () {
      final rec = ApiMonitorRecord.fromJson(baseJson(isComplete: 0));
      expect(rec.isComplete, isFalse);
    });

    test('is_complete = 1 时应解析为 true', () {
      final rec = ApiMonitorRecord.fromJson(baseJson(isComplete: 1));
      expect(rec.isComplete, isTrue);
    });

    test('is_complete = true 时应解析为 true', () {
      final rec = ApiMonitorRecord.fromJson(baseJson(isComplete: true));
      expect(rec.isComplete, isTrue);
    });

    test('is_complete = false 时应解析为 false', () {
      final rec = ApiMonitorRecord.fromJson(baseJson(isComplete: false));
      expect(rec.isComplete, isFalse);
    });

    test('is_complete 缺失时应使用默认值 false', () {
      final rec = ApiMonitorRecord.fromJson(baseJson());
      expect(rec.isComplete, isFalse);
    });
  });

  group('ApiMonitorRecord.fromJson — internal_events', () {
    test('internal_events = null 时应返回空列表', () {
      final rec = ApiMonitorRecord.fromJson(baseJson());
      expect(rec.internalEvents, isEmpty);
    });

    test('internal_events = 空字符串时应返回空列表', () {
      final rec = ApiMonitorRecord.fromJson(baseJson(internalEvents: ''));
      expect(rec.internalEvents, isEmpty);
    });

    test('internal_events = 合法 JSON 字符串时应正确解码', () {
      // 构造一个包含两个事件的 JSON 数组
      final events = [
        InternalEvent(
          type: 'tool_call',
          timestamp: DateTime.parse('2025-06-14T12:00:01.000Z'),
          data: {'tool': 'readFile'},
        ),
        InternalEvent(
          type: 'compact',
          timestamp: DateTime.parse('2025-06-14T12:00:02.000Z'),
          data: {'strategy': 'micro'},
        ),
      ];
      final jsonStr = InternalEvent.encodeList(events);

      final rec = ApiMonitorRecord.fromJson(baseJson(internalEvents: jsonStr));
      expect(rec.internalEvents.length, 2);
      expect(rec.internalEvents[0].type, 'tool_call');
      expect(rec.internalEvents[0].data['tool'], 'readFile');
      expect(rec.internalEvents[1].type, 'compact');
      expect(rec.internalEvents[1].data['strategy'], 'micro');
    });

    test('internal_events = 无效 JSON 字符串时应返回空列表', () {
      final rec = ApiMonitorRecord.fromJson(
        baseJson(internalEvents: 'not-valid-json'),
      );
      expect(rec.internalEvents, isEmpty);
    });
  });

  group('ApiMonitorRecord.fromJson — tokenUsage', () {
    test('所有 token 字段缺失时 tokenUsage 应为 null', () {
      final rec = ApiMonitorRecord.fromJson(baseJson());
      expect(rec.tokenUsage, isNull);
    });

    test('仅 prompt_tokens 有值时也应构造 TokenUsage', () {
      final rec = ApiMonitorRecord.fromJson(baseJson(promptTokens: 100));
      expect(rec.tokenUsage, isNotNull);
      expect(rec.tokenUsage!.promptTokens, 100);
      expect(rec.tokenUsage!.completionTokens, 0);
      expect(rec.tokenUsage!.promptCacheHitTokens, 0);
      expect(rec.tokenUsage!.promptCacheMissTokens, 0);
    });

    test('所有 token 字段有值时应完整解析', () {
      final rec = ApiMonitorRecord.fromJson(
        baseJson(
          promptTokens: 500,
          completionTokens: 200,
          totalTokens: 700,
          promptCacheHitTokens: 300,
          promptCacheMissTokens: 200,
        ),
      );
      expect(rec.tokenUsage, isNotNull);
      expect(rec.tokenUsage!.promptTokens, 500);
      expect(rec.tokenUsage!.completionTokens, 200);
      expect(rec.tokenUsage!.promptCacheHitTokens, 300);
      expect(rec.tokenUsage!.promptCacheMissTokens, 200);
    });
  });

  group('ApiMonitorRecord.fromJson — 其他字段', () {
    test('应正确解析必填字段', () {
      final rec = ApiMonitorRecord.fromJson(baseJson());
      expect(rec.id, 'rec-1');
      expect(rec.conversationId, 'conv-1');
      expect(rec.requestJson, '{"model":"deepseek-v4-flash"}');
      expect(rec.responseRawText, '[Response] 你好');
      expect(rec.createdAt, DateTime.parse('2025-06-14T12:00:00.000Z'));
    });

    test('可选字段缺失时应为 null 或默认值', () {
      final rec = ApiMonitorRecord.fromJson(baseJson());
      expect(rec.errorCategory, isNull);
      expect(rec.errorCode, isNull);
      expect(rec.errorMessage, isNull);
      expect(rec.errorSuggestion, isNull);
    });

    test('可选字段有值时应正确解析', () {
      final rec = ApiMonitorRecord.fromJson({
        ...baseJson(),
        'error_category': 'network',
        'error_code': 'ECONNREFUSED',
        'error_message': '连接被拒绝',
        'error_suggestion': '检查网络连接',
      });
      expect(rec.errorCategory, 'network');
      expect(rec.errorCode, 'ECONNREFUSED');
      expect(rec.errorMessage, '连接被拒绝');
      expect(rec.errorSuggestion, '检查网络连接');
    });

    test('request_json 缺失时应默认为空字符串', () {
      final json = {'id': 'rec-2', 'created_at': '2025-06-14T12:00:00.000Z'};
      final rec = ApiMonitorRecord.fromJson(json);
      expect(rec.requestJson, '');
      expect(rec.responseRawText, '');
    });
  });
}
