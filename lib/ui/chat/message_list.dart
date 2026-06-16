/// 聊天消息列表 — 负责消息渲染、流式内容展示、搜索高亮、滚动控制
///
/// 管理滚动状态、乐观 UI 待处理消息清理、段落拆分、搜索匹配高亮。
/// 包含"回到底部"浮动按钮。
library;

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/di/chat_provider.dart';
import '../../core/di/chat_search_provider.dart';
import '../../core/di/toast_provider.dart';
import '../../core/theme/app_animations.dart';
import '../../core/theme/app_colors.dart';
import '../../data/models/chat_message.dart';
import '../widgets/avatar/avatar_provider.dart';
import '../widgets/message_bubble.dart';

/// 聊天消息列表 — 管理滚动、乐观 UI 清理、搜索高亮、段落拆分
class ChatMessageList extends ConsumerStatefulWidget {
  final AsyncValue<List<ChatMessage>>? messagesAsync;
  final ChatState chatState;
  final String? activeConversationId;
  final bool isSearchVisible;

  /// 父组件递增此值以请求滚动到底部（如发送消息后）
  final int scrollToBottomRequest;

  const ChatMessageList({
    super.key,
    required this.messagesAsync,
    required this.chatState,
    this.activeConversationId,
    this.isSearchVisible = false,
    this.scrollToBottomRequest = 0,
  });

  @override
  ConsumerState<ChatMessageList> createState() => _ChatMessageListState();
}

