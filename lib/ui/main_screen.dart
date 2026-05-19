
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/di/chat_provider.dart';
import '../core/theme/app_animations.dart';
import '../core/theme/app_colors.dart';
import '../data/models/conversation.dart';
import 'widgets/conversation_list_page.dart';

/// 主页面 — 底部导航栏容器，包含对话列表、联系人（占位）和个人（占位）三个标签页
///
/// 通过 AnimatedSwitcher 实现标签切换的淡入淡出过渡。
class MainScreen extends ConsumerStatefulWidget {
  const MainScreen({super.key});

  @override
  ConsumerState<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends ConsumerState<MainScreen>
    with SingleTickerProviderStateMixin {
  int _selectedIndex = 0;

  static const _tabs = [
    _TabItem(
      label: 'Messages',
      icon: Icons.chat_bubble_outline,
      activeIcon: Icons.chat_bubble,
    ),
    _TabItem(
      label: 'Contacts',
      icon: Icons.contacts_outlined,
      activeIcon: Icons.contacts,
    ),
    _TabItem(
      label: 'Me',
      icon: Icons.person_outline,
      activeIcon: Icons.person,
    ),
  ];

  Future<void> _createConversation() async {
    final controller = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder:
          (context) => AlertDialog(
            backgroundColor: AppColors.surface,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            title: const Text(
              'New Conversation',
              style: TextStyle(color: AppColors.textPrimary),
            ),
            content: TextField(
              controller: controller,
              style: const TextStyle(color: AppColors.textPrimary),
              decoration: const InputDecoration(
                hintText: 'Title (auto-generated if empty)',
                hintStyle: TextStyle(color: AppColors.textTertiary),
              ),
              autofocus: true,
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Cancel'),
              ),
              TextButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Create'),
              ),
            ],
          ),
    );

    if (confirmed == true) {
      final title =
          controller.text.trim().isEmpty
              ? 'New ${DateTime.now().toString().substring(0, 16)}'
              : controller.text.trim();
      await ref.read(chatNotifierProvider.notifier).createConversation(title);
    }
    controller.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final conversationsAsync = ref.watch(conversationsProvider);
    final activeConversationId = ref.watch(activeConversationIdProvider);

    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      body: AnimatedSwitcher(
        duration: const Duration(milliseconds: 200),
        switchInCurve: AppAnimations.easeInOutCubic,
        switchOutCurve: AppAnimations.easeInOutCubic,
        transitionBuilder: (child, animation) {
          return FadeTransition(opacity: animation, child: child);
        },
        child: KeyedSubtree(
          key: ValueKey<int>(_selectedIndex),
          child: _buildTabContent(
            conversationsAsync,
            activeConversationId,
          ),
        ),
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: AppColors.bgSecondary,
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: SafeArea(
          child: SizedBox(
            height: 64,
            child: Row(
              children:
                  _tabs.asMap().entries.map((entry) {
                    final index = entry.key;
                    final tab = entry.value;
                    final isActive = index == _selectedIndex;
                    return Expanded(
                      child: _BottomNavItem(
                        icon: isActive ? tab.activeIcon : tab.icon,
                        label: tab.label,
                        isActive: isActive,
                        onTap: () => setState(() => _selectedIndex = index),
                      ),
                    );
                  }).toList(),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildTabContent(
    AsyncValue<List<Conversation>> conversationsAsync,
    String? activeConversationId,
  ) {
    switch (_selectedIndex) {
      case 0:
        return ConversationListPage(
          conversationsAsync: conversationsAsync,
          activeConversationId: activeConversationId,
          onCreate: _createConversation,
          onSwitch:
              (id) =>
                  ref.read(chatNotifierProvider.notifier).switchConversation(id),
          onDelete:
              (id) =>
                  ref.read(chatNotifierProvider.notifier).deleteConversation(id),
          onRename:
              (id, title) => ref
                  .read(chatNotifierProvider.notifier)
                  .renameConversation(id, title),
          onArchive:
              (id, archived) => ref
                  .read(chatNotifierProvider.notifier)
                  .toggleArchiveConversation(id, archived),
          onViewArchive: () => context.push('/archive'),
        );
      case 1:
        return const _PlaceholderTab(
          icon: Icons.contacts_outlined,
          label: 'Contacts',
        );
      case 2:
        return const _PlaceholderTab(icon: Icons.person_outline, label: 'Me');
      default:
        return const SizedBox.shrink();
    }
  }
}

/// 底部导航标签定义 — 标签文本及对应的常态/激活态图标
class _TabItem {
  final String label;
  final IconData icon;
  final IconData activeIcon;

  const _TabItem({
    required this.label,
    required this.icon,
    required this.activeIcon,
  });
}

/// 底部导航项组件 — 带按下态透明度反馈和图标缩放切换动画
/// 底部导航项 — 带按下态反馈的激活/非激活图标与标签
class _BottomNavItem extends StatefulWidget {
  final IconData icon;
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _BottomNavItem({
    required this.icon,
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  State<_BottomNavItem> createState() => _BottomNavItemState();
}

class _BottomNavItemState extends State<_BottomNavItem> {
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    final color = widget.isActive ? AppColors.green : AppColors.textTertiary;

    return GestureDetector(
      onTapDown: (_) => setState(() => _isPressed = true),
      onTapUp: (_) {
        setState(() => _isPressed = false);
        widget.onTap();
      },
      onTapCancel: () => setState(() => _isPressed = false),
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 100),
        opacity: _isPressed ? 0.6 : 1.0,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 200),
              transitionBuilder: (child, animation) {
                return ScaleTransition(scale: animation, child: child);
              },
              child: Icon(
                widget.icon,
                key: ValueKey<bool>(widget.isActive),
                color: color,
                size: 24,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              widget.label,
              style: TextStyle(
                color: color,
                fontSize: 11,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 占位标签页 — 显示图标和文字，用于尚未实现的页面
/// 占位标签页 — 未实现功能的提示页
class _PlaceholderTab extends StatelessWidget {
  final IconData icon;
  final String label;

  const _PlaceholderTab({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 64, color: AppColors.textTertiary.withValues(alpha: 0.3)),
            const SizedBox(height: 16),
            Text(
              label,
              style: TextStyle(
                color: AppColors.textTertiary.withValues(alpha: 0.5),
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
