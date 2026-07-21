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
///
/// 混入 [ChatAgentMixin]（代理会话管理）和 [ChatMonitorMixin]（监控记录管理），
/// 是前端聊天功能的核心状态控制器。
class ChatNotifier extends StateNotifier<ChatState>
    with ChatAgentMixin, ChatMonitorMixin {
  @override
  final RemoteChatRepository chatRepository;

  /// AI 适配器工厂，按模型 ID 获取对应的适配器实例
  final AdapterFactory _adapterFactory;

  @override
  final Ref ref;

  /// 乐观 UI 的消息 ID 计数器（负数，避免与后端 ID 冲突）
  int _pendingIdCounter = 0;

  /// 后端持久化节流定时器（150ms 间隔，减少 PUT 请求频率）
  Timer? _updateThrottle;

  /// 流式 UI 节流定时器（50ms 间隔，避免每 token 触发全量 state 重建）
  Timer? _streamingUiThrottle;

  /// 标记 Notifier 是否已释放，防止释放后继续更新状态
  bool _disposed = false;

  ChatNotifier(this.chatRepository, this._adapterFactory, this.ref)
    : super(const ChatState());

  @override
  void dispose() {
    _disposed = true;
    _updateThrottle?.cancel();
    _streamingUiThrottle?.cancel();
    super.dispose();
  }

  /// 安全更新状态：已释放时跳过，避免 dispose 后 setState 抛错
  void _setState(ChatState newState) {
    if (_disposed) return;
    state = newState;
  }

  /// 发送用户消息并接收 AI 流式响应
  ///
  /// 完整流程：
  /// 1. 确保活跃会话存在（无则自动创建主代理会话）
  /// 2. 为 AI 附加日期/时间标记（不在 UI 显示）
  /// 3. 乐观 UI：立即将用户消息加入 pendingMessages
  /// 4. 发送用户消息到后端，创建助手占位消息
  /// 5. 通过 SSE 流式接收 AI 响应，节流更新占位消息
  /// 6. 流结束后保存最终内容、token 用量，清理 pending 消息
  Future<void> sendMessage(String content) async {
    // 1. 解析或创建活跃会话
    final conversationId = await _resolveOrCreateConversation();
    final trimmedContent = content.trim();
    if (trimmedContent.isEmpty) return;

    // 2. 构建带时间标记的 AI 内容 + 乐观 UI 添加 pending 消息
    final aiContent = _buildTimestampedAiContent(trimmedContent, conversationId);
    final (:pendingId, :pendingUserMsg) = _addPendingUserMessage(
      trimmedContent,
      conversationId,
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

      _setState(
        state.copyWith(
          isLoading: true,
          streamingContent: '',
          streamingReasoningContent: '',
          streamingAssistantMessageId: placeholderId,
          clearError: true,
        ),
      );

      stage = 'streaming';

      // 3. 构建 AI 上下文、options、监控记录
      final (:context, :messageCountBefore) = _buildChatContext(
        conversationId,
        pendingUserMsg.id,
      );
      final options = _buildAdapterOptions(conversationId);

      final apiClient = ref.read(apiClientProvider);
      final modelId = ref.read(selectedModelProvider);
      final adapter = _adapterFactory.getAdapter(
        modelId,
        backendBaseUrl: apiClient.baseUrl,
        authToken: apiClient.currentToken,
      );

      monitorIndex = await _insertMonitorRecordAndRefresh(conversationId);

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

      if (kDebugMode) {
        debugPrint('[聊天] 开始接收流式响应...');
      }

      // 如果 5 秒内没有收到内容，显示等待提示
      var hasReceivedContent = false;
      waitingTimer = Timer(const Duration(seconds: 5), () {
        if (!hasReceivedContent && state.isLoading) {
          _setState(
            state.copyWith(
              streamingContent: '服务器繁忙，正在排队等待响应...',
            ),
          );
        }
      });

      // 启动 UI 节流定时器
      _startStreamingUiThrottle(contentBuffer, reasoningBuffer);

      TokenUsage? lastUsage;
      await for (final chunk in stream) {
        // 仅在 debug 模式下输出 chunk 详情，避免 release 构建中的日志风暴与对话内容外泄
        if (kDebugMode) {
          debugPrint(
            '[SSE] content="${chunk.content}", reasoning="${chunk.reasoningContent}", '
            'finished=${chunk.isFinished}, isError=${chunk.isError}',
          );
        }

        // 后端推送错误事件：映射为 ErrorInfo 并抛出异常以走 catch 分支
        if (chunk.isError) {
          capturedError = await _handleErrorChunk(chunk, monitorIndex);
          throw Exception(capturedError!.message);
        }

        if (chunk.isStatus) {
          _handleStatusChunk(chunk, monitorIndex);
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

        // 流式 UI 由 _streamingUiThrottle 每 50ms 节流更新，此处不再每 token 触发 state 重建

        // 流式更新占位消息到后端，使用节流减少 PUT 请求频率
        // 注：placeholderId 在此处已被类型提升为 String（line 109 赋值后无重新赋值）
        _scheduleThrottledPersist(
          placeholderId,
          contentBuffer,
          reasoningBuffer,
          monitorIndex,
        );

        if (chunk.isFinished) {
          if (kDebugMode) {
            debugPrint('[聊天] 流式响应结束，总内容长度: ${contentBuffer.length}');
          }
          // 流结束前取消节流定时器，避免与最终保存竞态
          _updateThrottle?.cancel();
          _updateThrottle = null;
          // 立即取消 UI 节流并同步最终内容，确保 UI 与持久化数据一致
          _streamingUiThrottle?.cancel();
          _streamingUiThrottle = null;
          _setState(
            state.copyWith(
              streamingContent: contentBuffer.toString(),
              streamingReasoningContent: reasoningBuffer.toString(),
            ),
          );
          break;
        }
      }

      // 流结束，标记监控记录为完成并保存 Token 用量
      await _finalizeMonitorRecord(
        monitorIndex,
        conversationId,
        contentBuffer.toString(),
        reasoningBuffer.toString(),
        lastUsage,
      );

      // 将 API 返回的官方 token 数写入状态
      if (lastUsage != null) {
        _setState(
          state.copyWith(
            tokenCount: lastUsage.promptTokens + lastUsage.completionTokens,
          ),
        );
      }

      // 使消息列表 Provider 失效
      ref.invalidate(conversationMessagesProvider(conversationId));

      // 根据实际消息列表长度变化更新计数
      final messagesAfter = await ref.read(
        conversationMessagesProvider(conversationId).future,
      );
      final actualDelta = messagesAfter.length - messageCountBefore;
      if (actualDelta > 0) {
        _setState(
          state.copyWith(messageCount: state.messageCount + actualDelta),
        );
      }

      // 流结束，确保最终内容已保存
      await _saveFinalContent(
        placeholderId,
        contentBuffer.toString(),
        reasoningBuffer.toString(),
        capturedError,
      );
    } on Exception catch (e) {
      await _handleSendException(
        e,
        conversationId,
        placeholderId: placeholderId,
        pendingId: pendingId,
        capturedError: capturedError,
        stage: stage,
        monitorIndex: monitorIndex,
      );
    } finally {
      _updateThrottle?.cancel();
      _updateThrottle = null;
      _streamingUiThrottle?.cancel();
      _streamingUiThrottle = null;
      waitingTimer?.cancel();
      _setState(
        state.copyWith(
          isLoading: false,
          pendingMessages: state.pendingMessages
              .where((m) => m.id != pendingId)
              .toList(),
        ),
      );
    }
  }

  /// 创建新会话并切换为当前活跃会话
  Future<void> createConversation(String title) async {
    final id = await chatRepository.createConversation(title);
    ref.read(activeConversationIdProvider.notifier).state = id;
    clearPendingIfMatched();
  }

  /// 切换到指定会话，重置状态并加载该会话的监控记录
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
        _setState(
          ChatState(
            apiInputHistory: records,
            hasMoreMonitorRecords: totalCount > records.length,
          ),
        );
      } catch (e) {
        debugPrint('加载监控记录失败: $e');
        _setState(const ChatState());
      }
    } else {
      _setState(const ChatState());
    }
  }

  /// 重命名指定会话
  Future<void> renameConversation(String id, String newTitle) async {
    await chatRepository.renameConversation(id, newTitle);
  }

  /// 删除指定会话，若为当前活跃会话则清空活跃 ID
  Future<void> deleteConversation(String id) async {
    await chatRepository.deleteConversation(id);
    final activeId = ref.read(activeConversationIdProvider);
    if (activeId == id) {
      ref.read(activeConversationIdProvider.notifier).state = null;
    }
  }

  /// 切换会话的归档状态
  Future<void> toggleArchiveConversation(String id, bool isArchived) async {
    await chatRepository.toggleArchiveConversation(id, isArchived);
  }

  /// 删除指定消息
  Future<void> deleteMessage(String messageId) async {
    await chatRepository.deleteMessage(messageId);
  }

  /// 清空指定会话的所有消息
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
      _setState(
        state.copyWith(tokenCount: tokenUsage, messageCount: msgCount),
      );
    } catch (_) {
      debugPrint('[ChatNotifier] fetchTokenStatus failed');
    }
  }

  /// 从设置缓存同步子代理触发参数
  void updateAgentParams() {
    final cache = ref.read(settingsCacheProvider);
    final params = cache.params;
    _setState(
      state.copyWith(
        memoryMinMessages: params['param_session_memory_min_messages'] ?? 6,
        memoryMinTokensBetweenUpdate:
            params['param_session_memory_min_tokens_between_update'] ?? 2000,
        compactTriggerTokens: params['param_compact_trigger_tokens'] ?? 200000,
        dreamMinHours: params['param_dream_min_hours'] ?? 24,
      ),
    );
  }

  // ==================== sendMessage 私有辅助方法 ====================
  //
  // 以下方法由 [sendMessage] 按阶段调用，将原本 536 行的巨型方法拆分为
  // 可读、可测试的阶段化方法。行为与原实现完全一致。

  /// 解析或创建活跃会话 ID
  ///
  /// 优先使用当前活跃会话；若无，尝试从 SharedPreferences 读取主代理会话 ID；
  /// 都不存在则创建新的主代理会话并持久化。
  Future<String> _resolveOrCreateConversation() async {
    var conversationId = ref.read(activeConversationIdProvider);
    if (conversationId != null) return conversationId;

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
    return conversationId;
  }

  /// 构建发给 AI 的带日期/时间标记的内容（不在 UI 显示）
  ///
  /// 若当天已有消息则不附加日期，仅附加时间。
  String _buildTimestampedAiContent(
    String content,
    String conversationId,
  ) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final existingForCheck =
        ref.read(conversationMessagesProvider(conversationId)).valueOrNull ??
        [];
    final hasMessageToday = existingForCheck.any((m) {
      final created = m.createdAt.toLocal();
      return created.year == today.year &&
          created.month == today.month &&
          created.day == today.day;
    });

    final timeStr =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')}';
    var aiContent = content;
    if (!hasMessageToday) {
      final dateStr =
          '${now.year}/${now.month.toString().padLeft(2, '0')}/${now.day.toString().padLeft(2, '0')}';
      aiContent = 'Day: $dateStr\n$aiContent';
    }
    return '$aiContent\ntime: $timeStr';
  }

  /// 乐观 UI：立即将用户消息加入 pendingMessages 列表
  ///
  /// 返回 (pendingId, pendingUserMsg) record，pendingId 为负数避免与后端 ID 冲突。
  ({String pendingId, ChatMessage pendingUserMsg}) _addPendingUserMessage(
    String content,
    String conversationId,
  ) {
    final pendingId = (--_pendingIdCounter).toString();
    final pendingUserMsg = ChatMessage(
      id: pendingId,
      conversationId: conversationId,
      role: 'user',
      content: content,
      reasoningContent: null,
      isCompactSummary: false,
      createdAt: DateTime.now(),
    );

    _setState(
      state.copyWith(
        pendingMessages: [...state.pendingMessages, pendingUserMsg],
        clearError: true,
      ),
    );

    return (pendingId: pendingId, pendingUserMsg: pendingUserMsg);
  }

  /// 构建 AI 上下文消息列表和消息计数
  ///
  /// 排除 pending 消息（避免重复），返回 (context, messageCountBefore) record。
  ({List<Message> context, int messageCountBefore}) _buildChatContext(
    String conversationId,
    String pendingUserMsgId,
  ) {
    final existingMessages =
        ref.read(conversationMessagesProvider(conversationId)).valueOrNull ??
        [];
    final messageCountBefore = existingMessages.length;
    final context = existingMessages
        .where((m) => m.id != pendingUserMsgId)
        .map(
          (m) => Message(
            role: m.role,
            content: m.content,
            reasoningContent: m.reasoningContent,
            isCompactSummary: m.isCompactSummary,
          ),
        )
        .toList();
    return (context: context, messageCountBefore: messageCountBefore);
  }

  /// 构建 AI 适配器请求选项
  ///
  /// 从 settingsCacheProvider 读取模型、思考模式、温度、maxTokens 等参数。
  Map<String, dynamic> _buildAdapterOptions(String conversationId) {
    final modelId = ref.read(selectedModelProvider);
    final cache = ref.read(settingsCacheProvider);
    final thinkingType = cache.thinkingType;
    final reasoningEffort = cache.reasoningEffort;

    final options = <String, dynamic>{
      'model': modelId,
      'thinking_type': thinkingType,
    };

    options['temperature'] = cache.temperature;
    options['maxTokens'] = cache.maxTokens;

    if (reasoningEffort.isNotEmpty) {
      options['reasoning_effort'] = reasoningEffort;
    }

    options['json_mode'] = cache.jsonMode;
    options['conversation_id'] = conversationId;

    return options;
  }

  /// 插入监控记录并刷新 state 中的监控记录列表
  ///
  /// 返回新插入记录在列表中的索引（monitorIndex）。
  Future<int> _insertMonitorRecordAndRefresh(String conversationId) async {
    final newRecordId = await chatRepository.insertMonitorRecord(
      conversationId: conversationId,
      requestJson: '',
      responseRawText: '',
      isComplete: false,
    );

    final totalCount = await chatRepository.getMonitorRecordCount(
      conversationId,
    );
    final recordsData = await chatRepository.getMonitorRecords(
      conversationId,
    );
    final records = recordsData
        .map((d) => ApiMonitorRecord.fromJson(d))
        .toList();
    _setState(
      state.copyWith(
        apiInputHistory: records,
        hasMoreMonitorRecords: totalCount > records.length,
      ),
    );
    return records.indexWhere((r) => r.id == newRecordId);
  }

  /// 启动 UI 节流定时器：每 50ms 同步一次 streamingContent/reasoningContent
  ///
  /// 避免每个 SSE chunk 都触发 state 全量重建造成的 UI 帧压力。
  /// [contentBuffer] 和 [reasoningBuffer] 为引用类型，定时器触发时读取最新内容。
  void _startStreamingUiThrottle(
    StringBuffer contentBuffer,
    StringBuffer reasoningBuffer,
  ) {
    _streamingUiThrottle?.cancel();
    _streamingUiThrottle = Timer.periodic(
      const Duration(milliseconds: 50),
      (_) {
        if (_disposed) return;
        final latestContent = contentBuffer.toString();
        final latestReasoning = reasoningBuffer.toString();
        if (state.streamingContent != latestContent ||
            state.streamingReasoningContent != latestReasoning) {
          _setState(
            state.copyWith(
              streamingContent: latestContent,
              streamingReasoningContent: latestReasoning,
            ),
          );
        }
      },
    );
  }

  /// 处理 SSE 错误 chunk（isError=true 的后端错误事件）
  ///
  /// 返回构建的 [ErrorInfo] 并更新监控记录。调用方负责设置 capturedError 并抛出异常，
  /// 以走 catch 分支统一清理占位消息。
  Future<ErrorInfo> _handleErrorChunk(
    StreamChunk chunk,
    int monitorIndex,
  ) async {
    final errorInfo = ErrorInfo(
      category: ErrorCategory.server,
      message: chunk.content.isEmpty ? '未知错误' : chunk.content,
    );
    if (monitorIndex >= 0 && monitorIndex < state.apiInputHistory.length) {
      final errorRecord = state.apiInputHistory[monitorIndex];
      if (errorRecord.id != null) {
        await chatRepository.updateMonitorRecord(
          id: errorRecord.id!,
          errorCategory: errorInfo.category.name,
          errorMessage: errorInfo.message,
        );
      }
    }
    return errorInfo;
  }

  /// 处理 SSE 状态 chunk（isStatus=true 的非用户可见事件）
  ///
  /// 处理 full_request、tool_call、compact、session_notes_init 等状态事件，
  /// 将其记录到监控记录的 internalEvents 中。
  void _handleStatusChunk(StreamChunk chunk, int monitorIndex) {
    final fullRequestJson = chunk.fullRequestJson;
    if (fullRequestJson != null && fullRequestJson.isNotEmpty) {
      if (monitorIndex >= 0 && monitorIndex < state.apiInputHistory.length) {
        final record = state.apiInputHistory[monitorIndex];
        if (record.id != null) {
          final updatedRecord = record.copyWith(
            requestJson: fullRequestJson,
          );
          final newHistory = List<ApiMonitorRecord>.from(
            state.apiInputHistory,
          );
          newHistory[monitorIndex] = updatedRecord;
          _setState(state.copyWith(apiInputHistory: newHistory));
          chatRepository
              .updateMonitorRecord(
                id: record.id!,
                requestJson: fullRequestJson,
              )
              .catchError((Object e) {
            debugPrint(
              '[ChatNotifier] updateMonitorRecord failed: $e',
            );
            return 0;
          });
        }
      }
    }
    if (chunk.toolCallInfo != null) {
      appendInternalEvent('tool_call', {
        'tools': chunk.toolCallInfo!.tools
            .map(
              (t) => {
                'name': t.name,
                'arguments': t.arguments,
                'result_preview': t.resultPreview,
              },
            )
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
  }

  /// 调度节流持久化占位消息内容到后端
  ///
  /// 每 150ms 最多一次，将当前缓冲区内容 PUT 到后端，同时更新监控记录的 responseRawText。
  void _scheduleThrottledPersist(
    String placeholderId,
    StringBuffer contentBuffer,
    StringBuffer reasoningBuffer,
    int monitorIndex,
  ) {
    if (_disposed) return;
    _updateThrottle?.cancel();
    _updateThrottle = Timer(
      const Duration(milliseconds: 150),
      () async {
        if (_disposed) return;
        if (contentBuffer.isNotEmpty) {
          await chatRepository.updateMessageContent(
            placeholderId,
            contentBuffer.toString(),
            skipBroadcast: true,
          );
        }
        if (reasoningBuffer.isNotEmpty) {
          await chatRepository.updateMessageReasoningContent(
            placeholderId,
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

  /// 流结束后更新监控记录：标记完成、保存 token 用量、刷新记录列表
  Future<void> _finalizeMonitorRecord(
    int monitorIndex,
    String conversationId,
    String content,
    String reasoning,
    TokenUsage? usage,
  ) async {
    if (monitorIndex < 0 || monitorIndex >= state.apiInputHistory.length) {
      return;
    }
    final currentRecord = state.apiInputHistory[monitorIndex];
    if (currentRecord.id == null) return;

    await chatRepository.updateMonitorRecord(
      id: currentRecord.id!,
      responseRawText: formatResponseText(content, reasoning),
      isComplete: true,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
      totalTokens: usage != null
          ? usage.promptTokens + usage.completionTokens
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
    _setState(state.copyWith(apiInputHistory: finalRecords));
  }

  /// 流结束后保存最终内容到后端占位消息
  ///
  /// 若内容为空且无错误，写入默认空响应提示并设置 state.error。
  Future<void> _saveFinalContent(
    String placeholderId,
    String content,
    String reasoning,
    ErrorInfo? capturedError,
  ) async {
    if (content.isEmpty && capturedError == null) {
      const emptyMsg = 'AI 未返回任何内容，请检查 API Key 配置或重试';
      await chatRepository.updateMessageContent(placeholderId, emptyMsg);
      _setState(
        state.copyWith(
          error: const ErrorInfo(
            category: ErrorCategory.unknown,
            message: emptyMsg,
          ),
        ),
      );
    } else {
      await chatRepository.updateMessageContent(placeholderId, content);
    }
    if (reasoning.isNotEmpty) {
      await chatRepository.updateMessageReasoningContent(
        placeholderId,
        reasoning,
      );
    }
  }

  /// 处理 sendMessage 异常：清理占位消息、更新监控记录错误信息、设置 state.error
  ///
  /// 根据 [stage] 提供差异化的错误信息：
  /// - 'sending_user_message' → 网络错误
  /// - 'creating_placeholder' → 创建失败
  /// - 其他 → AI 响应中断（保留异常消息）
  Future<void> _handleSendException(
    Exception e,
    String conversationId, {
    required String? placeholderId,
    required String pendingId,
    required ErrorInfo? capturedError,
    required String stage,
    required int monitorIndex,
  }) async {
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
            errorCategory: capturedError.category.name,
            errorCode: capturedError.errorCode,
            errorMessage: capturedError.message,
            errorSuggestion: capturedError.suggestion,
          );
        }
      }
    }

    ErrorInfo errorInfo;
    if (capturedError != null) {
      errorInfo = capturedError;
    } else if (stage == 'sending_user_message') {
      errorInfo = const ErrorInfo(
        category: ErrorCategory.network,
        message: '发送消息失败',
      );
    } else if (stage == 'creating_placeholder') {
      errorInfo = const ErrorInfo(
        category: ErrorCategory.unknown,
        message: '创建助手响应失败',
      );
    } else {
      errorInfo = ErrorInfo(
        category: ErrorCategory.unknown,
        message: 'AI 响应中断: ${e.toString().replaceFirst('Exception: ', '')}',
      );
    }

    _setState(
      state.copyWith(
        error: errorInfo,
        clearStreamingAssistantMessageId: true,
      ),
    );
    // 失败时同步刷新消息列表 Provider，保证乐观 UI 的用户消息与后端状态一致，
    // 避免"用户消息消失直到下次刷新"的问题
    ref.invalidate(conversationMessagesProvider(conversationId));
  }

  // ==================== 状态查询 ====================

  /// 当前会话已消耗的 token 总量
  int get currentTokenCount => state.tokenCount;
}

/// 聊天状态 Notifier Provider
///
/// 依赖 [chatRepositoryProvider] 和 [adapterFactoryProvider]，
/// 在被 watch 时自动创建 [ChatNotifier] 实例。
final chatNotifierProvider = StateNotifierProvider<ChatNotifier, ChatState>((
  ref,
) {
  final chatRepo = ref.watch(chatRepositoryProvider);
  final adapterFactory = ref.watch(adapterFactoryProvider);
  return ChatNotifier(chatRepo, adapterFactory, ref);
});
