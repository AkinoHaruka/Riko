/// Conversation.fromJson 单元测试
///
/// 重点验证 is_archived 字段的 int/bool/null 兼容解析逻辑。
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:riko/data/models/conversation.dart';

void main() {
  /// 构造最小合法 JSON Map，仅覆盖必填字段
  Map<String, dynamic> baseJson({dynamic isArchived}) => {
        'id': 'conv-1',
        'title': '测试会话',
        'created_at': '2025-06-14T08:00:00.000Z',
        'updated_at': '2025-06-14T09:00:00.000Z',
        'is_archived': ?isArchived,
      };

  group('Conversation.fromJson', () {
    test('is_archived = 0 时应解析为 false', () {
      final conv = Conversation.fromJson(baseJson(isArchived: 0));
      expect(conv.isArchived, isFalse);
    });

    test('is_archived = 1 时应解析为 true', () {
      final conv = Conversation.fromJson(baseJson(isArchived: 1));
      expect(conv.isArchived, isTrue);
    });

    test('is_archived = true 时应解析为 true', () {
      final conv = Conversation.fromJson(baseJson(isArchived: true));
      expect(conv.isArchived, isTrue);
    });

    test('is_archived = false 时应解析为 false', () {
      final conv = Conversation.fromJson(baseJson(isArchived: false));
      expect(conv.isArchived, isFalse);
    });

    test('is_archived 缺失时应使用默认值 false', () {
      final conv = Conversation.fromJson(baseJson());
      expect(conv.isArchived, isFalse);
    });

    test('应正确解析所有必填字段', () {
      final conv = Conversation.fromJson(baseJson(isArchived: 1));
      expect(conv.id, 'conv-1');
      expect(conv.title, '测试会话');
      expect(conv.createdAt, DateTime.parse('2025-06-14T08:00:00.000Z'));
      expect(conv.updatedAt, DateTime.parse('2025-06-14T09:00:00.000Z'));
    });

    test('可选字段缺失时应为 null', () {
      final conv = Conversation.fromJson(baseJson());
      expect(conv.agentType, isNull);
      expect(conv.background, isNull);
    });

    test('可选字段有值时应正确解析', () {
      final conv = Conversation.fromJson({
        ...baseJson(),
        'agent_type': 'memory',
        'background': 'solid:#1a1a2e',
      });
      expect(conv.agentType, 'memory');
      expect(conv.background, 'solid:#1a1a2e');
    });
  });
}
