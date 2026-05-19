import 'package:flutter_riverpod/flutter_riverpod.dart';

/// 聊天搜索状态
class ChatSearchState {
  final String query;
  final List<int> matchIndices;
  final int currentMatchIndex;

  const ChatSearchState({
    this.query = '',
    this.matchIndices = const [],
    this.currentMatchIndex = 0,
  });

  bool get hasMatches => matchIndices.isNotEmpty;
  bool get isActive => query.isNotEmpty;

  ChatSearchState copyWith({
    String? query,
    List<int>? matchIndices,
    int? currentMatchIndex,
  }) {
    return ChatSearchState(
      query: query ?? this.query,
      matchIndices: matchIndices ?? this.matchIndices,
      currentMatchIndex: currentMatchIndex ?? this.currentMatchIndex,
    );
  }
}

/// 聊天搜索 Notifier
///
/// 对内存中的消息列表做本地文本过滤，维护匹配索引和当前导航位置。
class ChatSearchNotifier extends StateNotifier<ChatSearchState> {
  ChatSearchNotifier() : super(const ChatSearchState());

  void setQuery(String q, List<String> messageContents) {
    if (q.isEmpty) {
      state = const ChatSearchState();
      return;
    }
    final lowerQ = q.toLowerCase();
    final indices = <int>[];
    for (int i = 0; i < messageContents.length; i++) {
      if (messageContents[i].toLowerCase().contains(lowerQ)) {
        indices.add(i);
      }
    }
    state = ChatSearchState(
      query: q,
      matchIndices: indices,
      currentMatchIndex: indices.isNotEmpty ? 0 : 0,
    );
  }

  void nextMatch() {
    if (!state.hasMatches) return;
    final next = (state.currentMatchIndex + 1) % state.matchIndices.length;
    state = state.copyWith(currentMatchIndex: next);
  }

  void previousMatch() {
    if (!state.hasMatches) return;
    final prev = (state.currentMatchIndex - 1 + state.matchIndices.length) %
        state.matchIndices.length;
    state = state.copyWith(currentMatchIndex: prev);
  }

  void clearSearch() {
    state = const ChatSearchState();
  }
}

final chatSearchProvider =
    StateNotifierProvider<ChatSearchNotifier, ChatSearchState>((ref) {
  return ChatSearchNotifier();
});
