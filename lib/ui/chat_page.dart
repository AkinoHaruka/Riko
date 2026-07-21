/// 聊天页面 — 应用核心交互入口
///
/// 负责分栏/单栏布局切换、WebSocket 事件订阅、代理操作与菜单动作的调度。
/// 具体实现已拆分到 lib/ui/chat/ 下的独立模块：
/// - chat_agent_actions_mixin.dart：压缩 / 记忆 / 梦境操作
/// - chat_menu_actions_mixin.dart：头像 / 搜索 / 背景 / 清空记录
/// - chat_scaffold.dart：聊天区 Scaffold（动态岛 + 悬浮按钮 + 消息列）
/// - chat_split_view.dart：宽屏分栏布局（聊天 + 终端面板）
/// - chat_progress_utils.dart：代理进度与背景解析纯函数
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/di/chat_provider.dart';
import '../core/di/providers.dart';
import '../core/di/settings_cache.dart';
import '../core/di/toast_provider.dart';
import 'chat/chat_agent_actions_mixin.dart';
import 'chat/chat_menu_actions_mixin.dart';
import 'chat/chat_scaffold.dart';
import 'chat/chat_split_view.dart';
import 'chat/websocket_listener_mixin.dart';

/// 聊天页面 — 核心交互入口
class ChatPage extends ConsumerStatefulWidget {
  const ChatPage({super.key});

  @override
  ConsumerState<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends ConsumerState<ChatPage>
    with
        WidgetsBindingObserver,
        WebSocketListenerMixin<ChatPage>,
        ChatAgentActionsMixin<ChatPage>,
        ChatMenuActionsMixin<ChatPage> {
  bool _isSessionMemoryLoading = false;
  bool _isCompactLoading = false;
  bool _isDreamLoading = false;
  bool _isSearchVisible = false;
  int _scrollToBottomRequest = 0;

  /// 上一次键盘高度，用于检测软键盘弹出/收起
  double _lastViewInsetBottom = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Future.microtask(() async {
      // 初始化面板比例、设置缓存、代理会话
      await ref.read(panelRatioProvider.notifier).init();
      if (!mounted) return;
      await ref.read(settingsCacheInitProvider.future);
      if (!mounted) return;
      await ref.read(chatNotifierProvider.notifier).ensureAgentConversations();
      if (!mounted) return;
      ref.read(chatNotifierProvider.notifier).updateAgentParams();
      // 延迟到首帧之后，避免动画初始化期间的帧冲突
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          ref.read(chatNotifierProvider.notifier).fetchTokenStatus();
        }
      });
      if (!mounted) return;
      // 初始化 WebSocket 监听
      initWebSocketListener();
    });
  }

  @override
  void onWebSocketActivity(Map<String, dynamic> activity, String eventType) {
    if (eventType == 'dream_activity') {
      setAgentLoading('dream', false);
      final status = activity['status'] as String?;
      if (status == 'completed') {
        final sessionsReviewed = activity['sessionsReviewed'];
        ref
            .read(toastProvider.notifier)
            .show('梦境整理完成 (审查 $sessionsReviewed 个会话)');
      }
    }
  }

  @override
  void dispose() {
    disposeWebSocketListener();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// 监听窗口尺寸变化（如软键盘弹出），触发重建以调整布局
  @override
  void didChangeMetrics() {
    super.didChangeMetrics();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final bottomInset = MediaQuery.of(context).viewInsets.bottom;
      if (bottomInset != _lastViewInsetBottom) {
        _lastViewInsetBottom = bottomInset;
        setState(() {});
      }
    });
  }

  // ---------------------------------------------------------------------------
  // ChatAgentActionsMixin 接口实现
  // ---------------------------------------------------------------------------

  @override
  void setAgentLoading(String key, bool value) {
    setState(() {
      switch (key) {
        case 'memory':
          _isSessionMemoryLoading = value;
        case 'compact':
          _isCompactLoading = value;
        case 'dream':
          _isDreamLoading = value;
      }
    });
  }

  @override
  void notifyScrollToBottom() {
    setState(() => _scrollToBottomRequest++);
  }

  // ---------------------------------------------------------------------------
  // ChatMenuActionsMixin 接口实现
  // ---------------------------------------------------------------------------

  @override
  void onSearchMenuSelected() {
    setState(() => _isSearchVisible = true);
  }

  // ---------------------------------------------------------------------------
  // 布局构建
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    // 监听设置变更并同步更新代理参数
    ref.listen(settingsCacheProvider, (prev, next) {
      ref.read(chatNotifierProvider.notifier).updateAgentParams();
    });
    // 监听当前活跃会话和代理类型
    final activeConversationId = ref.watch(activeConversationIdProvider);
    final activeAgentType = ref.watch(activeAgentTypeProvider);
    final chatState = ref.watch(chatNotifierProvider);
    final messagesAsync = activeConversationId != null
        ? ref.watch(conversationMessagesProvider(activeConversationId))
        : null;

    return LayoutBuilder(
      builder: (context, constraints) {
        // 宽高比 > 1.0 时启用左右分栏布局
        final ratio =
            constraints.maxWidth /
            constraints.maxHeight.clamp(1, double.infinity);
        final showSplit = ratio > 1.0;

        if (showSplit) {
          return ChatSplitView(
            chatState: chatState,
            messagesAsync: messagesAsync,
            activeConversationId: activeConversationId,
            activeAgentType: activeAgentType,
            isSessionMemoryLoading: _isSessionMemoryLoading,
            isCompactLoading: _isCompactLoading,
            isDreamLoading: _isDreamLoading,
            isSearchVisible: _isSearchVisible,
            onCloseSearch: () => setState(() => _isSearchVisible = false),
            onSendMessage: sendChatMessage,
            scrollToBottomRequest: _scrollToBottomRequest,
            onPopupMenuSelected: onPopupMenuSelected,
            onTriggerSessionMemory: activeConversationId != null
                ? triggerSessionMemory
                : null,
            onTriggerCompact: activeConversationId != null
                ? () => manualCompact()
                : null,
            onTriggerDream: triggerDream,
            subAgentActivities: subAgentActivities,
          );
        }

        return ChatScaffold(
          chatState: chatState,
          messagesAsync: messagesAsync,
          activeConversationId: activeConversationId,
          isMainAgent: activeAgentType == 'main',
          isSearchVisible: _isSearchVisible,
          onCloseSearch: () => setState(() => _isSearchVisible = false),
          onSendMessage: sendChatMessage,
          scrollToBottomRequest: _scrollToBottomRequest,
          onPopupMenuSelected: onPopupMenuSelected,
        );
      },
    );
  }
}
