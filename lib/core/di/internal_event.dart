import 'dart:convert';

import 'package:flutter/foundation.dart' show debugPrint;

/// 监控面板的内部事件模型
///
/// 记录工具调用、上下文压缩、会话笔记等 AI 运行时内部事件，
/// 每个 InternalEvent 挂载在对应的 ApiMonitorRecord.internalEvents 列表中。
class InternalEvent {
  /// 事件类型（如 tool_call、compact、session_notes_init）
  final String type;

  /// 事件发生时间
  final DateTime timestamp;

  /// 事件详细数据，结构因 [type] 而异
  final Map<String, dynamic> data;

  const InternalEvent({
    required this.type,
    required this.timestamp,
    required this.data,
  });

  Map<String, dynamic> toJson() => {
    'type': type,
    'timestamp': timestamp.toIso8601String(),
    'data': data,
  };

  factory InternalEvent.fromJson(Map<String, dynamic> json) => InternalEvent(
    type: json['type'] as String,
    timestamp: DateTime.parse(json['timestamp'] as String),
    data: json['data'] as Map<String, dynamic>,
  );

  /// 将事件列表编码为 JSON 字符串（用于存入数据库）
  static String encodeList(List<InternalEvent> events) {
    return jsonEncode(events.map((e) => e.toJson()).toList());
  }

  /// 从 JSON 字符串解码事件列表（解析失败时返回空列表）
  static List<InternalEvent> decodeList(String? jsonStr) {
    if (jsonStr == null || jsonStr.isEmpty) return [];
    try {
      final list = jsonDecode(jsonStr) as List<dynamic>;
      return list
          .map((e) => InternalEvent.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (e) {
      debugPrint('[InternalEvent] decode failed: $e');
      return [];
    }
  }
}
