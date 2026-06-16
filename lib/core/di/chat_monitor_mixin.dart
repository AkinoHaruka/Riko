import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/models/chat_message.dart';
import '../../data/repositories/remote_chat_repository.dart';
import '../../infrastructure/ai_adapter/ai_adapter.dart';
import 'api_monitor_record.dart';
import 'chat_state.dart';
import 'internal_event.dart';

/// 监控记录管理 mixin — 管理 API 监控面板的记录、子代理活动和分页加载
///
/// 提供监控记录的追加、清空、分页加载，子代理活动到历史记录的转换，
/// 以及 SSE 推送消息与乐观 UI 消息的同步清理。
/// 被 [ChatNotifier] 混入使用。
mixin ChatMonitorMixin on StateNotifier<ChatState> {
  /// 远程聊天仓库，由混入类提供
  RemoteChatRepository get chatRepository;

  /// Riverpod Ref，由混入类提供
  Ref get ref;

  /// 安全读取 SharedPreferences 中的 String 值，由混入类提供
  String? getPrefString(SharedPreferences prefs, String key);

  /// 向指定监控记录追加一个内部事件
  ///
  /// [monitorIndex] 为 [state.apiInputHistory] 中的索引位置，
  /// 越界时静默忽略。
  void appendInternalEvent(
    String type,
    Map<String, dynamic> data,
    int monitorIndex,
  ) {
    if (monitorIndex < 0 || monitorIndex >= state.apiInputHistory.length) {
      return;
    }
    final event = InternalEvent(
      type: type,
      timestamp: DateTime.now(),
      data: data,
    );
    final record = state.apiInputHistory[monitorIndex];
    final updatedRecord = record.copyWith(
      internalEvents: [...record.internalEvents, event],
    );
    final newHistory = List<ApiMonitorRecord>.from(state.apiInputHistory);
    newHistory[monitorIndex] = updatedRecord;
    state = state.copyWith(apiInputHistory: newHistory);
  }

  /// 格式化监控面板的响应文本，按 [Reasoning] / [Response] 分段显示
  String formatResponseText(String content, String reasoning) {
    final sb = StringBuffer();
    if (reasoning.isNotEmpty) {
      sb.writeln('[Reasoning]');
      sb.writeln(reasoning);
      sb.writeln();
    }
    sb.writeln('[Response]');
    sb.write(content);
    return sb.toString();
  }

  /// 清除当前错误状态
  void clearError() {
    state = state.copyWith(clearError: true);
  }

  /// 清空当前会话的所有监控记录（前端状态 + 后端数据库）
  Future<void> clearApiInputHistory() async {
    final conversationId = ref.read(activeConversationIdProvider);
    if (conversationId != null) {
      try {
        await chatRepository.deleteMonitorRecordsByConversation(conversationId);
      } catch (e) {
        debugPrint('清空监控记录失败: $e');
      }
    }
    state = state.copyWith(
      clearApiInputHistory: true,
      hasMoreMonitorRecords: false,
    );
  }

  /// 添加子代理活动到监控面板历史记录，同时更新上次运行时间
  void addSubAgentActivityToHistory(Map<String, dynamic> activity) {
    final trace = activity['trace'] as Map<String, dynamic>?;
    final requestJson = trace?['requestJson'] as String? ?? '';
    final turns = (trace?['turns'] as List<dynamic>?) ?? [];
    final output = (activity['summary'] as String?) ?? '';
    final subType = activity['activity_type'] as String? ?? 'sub_agent';
    final success = activity['success'] as bool? ?? true;
    final error = activity['error'] as String?;

    final modelOutputs = <String>[];
    for (final t in turns) {
      final turn = t as Map<String, dynamic>;
      final mr = turn['modelResponse'] as String?;
      if (mr != null && mr.isNotEmpty) {
        modelOutputs.add(mr);
      }
    }

    final toolCallEvents = <InternalEvent>[];
    for (final t in turns) {
      final turn = t as Map<String, dynamic>;
      final tcs = turn['toolCalls'] as List<dynamic>? ?? [];
      if (tcs.isEmpty) continue;
      toolCallEvents.add(
        InternalEvent(
          type: 'tool_call',
          timestamp: DateTime.now(),
          data: {
            'tools': tcs.map((tc) {
              final tcMap = tc as Map<String, dynamic>;
              return {
                'name': tcMap['name'] ?? '',
                'arguments': tcMap['arguments'] ?? '',
                'result_preview': tcMap['resultPreview'] ?? '',
              };
            }).toList(),
          },
        ),
      );
    }

    final respBuf = StringBuffer();
    respBuf.writeln('[Response]');
    if (modelOutputs.isNotEmpty) {
      respBuf.write(modelOutputs.join('\n\n'));
    } else if (output.isNotEmpty) {
      respBuf.write(output);
    } else {
      respBuf.write('(无输出)');
    }

    final record = ApiMonitorRecord(
      id: (-(DateTime.now().millisecondsSinceEpoch % 1000000)).toString(),
      conversationId: ref.read(activeConversationIdProvider) ?? '',
      requestJson: requestJson,
      responseRawText: respBuf.toString(),
      createdAt: DateTime.now(),
      isComplete: true,
      tokenUsage: trace != null
          ? const TokenUsage(
              promptTokens: 0,
              completionTokens: 0,
              promptCacheHitTokens: 0,
              promptCacheMissTokens: 0,
            )
          : null,
      errorCategory: success ? null : 'sub_$subType',
      errorMessage: error,
      internalEvents: toolCallEvents,
    );

    state = state.copyWith(apiInputHistory: [record, ...state.apiInputHistory]);

    final now = DateTime.now();
    if (subType == 'session_memory') {
      state = state.copyWith(
        lastMemoryAt: now,
        lastMemoryTokenCount: state.tokenCount,
        messageCount: 0,
      );
    } else if (subType == 'compact') {
      state = state.copyWith(lastCompactAt: now);
    } else if (subType == 'dream') {
      state = state.copyWith(lastDreamAt: now);
    }
  }

  /// 将子代理输出保存到对应子代理的对话消息中
  Future<void> saveSubAgentOutputToConversation(
    Map<String, dynamic> activity,
  ) async {
    final subType = activity['activity_type'] as String? ?? '';
    final agentType = switch (subType) {
      'session_memory' => 'memory',
      'compact' => 'compact',
      'dream' => 'dream',
      _ => null,
    };
    if (agentType == null) return;

    final prefs = await SharedPreferences.getInstance();
    final convId = getPrefString(prefs, 'agent_conv_$agentType');
    if (convId == null) return;

    final trace = activity['trace'] as Map<String, dynamic>?;
    final turns = (trace?['turns'] as List<dynamic>?) ?? [];
    final summary = (activity['summary'] as String?) ?? '';

    final outputBuf = StringBuffer();
    for (final t in turns) {
      final turn = t as Map<String, dynamic>;
      final tcs = turn['toolCalls'] as List<dynamic>? ?? [];
      for (final tc in tcs) {
        final tcMap = tc as Map<String, dynamic>;
        outputBuf.writeln('**工具调用: ${tcMap['name']}**');
        final args = tcMap['arguments'] as String?;
        if (args != null && args.isNotEmpty) {
          outputBuf.writeln('```json');
          outputBuf.writeln(args);
          outputBuf.writeln('```');
        }
        final result = tcMap['resultPreview'] as String?;
        if (result != null && result.isNotEmpty) {
          outputBuf.writeln('```');
          outputBuf.writeln(result);
          outputBuf.writeln('```');
        }
        outputBuf.writeln();
      }
      final mr = turn['modelResponse'] as String?;
      if (mr != null && mr.isNotEmpty) {
        outputBuf.writeln(mr);
        outputBuf.writeln();
      }
    }
    if (outputBuf.isEmpty && summary.isNotEmpty) {
      outputBuf.write(summary);
    }
    if (outputBuf.isEmpty) return;

    try {
      await chatRepository.sendMessage(
        conversationId: convId,
        role: 'assistant',
        content: outputBuf.toString(),
      );
      ref.invalidate(conversationMessagesProvider(convId));
      ref.invalidate(conversationsProvider);
    } catch (e) {
      debugPrint('保存子代理输出失败 ($agentType): $e');
    }
  }

  /// 加载更多监控记录（用户上滑时触发）
  Future<void> loadMoreMonitorRecords() async {
    final conversationId = ref.read(activeConversationIdProvider);
    if (conversationId == null) return;
    if (state.isLoadingMoreMonitor) return;

    state = state.copyWith(isLoadingMoreMonitor: true);

    try {
      final totalCount = await chatRepository.getMonitorRecordCount(
        conversationId,
      );
      final currentCount = state.apiInputHistory.length;

      if (currentCount >= totalCount) {
        if (!mounted) return;
        state = state.copyWith(
          hasMoreMonitorRecords: false,
          isLoadingMoreMonitor: false,
        );
        return;
      }

      final remaining = totalCount - currentCount;
      final loadCount = remaining > 200 ? 200 : remaining;

      final moreData = await chatRepository.getMonitorRecords(
        conversationId,
        limit: loadCount,
        offset: currentCount,
      );
      final moreRecords = moreData
          .map((d) => ApiMonitorRecord.fromJson(d))
          .toList();

      final newHistory = [...state.apiInputHistory, ...moreRecords];
      if (!mounted) return;
      state = state.copyWith(
        apiInputHistory: newHistory,
        hasMoreMonitorRecords: newHistory.length < totalCount,
        isLoadingMoreMonitor: false,
      );
    } catch (e) {
      debugPrint('加载更多监控记录失败: $e');
      state = state.copyWith(isLoadingMoreMonitor: false);
    }
  }

  /// 当 SSE 推送消息包含与 pendingMessages 中匹配的用户消息时，将其从 pending 中移除
  void clearPendingIfMatched() {
    final activeId = ref.read(activeConversationIdProvider);
    if (state.pendingMessages.isEmpty) return;

    final messages = activeId != null
        ? (ref.read(conversationMessagesProvider(activeId)).valueOrNull ?? [])
        : <ChatMessage>[];

    if (messages.isEmpty) return;

    final toRemove = <String>{};
    for (final pending in state.pendingMessages) {
      for (final msg in messages) {
        if (msg.role == pending.role &&
            msg.content == pending.content &&
            !msg.id.startsWith('-')) {
          toRemove.add(pending.id);
          break;
        }
      }
    }

    if (toRemove.isNotEmpty) {
      state = state.copyWith(
        pendingMessages: state.pendingMessages
            .where((m) => !toRemove.contains(m.id))
            .toList(),
      );
    }
  }
}
