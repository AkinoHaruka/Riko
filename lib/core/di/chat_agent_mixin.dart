import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/models/conversation.dart';
import '../../data/repositories/remote_chat_repository.dart';
import 'api_monitor_record.dart';
import 'chat_state.dart';

/// 聊天代理管理 mixin — 管理代理对话的创建、切换和持久化
///
/// 系统内置四种代理（main/memory/compact/dream），每种代理对应一个独立会话。
/// 代理会话 ID 持久化到 SharedPreferences，首次使用时自动创建。
/// 被 [ChatNotifier] 混入使用。
mixin ChatAgentMixin on StateNotifier<ChatState> {
  /// 远程聊天仓库，由混入类提供
  RemoteChatRepository get chatRepository;

  /// Riverpod Ref，由混入类提供
  Ref get ref;

  /// 代理类型到显示名称的映射
  static const _agentTitles = {
    'main': '主代理',
    'memory': '记忆提取',
    'compact': '上下文压缩',
    'dream': '梦境整理',
  };

  /// 标记代理会话是否已确保创建，避免重复检查
  bool _ensuredAgents = false;

  /// 安全读取 String 值（旧版存的是 int，getString 会抛类型错误）
  String? getPrefString(SharedPreferences prefs, String key) {
    try {
      return prefs.getString(key);
    } catch (e) {
      debugPrint('[ChatAgent] SharedPreferences type mismatch for $key: $e');
      return null;
    }
  }

  /// 重置代理确保标记（如切换用户时调用，强制下次重新检查）
  void resetAgents() {
    _ensuredAgents = false;
  }

  /// 确保四种代理会话已创建并持久化 ID
  ///
  /// 依次检查每种代理：如果 SharedPreferences 中有存储的 ID 且会话仍存在则跳过；
  /// 否则按标题查找已有会话或创建新会话。全部成功后设置 [activeConversationIdProvider]。
  Future<void> ensureAgentConversations() async {
    if (_ensuredAgents) return;

    final prefs = await SharedPreferences.getInstance();

    List<Conversation>? existingConversations;
    try {
      existingConversations = await chatRepository.getConversations();
    } catch (e) {
      debugPrint('[ChatAgent] getConversations failed: $e');
    }

    bool allSuccess = true;

    for (final type in ['main', 'memory', 'compact', 'dream']) {
      final key = 'agent_conv_$type';
      var storedId = getPrefString(prefs, key);

      // 存储的 ID 对应的会话可能已被删除，此时需重新创建
      if (storedId != null && existingConversations != null) {
        if (existingConversations.any((c) => c.id == storedId)) {
          continue;
        }
        storedId = null;
      }

      if (storedId == null) {
        final title = _agentTitles[type] ?? type;
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
          allSuccess = false;
        }
      }
    }

    if (allSuccess) {
      _ensuredAgents = true;
    }

    final mainId = getPrefString(prefs, 'agent_conv_main');
    if (mainId != null) {
      ref.read(activeConversationIdProvider.notifier).state = mainId;
    }
  }

  /// 切换到指定类型的代理会话
  ///
  /// [agentType] 为 main/memory/compact/dream 之一。
  /// 切换后加载该会话的监控记录到状态中。
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
