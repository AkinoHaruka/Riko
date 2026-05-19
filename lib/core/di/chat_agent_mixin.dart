import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/models/conversation.dart';
import '../../data/repositories/remote_chat_repository.dart';
import 'api_monitor_record.dart';
import 'chat_state.dart';

/// 聊天代理管理 mixin — 管理代理对话的创建、切换和持久化
mixin ChatAgentMixin on StateNotifier<ChatState> {
  RemoteChatRepository get chatRepository;
  Ref get ref;

  static const _agentTitles = {
    'main': '主代理',
    'memory': '记忆提取',
    'compact': '上下文压缩',
    'dream': '梦境整理',
  };

  bool _ensuredAgents = false;

  /// 安全读取 String 值（旧版存的是 int，getString 会抛类型错误）
  String? getPrefString(SharedPreferences prefs, String key) {
    try {
      return prefs.getString(key);
    } catch (_) {
      return null;
    }
  }

  void resetAgents() {
    _ensuredAgents = false;
  }

  Future<void> ensureAgentConversations() async {
    if (_ensuredAgents) return;
    _ensuredAgents = true;

    final prefs = await SharedPreferences.getInstance();

    List<Conversation>? existingConversations;
    try {
      existingConversations = await chatRepository.getConversations();
    } catch (_) {}

    for (final type in ['main', 'memory', 'compact', 'dream']) {
      final key = 'agent_conv_$type';
      var storedId = getPrefString(prefs, key);

      if (storedId != null && existingConversations != null) {
        if (existingConversations.any((c) => c.id == storedId)) {
          continue;
        }
        storedId = null;
      }

      if (storedId == null) {
        final title = _agentTitles[type] ?? type;
        // 先尝试在已有对话中按标题查找（例如导入恢复的场景）
        final existingByTitle = existingConversations
            ?.where((c) => c.title == title)
            .firstOrNull;
        if (existingByTitle != null) {
          await prefs.setString(key, existingByTitle.id);
          continue;
        }
        try {
          final id = await chatRepository.createConversation(title);
          await prefs.setString(key, id);
        } catch (e) {
          debugPrint('创建代理对话失败 ($type): $e');
        }
      }
    }

    final mainId = getPrefString(prefs, 'agent_conv_main');
    if (mainId != null) {
      ref.read(activeConversationIdProvider.notifier).state = mainId;
    }
  }

  Future<void> switchToAgent(String agentType) async {
    final prefs = await SharedPreferences.getInstance();
    final key = 'agent_conv_$agentType';
    final storedId = getPrefString(prefs, key);

    if (storedId == null) {
      await ensureAgentConversations();
      final newId = getPrefString(prefs, key);
      if (newId != null) {
        ref.read(activeConversationIdProvider.notifier).state = newId;
      }
      return;
    }

    ref.read(activeConversationIdProvider.notifier).state = storedId;

    try {
      final totalCount = await chatRepository.getMonitorRecordCount(storedId);
      final recordsData = await chatRepository.getMonitorRecords(storedId);
      final records = recordsData
          .map((d) => ApiMonitorRecord.fromJson(d))
          .toList();
      state = ChatState(
        apiInputHistory: records,
        hasMoreMonitorRecords: totalCount > records.length,
      );
    } catch (e) {
      debugPrint('加载监控记录失败: $e');
      state = const ChatState();
    }
  }
}
