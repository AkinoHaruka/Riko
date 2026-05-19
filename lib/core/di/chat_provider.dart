import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/models/chat_message.dart';
import '../../data/repositories/remote_chat_repository.dart';
import '../../infrastructure/ai_adapter/ai_adapter.dart';
import '../../infrastructure/ai_adapter/adapter_factory.dart';
import 'api_monitor_record.dart';
import 'chat_agent_mixin.dart';
import 'chat_monitor_mixin.dart';
import 'chat_state.dart';
import 'internal_event.dart';
import 'providers.dart';
import 'settings_cache.dart';

export 'api_monitor_record.dart';
export 'chat_state.dart';
export 'dream_notifier.dart';
export 'dream_status.dart';
export 'internal_event.dart';

/// 聊天状态管理：消息发送、SSE 流式接收、乐观 UI、监控记录
///
/// 核心职责：
/// 1. 将用户消息发送到后端，创建占位消息开始流式接收
/// 2. 实时更新 streamingContent/reasoningContent
/// 3. 管理监控面板记录（API 输入/输出、token 用量）
/// 4. 追踪子代理（记忆提取/压缩/梦境）的活动与时间
class ChatNotifier extends StateNotifier<ChatState>
    with ChatAgentMixin, ChatMonitorMixin {
  @override
  final RemoteChatRepository chatRepository;
  final AdapterFactory _adapterFactory;
  @override
  final Ref ref;
  int _pendingIdCounter = 0;
  Timer? _updateThrottle;
  bool _disposed = false;

  ChatNotifier(this.chatRepository, this._adapterFactory, this.ref)
    : super(const ChatState());

  @override
  void dispose() {
    _disposed = true;
    _updateThrottle?.cancel();
    super.dispose();
  }

  Future<void> sendMessage(String content) async {
    var conversationId = ref.read(activeConversationIdProvider);

    if (conversationId == null) {
      final prefs = await SharedPreferences.getInstance();
      final mainId = getPrefString(prefs, 'agent_conv_main');
      if (mainId != null) {
        conversationId = mainId;
        ref.read(activeConversationIdProvider.notifier).state = mainId;
      } else {
        conversationId = await chatRepository.createConversation('主代理');
        await prefs.setString('agent_conv_main', conversationId);
        ref.read(activeConversationIdProvider.notifier).state = conversationId;
      }
    }

    if (content.trim().isEmpty) return;

    final trimmedContent = content.trim();

    // 构建发给 AI 的带日期/时间标记的内容（不在 UI 显示）
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final existingForCheck =
        ref.read(conversationMessagesProvider(conversationId)).valueOrNull ?? [];
    final hasMessageToday = existingForCheck.any((m) {
      final created = m.createdAt.toLocal();
      return created.year == today.year &&
          created.month == today.month &&
          created.day == today.day;
    });

    final timeStr =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')}';
    var aiContent = trimmedContent;
    if (!hasMessageToday) {
      final dateStr =
          '${now.year}/${now.month.toString().padLeft(2, '0')}/${now.day.toString().padLeft(2, '0')}';
      aiContent = 'Day: $dateStr\n$aiContent';
    }
    aiContent = '$aiContent\ntime: $timeStr';

    // 乐观 UI：立即将用户消息加入待确认列表
    final pendingId = (--_pendingIdCounter).toString();
    final pendingUserMsg = ChatMessage(
      id: pendingId,
      conversationId: conversationId,
      role: 'user',
      content: trimmedContent,
      reasoningContent: null,
      isCompactSummary: false,
      createdAt: DateTime.now(),
    );

    state = state.copyWith(
      pendingMessages: [...state.pendingMessages, pendingUserMsg],
      clearError: true,
    );

    String? placeholderId;
    var stage = 'sending_user_message';
    ErrorInfo? capturedError;
    int monitorIndex = -1;
    Timer? waitingTimer;
    try {
      await chatRepository.sendMessage(
        conversationId: conversationId,
        role: 'user',
        content: trimmedContent,
      );

      stage = 'creating_placeholder';
      placeholderId = await chatRepository.sendMessage(
        conversationId: conversationId,
        role: 'assistant',
        content: '',
        reasoningContent: '',
      );

      state = state.copyWith(
        isLoading: true,
        streamingContent: '',
        streamingReasoningContent: '',
        streamingAssistantMessageId: placeholderId,
        clearError: true,
      );

      stage = 'streaming';

      final existingMessages =
          ref.read(conversationMessagesProvider(conversationId)).valueOrNull ??
          [];
      final context = existingMessages
          .where((m) =>
              m.id != pendingUserMsg.id &&
              !(m.role == 'user' && m.content == trimmedContent))
          .map(
            (m) => Message(
              role: m.role,
              content: m.content,
              reasoningContent: m.reasoningContent,
              isCompactSummary: m.isCompactSummary,
            ),
          )
          .toList();

      final modelId = ref.read(selectedModelProvider);
      final backendBaseUrl = ref.read(apiClientProvider).baseUrl;
      final adapter = _adapterFactory.getAdapter(
        modelId,
        backendBaseUrl: backendBaseUrl,
      );

      final cache = ref.read(settingsCacheProvider);
      final thinkingType = cache.thinkingType;
      final reasoningEffort = cache.reasoningEffort;

      final options = <String, dynamic>{
        'model': modelId,
        'thinking_type': thinkingType,
      };

      final temperature = cache.temperature;
      options['temperature'] = temperature;

      final maxTokens = cache.maxTokens;
      options['maxTokens'] = maxTokens;

      if (reasoningEffort.isNotEmpty) {
        options['reasoning_effort'] = reasoningEffort;
      }

      options['json_mode'] = cache.jsonMode;
      options['conversation_id'] = conversationId;

      // 插入监控记录到数据库
      await chatRepository.insertMonitorRecord(
        conversationId: conversationId,
        requestJson: '',
        responseRawText: '',
        isComplete: false,
      );

      // 加载监控记录（最新优先）
      final totalCount = await chatRepository.getMonitorRecordCount(
        conversationId,
      );
      final recordsData = await chatRepository.getMonitorRecords(
        conversationId,
      );
      final records = recordsData
          .map((d) => ApiMonitorRecord.fromJson(d))
          .toList();
      state = state.copyWith(
        apiInputHistory: records,
        hasMoreMonitorRecords: totalCount > records.length,
      );
      monitorIndex = 0;

      final stream = adapter.chatStream(
        aiContent,
        context,
        options,
        onError: (errorInfo) {
          capturedError = errorInfo;
        },
      );

      final contentBuffer = StringBuffer();
      final reasoningBuffer = StringBuffer();

      debugPrint('[聊天] 开始接收流式响应...');

      // 如果 5 秒内没有收到内容，显示等待提示
      var hasReceivedContent = false;
      waitingTimer = Timer(const Duration(seconds: 5), () {
        if (!hasReceivedContent && state.isLoading) {
          state = state.copyWith(
            streamingContent: '服务器繁忙，正在排队等待响应...',
          );
        }
      });

      TokenUsage? lastUsage;
      await for (final chunk in stream) {
        debugPrint(
          '[SSE] content="${chunk.content}", reasoning="${chunk.reasoningContent}", finished=${chunk.isFinished}',
        );

        if (chunk.isStatus) {
          final fullRequestJson = chunk.fullRequestJson;
          if (fullRequestJson != null && fullRequestJson.isNotEmpty) {
            if (monitorIndex >= 0 &&
                monitorIndex < state.apiInputHistory.length) {
              final record = state.apiInputHistory[monitorIndex];
              if (record.id != null) {
                final updatedRecord = record.copyWith(
                  requestJson: fullRequestJson,
                );
                final newHistory = List<ApiMonitorRecord>.from(
                  state.apiInputHistory,
                );
                newHistory[monitorIndex] = updatedRecord;
                state = state.copyWith(apiInputHistory: newHistory);
                chatRepository.updateMonitorRecord(
                  id: record.id!,
                  requestJson: fullRequestJson,
                );
              }
            }
          }
          if (chunk.toolCallInfo != null) {
            appendInternalEvent('tool_call', {
              'tools': chunk.toolCallInfo!.tools
                  .map((t) => {
                        'name': t.name,
                        'arguments': t.arguments,
                        'result_preview': t.resultPreview,
                      })
                  .toList(),
              'summary': chunk.toolCallInfo!.summary,
            }, monitorIndex);
          }
          if (chunk.compactInfo != null) {
            appendInternalEvent('compact', {
              'strategy': chunk.compactInfo!.strategy,
              'pre_compact_tokens': chunk.compactInfo!.preCompactTokens,
              'post_compact_tokens': chunk.compactInfo!.postCompactTokens,
              'pre_compact_message_count':
                  chunk.compactInfo!.preCompactMessageCount,
              'post_compact_message_count':
                  chunk.compactInfo!.postCompactMessageCount,
              'is_auto': chunk.compactInfo!.isAuto,
            }, monitorIndex);
          }
          if (chunk.sessionNotesInitInfo != null) {
            appendInternalEvent('session_notes_init', {
              'conversation_id': chunk.sessionNotesInitInfo!.conversationId,
              'message_count': chunk.sessionNotesInitInfo!.messageCount,
              'notes_path': chunk.sessionNotesInitInfo!.notesPath,
            }, monitorIndex);
          }
          continue;
        }

        if (chunk.content.isNotEmpty) {
          contentBuffer.write(chunk.content);
          hasReceivedContent = true;
        }
        if (chunk.reasoningContent.isNotEmpty) {
          reasoningBuffer.write(chunk.reasoningContent);
          hasReceivedContent = true;
        }
        if (chunk.usage != null) {
          lastUsage = chunk.usage;
        }

        state = state.copyWith(
          streamingContent: contentBuffer.toString(),
          streamingReasoningContent: reasoningBuffer.toString(),
        );

        // 流式更新占位消息，使用节流减少 PUT 请求频率
        final currentPlaceholderId = placeholderId;
        // ignore: unnecessary_null_comparison
        if (currentPlaceholderId != null) {
          if (!_disposed) {
            _updateThrottle?.cancel();
            _updateThrottle = Timer(
              const Duration(milliseconds: 150),
              () async {
                if (_disposed) return;
                if (contentBuffer.isNotEmpty) {
                  await chatRepository.updateMessageContent(
                    currentPlaceholderId,
                    contentBuffer.toString(),
                    skipBroadcast: true,
                  );
                }
                if (reasoningBuffer.isNotEmpty) {
                  await chatRepository.updateMessageReasoningContent(
                    currentPlaceholderId,
                    reasoningBuffer.toString(),
                    skipBroadcast: true,
                  );
                }
                if (monitorIndex >= 0 &&
                    monitorIndex < state.apiInputHistory.length) {
                  final cr = state.apiInputHistory[monitorIndex];
                  if (cr.id != null) {
                    await chatRepository.updateMonitorRecord(
                      id: cr.id!,
                      responseRawText: formatResponseText(
                        contentBuffer.toString(),
                        reasoningBuffer.toString(),
                      ),
                    );
                  }
                }
              },
            );
          }
        }

        if (chunk.isFinished) {
          debugPrint(
            '[聊天] 流式响应结束，总内容长度: ${contentBuffer.length}',
          );
          break;
        }
      }

      // 流结束，标记监控记录为完成并保存 Token 用量
      if (monitorIndex >= 0 && monitorIndex < state.apiInputHistory.length) {
        final currentRecord = state.apiInputHistory[monitorIndex];
        if (currentRecord.id != null) {
          await chatRepository.updateMonitorRecord(
            id: currentRecord.id!,
            responseRawText: formatResponseText(
              contentBuffer.toString(),
              reasoningBuffer.toString(),
            ),
            isComplete: true,
            promptTokens: lastUsage?.promptTokens,
            completionTokens: lastUsage?.completionTokens,
            totalTokens: lastUsage != null
                ? lastUsage.promptTokens + lastUsage.completionTokens
                : null,
          );
          final updatedRecord = state.apiInputHistory[monitorIndex];
          if (updatedRecord.internalEvents.isNotEmpty) {
            await chatRepository.updateMonitorRecordInternalEvents(
              updatedRecord.id!,
              InternalEvent.encodeList(updatedRecord.internalEvents),
            );
          }
          final finalRecordsData = await chatRepository.getMonitorRecords(
            conversationId,
          );
          final finalRecords = finalRecordsData
              .map((d) => ApiMonitorRecord.fromJson(d))
              .toList();
          state = state.copyWith(apiInputHistory: finalRecords);
        }
      }

      // 将 API 返回的官方 token 数写入状态
      if (lastUsage != null) {
        state = state.copyWith(
          tokenCount: lastUsage.promptTokens + lastUsage.completionTokens,
        );
      }

      // 每次成功对话后增加消息计数
      state = state.copyWith(messageCount: state.messageCount + 2);

      // 流结束，确保最终内容已保存
      final finalContent = contentBuffer.toString();
      if (finalContent.isEmpty && capturedError == null) {
        const emptyMsg = 'AI 未返回任何内容，请检查 API Key 配置或重试';
        await chatRepository.updateMessageContent(placeholderId, emptyMsg);
        state = state.copyWith(error: emptyMsg);
      } else {
        await chatRepository.updateMessageContent(
          placeholderId,
          finalContent,
        );
      }
      if (reasoningBuffer.isNotEmpty) {
        await chatRepository.updateMessageReasoningContent(
          placeholderId,
          reasoningBuffer.toString(),
        );
      }

      // 使消息列表 Provider 失效
      ref.invalidate(conversationMessagesProvider(conversationId));
    } on Exception catch (e) {
      if (placeholderId != null) {
        try {
          await chatRepository.deleteMessage(placeholderId);
        } on Exception catch (deleteErr) {
          debugPrint('删除失败的占位消息时出错: $deleteErr');
        }
      }

      if (capturedError != null) {
        if (monitorIndex >= 0 && monitorIndex < state.apiInputHistory.length) {
          final errorRecord = state.apiInputHistory[monitorIndex];
          if (errorRecord.id != null) {
            await chatRepository.updateMonitorRecord(
              id: errorRecord.id!,
              errorCategory: capturedError!.category.name,
              errorCode: capturedError!.errorCode,
              errorMessage: capturedError!.message,
              errorSuggestion: capturedError!.suggestion,
            );
          }
        }
      }

      String errorMsg;
      if (capturedError != null) {
        errorMsg = capturedError!.message;
      } else if (stage == 'sending_user_message') {
        errorMsg = '发送消息失败';
      } else if (stage == 'creating_placeholder') {
        errorMsg = '创建助手响应失败';
      } else {
        errorMsg =
            'AI 响应中断: ${e.toString().replaceFirst('Exception: ', '')}';
      }

      state = state.copyWith(
        error: errorMsg,
        clearStreamingAssistantMessageId: true,
      );
    } finally {
      waitingTimer?.cancel();
      state = state.copyWith(
        isLoading: false,
        pendingMessages: state.pendingMessages
            .where((m) => m.id != pendingId)
            .toList(),
      );
    }
  }

  Future<void> createConversation(String title) async {
    final id = await chatRepository.createConversation(title);
    ref.read(activeConversationIdProvider.notifier).state = id;
    clearPendingIfMatched();
  }

  Future<void> switchConversation(String? id) async {
    ref.read(activeConversationIdProvider.notifier).state = id;
    _pendingIdCounter = 0;

    if (id != null) {
      try {
        final totalCount = await chatRepository.getMonitorRecordCount(id);
        final recordsData = await chatRepository.getMonitorRecords(id);
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
    } else {
      state = const ChatState();
    }
  }

  Future<void> renameConversation(String id, String newTitle) async {
    await chatRepository.renameConversation(id, newTitle);
  }

  Future<void> deleteConversation(String id) async {
    await chatRepository.deleteConversation(id);
    final activeId = ref.read(activeConversationIdProvider);
    if (activeId == id) {
      ref.read(activeConversationIdProvider.notifier).state = null;
    }
  }

  Future<void> toggleArchiveConversation(String id, bool isArchived) async {
    await chatRepository.toggleArchiveConversation(id, isArchived);
  }

  Future<void> deleteMessage(String messageId) async {
    await chatRepository.deleteMessage(messageId);
  }

  Future<void> clearConversationMessages(String conversationId) async {
    await chatRepository.clearMessages(conversationId);
  }

  /// 从后端获取当前会话的 token 使用量和消息数
  Future<void> fetchTokenStatus() async {
    final conversationId = ref.read(activeConversationIdProvider);
    if (conversationId == null) return;

    try {
      final cache = ref.read(settingsCacheProvider);
      final model = cache.selectedModel;
      final result = await chatRepository.getCompactStatus(
        conversationId: conversationId,
        model: model,
      );
      final tokenUsage = result['token_usage'] as int? ?? 0;
      final msgCount = result['message_count'] as int? ?? 0;
      state = state.copyWith(tokenCount: tokenUsage, messageCount: msgCount);
    } catch (_) {}
  }

  /// 从设置缓存同步子代理触发参数
  void updateAgentParams() {
    final cache = ref.read(settingsCacheProvider);
    final params = cache.params;
    state = state.copyWith(
      memoryMinMessages:
          params['param_session_memory_min_messages'] ?? 6,
      memoryMinTokensBetweenUpdate:
          params['param_session_memory_min_tokens_between_update'] ?? 2000,
      compactTriggerTokens:
          params['param_compact_trigger_tokens'] ?? 200000,
      dreamMinHours: params['param_dream_min_hours'] ?? 24,
    );
  }

  /// 当前会话已消耗的 token 总量
  int get currentTokenCount => state.tokenCount;
}

final chatNotifierProvider = StateNotifierProvider<ChatNotifier, ChatState>((
  ref,
) {
  final chatRepo = ref.watch(chatRepositoryProvider);
  final adapterFactory = ref.watch(adapterFactoryProvider);
  return ChatNotifier(chatRepo, adapterFactory, ref);
});