class _ChatMessageListState extends ConsumerState<ChatMessageList> {
  final _scrollController = ScrollController();
  bool _hasInitialScrolled = false;
  bool _pendingClearScheduled = false;
  bool _showScrollToBottom = false;
  int _lastScrollRequest = 0;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _lastScrollRequest = widget.scrollToBottomRequest;
  }

  @override
  void didUpdateWidget(ChatMessageList oldWidget) {
    super.didUpdateWidget(oldWidget);
    // 父组件请求滚动到底部
    if (widget.scrollToBottomRequest != _lastScrollRequest) {
      _lastScrollRequest = widget.scrollToBottomRequest;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _scrollToBottom();
      });
    }
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  /// 滚动监听：距离底部超过 200px 时显示"回到底部"按钮
  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final show =
        _scrollController.position.pixels <
        _scrollController.position.maxScrollExtent - 200;
    if (show != _showScrollToBottom) {
      setState(() => _showScrollToBottom = show);
    }
  }

  /// 滚动消息列表到底部
  void _scrollToBottom() {
    if (_scrollController.hasClients) {
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: AppAnimations.normal,
        curve: AppAnimations.easeOutExpo,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final messagesAsync = widget.messagesAsync;
    final chatState = widget.chatState;

    // 处理乐观 UI 待处理消息的清理
    if (messagesAsync?.hasValue == true &&
        chatState.pendingMessages.isNotEmpty &&
        !_pendingClearScheduled) {
      _pendingClearScheduled = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _pendingClearScheduled = false;
        if (mounted) {
          ref.read(chatNotifierProvider.notifier).clearPendingIfMatched();
        }
      });
    }

    return messagesAsync?.when(
          data: (messages) {
            if (messages.isEmpty &&
                chatState.pendingMessages.isEmpty &&
                !chatState.isLoading) {
              return const Center(
                child: Text(
                  'Send your first message to start',
                  style: TextStyle(color: AppColors.textSecondary),
                ),
              );
            }
            final allMessages = _mergeAndSort(messages, chatState);
            final items = _buildRenderItems(allMessages, chatState);
            if (!_hasInitialScrolled && items.isNotEmpty) {
              _hasInitialScrolled = true;
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted) _scrollToBottom();
              });
            }
            return Stack(
              children: [
                ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: items.length,
                  itemBuilder: (context, index) {
                    final item = items[index];
                    final child = item.build(context);
                    final key = item.key;
                    if (key != null) {
                      return KeyedSubtree(key: key, child: child);
                    }
                    return child;
                  },
                ),
                Positioned(
                  right: 16,
                  bottom: 8,
                  child: AnimatedScale(
                    scale: _showScrollToBottom ? 1.0 : 0.0,
                    duration: AppAnimations.quick,
                    curve: _showScrollToBottom
                        ? AppAnimations.spring
                        : AppAnimations.easeIn,
                    child: AnimatedOpacity(
                      opacity: _showScrollToBottom ? 1.0 : 0.0,
                      duration: AppAnimations.quick,
                      child: GestureDetector(
                        onTap: _scrollToBottom,
                        child: Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(
                            color: AppColors.surface.withValues(alpha: 0.9),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: AppColors.border),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.3),
                                blurRadius: 8,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                          child: const Icon(
                            Icons.keyboard_arrow_down,
                            color: AppColors.textSecondary,
                            size: 24,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
          loading: () => const Center(
            child: CircularProgressIndicator(color: AppColors.success),
          ),
          error: (error, _) => Center(
            child: Text(
              'Failed to load messages: $error',
              style: const TextStyle(color: AppColors.error),
            ),
          ),
        ) ??
        const Center(
          child: CircularProgressIndicator(color: AppColors.success),
        );
  }

  /// 合并轮询消息和待处理消息（乐观 UI），去除重复 ID
  List<ChatMessage> _mergeAndSort(
    List<ChatMessage> polled,
    ChatState chatState,
  ) {
    final seen = <String>{};
    final result = <ChatMessage>[];

    for (final m in polled) {
      seen.add(m.id);
      result.add(m);
    }
    for (final p in chatState.pendingMessages) {
      if (seen.contains(p.id)) continue;
      result.add(p);
    }

    final sid = chatState.streamingAssistantMessageId;
    if (sid != null && !seen.contains(sid) && chatState.isLoading) {
      result.add(
        ChatMessage(
          id: sid,
          conversationId: polled.isNotEmpty ? polled.first.conversationId : '',
          role: 'assistant',
          content: '',
          reasoningContent: null,
          isCompactSummary: false,
          createdAt: DateTime.now(),
        ),
      );
    }

    result.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    return result;
  }

  /// 构建渲染项列表：插入时间分隔器、过滤系统消息、绑定流式内容
  List<_RenderItem> _buildRenderItems(
    List<ChatMessage> messages,
    ChatState chatState,
  ) {
    final avatarBytes = ref.watch(mainAgentAvatarProvider).valueOrNull;
    final searchState = widget.isSearchVisible
        ? ref.watch(chatSearchProvider)
        : null;
    final searchMatchList = searchState?.hasMatches == true
        ? searchState!.matchIndices
        : <int>[];
    final searchMatchSet = searchMatchList.toSet();
    final currentSearchIndex = searchState?.currentMatchIndex;
    final searchQuery = searchState?.isActive == true
        ? searchState!.query
        : null;

    // 搜索激活时，只保留匹配消息及其前后各 2 条上下文
    List<ChatMessage> filteredMessages;
    Map<int, int> sourceIndexToFiltered;
    if (searchQuery != null && searchMatchSet.isNotEmpty) {
      final keepIndices = <int>{};
      for (final mi in searchMatchSet) {
        for (
          int j = (mi - 2).clamp(0, messages.length - 1);
          j <= (mi + 2).clamp(0, messages.length - 1);
          j++
        ) {
          keepIndices.add(j);
        }
      }
      filteredMessages = [];
      sourceIndexToFiltered = {};
      for (int i = 0; i < messages.length; i++) {
        if (keepIndices.contains(i)) {
          sourceIndexToFiltered[i] = filteredMessages.length;
          filteredMessages.add(messages[i]);
        }
      }
    } else {
      filteredMessages = messages;
      sourceIndexToFiltered = {};
      for (int i = 0; i < messages.length; i++) {
        sourceIndexToFiltered[i] = i;
      }
    }
    // source index → filtered index 反向映射
    final filteredIndexToSource = <int, int>{};
    for (final e in sourceIndexToFiltered.entries) {
      filteredIndexToSource[e.value] = e.key;
    }

    final items = <_RenderItem>[];
    DateTime? lastTime;

    for (int i = 0; i < filteredMessages.length; i++) {
      final message = filteredMessages[i];

      // 过滤系统消息
      if (message.role == 'system') {
        final content = message.content;
        if (content.contains('<session-memory-update>')) {
          continue;
        }
      }
      if (message.role == 'system' &&
          message.compactMetadata != null &&
          message.compactMetadata!.contains('compact_boundary')) {
        continue;
      }
      if (message.isCompactSummary &&
          message.role == 'user' &&
          message.content.contains('此会话从之前的对话继续')) {
        continue;
      }

      // 时间分隔器：间隔超过 5 分钟时插入
      if (lastTime == null ||
          message.createdAt.difference(lastTime).inMinutes > 5) {
        items.add(
          _RenderItem(
            (_) => TimeSeparator(dateTime: message.createdAt),
            key: ValueKey('ts_${message.id}'),
          ),
        );
      }
      lastTime = message.createdAt;

      final isStreamingTarget =
          message.id == chatState.streamingAssistantMessageId;
      final animateEntrance = !message.id.startsWith('-') && !isStreamingTarget;

      final isCompactBoundary =
          message.isCompactSummary &&
          i + 1 < filteredMessages.length &&
          !filteredMessages[i + 1].isCompactSummary;

      final sourceIdx = filteredIndexToSource[i] ?? -1;
      final isMatch = searchMatchSet.contains(sourceIdx);
      final isFocused =
          isMatch &&
          currentSearchIndex != null &&
          currentSearchIndex < searchMatchList.length &&
          searchMatchList[currentSearchIndex] == sourceIdx;

      // 段落拆分：AI 多段落回复（以空行分隔）拆成独立气泡+头像
      final isAssistant = message.role == 'assistant';
      final shouldSplit =
          isAssistant && searchQuery == null && !message.isCompactSummary;

      if (shouldSplit) {
        final rawContent = isStreamingTarget
            ? chatState.streamingContent
            : message.content;
        final normalized = rawContent.replaceAll('\r\n', '\n');

        // 包含代码块（```）的消息不拆分，避免破坏 markdown 结构
        final hasCodeFence = normalized.contains('```');

        if (!hasCodeFence && normalized.contains('\n\n')) {
          final parts = normalized.split(RegExp(r'\n\n+'));
          while (parts.isNotEmpty && parts.last.isEmpty) {
            parts.removeLast();
          }
          if (parts.length >= 2) {
            final baseOnDelete =
                !message.id.startsWith('-') && !isStreamingTarget
                ? () => ref
                      .read(chatNotifierProvider.notifier)
                      .deleteMessage(message.id)
                : null;

            final streamingDone =
                !isStreamingTarget || RegExp(r'\n\n+$').hasMatch(normalized);
            final doneCount = streamingDone ? parts.length : parts.length - 1;

            for (int p = 0; p < doneCount; p++) {
              final speakContent = parts[p].trimRight();
              items.add(
                _buildParagraphItem(
                  role: message.role,
                  content: speakContent,
                  reasoningContent: p == 0
                      ? (isStreamingTarget
                            ? (chatState.streamingReasoningContent.isNotEmpty
                                  ? chatState.streamingReasoningContent
                                  : null)
                            : message.reasoningContent)
                      : null,
                  isStreaming: false,
                  animateEntrance: p == 0 && animateEntrance,
                  createdAt: message.createdAt,
                  onDelete: baseOnDelete,
                  onCopy: () =>
                      ref.read(toastProvider.notifier).show('已复制到剪贴板'),
                  assistantAvatar: avatarBytes,
                  searchQuery: isMatch ? searchQuery : null,
                  isSearchMatch: isFocused,
                ),
              );
            }

            if (!streamingDone) {
              items.add(
                _buildParagraphItem(
                  role: message.role,
                  content: parts.last.trimRight(),
                  reasoningContent: null,
                  isStreaming: true,
                  animateEntrance: false,
                  createdAt: message.createdAt,
                  onDelete: null,
                  onCopy: () =>
                      ref.read(toastProvider.notifier).show('已复制到剪贴板'),
                  assistantAvatar: avatarBytes,
                  searchQuery: isMatch ? searchQuery : null,
                  isSearchMatch: isFocused,
                  key: const ValueKey('__streaming_target__'),
                ),
              );
            }
            continue;
          }
        }
      }

      // 非拆分消息：直接渲染单个气泡
      final bubbleKey = isStreamingTarget
          ? const ValueKey('__streaming_target__')
          : ValueKey(message.id);
      items.add(
        _RenderItem(
          (_) => RepaintBoundary(
            child: MessageBubble(
              key: bubbleKey,
              role: message.role,
              content:
                  (isStreamingTarget
                          ? chatState.streamingContent
                          : message.content)
                      .trimRight(),
              reasoningContent: isStreamingTarget
                  ? (chatState.streamingReasoningContent.isNotEmpty
                        ? chatState.streamingReasoningContent
                        : null)
                  : message.reasoningContent,
              createdAt: message.createdAt,
              animateEntrance: animateEntrance,
              isStreaming: isStreamingTarget,
              isCompactSummary: message.isCompactSummary,
              isCompactBoundary: isCompactBoundary,
              assistantAvatar: avatarBytes,
              searchQuery: isMatch ? searchQuery : null,
              isSearchMatch: isFocused,
              onDelete: !message.id.startsWith('-') && !isStreamingTarget
                  ? () => ref
                        .read(chatNotifierProvider.notifier)
                        .deleteMessage(message.id)
                  : null,
              onCopy: () => ref.read(toastProvider.notifier).show('已复制到剪贴板'),
            ),
          ),
          key: bubbleKey,
        ),
      );
    }

    return items;
  }

  /// 构建单一段落气泡，用于多段落 AI 回复拆分
  _RenderItem _buildParagraphItem({
    required String role,
    required String content,
    required String? reasoningContent,
    required bool isStreaming,
    required bool animateEntrance,
    required DateTime createdAt,
    required VoidCallback? onDelete,
    required VoidCallback? onCopy,
    required Uint8List? assistantAvatar,
    required String? searchQuery,
    required bool isSearchMatch,
    Key? key,
  }) {
    return _RenderItem(
      (_) => RepaintBoundary(
        child: MessageBubble(
          key: key,
          role: role,
          content: content,
          reasoningContent: reasoningContent,
          isStreaming: isStreaming,
          animateEntrance: animateEntrance,
          createdAt: createdAt,
          onDelete: onDelete,
          onCopy: onCopy,
          isCompactSummary: false,
          isCompactBoundary: false,
          assistantAvatar: assistantAvatar,
          searchQuery: searchQuery,
          isSearchMatch: isSearchMatch,
        ),
      ),
      key: key,
    );
  }
}

/// 渲染项 — 消息列表中的单条内容（消息气泡或时间分隔符），按需构建
class _RenderItem {
  final Widget Function(BuildContext) build;
  final Key? key;
  _RenderItem(this.build, {this.key});
}
