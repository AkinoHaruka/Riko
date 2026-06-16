import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Toast 提示条目
///
/// [id] 唯一标识（用于定时器管理和移除）
/// [text] 提示文本
class ToastEntry {
  final String id;
  final String text;

  ToastEntry({required this.id, required this.text});
}

/// Toast 提示状态管理
///
/// 管理 Toast 提示的显示和自动消失（2 秒后移除）。
/// 支持同时显示多条 Toast，每条独立计时。
class ToastNotifier extends StateNotifier<List<ToastEntry>> {
  /// 各条目的自动消失定时器
  final _timers = <String, Timer>{};

  /// ID 自增计数器
  int _nextId = 0;

  ToastNotifier() : super([]);

  /// 显示一条 Toast 提示，2 秒后自动消失
  void show(String text) {
    final id = 't${_nextId++}';
    state = [...state, ToastEntry(id: id, text: text)];
    _timers[id] = Timer(const Duration(seconds: 2), () {
      if (!mounted) return;
      _remove(id);
    });
  }

  /// 移除指定 ID 的 Toast 并取消其定时器
  void _remove(String id) {
    _timers[id]?.cancel();
    _timers.remove(id);
    state = state.where((e) => e.id != id).toList();
  }

  /// 清除所有 Toast 提示
  void dismissAll() {
    for (final t in _timers.values) {
      t.cancel();
    }
    _timers.clear();
    state = [];
  }

  @override
  void dispose() {
    for (final t in _timers.values) {
      t.cancel();
    }
    _timers.clear();
    super.dispose();
  }
}

/// Toast 提示 Provider
final toastProvider = StateNotifierProvider<ToastNotifier, List<ToastEntry>>((
  ref,
) {
  return ToastNotifier();
});
