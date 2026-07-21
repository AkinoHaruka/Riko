/// 聊天页面宽屏分栏视图 — 聊天区 + 可拖拽分隔条 + 终端监控面板
///
/// 仅在宽高比 > 1.0 时由 [ChatPage] 使用，
/// 负责计算左右面板比例并组装分栏布局。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/di/chat_provider.dart';
import '../../core/di/providers.dart';
import '../../data/models/chat_message.dart';
import '../widgets/draggable_splitter.dart';
import '../widgets/terminal_panel.dart';
import 'chat_scaffold.dart';

/// 宽屏分栏视图
class ChatSplitView extends ConsumerWidget {
  /// 聊天全局状态
  final ChatState chatState;

  /// 当前会话消息列表
  final AsyncValue<List<ChatMessage>>? messagesAsync;

  /// 当前活跃会话 ID
  final String? activeConversationId;

  /// 当前活跃代理类型
  final String activeAgentType;

  /// 会话记忆提取是否加载中
  final bool isSessionMemoryLoading;

  /// 上下文压缩是否加载中
  final bool isCompactLoading;

  /// 梦境整固是否加载中
  final bool isDreamLoading;

  /// 是否显示搜索栏
  final bool isSearchVisible;

  /// 关闭搜索栏回调
  final VoidCallback onCloseSearch;

  /// 发送消息回调
  final Future<void> Function(String text) onSendMessage;

  /// 请求滚动到底部的递增计数器
  final int scrollToBottomRequest;

  /// 弹出菜单选择回调
  final void Function(String value) onPopupMenuSelected;

  /// 触发会话记忆提取回调
  final VoidCallback? onTriggerSessionMemory;

  /// 触发上下文压缩回调
  final VoidCallback? onTriggerCompact;

  /// 触发梦境整固回调
  final VoidCallback? onTriggerDream;

  /// 子代理活动记录列表
  final List<Map<String, dynamic>> subAgentActivities;

  const ChatSplitView({
    super.key,
    required this.chatState,
    required this.messagesAsync,
    required this.activeConversationId,
    required this.activeAgentType,
    required this.isSessionMemoryLoading,
    required this.isCompactLoading,
    required this.isDreamLoading,
    required this.isSearchVisible,
    required this.onCloseSearch,
    required this.onSendMessage,
    required this.scrollToBottomRequest,
    required this.onPopupMenuSelected,
    required this.onTriggerSessionMemory,
    required this.onTriggerCompact,
    required this.onTriggerDream,
    required this.subAgentActivities,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final savedRatio = ref.watch(panelRatioProvider);
        final height = constraints.maxHeight;
        final width = constraints.maxWidth;

        final minRatio = (height * 0.5) / width;
        final maxRatio = 1.0 - minRatio;

        final defaultRatio = (height * 9.0 / 16.0) / width;
        var leftRatio = savedRatio;
        if (leftRatio < minRatio || leftRatio > maxRatio) {
          leftRatio = defaultRatio.clamp(minRatio, maxRatio);
        }

        final isMainAgent = activeAgentType == 'main';

        return Row(
          children: [
            SizedBox(
              width: width * leftRatio,
              child: ChatScaffold(
                chatState: chatState,
                messagesAsync: messagesAsync,
                activeConversationId: activeConversationId,
                isMainAgent: isMainAgent,
                isSearchVisible: isSearchVisible,
                onCloseSearch: onCloseSearch,
                onSendMessage: onSendMessage,
                scrollToBottomRequest: scrollToBottomRequest,
                onPopupMenuSelected: onPopupMenuSelected,
              ),
            ),
            DraggableSplitter(
              parentWidth: width,
              leftRatio: leftRatio,
              minRatio: minRatio,
              maxRatio: maxRatio,
              onRatioChanged: (newRatio) {
                ref.read(panelRatioProvider.notifier).setRatio(newRatio);
              },
            ),
            Expanded(
              child: TerminalPanel(
                inputHistory: chatState.apiInputHistory,
                onClear: () => ref
                    .read(chatNotifierProvider.notifier)
                    .clearApiInputHistory(),
                onLoadMore: () => ref
                    .read(chatNotifierProvider.notifier)
                    .loadMoreMonitorRecords(),
                hasMoreData: chatState.hasMoreMonitorRecords,
                onCompact: activeConversationId != null
                    ? onTriggerCompact
                    : null,
                isCompactEnabled: activeConversationId != null,
                subAgentActivities: subAgentActivities,
                hasActiveConversation: activeConversationId != null,
                isSessionMemoryLoading: isSessionMemoryLoading,
                isCompactLoading: isCompactLoading,
                isDreamLoading: isDreamLoading,
                onTriggerSessionMemory: activeConversationId != null
                    ? onTriggerSessionMemory
                    : null,
                onTriggerCompact: activeConversationId != null
                    ? onTriggerCompact
                    : null,
                onTriggerDream: onTriggerDream,
              ),
            ),
          ],
        );
      },
    );
  }
}
