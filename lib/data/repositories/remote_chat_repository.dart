import 'package:flutter/foundation.dart' show debugPrint;

import '../api_client.dart';
import '../models/conversation.dart';
import '../models/chat_message.dart';
import '../../infrastructure/sse_client.dart';

/// 远程聊天仓库
///
/// 通过 HTTP API 与后端服务器交互，统一管理会话/消息的读写。
/// 通过 WebSocket 事件流驱动的 rx_stream 取代轮询，实时刷新数据。
///
/// 数据流模式：先通过 HTTP 获取初始数据 yield 一次，
/// 然后订阅 WebSocket 事件流，在收到相关事件时重新获取数据 yield。
class RemoteChatRepository {
  final ApiClient _apiClient;
  final WebSocketClient _wsClient;

  RemoteChatRepository(this._apiClient, this._wsClient);

  /// 快速检查后端是否可达
  Future<bool> _isBackendReachable() async {
    try {
      return await _apiClient.healthCheckFast();
    } catch (_) {
      return false;
    }
  }

  /// 延迟连接 WebSocket（200ms），避免与初始 HTTP 请求竞争
  Future<void> _connectWsDelayed() async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    _wsClient.connect();
  }

  void dispose() {}

  // ========== 会话 ==========

  /// 兼容 int(0/1) 和 bool 两种 is_archived 格式
  bool _isArchived(dynamic value) => value == 1 || value == true;

  /// 共享的会话列表 WebSocket 事件流订阅
  ///
  /// watchConversations 和 watchArchivedConversations 共用同一个事件流，
  /// 仅在过滤逻辑上区分归档/非归档，避免重复订阅 WebSocket。
  Stream<List<Conversation>> _watchConversationsFiltered({
    required bool archived,
  }) async* {
    try {
      final data = await _apiClient.get('/conversations');
      final conversations = _parseConversations(data, archived: archived);
      yield conversations;
    } catch (e) {
      debugPrint('[RemoteChatRepository] error: $e');
      yield [];
    }

    if (!await _isBackendReachable()) return;

    final wsClient = _wsClient;
    // 仅非归档订阅时触发延迟连接，避免两个流同时调用 connect
    if (!archived) {
      _connectWsDelayed();
    }

    await for (final event in wsClient.events) {
      if (event.type == 'conversation_created' ||
          event.type == 'conversation_updated' ||
          event.type == 'conversation_deleted' ||
          event.type == 'data_imported') {
        try {
          final data = await _apiClient.get('/conversations');
          final conversations = _parseConversations(data, archived: archived);
          yield conversations;
        } catch (e) {
          debugPrint('[RemoteChatRepository] error: $e');
          yield [];
        }
      }
    }
  }

  /// 监听会话列表变化（非归档）
  Stream<List<Conversation>> watchConversations() =>
      _watchConversationsFiltered(archived: false);

  /// 监听归档会话列表变化
  Stream<List<Conversation>> watchArchivedConversations() =>
      _watchConversationsFiltered(archived: true);

  // ========== 消息 ==========

  /// 监听指定会话的消息列表变化
  ///
  /// 响应 message_created / message_updated / message_deleted 以及
  /// compact_activity / messages_compacted 事件。
  Stream<List<ChatMessage>> watchMessages(
    String conversationId, {
    int? limit,
    int offset = 0,
  }) async* {
    try {
      final messages = await _fetchMessages(
        conversationId,
        limit: limit,
        offset: offset,
      );
      yield messages;
    } catch (e) {
      debugPrint('[RemoteChatRepository] error: $e');
      yield [];
    }

    if (!await _isBackendReachable()) return;

    final wsClient = _wsClient;

    await for (final event in wsClient.events) {
      final type = event.type;
      if (type == 'message_created' ||
          type == 'message_updated' ||
          type == 'message_deleted') {
        final payload = event.payload;
        if (payload['conversation_id'] == conversationId) {
          try {
            final messages = await _fetchMessages(
              conversationId,
              limit: limit,
              offset: offset,
            );
            yield messages;
          } catch (e) {
            debugPrint('[RemoteChatRepository] error: $e');
            yield [];
          }
        }
      } else if (type == 'compact_activity' || type == 'messages_compacted') {
        final payload = event.payload;
        if (payload['conversation_id'] == conversationId) {
          try {
            final messages = await _fetchMessages(
              conversationId,
              limit: limit,
              offset: offset,
            );
            yield messages;
          } catch (e) {
            debugPrint('[RemoteChatRepository] error: $e');
            yield [];
          }
        }
      }
    }
  }

  // ========== 解析 ==========

  /// 解析会话列表 JSON，按归档状态过滤
  ///
  /// 使用 [_isArchived] 兼容 int(0/1) 和 bool 两种 is_archived 格式，
  /// 与 Conversation.fromJson 保持一致。
  List<Conversation> _parseConversations(
    dynamic data, {
    bool archived = false,
  }) {
    return (data as List)
        .where((c) {
          final isArchived = _isArchived(c['is_archived']);
          if (archived && !isArchived) return false;
          if (!archived && isArchived) return false;
          return true;
        })
        .map((c) => Conversation.fromJson(c as Map<String, dynamic>))
        .toList();
  }

  /// 从后端获取指定会话的消息列表
  ///
  /// 响应格式兼容 `{ messages: [...] }` 和纯数组两种形式。
  Future<List<ChatMessage>> _fetchMessages(
    String conversationId, {
    int? limit,
    int offset = 0,
  }) async {
    final queryParams = <String, dynamic>{'conversationId': conversationId};
    if (limit != null) {
      queryParams['limit'] = limit;
      queryParams['offset'] = offset;
    }
    final data = await _apiClient.get(
      '/messages',
      queryParameters: queryParams,
    );

    List<dynamic> messageList;
    if (data is Map && data.containsKey('messages')) {
      messageList = data['messages'] as List;
    } else {
      messageList = data as List;
    }

    return messageList
        .map((m) => ChatMessage.fromJson(m as Map<String, dynamic>))
        .toList();
  }

  // ========== 会话操作 ==========

  /// 获取所有非归档会话
  Future<List<Conversation>> getConversations() async {
    final data = await _apiClient.get('/conversations');
    return _parseConversations(data);
  }

  /// 创建新会话，返回会话 ID
  Future<String> createConversation(String title) async {
    final response = await _apiClient.post(
      '/conversations',
      data: {'title': title},
    );
    return response['id'] as String;
  }

  // ========== 消息操作 ==========

  /// 发送消息到指定会话，返回消息 ID
  Future<String> sendMessage({
    required String conversationId,
    required String role,
    required String content,
    String? reasoningContent,
    int? tokenCount,
  }) async {
    final response = await _apiClient.post(
      '/messages',
      data: {
        'conversation_id': conversationId,
        'role': role,
        'content': content,
        'reasoning_content': reasoningContent ?? '',
      },
    );
    return response['id'] as String;
  }

  /// 更新消息正文内容
  ///
  /// [skipBroadcast] 为 true 时不触发 WebSocket 广播（流式更新时避免频繁推送）
  Future<void> updateMessageContent(
    String messageId,
    String content, {
    bool skipBroadcast = false,
  }) async {
    await _apiClient.put(
      '/messages/$messageId',
      data: {'content': content},
      queryParameters: skipBroadcast ? {'skip_broadcast': 'true'} : null,
    );
  }

  /// 更新消息推理内容
  ///
  /// [skipBroadcast] 为 true 时不触发 WebSocket 广播
  Future<void> updateMessageReasoningContent(
    String messageId,
    String reasoningContent, {
    bool skipBroadcast = false,
  }) async {
    await _apiClient.put(
      '/messages/$messageId',
      data: {'reasoning_content': reasoningContent},
      queryParameters: skipBroadcast ? {'skip_broadcast': 'true'} : null,
    );
  }

  /// 重命名会话
  Future<void> renameConversation(String id, String newTitle) async {
    await _apiClient.put('/conversations/$id', data: {'title': newTitle});
  }

  /// 删除会话
  Future<void> deleteConversation(String id) async {
    await _apiClient.delete('/conversations/$id');
  }

  /// 切换会话归档状态
  Future<void> toggleArchiveConversation(String id, bool isArchived) async {
    await _apiClient.put(
      '/conversations/$id',
      data: {'is_archived': isArchived ? 1 : 0},
    );
  }

  /// 设置会话背景样式
  Future<void> setConversationBackground(String id, String? background) async {
    await _apiClient.put(
      '/conversations/$id',
      data: {'background': background},
    );
  }

  /// 删除指定消息
  Future<void> deleteMessage(String messageId) async {
    await _apiClient.delete('/messages/$messageId');
  }

  /// 清空指定会话的所有消息，返回删除数量
  Future<int> clearMessages(String conversationId) async {
    final response = await _apiClient.delete(
      '/messages',
      queryParameters: {'conversationId': conversationId},
    );
    return response['deleted_count'] as int? ?? 0;
  }

  // ========== 压缩 / 记忆 / 梦境 ==========

  /// 触发上下文压缩，超时 5 分钟
  Future<Map<String, dynamic>> compactConversation({
    required String conversationId,
    String model = 'deepseek-v4-pro',
    String? customInstructions,
  }) async {
    final data = <String, dynamic>{
      'conversation_id': conversationId,
      'model': model,
    };
    if (customInstructions != null) {
      data['custom_instructions'] = customInstructions;
    }
    final result = await _apiClient.post(
      '/compact',
      data: data,
      receiveTimeout: const Duration(minutes: 5),
    );
    if (result is Map && result['success'] == false) {
      throw Exception(result['error'] ?? '压缩失败');
    }
    return result as Map<String, dynamic>;
  }

  /// 获取压缩状态（token 用量、消息数）
  Future<Map<String, dynamic>> getCompactStatus({
    required String conversationId,
    String model = 'deepseek-v4-pro',
  }) async {
    final result = await _apiClient.get(
      '/compact/status',
      queryParameters: {'conversation_id': conversationId, 'model': model},
    );
    return result as Map<String, dynamic>;
  }

  /// 触发会话记忆提取
  Future<Map<String, dynamic>> extractSessionMemory(
    String conversationId,
  ) async {
    final result = await _apiClient.post(
      '/session-notes/$conversationId/extract',
    );
    return result as Map<String, dynamic>;
  }

  /// 触发梦境整理
  Future<Map<String, dynamic>> triggerDream() async {
    final result = await _apiClient.post('/dream');
    return result as Map<String, dynamic>;
  }

  /// 查询当前 Dream 任务状态
  ///
  /// 返回 `{ status: 'idle' | 'running' | 'completed', summary?, startedAt? }`
  Future<Map<String, dynamic>> getDreamStatus() async {
    return await _apiClient.get('/dream/status') as Map<String, dynamic>;
  }

  /// 读取会话笔记
  ///
  /// 返回 `{ conversationId, notes, extractedAt }`，404 或其他错误时返回 null
  Future<Map<String, dynamic>?> getSessionNotes(String conversationId) async {
    try {
      return await _apiClient.get('/session-notes/$conversationId')
          as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  /// 删除会话笔记
  ///
  /// 失败时抛出异常，由调用方处理
  Future<void> deleteSessionNotes(String conversationId) async {
    await _apiClient.delete('/session-notes/$conversationId');
  }

  // ========== 监控记录操作（HTTP API） ==========

  /// 插入一条监控记录，返回记录 ID
  Future<String> insertMonitorRecord({
    required String conversationId,
    String requestJson = '',
    String responseRawText = '',
    bool isComplete = false,
    int? promptTokens,
    int? completionTokens,
    int? totalTokens,
    String? errorCategory,
    String? errorCode,
    String? errorMessage,
    String? errorSuggestion,
    String? internalEvents,
  }) async {
    final response = await _apiClient.post(
      '/monitor/records',
      data: {
        'conversationId': conversationId,
        'requestJson': requestJson,
        'responseRawText': responseRawText,
        'isComplete': isComplete,
        'promptTokens': promptTokens,
        'completionTokens': completionTokens,
        'totalTokens': totalTokens,
        'errorCategory': errorCategory,
        'errorCode': errorCode,
        'errorMessage': errorMessage,
        'errorSuggestion': errorSuggestion,
        'internalEvents': internalEvents,
      },
    );
    return response['id'] as String;
  }

  /// 分页获取监控记录
  Future<List<Map<String, dynamic>>> getMonitorRecords(
    String conversationId, {
    int limit = 200,
    int offset = 0,
  }) async {
    final response = await _apiClient.get(
      '/monitor/records',
      queryParameters: {
        'conversationId': conversationId,
        'limit': limit.toString(),
        'offset': offset.toString(),
      },
    );
    return (response['records'] as List)
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
  }

  /// 获取监控记录总数
  Future<int> getMonitorRecordCount(String conversationId) async {
    final response = await _apiClient.get(
      '/monitor/records/count',
      queryParameters: {'conversationId': conversationId},
    );
    return response['count'] as int;
  }

  /// 更新监控记录（仅更新非 null 字段）
  Future<int> updateMonitorRecord({
    required String id,
    String? requestJson,
    String? responseRawText,
    bool? isComplete,
    int? promptTokens,
    int? completionTokens,
    int? totalTokens,
    String? errorCategory,
    String? errorCode,
    String? errorMessage,
    String? errorSuggestion,
  }) async {
    final data = <String, dynamic>{};
    if (requestJson != null) data['requestJson'] = requestJson;
    if (responseRawText != null) data['responseRawText'] = responseRawText;
    if (isComplete != null) data['isComplete'] = isComplete;
    if (promptTokens != null) data['promptTokens'] = promptTokens;
    if (completionTokens != null) data['completionTokens'] = completionTokens;
    if (totalTokens != null) data['totalTokens'] = totalTokens;
    if (errorCategory != null) data['errorCategory'] = errorCategory;
    if (errorCode != null) data['errorCode'] = errorCode;
    if (errorMessage != null) data['errorMessage'] = errorMessage;
    if (errorSuggestion != null) data['errorSuggestion'] = errorSuggestion;
    if (data.isEmpty) return 0;
    await _apiClient.put('/monitor/records/$id', data: data);
    return 1;
  }

  /// 更新监控记录的内部事件 JSON
  Future<void> updateMonitorRecordInternalEvents(
    String id,
    String internalEvents,
  ) async {
    await _apiClient.put(
      '/monitor/records/$id/internal-events',
      data: {'internalEvents': internalEvents},
    );
  }

  /// 删除指定会话的所有监控记录，返回删除数量
  Future<int> deleteMonitorRecordsByConversation(String conversationId) async {
    final response = await _apiClient.delete(
      '/monitor/records',
      queryParameters: {'conversationId': conversationId},
    );
    return response['deleted'] as int? ?? 0;
  }

  /// 删除所有监控记录，返回删除数量
  Future<int> deleteAllMonitorRecords() async {
    final response = await _apiClient.delete('/monitor/records/all');
    return response['deleted'] as int? ?? 0;
  }

  /// 删除所有监控活动记录
  Future<void> deleteAllMonitorActivities() async {
    await _apiClient.delete('/monitor/activities');
  }

  /// 删除旧监控记录，仅保留最近 [keepCount] 条
  Future<void> deleteOldMonitorRecords(
    String conversationId,
    int keepCount,
  ) async {
    await _apiClient.delete(
      '/monitor/records/old',
      queryParameters: {
        'conversationId': conversationId,
        'keepCount': keepCount.toString(),
      },
    );
  }
}
