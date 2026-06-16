/// 归档会话页面 — 查看和管理已归档的对话
///
/// 显示所有已归档对话列表，支持取消归档（恢复到活跃列表）和彻底删除操作。
/// 删除前会弹出确认对话框以防误操作。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../core/di/chat_provider.dart';
import '../core/di/providers.dart';
import '../core/theme/app_animations.dart';
import '../core/theme/app_colors.dart';
import '../data/models/conversation.dart';

/// 归档会话页面 — 显示所有已归档对话，支持取消归档和彻底删除
class ArchivePage extends ConsumerWidget {
  const ArchivePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final archivedAsync = ref.watch(archivedConversationsProvider);

    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(
        backgroundColor: AppColors.bgTertiary,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.textSecondary),
          onPressed: () => context.go('/'),
        ),
        title: const Text(
          '归档会话',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: archivedAsync.when(
        data: (conversations) {
          if (conversations.isEmpty) {
            return _buildEmptyState();
          }
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: conversations.length,
            itemBuilder: (context, index) {
              final conversation = conversations[index];
              return _buildConversationCard(context, ref, conversation);
            },
          );
        },
        loading: () => const Center(
          child: CircularProgressIndicator(color: AppColors.green),
        ),
        error: (error, _) => Center(
          child: Text(
            '加载失败: $error',
            style: const TextStyle(color: AppColors.error),
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.archive_outlined,
            size: 64,
            color: AppColors.textTertiary.withValues(alpha: 0.3),
          ),
          const SizedBox(height: 16),
          Text(
            '暂无归档会话',
            style: TextStyle(
              color: AppColors.textTertiary.withValues(alpha: 0.7),
              fontSize: 16,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildConversationCard(
    BuildContext context,
    WidgetRef ref,
    Conversation conversation,
  ) {
    final timeText = _formatTime(conversation.updatedAt);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: AppColors.bgElevated,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Icon(
            Icons.archive,
            color: AppColors.textTertiary,
            size: 22,
          ),
        ),
        title: Text(
          conversation.title,
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontWeight: FontWeight.w600,
            fontSize: 15,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            '归档于 $timeText',
            style: const TextStyle(color: AppColors.textTertiary, fontSize: 12),
          ),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppAnimations.scaleTap(
              onTap: () => ref
                  .read(chatNotifierProvider.notifier)
                  .toggleArchiveConversation(conversation.id, false),
              child: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.cyan.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(
                  Icons.unarchive,
                  color: AppColors.cyan,
                  size: 18,
                ),
              ),
            ),
            const SizedBox(width: 8),
            AppAnimations.scaleTap(
              onTap: () => _confirmDelete(context, ref, conversation),
              child: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.error.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(
                  Icons.delete_outline,
                  color: AppColors.error,
                  size: 18,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmDelete(
    BuildContext context,
    WidgetRef ref,
    Conversation conversation,
  ) async {
    final confirmed = await AppAnimations.showSpringDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('删除会话', style: TextStyle(color: AppColors.error)),
        content: Text(
          '确定要删除"${conversation.title}" 吗？此操作不可恢复',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('删除', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref
          .read(chatNotifierProvider.notifier)
          .deleteConversation(conversation.id);
    }
  }

  String _formatTime(DateTime time) {
    return DateFormat('yyyy-MM-dd HH:mm').format(time.toLocal());
  }
}

/// 归档会话流提供器 — 监听后端归档对话变更
final archivedConversationsProvider =
    StreamProvider<List<Conversation>>((ref) {
      final repo = ref.watch(chatRepositoryProvider);
      return repo.watchArchivedConversations();
    });
