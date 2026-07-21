/// 聊天区域 Scaffold — 标题栏悬浮按钮 + 动态岛 + 聊天主体
///
/// 从 [_ChatPageState._buildChatScaffold] 抽取的纯 UI 组装组件，
/// 负责消息区、动态岛、返回/菜单按钮的叠加布局。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:go_router/go_router.dart';

import '../../core/di/chat_background_provider.dart';
import '../../core/di/chat_provider.dart';
import '../../core/theme/app_animations.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../data/models/chat_message.dart';
import '../widgets/dynamic_island/dynamic_island_overlay.dart';
import 'chat_column.dart';
import 'chat_popup_menu.dart';
import 'chat_progress_utils.dart';

/// 聊天区域 Scaffold
///
/// 在无背景的默认场景下直接返回 [Scaffold]；
/// 当会话配置了渐变背景时，外层包裹 [Container] 应用渐变。
class ChatScaffold extends ConsumerWidget {
  /// 聊天全局状态
  final ChatState chatState;

  /// 当前会话消息列表（可能为 null 表示未选中会话）
  final AsyncValue<List<ChatMessage>>? messagesAsync;

  /// 当前活跃会话 ID
  final String? activeConversationId;

  /// 是否为主代理（控制输入框与动态岛显隐）
  final bool isMainAgent;

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

  const ChatScaffold({
    super.key,
    required this.chatState,
    required this.messagesAsync,
    required this.activeConversationId,
    required this.isMainAgent,
    required this.isSearchVisible,
    required this.onCloseSearch,
    required this.onSendMessage,
    required this.scrollToBottomRequest,
    required this.onPopupMenuSelected,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final progress = computeAgentProgress(
      chatState: chatState,
      isMainAgent: isMainAgent,
    );
    final background = ref.watch(activeConversationBackgroundProvider);
    final bg = resolveChatBackground(background);

    final scaffold = Scaffold(
      backgroundColor: bg.color ?? AppColors.bgPrimary,
      // 使用 Stack 将动态岛与圆形悬浮按钮叠加在聊天内容之上，不再显示顶部横条
      body: Stack(
        children: [
          SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: ChatColumn(
                    chatState: chatState,
                    messagesAsync: messagesAsync,
                    activeConversationId: activeConversationId,
                    isMainAgent: isMainAgent,
                    isSearchVisible: isSearchVisible,
                    onCloseSearch: onCloseSearch,
                    onSendMessage: onSendMessage,
                    scrollToBottomRequest: scrollToBottomRequest,
                  ),
                ),
              ],
            ),
          ),
          // 主代理模式下，动态岛悬浮在最顶层
          if (isMainAgent)
            DynamicIslandOverlay(
              tokenCount: chatState.tokenCount,
              maxTokens: 1000000,
              memoryProgress: progress.memory,
              compactProgress: progress.compact,
              dreamProgress: progress.dream,
            ),
          // 顶部左右悬浮圆形按钮：返回与更多
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.mdSm,
                vertical: AppSpacing.sm,
              ),
              child: Row(
                children: [
                  const _FloatingBackButton(),
                  const Spacer(),
                  ChatPopupMenuButton(onSelected: onPopupMenuSelected),
                ],
              ),
            ),
          ),
        ],
      ),
    );
    if (bg.decoration != null) {
      return Container(decoration: bg.decoration, child: scaffold);
    }
    return scaffold;
  }
}

/// 悬浮圆形返回按钮 — 弹簧入场 + 按压回弹
class _FloatingBackButton extends StatelessWidget {
  const _FloatingBackButton();

  @override
  Widget build(BuildContext context) {
    return AppAnimations.scaleIn(
      curve: AppAnimations.spring,
      duration: AppAnimations.normal,
      child: AppAnimations.scaleTap(
        scaleDown: 0.86,
        onTap: () => context.pop(),
        child: const OrbButton(
          icon: FaIcon(
            FontAwesomeIcons.chevronLeft,
            color: AppColors.textPrimary,
            size: 18,
          ),
          tooltip: '返回',
        ),
      ),
    );
  }
}
