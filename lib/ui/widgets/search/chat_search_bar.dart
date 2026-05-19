import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/chat_search_provider.dart';
import '../../../core/theme/app_colors.dart';

/// 聊天搜索栏
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          const Icon(Icons.search, color: AppColors.textSecondary, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: _controller,
              autofocus: true,
              style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
              decoration: const InputDecoration(
                hintText: '搜索消息...',
                hintStyle: TextStyle(color: AppColors.textTertiary, fontSize: 14),
                border: InputBorder.none,
                contentPadding: EdgeInsets.symmetric(vertical: 8),
              ),
              onChanged: widget.onSearchChanged,
            ),
          ),
          if (searchState.hasMatches) ...[
            Text(
              '${searchState.currentMatchIndex + 1} / ${searchState.matchIndices.length}',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
            ),
            const SizedBox(width: 4),
            IconButton(
              icon: const Icon(Icons.keyboard_arrow_up, color: AppColors.textSecondary, size: 20),
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              padding: EdgeInsets.zero,
              onPressed: () => ref.read(chatSearchProvider.notifier).previousMatch(),
            ),
            IconButton(
              icon: const Icon(Icons.keyboard_arrow_down, color: AppColors.textSecondary, size: 20),
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              padding: EdgeInsets.zero,
              onPressed: () => ref.read(chatSearchProvider.notifier).nextMatch(),
            ),
          ] else if (searchState.isActive)
            const Text('无匹配', style: TextStyle(color: AppColors.textTertiary, fontSize: 12)),
          IconButton(
            icon: const Icon(Icons.close, color: AppColors.textSecondary, size: 18),
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
