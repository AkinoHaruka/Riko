/// 聊天页面菜单动作 Mixin — 头像 / 搜索 / 背景 / 清空记录
///
/// 将 [_ChatPageState] 中的弹出菜单处理逻辑抽出，
/// 与宿主状态（如搜索可见性）通过回调解耦。
library;

import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/di/chat_provider.dart';
import '../../core/di/providers.dart';
import '../../core/di/toast_provider.dart';
import '../../core/theme/app_animations.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_radius.dart';
import '../widgets/avatar/avatar_crop_page.dart';
import '../widgets/avatar/avatar_provider.dart';
import '../widgets/background/background_picker.dart';

/// 聊天页面菜单动作 Mixin
///
/// 宿主需为 [ConsumerState] 并实现 [onSearchMenuSelected]，
/// 用于响应"搜索消息"菜单项（通常切换搜索栏可见性）。
mixin ChatMenuActionsMixin<W extends ConsumerStatefulWidget>
    on ConsumerState<W> {
  /// "搜索消息"菜单项被选中时调用（由宿主实现）
  void onSearchMenuSelected();

  /// 弹出菜单项选择处理：头像、搜索、背景、清空聊天记录
  void onPopupMenuSelected(String value) {
    switch (value) {
      case 'avatar':
        pickAndCropAvatar();
      case 'remove_avatar':
        removeUserAvatar();
      case 'search':
        onSearchMenuSelected();
      case 'background':
        showBackgroundPicker();
      case 'clear_all':
        clearCurrentAgentHistory();
    }
  }

  /// 根据代理类型返回中文标题
  String resolveAgentTitle(String agentType) {
    return switch (agentType) {
      'main' => '主代理',
      'memory' => '记忆提取',
      'compact' => '上下文压缩',
      'dream' => '梦境整理',
      _ => 'RIKO',
    };
  }

  /// 选择并裁剪头像图片，保存到本地
  Future<void> pickAndCropAvatar() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      withData: true,
    );
    if (result == null || result.files.isEmpty) return;
    final bytes = result.files.first.bytes;
    if (bytes == null) return;

    if (!mounted) return;
    final cropped = await Navigator.push<Uint8List>(
      context,
      PageRouteBuilder<Uint8List>(
        pageBuilder: (context, animation, secondaryAnimation) {
          return AvatarCropPage(imageBytes: bytes);
        },
        transitionsBuilder: AppAnimations.slideInFromBottom,
        transitionDuration: AppAnimations.page,
        reverseTransitionDuration: AppAnimations.normal,
      ),
    );
    if (cropped == null || !mounted) return;
    await saveAvatar(ref, cropped);
    if (mounted) {
      ref.read(toastProvider.notifier).show('头像已更新');
    }
  }

  /// 移除当前用户头像
  Future<void> removeUserAvatar() async {
    await removeAvatar(ref);
    if (mounted) {
      ref.read(toastProvider.notifier).show('头像已移除');
    }
  }

  /// 清空当前代理的聊天记录，删除对话和监控记录后重建新对话
  Future<void> clearCurrentAgentHistory() async {
    final agentType = ref.read(activeAgentTypeProvider);
    final agentTitle = resolveAgentTitle(agentType);
    final confirmed = await AppAnimations.showSpringDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.lgAll),
        title: Text(
          '清空 $agentTitle',
          style: const TextStyle(color: AppColors.error),
        ),
        content: Text(
          '此操作将清空「$agentTitle」的所有消息，不可恢复。',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('确认', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      final convId = ref.read(activeConversationIdProvider);
      final chatRepo = ref.read(chatRepositoryProvider);
      if (convId != null) {
        try {
          await chatRepo.deleteConversation(convId);
        } on Exception catch (e) {
          debugPrint('清除对话失败 ($convId): $e');
        }
        try {
          await chatRepo.deleteMonitorRecordsByConversation(convId);
        } on Exception catch (e) {
          debugPrint('清除 monitor 记录失败 ($convId): $e');
        }
      }
      // 清理 SharedPreferences 中该 agent 的绑定，确保重建新对话
      final prefs = await SharedPreferences.getInstance();
      final key = 'agent_conv_$agentType';
      await prefs.remove(key);
      ref.read(chatNotifierProvider.notifier).resetAgents();
      // ensureAgentConversations 会在发现该 agent 缺少对话时自动创建新对话
      if (!mounted) return;
      await ref.read(chatNotifierProvider.notifier).ensureAgentConversations();
      if (mounted) {
        ref.read(toastProvider.notifier).show('$agentTitle已清空');
      }
    } on Exception catch (e) {
      if (mounted) {
        ref.read(toastProvider.notifier).show('清空失败: $e');
      }
    }
  }

  /// 打开聊天背景选择对话框
  Future<void> showBackgroundPicker() async {
    final conversationId = ref.read(activeConversationIdProvider);
    if (conversationId == null) return;
    final result = await AppAnimations.showSpringDialog<String>(
      context: context,
      builder: (context) => const BackgroundPicker(),
    );
    if (result == null || !mounted) return;
    final repo = ref.read(chatRepositoryProvider);
    final background = result.isEmpty ? null : result;
    await repo.setConversationBackground(conversationId, background);
    ref.invalidate(conversationsProvider);
  }
}
