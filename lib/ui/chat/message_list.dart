/// 聊天消息列表 — 负责消息渲染、流式内容展示、搜索高亮、滚动控制
///
/// 使用 AnimatedList 管理消息插入/删除动画：新消息从底部滑入+淡入，
/// 删除消息有过渡动画，历史消息首次加载时整体从顶部淡入。
/// 单条消息使用 RepaintBoundary 优化性能；切换会话时列表状态完全重置。
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

/// 聊天消息列表 — 管理滚动、乐观 UI 清理、搜索高亮、列表动画
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

class _ChatMessageListState extends ConsumerState<ChatMessageList>
    with TickerProviderStateMixin {
  final _scrollController = ScrollController();

  /// AnimatedList 的 GlobalKey，会话切换时重新创建以强制重建列表
  GlobalKey<AnimatedListState> _listKey = GlobalKey<AnimatedListState>();

  /// 当前渲染项列表，与 AnimatedList 内部状态保持同步
  final List<_RenderItem> _items = [];

  /// 最近一次活跃会话 ID，用于检测会话切换并重置列表
  String? _lastConversationId;

  bool _hasInitialScrolled = false;
  bool _pendingClearScheduled = false;
  bool _pendingScrollToBottom = false;
  bool _showScrollToBottom = false;
  int _lastScrollRequest = 0;

  /// 历史消息首次加载动画控制器
  AnimationController? _historyFadeController;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _lastScrollRequest = widget.scrollToBottomRequest;
    _lastConversationId = widget.activeConversationId;
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _historyFadeController?.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(ChatMessageList oldWidget) {
    super.didUpdateWidget(oldWidget);

    // 父组件请求滚动到底部
    if (widget.scrollToBottomRequest != _lastScrollRequest) {
      _lastScrollRequest = widget.scrollToBottomRequest;
      _pendingScrollToBottom = true;
    }

    // 数据就绪后同步列表
    if (widget.messagesAsync?.hasValue == true) {
      _syncItems();
    }
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
        duration: AppAnimations.duration(context, AppAnimations.normal),
        curve: AppAnimations.curve(context, AppAnimations.easeOutExpo),
      );
    }
  }

  /// 延迟滚动到底部，等待列表项插入动画完成
  void _scheduleScrollToBottom() {
    Future.delayed(AppAnimations.duration(context, AppAnimations.normal), () {
      if (mounted) _scrollToBottom();
    });
  }

  /// 同步渲染项列表与 AnimatedList 状态
  ///
  /// 处理三种场景：
  /// 1. 会话切换 / 历史首次加载 / 搜索大量过滤：重建 AnimatedList，触发历史淡入
  /// 2. 动画禁用时：直接替换项
  /// 3. 增量更新：通过 diff 计算插入/删除项，应用动画
  void _syncItems() {
    final messagesAsync = widget.messagesAsync;
    final chatState = widget.chatState;
    if (messagesAsync?.hasValue != true) return;

    final allMessages = _mergeAndSort(messagesAsync!.value!, chatState);
    final newItems = _buildRenderItems(allMessages, chatState);
    final disableAnimations = MediaQuery.of(context).disableAnimations;

    // 会话切换：完全重置列表状态并重建 AnimatedList
    if (widget.activeConversationId != _lastConversationId) {
      _lastConversationId = widget.activeConversationId;
      _hasInitialScrolled = false;
      _items
        ..clear()
        ..addAll(newItems);
      _listKey = GlobalKey<AnimatedListState>();
      if (newItems.isNotEmpty) {
        _startHistoryFadeAnimation();
        _scheduleInitialScroll();
      }
      if (mounted) setState(() {});
      return;
    }

    // 历史消息首次加载（空列表 -> 有列表）
    if (_items.isEmpty && newItems.isNotEmpty) {
      _items.addAll(newItems);
      _listKey = GlobalKey<AnimatedListState>();
      _startHistoryFadeAnimation();
      _scheduleInitialScroll();
      if (mounted) setState(() {});
      return;
    }

    // 计算 diff：按 Key 判断新增/删除
    final oldKeys = _items.asMap().map((i, item) => MapEntry(item.key, i));
    final newKeys = newItems.asMap().map((i, item) => MapEntry(item.key, i));

    final removedIndices = <int>[];
    for (int i = _items.length - 1; i >= 0; i--) {
      if (!newKeys.containsKey(_items[i].key)) {
        removedIndices.add(i);
      }
    }

    final insertedIndices = <int>[];
    for (int i = 0; i < newItems.length; i++) {
      if (!oldKeys.containsKey(newItems[i].key)) {
        insertedIndices.add(i);
      }
    }

    // 大量变更（如搜索过滤）或动画禁用时直接重建，避免动画混乱
    if (disableAnimations ||
        removedIndices.length + insertedIndices.length > 3) {
      _items
        ..clear()
        ..addAll(newItems);
      _listKey = GlobalKey<AnimatedListState>();
      if (mounted) setState(() {});
      return;
    }

    // 删除项（从高索引到低索引，保持索引有效）
    for (final index in removedIndices) {
      final removed = _items[index];
      _listKey.currentState?.removeItem(
        index,
        (context, animation) => _buildRemovedItem(removed, animation),
        duration: AppAnimations.duration(context, AppAnimations.normal),
      );
      _items.removeAt(index);
    }

    // 插入项（从低索引到高索引，保持目标位置正确）
    for (final index in insertedIndices) {
      _items.insert(index, newItems[index]);
      _listKey.currentState?.insertItem(
        index,
        duration: AppAnimations.duration(context, AppAnimations.normal),
      );
    }

    // 同步已有项的内容变化（如流式更新），并触发重绘
    for (int i = 0; i < newItems.length; i++) {
      if (i < _items.length && _items[i].key == newItems[i].key) {
        _items[i] = newItems[i];
      }
    }

    // 请求滚动到底部时，等待插入动画结束后再滚动
    if (insertedIndices.isNotEmpty && _pendingScrollToBottom) {
      _pendingScrollToBottom = false;
      _scheduleScrollToBottom();
    }

    if (mounted) setState(() {});
  }

  /// 启动历史消息首次加载的淡入动画
  void _startHistoryFadeAnimation() {
    _historyFadeController?.dispose();
    _historyFadeController = AnimationController(
      vsync: this,
      duration: AppAnimations.duration(context, AppAnimations.normal),
    );
    _historyFadeController!.forward();
    if (mounted) setState(() {});
  }

  /// 首次有消息时滚动到底部
  void _scheduleInitialScroll() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !_hasInitialScrolled) {
        _hasInitialScrolled = true;
        _scrollToBottom();
      }
    });
  }

  /// 构建 AnimatedList 单一项（插入/常规状态）
  Widget _buildItem(
    BuildContext context,
    int index,
    Animation<double> animation,
  ) {
    if (index < 0 || index >= _items.length) return const SizedBox.shrink();
    final item = _items[index];
    final child = item.build(context);
    return RepaintBoundary(
      child: _MessageItemAnimation(
        animation: animation,
        isRemoval: false,
        child: child,
      ),
    );
  }

  /// 构建被删除项的退场动画
  Widget _buildRemovedItem(_RenderItem item, Animation<double> animation) {
    return RepaintBoundary(
      child: _MessageItemAnimation(
        animation: animation,
        isRemoval: true,
        child: item.build(context),
      ),
    );
  }

  /// 历史消息整体淡入+顶部滑入包装
  Widget _buildHistoryFade({required Widget child}) {
    final controller = _historyFadeController;
    if (controller == null) return child;
    final disable = AppAnimations.disableAnimationsOf(context);
    return AnimatedBuilder(
      animation: controller,
      builder: (context, childWidget) {
        final value = disable ? 1.0 : controller.value;
        return Opacity(
          opacity: value,
          child: Transform.translate(
            offset: Offset(0, disable ? 0 : -12 * (1 - value)),
            child: childWidget,
          ),
        );
      },
      child: child,
    );
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
            return Stack(
              children: [
                _buildHistoryFade(
                  child: AnimatedList(
                    key: _listKey,
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    initialItemCount: _items.length,
                    itemBuilder: _buildItem,
                  ),
                ),
                Positioned(
                  right: 16,
                  bottom: 8,
                  child: AnimatedScale(
                    scale: _showScrollToBottom ? 1.0 : 0.0,
                    duration: AppAnimations.duration(
                      context,
                      AppAnimations.quick,
                    ),
                    curve: AppAnimations.curve(
                      context,
                      _showScrollToBottom
                          ? AppAnimations.spring
                          : AppAnimations.easeIn,
                    ),
                    child: AnimatedOpacity(
                      opacity: _showScrollToBottom ? 1.0 : 0.0,
                      duration: AppAnimations.duration(
                        context,
                        AppAnimations.quick,
                      ),
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

  /// 根据消息在列表中的位置与全局状态推导气泡发送状态
  MessageBubbleStatus? _deriveMessageStatus(
    ChatMessage message,
    int index,
    int lastUserIndex,
  ) {
    if (message.role != 'user') return null;
    if (message.id.startsWith('-')) return MessageBubbleStatus.sending;
    if (index != lastUserIndex) return null;
    if (widget.chatState.error != null) return MessageBubbleStatus.failed;
    return MessageBubbleStatus.sent;
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

    // 最后一条用户消息索引，用于显示发送中/成功/失败状态
    final lastUserIndex = filteredMessages.lastIndexWhere(
      (m) => m.role == 'user',
    );

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

      // 当前消息的发送状态（仅用户消息有效）
      final messageStatus = _deriveMessageStatus(message, i, lastUserIndex);

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
                  animateEntrance: false,
                  createdAt: message.createdAt,
                  onDelete: baseOnDelete,
                  onCopy: () =>
                      ref.read(toastProvider.notifier).show('已复制到剪贴板'),
                  assistantAvatar: avatarBytes,
                  searchQuery: isMatch ? searchQuery : null,
                  isSearchMatch: isFocused,
                  status: null,
                  key: ValueKey('${message.id}_p$p'),
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
                  status: null,
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
          (_) => MessageBubble(
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
            animateEntrance: false,
            isStreaming: isStreamingTarget,
            isCompactSummary: message.isCompactSummary,
            isCompactBoundary: isCompactBoundary,
            assistantAvatar: avatarBytes,
            searchQuery: isMatch ? searchQuery : null,
            isSearchMatch: isFocused,
            status: messageStatus,
            onDelete: !message.id.startsWith('-') && !isStreamingTarget
                ? () => ref
                      .read(chatNotifierProvider.notifier)
                      .deleteMessage(message.id)
                : null,
            onCopy: () => ref.read(toastProvider.notifier).show('已复制到剪贴板'),
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
    MessageBubbleStatus? status,
    Key? key,
  }) {
    return _RenderItem(
      (_) => MessageBubble(
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
        status: status,
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

/// 列表项动画包装 — 插入时从底部滑入+淡入，删除时向顶部淡出+缩小
class _MessageItemAnimation extends StatelessWidget {
  final Animation<double> animation;
  final Widget child;
  final bool isRemoval;

  const _MessageItemAnimation({
    required this.animation,
    required this.child,
    required this.isRemoval,
  });

  @override
  Widget build(BuildContext context) {
    final disable = AppAnimations.disableAnimationsOf(context);
    if (disable) return child;

    final curve = AppAnimations.curve(
      context,
      isRemoval ? AppAnimations.easeIn : AppAnimations.easeOutBack,
    );

    return AnimatedBuilder(
      animation: animation,
      builder: (context, childWidget) {
        final value = curve.transform(animation.value);
        final translateY = isRemoval ? -20.0 * (1 - value) : 20.0 * (1 - value);
        final scale = isRemoval ? 0.96 + 0.04 * value : 1.0;
        return Opacity(
          opacity: value.clamp(0.0, 1.0),
          child: Transform.translate(
            offset: Offset(0, translateY),
            child: Transform.scale(
              scale: scale,
              alignment: isRemoval
                  ? Alignment.topCenter
                  : Alignment.bottomCenter,
              child: childWidget,
            ),
          ),
        );
      },
      child: child,
    );
  }
}
