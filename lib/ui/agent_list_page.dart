/// 代理列表页面 — 主代理与子代理的对话入口
///
/// 展示主代理、记忆提取、上下文压缩、梦境整理四种代理的对话列表，
/// 底部导航栏支持在消息、文件、设置三个标签间切换。
/// 首次进入时自动跳转到聊天页面。
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/di/chat_provider.dart';
import '../core/di/providers.dart';
import '../core/theme/app_animations.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_radius.dart';
import '../core/theme/app_spacing.dart';
import '../core/theme/app_typography.dart';
import '../core/utils/time_formatters.dart';
import '../data/models/chat_message.dart';
import 'settings_page.dart' deferred as settings_page;
import 'widgets/avatar/avatar_provider.dart';
import 'widgets/memory_file_browser.dart';

final _agentDefs = [
  const _AgentDef('main', '主代理', Icons.chat_bubble),
  const _AgentDef('memory', '记忆提取', Icons.psychology),
  const _AgentDef('compact', '上下文压缩', Icons.compress),
  const _AgentDef('dream', '梦境整理', Icons.nightlight_round),
];

/// 代理类型定义 — 类型标识、显示名称和图标
class _AgentDef {
  final String type;
  final String name;
  final IconData icon;

  const _AgentDef(this.type, this.name, this.icon);
}

/// 代理列表页面 — 展示主代理和子代理的对话入口，底部导航栏支持切换消息/文件/设置标签
class AgentListPage extends ConsumerStatefulWidget {
  const AgentListPage({super.key});

  @override
  ConsumerState<AgentListPage> createState() => _AgentListPageState();
}

class _AgentListPageState extends ConsumerState<AgentListPage> {
  int _selectedTab = 0;
  bool _settingsLoaded = false;

  /// 标记是否已完成首次自动跳转聊天页，避免重复跳转
  static bool _initialChatPushDone = false;

  @override
  void initState() {
    super.initState();
    // 确保每个代理类型都有对应的会话
    unawaited(
      ref.read(chatNotifierProvider.notifier).ensureAgentConversations(),
    );
    // 延迟加载设置页面的 deferred library
    _loadSettingsDeferred();
    // 首次进入时自动跳转到聊天页面
    if (!_initialChatPushDone) {
      _initialChatPushDone = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.push('/chat');
      });
    }
  }

  /// 延迟加载设置页面的 deferred library，加载完成后标记就绪
  Future<void> _loadSettingsDeferred() async {
    await settings_page.loadLibrary();
    if (mounted) setState(() => _settingsLoaded = true);
  }

  void _switchTab(int index) {
    if (index == _selectedTab) return;
    setState(() => _selectedTab = index);
  }

  static const _tabLabels = ['消息', '文件', '设置'];

  @override
  Widget build(BuildContext context) {
    final activeAgentType = ref.watch(activeAgentTypeProvider);
    final conversationsAsync = ref.watch(conversationsProvider);
    final conversations = conversationsAsync.valueOrNull ?? [];

    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(
        backgroundColor: AppColors.bgPrimary,
        elevation: 0,
        centerTitle: true,
        title: Text(
          _tabLabels[_selectedTab],
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontSize: 19,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      body: SafeArea(
        child: _PageSwitcher(
          selectedIndex: _selectedTab,
          children: [
            ListView.separated(
              padding: EdgeInsets.zero,
              itemCount: _agentDefs.length,
              separatorBuilder: (_, _) => const Padding(
                padding: EdgeInsets.only(left: 84),
                child: Divider(height: 1, color: AppColors.divider),
              ),
              itemBuilder: (context, index) {
                final def = _agentDefs[index];
                final isActive = def.type == activeAgentType;
                final conv = conversations
                    .where((c) => c.title == def.name)
                    .firstOrNull;
                final lastMsg = conv != null
                    ? ref
                          .watch(conversationMessagesProvider(conv.id))
                          .valueOrNull
                          ?.lastOrNull
                    : null;

                return _AgentItem(
                  def: def,
                  isActive: isActive,
                  lastMessage: lastMsg,
                  fallbackTime: conv?.updatedAt,
                  onTap: () {
                    ref.read(activeAgentTypeProvider.notifier).state = def.type;
                    ref
                        .read(chatNotifierProvider.notifier)
                        .switchToAgent(def.type);
                    context.push('/chat');
                  },
                );
              },
            ),
            const MemoryFileBrowser(),
            if (_settingsLoaded)
              Navigator(
                // SettingsPage 是 deferred 类，无法用 const MaterialPage，
                // 导致整个 pages 列表也无法声明为 const
                // ignore: prefer_const_literals_to_create_immutables
                pages: [
                  // ignore: prefer_const_constructors — SettingsPage 是 deferred 类，不能用 const
                  MaterialPage(
                    key: const ValueKey('settings'),
                    child: settings_page.SettingsPage(showBackButton: false),
                  ),
                ],
                onDidRemovePage: (route) {},
              )
            else
              const Center(child: CircularProgressIndicator(strokeWidth: 2)),
          ],
        ),
      ),
      bottomNavigationBar: _BottomNavBar(
        selectedTab: _selectedTab,
        onTap: _switchTab,
      ),
    );
  }
}

/// 页面切换器 — 带滑动+淡入动画的 IndexedStack 替代方案
class _PageSwitcher extends StatelessWidget {
  final int selectedIndex;
  final List<Widget> children;

