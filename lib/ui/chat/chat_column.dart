/// 聊天主体列 — 错误提示 + 搜索栏 + 消息列表 + 输入栏
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/di/chat_provider.dart';
import '../../core/di/chat_search_provider.dart';
import '../../core/theme/app_animations.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../data/models/chat_message.dart';
import '../widgets/modern_input_bar.dart';
import '../widgets/search/chat_search_bar.dart';
import 'message_list.dart';

/// 聊天主体列：错误提示 + 搜索栏 + 消息列表 + 输入栏
class ChatColumn extends ConsumerStatefulWidget {
  final ChatState chatState;
  final AsyncValue<List<ChatMessage>>? messagesAsync;
  final String? activeConversationId;
  final bool isMainAgent;
  final bool isSearchVisible;
  final VoidCallback onCloseSearch;
  final Future<void> Function(String text) onSendMessage;
  final int scrollToBottomRequest;

  const ChatColumn({
    super.key,
    required this.chatState,
    this.messagesAsync,
    this.activeConversationId,
    required this.isMainAgent,
    required this.isSearchVisible,
    required this.onCloseSearch,
    required this.onSendMessage,
    this.scrollToBottomRequest = 0,
  });

  @override
  ConsumerState<ChatColumn> createState() => _ChatColumnState();
}

class _ChatColumnState extends ConsumerState<ChatColumn> {
  final _messageController = TextEditingController();
  // UI-only slider state; actual API params are read from settingsCacheProvider
  double _temperature = 0.7;
  int _maxTokens = 384000;

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  /// 处理发送：提取文本、清空输入框、回调父组件
  Future<void> _handleSend() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;
    _messageController.clear();
    await widget.onSendMessage(text);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // 错误提示栏
        AnimatedSize(
          duration: AppAnimations.page,
          curve: AppAnimations.easeOutBack,
          alignment: Alignment.topCenter,
          child: widget.chatState.error != null
              ? Container(
                  width: double.infinity,
                  color: AppColors.errorBg,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.error_outline,
                        color: AppColors.error,
                        size: 18,
                      ),
                      AppSpacing.hSM,
                      Expanded(
                        child: Text(
                          widget.chatState.error!.message,
                          style: const TextStyle(
                            color: AppColors.error,
                            fontSize: 13,
                          ),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(
                          Icons.close,
                          color: AppColors.error,
                          size: 18,
                        ),
                        onPressed: () =>
                            ref.read(chatNotifierProvider.notifier).clearError(),
                      ),
                    ],
                  ),
                )
              : const SizedBox.shrink(),
        ),
        // 搜索栏
        AnimatedSize(
          duration: AppAnimations.page,
          curve: AppAnimations.easeOutBack,
          alignment: Alignment.topCenter,
          child: widget.isSearchVisible
              ? ChatSearchBar(
                  onClose: widget.onCloseSearch,
                  onSearchChanged: (q) {
                    final messages = widget.messagesAsync?.valueOrNull ?? [];
                    final contents = messages.map((m) => m.content).toList();
                    ref.read(chatSearchProvider.notifier).setQuery(q, contents);
                  },
                )
              : const SizedBox.shrink(),
        ),
        // 消息列表
        Expanded(
          child: widget.activeConversationId == null
              ? const SizedBox.shrink()
              : ChatMessageList(
                  messagesAsync: widget.messagesAsync,
                  chatState: widget.chatState,
                  activeConversationId: widget.activeConversationId,
                  isSearchVisible: widget.isSearchVisible,
                  scrollToBottomRequest: widget.scrollToBottomRequest,
                ),
        ),
        // 输入栏或只读提示
        if (widget.isMainAgent)
          ModernInputBar(
            controller: _messageController,
            isLoading: widget.chatState.isLoading,
            onSend: _handleSend,
            temperature: _temperature,
            maxTokens: _maxTokens,
            onTemperatureChanged: (v) => setState(() => _temperature = v),
            onMaxTokensChanged: (v) => setState(() => _maxTokens = v),
          )
        else
          SafeArea(
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: const BoxDecoration(
                color: AppColors.bgSecondary,
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: const Text(
                '仅显示输出内容',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textTertiary, fontSize: 13),
              ),
            ),
          ),
      ],
    );
  }
}
