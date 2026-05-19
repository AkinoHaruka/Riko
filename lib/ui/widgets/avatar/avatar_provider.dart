import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../../../core/di/providers.dart';
import '../../../core/di/settings_cache.dart';

/// 主代理头像 Provider
///
/// - 原生平台：从 `agent_avatar_path` 设置读取文件路径 → File.readAsBytes()
/// - Web：从 `agent_avatar_data` 设置读取 base64 → base64Decode()
final mainAgentAvatarProvider = FutureProvider<Uint8List?>((ref) async {
  final cache = ref.watch(settingsCacheProvider);
  final avatarPath = cache.avatarPath;
  if (avatarPath != null && avatarPath.isNotEmpty && !kIsWeb) {
    final file = File(avatarPath);
    if (await file.exists()) {
      return await file.readAsBytes();
    }
  }
  final avatarData = cache.avatarData;
  if (avatarData != null && avatarData.isNotEmpty) {
    return const Base64Decoder().convert(avatarData);
  }
  return null;
});

/// 保存头像图片并更新设置
///
/// 所有平台统一存 base64 到设置（确保导入导出时头像包含在 DB 中）。
/// 原生平台额外存文件（快速本地加载）。
Future<void> saveAvatar(WidgetRef ref, Uint8List bytes) async {
  final settingsRepo = ref.read(settingsRepositoryProvider);

  // 所有平台统一存 base64 → DB 导出时头像不会丢失
  final data = base64Encode(bytes);
  ref.read(settingsCacheProvider.notifier).updateAvatarData(data);
  await settingsRepo.setString('agent_avatar_data', data);

  // 原生平台额外存文件
  if (!kIsWeb) {
    final dir = await getApplicationDocumentsDirectory();
    final avatarsDir = Directory('${dir.path}/avatars');
    if (!await avatarsDir.exists()) {
      await avatarsDir.create(recursive: true);
    }
    final file = File('${avatarsDir.path}/main_agent.png');
    await file.writeAsBytes(bytes);
    ref.read(settingsCacheProvider.notifier).updateAvatarPath(file.path);
    await settingsRepo.setString('agent_avatar_path', file.path);
  }

  ref.invalidate(mainAgentAvatarProvider);
}

/// 清除头像
Future<void> removeAvatar(WidgetRef ref) async {
  final cache = ref.read(settingsCacheProvider);
  if (!kIsWeb && cache.avatarPath != null) {
    final file = File(cache.avatarPath!);
    if (await file.exists()) {
      await file.delete();
    }
  }
  ref.read(settingsCacheProvider.notifier).updateAvatarPath(null);
  ref.read(settingsCacheProvider.notifier).updateAvatarData(null);
  final settingsRepo = ref.read(settingsRepositoryProvider);
  await settingsRepo.remove('agent_avatar_path');
  await settingsRepo.remove('agent_avatar_data');
  ref.invalidate(mainAgentAvatarProvider);
}
