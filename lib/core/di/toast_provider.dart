import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

class ToastEntry {
  final String id;
  final String text;

  ToastEntry({
    required this.id,
    required this.text,
  });
}

class ToastNotifier extends StateNotifier<List<ToastEntry>> {
  final _timers = <String, Timer>{};
  int _nextId = 0;

  ToastNotifier() : super([]);

  void show(String text) {
    final id = 't${_nextId++}';
    state = [...state, ToastEntry(id: id, text: text)];
    _timers[id] = Timer(const Duration(seconds: 2), () {
      _remove(id);
    });
  }

  void _remove(String id) {
    _timers[id]?.cancel();
    _timers.remove(id);
    state = state.where((e) => e.id != id).toList();
  }

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

final toastProvider =
    StateNotifierProvider<ToastNotifier, List<ToastEntry>>((ref) {
  return ToastNotifier();
});
