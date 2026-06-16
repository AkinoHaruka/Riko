/// ChatMessage.fromJson 单元测试
///
/// 重点验证 is_compact_summary 字段的 int/bool/null 兼容解析逻辑。
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:riko/data/models/chat_message.dart';

void main() {
  /// 构造最小合法 JSON Map，仅覆盖必填字段
  Map<String, dynamic> baseJson({
    dynamic isCompactSummary,
  }) =>
      {
        'id': 'msg-1',
        'conversation_id': 'conv-1',
        'role': 'assistant',
        'content': '你好',
        'created_at': '2025-06-14T10:00:00.000Z',
        'is_compact_summary': ?isCompactSummary,
      };

  group('ChatMessage.fromJson', () {
    test('is_compact_summary = 0 时应解析为 false', () {
      final msg = ChatMessage.fromJson(baseJson(isCompactSummary: 0));
      expect(msg.isCompactSummary, isFalse);
    });

    test('is_compact_summary = 1 时应解析为 true', () {
      final msg = ChatMessage.fromJson(baseJson(isCompactSummary: 1));
      expect(msg.isCompactSummary, isTrue);
    });

    test('is_compact_summary = true 时应解析为 true', () {
      final msg = ChatMessage.fromJson(baseJson(isCompactSummary: true));
      expect(msg.isCompactSummary, isTrue);
    });

    test('is_compact_summary = false 时应解析为 false', () {
      final msg = ChatMessage.fromJson(baseJson(isCompactSummary: false));
      expect(msg.isCompactSummary, isFalse);
    });

    test('is_compact_summary 缺失时应使用默认值 false', () {
      // 不传 is_compact_summary 字段
      final msg = ChatMessage.fromJson(baseJson());
      expect(msg.isCompactSummary, isFalse);
    });

    test('应正确解析所有必填字段', () {
      final msg = ChatMessage.fromJson(baseJson(isCompactSummary: 1));
      expect(msg.id, 'msg-1');
      expect(msg.conversationId, 'conv-1');
      expect(msg.role, 'assistant');
      expect(msg.content, '你好');
      expect(msg.createdAt, DateTime.parse('2025-06-14T10:00:00.000Z'));
    });

    test('可选字段缺失时应为 null 或默认值', () {
      final msg = ChatMessage.fromJson(baseJson());
      expect(msg.reasoningContent, isNull);
      expect(msg.compactMetadata, isNull);
      expect(msg.tokenCount, isNull);
    });

    test('可选字段有值时应正确解析', () {
      final msg = ChatMessage.fromJson({
        ...baseJson(),
        'reasoning_content': '思考过程',
        'compact_metadata': '{"strategy":"micro"}',
        'token_count': 42,
      });
      expect(msg.reasoningContent, '思考过程');
      expect(msg.compactMetadata, '{"strategy":"micro"}');
      expect(msg.tokenCount, 42);
    });
  });
}
