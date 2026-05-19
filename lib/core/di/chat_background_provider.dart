import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'chat_provider.dart';

/// 当前对话的背景样式
///
/// 返回 conversation.background 的值，如 `solid:#1a1a2e` 或 `gradient:#a|#b|#c`
final activeConversationBackgroundProvider = Provider<String?>((ref) {
  final conversationId = ref.watch(activeConversationIdProvider);
  if (conversationId == null) return null;
  final conversations = ref.watch(conversationsProvider).valueOrNull ?? [];
  final conv = conversations.where((c) => c.id == conversationId).firstOrNull;
  return conv?.background;
});
