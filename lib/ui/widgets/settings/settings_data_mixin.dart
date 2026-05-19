import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/di/chat_provider.dart';
import '../../../core/di/providers.dart';
import '../../../core/di/toast_provider.dart';
import '../../../core/theme/app_colors.dart';
import 'settings_import_dialog.dart';

/// 设置页面的数据管理 mixin — 导入/导出、清空对话/记忆
mixin SettingsDataMixin<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  String formatSettingsError(dynamic error) {
    if (error is DioException) {
      if (error.error is String) {
        return error.error! as String;
      }
      final statusCode = error.response?.statusCode;
      if (statusCode != null) {
        return '请求失败 ($statusCode)';
      }
    }
    return error.toString();
  }

  Future<void> confirmAndClear(
    String title,
    String message,
    VoidCallback onConfirm,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
        title: Text(title, style: const TextStyle(color: AppColors.error)),
        content: Text(
          message,
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text(
              '确认',
              style: TextStyle(color: AppColors.error),
            ),
          ),
        ],
      ),
    );
    if (confirmed == true) onConfirm();
  }

  Future<void> clearAllConversations() async {
    try {
      final chatRepo = ref.read(chatRepositoryProvider);
      final conversations = await chatRepo.getConversations();
      for (final c in conversations) {
        await chatRepo.deleteConversation(c.id);
      }
      await chatRepo.deleteAllMonitorRecords();
      await chatRepo.deleteAllMonitorActivities();
      final prefs = await SharedPreferences.getInstance();
      for (final type in ['main', 'memory', 'compact', 'dream']) {
        await prefs.remove('agent_conv_$type');
      }
      ref.read(activeConversationIdProvider.notifier).state = null;
      ref.read(chatNotifierProvider.notifier).resetAgents();
      await ref.read(chatNotifierProvider.notifier).ensureAgentConversations();
      if (mounted) {
        ref.read(toastProvider.notifier).show('所有对话已清空');
      }
    } catch (e) {
      if (mounted) {
        ref.read(toastProvider.notifier).show('清空失败: $e');
      }
    }
  }

  Future<void> clearAllMemories() async {
    try {
      final memoryRepo = ref.read(memoryRepositoryProvider);
      await memoryRepo.clearAll();
      if (mounted) {
        ref.read(toastProvider.notifier).show('所有记忆已清空');
      }
    } catch (e) {
      if (mounted) {
        ref.read(toastProvider.notifier).show('清空失败: $e');
      }
    }
  }

  Future<void> exportData() async {
    try {
      final apiClient = ref.read(apiClientProvider);
      final bytes = await apiClient.downloadRaw('/export');

      final now = DateTime.now();
      final ts =
          '${now.year}${now.month.toString().padLeft(2, '0')}${now.day.toString().padLeft(2, '0')}'
          '${now.hour.toString().padLeft(2, '0')}${now.minute.toString().padLeft(2, '0')}'
          '${now.second.toString().padLeft(2, '0')}';

      final result = await FilePicker.platform.saveFile(
        dialogTitle: '选择保存位置',
        fileName: 'riko_$ts.riko',
        bytes: Uint8List.fromList(bytes),
      );

      if (mounted) {
        ref
            .read(toastProvider.notifier)
            .show(result != null ? '数据已导出' : '导出已取消');
      }
    } catch (e) {
      if (mounted) {
        ref.read(toastProvider.notifier).show('导出失败: $e');
      }
    }
  }

  Future<void> importData() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        dialogTitle: '选择 .riko 文件',
        allowMultiple: false,
        type: FileType.custom,
        allowedExtensions: ['riko'],
        withData: true,
      );

      if (result == null || result.files.isEmpty) return;

      final file = result.files.first;
      if (file.bytes == null) {
        if (mounted) {
          ref.read(toastProvider.notifier).show('无法读取文件');
        }
        return;
      }

      final apiClient = ref.read(apiClientProvider);

      // Preview
      final preview = await apiClient.uploadRaw(
        '/import/preview',
        file.bytes!,
      );
      if (preview == null || preview['error'] != null) {
        if (mounted) {
          ref.read(toastProvider.notifier).show(
            '导入预览失败: ${preview?['error'] ?? '未知错误'}',
          );
        }
        return;
      }

      if (!mounted) return;

      // Show preview dialog
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) =>
            ImportPreviewDialog(preview: preview as Map<String, dynamic>),
      );

      if (confirmed != true) return;

      // Execute merge
      final mergeResult = await apiClient.uploadRaw(
        '/import/merge',
        file.bytes!,
      );
      if (mergeResult == null || mergeResult['error'] != null) {
        if (mounted) {
          ref.read(toastProvider.notifier).show(
            '导入失败: ${mergeResult?['error'] ?? '未知错误'}',
          );
        }
        return;
      }

      if (mounted) {
        ref.read(toastProvider.notifier).show(
          '导入完成: 新增 ${mergeResult['inserted'] ?? 0} 条, 更新 ${mergeResult['updated'] ?? 0} 条',
        );
        // 导入后重新绑定 Agent 对话：后端已清理空重复项，前端需重发现
        ref.read(chatNotifierProvider.notifier).resetAgents();
        await ref.read(chatNotifierProvider.notifier).ensureAgentConversations();
        ref.invalidate(conversationsProvider);
      }
    } catch (e) {
      if (mounted) {
        ref.read(toastProvider.notifier).show('导入失败: $e');
      }
    }
  }
}
