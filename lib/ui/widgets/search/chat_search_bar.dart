/// 聊天搜索栏 — 消息内容搜索与匹配导航
///
/// 提供搜索输入框，实时过滤当前对话消息。匹配时显示结果计数和上/下导航按钮，
/// 无匹配时显示"无匹配"提示。关闭时自动清除搜索状态。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/chat_search_provider.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';

/// 聊天搜索栏组件 — 输入框 + 匹配计数 + 上/下导航 + 关闭按钮
class ChatSearchBar extends ConsumerStatefulWidget {
  final VoidCallback onClose;
  final void Function(String query) onSearchChanged;

  const ChatSearchBar({
    super.key,
    required this.onClose,
    required this.onSearchChanged,
  });

  @override
  ConsumerState<ChatSearchBar> createState() => _ChatSearchBarState();
}

class _ChatSearchBarState extends ConsumerState<ChatSearchBar> {
  final _controller = TextEditingController();

  @override
  void initState() {
    super.initState();
    _controller.text = ref.read(chatSearchProvider).query;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final searchState = ref.watch(chatSearchProvider);

    return Container(
      color: AppColors.bgSecondary,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.mdSm, vertical: AppSpacing.sm),
      child: Row(
        children: [
          const Icon(Icons.search, color: AppColors.textSecondary, size: 20),
          AppSpacing.hSM,
          Expanded(
            child: TextField(
              controller: _controller,
              autofocus: true,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: AppTypography.body,
              ),
              decoration: const InputDecoration(
                hintText: '搜索消息...',
                hintStyle: TextStyle(
                  color: AppColors.textTertiary,
                  fontSize: AppTypography.body,
                ),
                border: InputBorder.none,
                contentPadding: EdgeInsets.symmetric(vertical: 8),
              ),
              onChanged: widget.onSearchChanged,
            ),
          ),
          if (searchState.hasMatches) ...[
            Text(
              '${(searchState.currentMatchIndex >= 0 ? searchState.currentMatchIndex : 0) + 1} / ${searchState.matchIndices.length}',
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: AppTypography.caption,
              ),
            ),
            AppSpacing.hXS,
            IconButton(
              icon: const Icon(
                Icons.keyboard_arrow_up,
                color: AppColors.textSecondary,
                size: 20,
              ),
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              padding: EdgeInsets.zero,
              onPressed: () =>
                  ref.read(chatSearchProvider.notifier).previousMatch(),
            ),
            IconButton(
              icon: const Icon(
                Icons.keyboard_arrow_down,
                color: AppColors.textSecondary,
                size: 20,
              ),
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              padding: EdgeInsets.zero,
              onPressed: () =>
                  ref.read(chatSearchProvider.notifier).nextMatch(),
            ),
          ] else if (searchState.isActive)
            const Text(
              '无匹配',
              style: TextStyle(color: AppColors.textTertiary, fontSize: 12),
            ),
          IconButton(
            icon: const Icon(
              Icons.close,
              color: AppColors.textSecondary,
              size: 18,
            ),
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            padding: EdgeInsets.zero,
            onPressed: () {
              ref.read(chatSearchProvider.notifier).clearSearch();
              widget.onClose();
            },
          ),
        ],
      ),
    );
  }
}
