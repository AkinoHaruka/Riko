/// 聊天页面弹出菜单 — 头像、搜索、背景、清空记录
/// 使用自定义弹簧动画替代原生 PopupMenuButton
library;

import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import '../../core/theme/app_animations.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_radius.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../widgets/avatar/avatar_provider.dart';

/// 聊天页面右上角弹出菜单按钮
class ChatPopupMenuButton extends ConsumerWidget {
  /// 菜单项选择回调
  final void Function(String) onSelected;

  const ChatPopupMenuButton({super.key, required this.onSelected});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hasAvatar = ref.watch(mainAgentAvatarProvider).valueOrNull != null;
    return AppAnimations.scaleTap(
      onTap: () => _showSpringMenu(context, hasAvatar),
      child: const Padding(
        padding: EdgeInsets.all(8.0),
        child: FaIcon(
          FontAwesomeIcons.ellipsis,
          color: AppColors.textPrimary,
          size: 18,
        ),
      ),
    );
  }

  void _showSpringMenu(BuildContext context, bool hasAvatar) {
    final items = _buildItems(hasAvatar);

    // 获取按钮位置用于定位菜单
    final renderBox = context.findRenderObject() as RenderBox;
    final size = renderBox.size;
    final offset = renderBox.localToGlobal(Offset.zero);

    showGeneralDialog(
      context: context,
      barrierDismissible: true,
      barrierColor: Colors.transparent,
      transitionDuration: AppAnimations.normal,
      transitionBuilder: (context, animation, secondaryAnimation, child) {
        final scaleAnim = Tween(begin: 0.85, end: 1.0).chain(
          CurveTween(curve: AppAnimations.spring),
        );
        final fadeAnim = Tween(begin: 0.0, end: 1.0).chain(
          CurveTween(curve: AppAnimations.easeOutExpo),
        );
        return ScaleTransition(
          scale: animation.drive(scaleAnim),
          child: FadeTransition(
            opacity: animation.drive(fadeAnim),
            child: child,
          ),
        );
      },
      pageBuilder: (context, animation, secondaryAnimation) {
        return Stack(
          children: [
            // 透明遮罩，点击关闭菜单
            Positioned.fill(
              child: GestureDetector(
                onTap: () => Navigator.of(context).pop(),
                behavior: HitTestBehavior.opaque,
                child: const SizedBox.expand(),
              ),
            ),
            // 菜单本体
            Positioned(
              left: offset.dx + size.width / 2 - 150,
              top: offset.dy + size.height + 8,
              child: Material(
                color: Colors.transparent,
                child: ClipRRect(
                  borderRadius: AppRadius.lgAll,
                  child: BackdropFilter(
                    filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
                    child: Container(
                      width: 200,
                      decoration: BoxDecoration(
                        color: AppColors.surfaceGlass,
                        borderRadius: AppRadius.lgAll,
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.1),
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.4),
                            blurRadius: 24,
                            offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          for (int i = 0; i < items.length; i++)
                            AppAnimations.staggerItem(
                              index: i,
                              child: items[i],
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  List<Widget> _buildItems(bool hasAvatar) {
    return [
      _MenuItem(
        icon: Icons.face,
        label: '更换头像',
        color: AppColors.textSecondary,
        onTap: (context) {
          Navigator.of(context).pop();
          onSelected('avatar');
        },
      ),
      if (hasAvatar)
        _MenuItem(
          icon: Icons.face_retouching_off,
          label: '移除头像',
          color: AppColors.error,
          onTap: (context) {
            Navigator.of(context).pop();
            onSelected('remove_avatar');
          },
        ),
      const _MenuDivider(),
      _MenuItem(
        icon: Icons.search,
        label: '搜索消息',
        color: AppColors.textSecondary,
        onTap: (context) {
          Navigator.of(context).pop();
          onSelected('search');
        },
      ),
      const _MenuDivider(),
      _MenuItem(
        icon: Icons.wallpaper,
        label: '聊天背景',
        color: AppColors.textSecondary,
        onTap: (context) {
          Navigator.of(context).pop();
          onSelected('background');
        },
      ),
      const _MenuDivider(),
      _MenuItem(
        icon: Icons.delete_sweep,
        label: '清空聊天记录',
        color: AppColors.error,
        onTap: (context) {
          Navigator.of(context).pop();
          onSelected('clear_all');
        },
      ),
    ];
  }
}

class _MenuItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final ValueChanged<BuildContext> onTap;

  const _MenuItem({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return AppAnimations.scaleTap(
      scaleDown: 0.97,
      onTap: () => onTap(context),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Icon(icon, color: color, size: 18),
            AppSpacing.hSM,
            Text(
              label,
              style: TextStyle(color: color, fontSize: AppTypography.body),
            ),
          ],
        ),
      ),
    );
  }
}

class _MenuDivider extends StatelessWidget {
  const _MenuDivider();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(horizontal: 12),
      child: Divider(height: 1, color: AppColors.border),
    );
  }
}
