/// 对话列表页面 — 活跃对话的浏览与管理
///
/// 显示所有活跃对话，支持搜索过滤、新建对话、重命名、归档和删除操作。
/// 点击对话项跳转到聊天页面，底部提供"查看归档"入口。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_animations.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_radius.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/time_formatters.dart';
import '../../data/models/conversation.dart';

/// 对话列表页面 — 显示所有对话，支持搜索、新建、重命名、归档和删除
class ConversationListPage extends ConsumerStatefulWidget {
  final AsyncValue<List<Conversation>> conversationsAsync;
  final String? activeConversationId;
  final VoidCallback onCreate;
  final ValueChanged<String> onSwitch;
  final ValueChanged<String> onDelete;
  final void Function(String id, String newTitle) onRename;
  final void Function(String id, bool isArchived) onArchive;
  final VoidCallback? onViewArchive;

  const ConversationListPage({
    super.key,
    required this.conversationsAsync,
    required this.activeConversationId,
    required this.onCreate,
    required this.onSwitch,
    required this.onDelete,
    required this.onRename,
    required this.onArchive,
    this.onViewArchive,
  });

  @override
  ConsumerState<ConversationListPage> createState() =>
      _ConversationListPageState();
}

class _ConversationListPageState extends ConsumerState<ConversationListPage> {
  String _searchQuery = '';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            _buildSearchBar(),
            const Divider(height: 1, color: AppColors.divider),
            Expanded(
              child: widget.conversationsAsync.when(
                data: (conversations) {
                  final filtered = conversations
                      .where(
                        (c) => c.title.toLowerCase().contains(
                          _searchQuery.toLowerCase(),
                        ),
                      )
                      .toList();
                  if (filtered.isEmpty) {
                    return _buildEmptyState();
                  }
                  return ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    itemCount: filtered.length,
                    itemBuilder: (context, index) {
                      final conversation = filtered[index];
                      return _buildConversationItem(conversation, index);
                    },
                  );
                },
                loading: () => const Center(
                  child: CircularProgressIndicator(color: AppColors.green),
                ),
                error: (error, _) => Center(
                  child: Text(
                    'Failed to load: $error',
                    style: const TextStyle(color: AppColors.error),
                  ),
                ),
              ),
            ),
            if (widget.onViewArchive != null) _buildArchiveFooter(),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 16, 12),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: const BoxDecoration(
              color: AppColors.surface,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.chat_bubble,
              color: AppColors.textSecondary,
              size: 18,
            ),
          ),
          AppSpacing.hMDSm,
          const Expanded(
            child: Text(
              '消息',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: AppTypography.headline,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          AppAnimations.scaleTap(
            onTap: widget.onCreate,
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: AppRadius.mdAll,
              ),
              child: const Icon(
                Icons.add,
                color: AppColors.textSecondary,
                size: 22,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: AppRadius.mdAll,
          border: Border.all(color: AppColors.border),
        ),
        child: TextField(
          onChanged: (value) => setState(() => _searchQuery = value),
          style: const TextStyle(color: AppColors.textPrimary, fontSize: AppTypography.body),
          decoration: const InputDecoration(
            hintText: '搜索对话...',
            hintStyle: TextStyle(color: AppColors.textTertiary),
            prefixIcon: Icon(
              Icons.search,
              color: AppColors.textTertiary,
              size: 20,
            ),
            border: InputBorder.none,
            contentPadding: EdgeInsets.symmetric(vertical: 12),
          ),
        ),
      ),
    );
  }

  Widget _buildConversationItem(Conversation conversation, int index) {
    final isActive = conversation.id == widget.activeConversationId;
    final timeText = _formatTime(conversation.updatedAt);

    return AppAnimations.staggerItem(
      index: index,
      child: AppAnimations.scaleTap(
        onTap: () {
          widget.onSwitch(conversation.id);
          context.push('/chat');
        },
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
          decoration: BoxDecoration(
            color: isActive ? AppColors.surfaceHover : Colors.transparent,
            borderRadius: AppRadius.smAll,
          ),
          child: ListTile(
            dense: true,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 2,
            ),
            leading: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: isActive
                    ? AppColors.green.withValues(alpha: 0.15)
                    : AppColors.surface,
                borderRadius: AppRadius.mdAll,
              ),
              child: Icon(
                Icons.chat_outlined,
                color: isActive ? AppColors.green : AppColors.textSecondary,
                size: 20,
              ),
            ),
            title: Text(
              conversation.title,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: isActive ? AppColors.green : AppColors.textPrimary,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
                fontSize: AppTypography.body,
              ),
            ),
            subtitle: Text(
              timeText,
              style: const TextStyle(color: AppColors.textTertiary, fontSize: 11),
            ),
            trailing: PopupMenuButton<String>(
              icon: const Icon(
                Icons.more_vert,
                color: AppColors.textTertiary,
                size: 18,
              ),
              color: AppColors.surface,
              onSelected: (value) {
                switch (value) {
                  case 'rename':
                    _showRenameDialog(conversation.id, conversation.title);
                  case 'archive':
                    widget.onArchive(conversation.id, true);
                  case 'delete':
                    widget.onDelete(conversation.id);
                }
              },
              itemBuilder: (context) => [
                PopupMenuItem(
                  value: 'rename',
                  child: Row(
                    children: [
                      const Icon(Icons.edit, color: AppColors.textSecondary, size: 18),
                      AppSpacing.hSM,
                      const Text('重命名', style: TextStyle(color: AppColors.textPrimary)),
                    ],
                  ),
                ),
                PopupMenuItem(
                  value: 'archive',
                  child: Row(
                    children: [
                      const Icon(
                        Icons.archive,
                        color: AppColors.textSecondary,
                        size: 18,
                      ),
                      AppSpacing.hSM,
                      const Text('归档', style: TextStyle(color: AppColors.textPrimary)),
                    ],
                  ),
                ),
                PopupMenuItem(
                  value: 'delete',
                  child: Row(
                    children: [
                      const Icon(Icons.delete, color: AppColors.error, size: 18),
                      AppSpacing.hSM,
                      const Text('删除', style: TextStyle(color: AppColors.error)),
                    ],
                  ),
                ),
              ],
            ),
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
            Icons.chat_bubble_outline,
            size: 48,
            color: AppColors.textTertiary.withValues(alpha: 0.5),
          ),
          AppSpacing.vMDSm,
          Text(
            '暂无对话',
            style: TextStyle(
              color: AppColors.textTertiary.withValues(alpha: 0.7),
              fontSize: AppTypography.body,
            ),
          ),
          AppSpacing.vMD,
          ElevatedButton.icon(
            onPressed: widget.onCreate,
            icon: const Icon(Icons.add, size: 18),
            label: const Text('新建对话'),
          ),
        ],
      ),
    );
  }

  Widget _buildArchiveFooter() {
    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.divider)),
      ),
      child: ListTile(
        dense: true,
        leading: const Icon(
          Icons.archive_outlined,
          color: AppColors.textTertiary,
          size: 20,
        ),
        title: const Text(
          '查看归档',
          style: TextStyle(color: AppColors.textTertiary, fontSize: AppTypography.body),
        ),
        onTap: () {
          widget.onViewArchive!();
        },
      ),
    );
  }

  Future<void> _showRenameDialog(String id, String currentTitle) async {
    final controller = TextEditingController(text: currentTitle);
    final confirmed = await AppAnimations.showSpringDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.lgAll),
        title: const Text(
          '重命名对话',
          style: TextStyle(color: AppColors.textPrimary),
        ),
        content: TextField(
          controller: controller,
          style: const TextStyle(color: AppColors.textPrimary),
          decoration: const InputDecoration(
            labelText: '新标题',
            labelStyle: TextStyle(color: AppColors.textSecondary),
          ),
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('保存'),
          ),
        ],
      ),
    );
    if (confirmed == true && controller.text.trim().isNotEmpty) {
      widget.onRename(id, controller.text.trim());
    }
    controller.dispose();
  }

  String _formatTime(DateTime time) {
    return TimeFormatters.relativeTime(time);
  }
}
