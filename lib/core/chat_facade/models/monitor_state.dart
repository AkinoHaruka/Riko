import 'package:flutter/foundation.dart';

import '../../di/api_monitor_record.dart';

/// 监控面板状态 — 包含记录列表和分页元数据
///
/// 从原 [ChatState] 中拆分出的独立状态。
@immutable
class MonitorState {
  /// 当前已加载的监控记录列表（最新优先）
  final List<ApiMonitorRecord> records;

  /// 后端总记录数
  final int totalCount;

  /// 是否正在加载更多
  final bool isLoadingMore;

  const MonitorState({
    this.records = const [],
    this.totalCount = 0,
    this.isLoadingMore = false,
  });

  /// 是否还有更多记录可加载
  bool get hasMore => records.length < totalCount;

  MonitorState copyWith({
    List<ApiMonitorRecord>? records,
    int? totalCount,
    bool? isLoadingMore,
  }) {
    return MonitorState(
      records: records ?? this.records,
      totalCount: totalCount ?? this.totalCount,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MonitorState &&
          isLoadingMore == other.isLoadingMore &&
          totalCount == other.totalCount &&
          listEquals(records, other.records);

  @override
  int get hashCode => Object.hash(
        isLoadingMore,
        totalCount,
        Object.hashAll(records),
      );
}