  const _PageSwitcher({required this.selectedIndex, required this.children});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: List.generate(children.length, (i) {
        final isActive = i == selectedIndex;
        return TweenAnimationBuilder<double>(
          tween: Tween(end: isActive ? 1.0 : 0.0),
          duration: AppAnimations.normal,
          curve: AppAnimations.easeOutBack,
          builder: (context, value, child) {
            if (value < 0.005 && !isActive) return const SizedBox.shrink();
            final clampedOpacity = value.clamp(0.0, 1.0);
            return Opacity(
              opacity: clampedOpacity,
              child: Transform.translate(
                offset: Offset((1 - clampedOpacity) * (i > selectedIndex ? 24 : -24), 0),
                child: child,
              ),
            );
          },
          child: IndexedStack(index: i, children: children),
        );
      }),
    );
  }
}

/// 底部导航栏 — 带滑动指示器和图标缩放动效
class _BottomNavBar extends StatelessWidget {
  final int selectedTab;
  final ValueChanged<int> onTap;

  const _BottomNavBar({required this.selectedTab, required this.onTap});

  static const _tabs = [
    (Icons.chat_bubble_outline, Icons.chat_bubble, '消息'),
    (Icons.folder_outlined, Icons.folder, '文件'),
    (Icons.settings_outlined, Icons.settings, '设置'),
  ];

  static const _accent = AppColors.green;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.bgPrimary,
        border: Border(top: BorderSide(color: AppColors.divider)),
      ),
      child: SafeArea(
        child: SizedBox(
          height: 56,
          child: LayoutBuilder(
            builder: (context, constraints) {
              final tabWidth = constraints.maxWidth / _tabs.length;
              return Stack(
                children: [
                  // Sliding indicator pill
                  AnimatedPositioned(
                    duration: AppAnimations.normal,
                    curve: AppAnimations.springHeavy,
                    left: selectedTab * tabWidth + tabWidth / 2 - 16,
                    top: 0,
                    child: Container(
                      width: 32,
                      height: 3,
                      decoration: BoxDecoration(
                        color: _accent,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  // Tab buttons
                  Row(
                    children: List.generate(_tabs.length, (i) {
                      final (icon, activeIcon, label) = _tabs[i];
                      final isActive = i == selectedTab;
                      return _AnimatedNavTab(
                        icon: icon,
                        activeIcon: activeIcon,
                        label: label,
                        isActive: isActive,
                        onTap: () => onTap(i),
                        width: tabWidth,
                      );
                    }),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

/// 带动效的导航标签 — 图标缩放 + 颜色渐变 + 实心/描边图标切换
class _AnimatedNavTab extends StatelessWidget {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool isActive;
  final VoidCallback onTap;
  final double width;

  const _AnimatedNavTab({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.isActive,
    required this.onTap,
    required this.width,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: TweenAnimationBuilder<double>(
          tween: Tween(end: isActive ? 1.0 : 0.0),
          duration: AppAnimations.normal,
          curve: AppAnimations.easeOutBack,
          builder: (context, value, child) {
            final clamped = value.clamp(0.0, 1.0);
            final scale = 1.0 + clamped * 0.15;
            final color = Color.lerp(
              AppColors.textTertiary,
              _BottomNavBar._accent,
              clamped,
            )!;
            return Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Transform.scale(
                  scale: scale,
                  child: Icon(
                    value > 0.5 ? activeIcon : icon,
                    color: color,
                    size: 24,
                  ),
                ),
                const SizedBox(height: 3),
                DefaultTextStyle(
                  style: TextStyle(color: color, fontSize: AppTypography.micro),
                  child: Text(label),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// 代理列表项 — 显示头像、名称、最后一条消息预览和时间
class _AgentItem extends StatelessWidget {
  final _AgentDef def;
  final bool isActive;
  final ChatMessage? lastMessage;
  final DateTime? fallbackTime;
  final VoidCallback onTap;

  const _AgentItem({
    required this.def,
    required this.isActive,
    required this.lastMessage,
    required this.fallbackTime,
    required this.onTap,
  });

  static const _chatGreen = AppColors.green;

  Color _avatarBg(bool active) {
    if (!active) return AppColors.surface;
    return _chatGreen.withValues(alpha: 0.12);
  }

  Color _avatarIconColor(bool active) {
    if (!active) return AppColors.textSecondary;
    return _chatGreen;
  }

  String _formatTime(DateTime time) {
    return TimeFormatters.agentListTime(time);
  }

  @override
  Widget build(BuildContext context) {
    final previewText = lastMessage?.content ?? '';
    final displayTime = lastMessage?.createdAt ?? fallbackTime;

    return AppAnimations.scaleTap(
      onTap: onTap,
      child: AnimatedContainer(
        duration: AppAnimations.quick,
        curve: AppAnimations.easeOutBack,
        constraints: const BoxConstraints(minHeight: 72),
        color: isActive ? AppColors.surfaceHover : Colors.transparent,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: _avatarBg(isActive),
                borderRadius: AppRadius.smAll,
              ),
              clipBehavior: Clip.antiAlias,
              child: def.type == 'main'
                  ? Consumer(
                      builder: (context, ref, _) {
                        final avatarAsync = ref.watch(mainAgentAvatarProvider);
                        final bytes = avatarAsync.valueOrNull;
                        if (bytes != null) {
                          return Image.memory(bytes, fit: BoxFit.cover);
                        }
                        return Icon(
                          def.icon,
                          color: _avatarIconColor(isActive),
                          size: 28,
                        );
                      },
                    )
                  : Icon(def.icon, color: _avatarIconColor(isActive), size: 28),
            ),
            AppSpacing.hMDSm,
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    def.name,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: isActive ? _chatGreen : AppColors.textPrimary,
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    previewText,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: AppTypography.body,
                    ),
                  ),
                ],
              ),
            ),
            AppSpacing.hSM,
            if (displayTime != null)
              Text(
                _formatTime(displayTime),
                style: const TextStyle(
                  color: AppColors.textTertiary,
                  fontSize: AppTypography.caption,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
