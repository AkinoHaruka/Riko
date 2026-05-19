import 'dart:convert';

/// 监控面板的内部事件模型
///
/// 记录工具调用、上下文压缩、会话笔记等 AI 运行时内部事件，
/// 每个 InternalEvent 挂载在对应的 ApiMonitorRecord.internalEvents 列表中。
class InternalEvent {
  final String type;
  final DateTime timestamp;
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

  static String encodeList(List<InternalEvent> events) {
    return jsonEncode(events.map((e) => e.toJson()).toList());
  }

  static List<InternalEvent> decodeList(String? jsonStr) {
    if (jsonStr == null || jsonStr.isEmpty) return [];
    try {
      final list = jsonDecode(jsonStr) as List<dynamic>;
      return list
          .map((e) => InternalEvent.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return [];
    }
  }
}
