/// 聊天页面代理操作 Mixin — 压缩 / 记忆提取 / 梦境整固
///
/// 将 [_ChatPageState] 中的代理操作逻辑抽出，
/// 通过 toast/loading 回调与宿主状态解耦，避免 mixin 直接持有业务字段。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/di/chat_provider.dart';
import '../../core/di/providers.dart';
import '../../core/di/toast_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';

/// 聊天页面代理操作 Mixin
///
/// 宿主需为 [ConsumerState] 并提供两个回调：
/// - [setAgentLoading]：切换某类代理操作的 loading 状态
/// - [notifyScrollToBottom]：消息发送成功后触发滚动到底部
mixin ChatAgentActionsMixin<W extends ConsumerStatefulWidget>
    on ConsumerState<W> {
  /// 切换代理操作 loading 状态（由宿主实现，通常调用 setState）
  void setAgentLoading(String key, bool value);

  /// 通知宿主滚动消息列表到底部
  void notifyScrollToBottom();

  /// 发送消息 — 处理 /compact 命令和普通消息发送
  Future<void> sendChatMessage(String text) async {
    if (text.toLowerCase().startsWith('/compact')) {
      final parts = text.trim().split(' ');
      final customInstructions = parts.length > 1
          ? parts.sublist(1).join(' ')
          : null;
      await manualCompact(customInstructions: customInstructions);
      return;
    }
    await ref.read(chatNotifierProvider.notifier).sendMessage(text);
    notifyScrollToBottom();
    await checkCompactStatus();
  }

  /// 手动触发上下文压缩，可选传入自定义指令
  Future<void> manualCompact({String? customInstructions}) async {
    final conversationId = ref.read(activeConversationIdProvider);
    if (conversationId == null) return;

    setAgentLoading('compact', true);
    try {
      final repo = ref.read(chatRepositoryProvider);
      await repo.compactConversation(
        conversationId: conversationId,
        model: ref.read(selectedModelProvider),
        customInstructions: customInstructions,
      );
      ref.invalidate(conversationMessagesProvider(conversationId));
      if (mounted) {
        ref.read(toastProvider.notifier).show('Conversation compacted');
      }
    } catch (e) {
      if (mounted) {
        ref.read(toastProvider.notifier).show('Compact failed: $e');
      }
    } finally {
      if (mounted) setAgentLoading('compact', false);
    }
  }

  /// 触发会话记忆提取
  Future<void> triggerSessionMemory() async {
    final conversationId = ref.read(activeConversationIdProvider);
    if (conversationId == null) return;

    setAgentLoading('memory', true);
    try {
      final repo = ref.read(chatRepositoryProvider);
      final result = await repo.extractSessionMemory(conversationId);
      final success = result['success'] as bool? ?? false;
      if (mounted) {
        if (success) {
          ref.read(toastProvider.notifier).show('Session memory extracted');
        } else {
          final message = result['message'] as String? ?? 'Unknown error';
          ref.read(toastProvider.notifier).show('Extraction failed: $message');
        }
      }
    } catch (e) {
      if (mounted) {
        ref.read(toastProvider.notifier).show('Extraction failed: $e');
      }
    } finally {
      if (mounted) setAgentLoading('memory', false);
    }
  }

  /// 触发后台梦境整固任务。
  ///
  /// 注意：dream loading 不在 finally 中关闭，
  /// 需等 dream_activity WebSocket 事件到达后由宿主调用
  /// setAgentLoading('dream', false) 关闭。
  Future<void> triggerDream() async {
    setAgentLoading('dream', true);
    try {
      final repo = ref.read(chatRepositoryProvider);
      await repo.triggerDream();
      if (mounted) {
        ref.read(toastProvider.notifier).show('整固任务已启动');
      }
    } catch (e) {
      if (mounted) {
        ref.read(toastProvider.notifier).show('整固启动失败: $e');
        setAgentLoading('dream', false);
      }
    }
  }

  /// 检查当前对话的 Token 使用状态，超出警告阈值时弹窗提示压缩
  Future<void> checkCompactStatus() async {
    final conversationId = ref.read(activeConversationIdProvider);
    if (conversationId == null) return;

    try {
      final repo = ref.read(chatRepositoryProvider);
      final status = await repo.getCompactStatus(
        conversationId: conversationId,
      );
      final warningState = status['warning_state'] as Map<String, dynamic>?;
      if (warningState != null && mounted) {
        final isAboveWarning =
            warningState['is_above_warning_threshold'] as bool? ?? false;
        if (isAboveWarning) {
          showTokenWarning();
        }
      }
    } catch (e) {
      debugPrint('[ChatPage] checkCompactStatus failed: $e');
    }
  }

  /// 显示 Token 接近上限的 SnackBar 警告
  void showTokenWarning() {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 5),
        content: Row(
          children: [
            const Icon(Icons.warning_amber_rounded, color: AppColors.warning),
            AppSpacing.hSM,
            const Expanded(
              child: Text(
                'Context nearing token limit. Use /compact to compress.',
              ),
            ),
          ],
        ),
        action: SnackBarAction(label: 'Compact', onPressed: manualCompact),
      ),
    );
  }
}
