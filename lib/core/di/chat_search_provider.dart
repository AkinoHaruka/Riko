import 'package:flutter_riverpod/flutter_riverpod.dart';

/// 聊天搜索状态
///
/// [query] 当前搜索关键词
/// [matchIndices] 匹配到的消息在列表中的索引
/// [currentMatchIndex] 当前高亮的匹配项在 [matchIndices] 中的位置
class ChatSearchState {
  final String query;
  final List<int> matchIndices;
  final int currentMatchIndex;

  const ChatSearchState({
    this.query = '',
    this.matchIndices = const [],
    this.currentMatchIndex = 0,
  });

  /// 是否存在匹配结果
  bool get hasMatches => matchIndices.isNotEmpty;

  /// 搜索是否处于激活状态（关键词非空）
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

  /// 设置搜索关键词，对 [messageContents] 做大小写不敏感的本地过滤
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
      currentMatchIndex: indices.isNotEmpty ? 0 : -1,
    );
  }

  /// 跳转到下一个匹配项（循环）
  void nextMatch() {
    if (!state.hasMatches) return;
    final next = (state.currentMatchIndex + 1) % state.matchIndices.length;
    state = state.copyWith(currentMatchIndex: next);
  }

  /// 跳转到上一个匹配项（循环）
  void previousMatch() {
    if (!state.hasMatches) return;
    final prev =
        (state.currentMatchIndex - 1 + state.matchIndices.length) %
        state.matchIndices.length;
    state = state.copyWith(currentMatchIndex: prev);
  }

  /// 清空搜索状态
  void clearSearch() {
    state = const ChatSearchState();
  }
}

/// 聊天搜索 Notifier Provider
final chatSearchProvider =
    StateNotifierProvider<ChatSearchNotifier, ChatSearchState>((ref) {
      return ChatSearchNotifier();
    });
