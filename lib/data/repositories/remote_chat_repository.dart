import '../api_client.dart';
import '../models/conversation.dart';
import '../models/chat_message.dart';
import '../../infrastructure/sse_client.dart';

/// 远程聊天仓库
///
/// 通过 HTTP API 与后端服务器交互，统一管理会话/消息的读写。
/// 通过 WebSocket 事件流驱动的 rx_stream 取代轮询，实时刷新数据。
class RemoteChatRepository {
  final ApiClient _apiClient;
  WebSocketClient? _sharedWsClient;

  RemoteChatRepository(this._apiClient);

  /// 获取或创建共享的 WebSocket 客户端
  WebSocketClient _getOrCreateWsClient() {
    _sharedWsClient ??= WebSocketClient(
      url: '${_apiClient.wsBaseUrl}/ws/events',
      token: _apiClient.currentToken,
    );
    _sharedWsClient!.setToken(_apiClient.currentToken);
    return _sharedWsClient!;
  }

  Future<bool> _isBackendReachable() async {
    try {
      return await _apiClient.healthCheckFast();
    } catch (_) {
      return false;
    }
  }

  Future<void> _connectWsDelayed() async {
    await Future<void>.delayed(const Duration(milliseconds: 200));
    final client = _sharedWsClient;
    client?.connect();
  }

  void dispose() {
    _sharedWsClient?.dispose();
    _sharedWsClient = null;
  }

  // ========== 会话 ==========

  Stream<List<Conversation>> watchConversations() async* {
    try {
      final data = await _apiClient.get('/conversations');
      final conversations = _parseConversations(data);
      yield conversations;
    } catch (e) {
      yield [];
    }

    if (!await _isBackendReachable()) return;

    final wsClient = _getOrCreateWsClient();
    _connectWsDelayed();

    await for (final event in wsClient.events) {
      if (event.type == 'conversation_created' ||
          event.type == 'conversation_updated' ||
          event.type == 'conversation_deleted' ||
          event.type == 'data_imported') {
        try {
          final data = await _apiClient.get('/conversations');
          final conversations = _parseConversations(data);
          yield conversations;
        } catch (e) {
          yield [];
        }
      }
    }
  }

  Stream<List<Conversation>> watchArchivedConversations() async* {
    try {
      final data = await _apiClient.get('/conversations');
      final conversations = _parseConversations(data, archived: true);
      yield conversations;
    } catch (e) {
      yield [];
    }

    if (!await _isBackendReachable()) return;

    final wsClient = _getOrCreateWsClient();

    await for (final event in wsClient.events) {
      if (event.type == 'conversation_created' ||
          event.type == 'conversation_updated' ||
          event.type == 'conversation_deleted' ||
          event.type == 'data_imported') {
        try {
          final data = await _apiClient.get('/conversations');
          final conversations = _parseConversations(data, archived: true);
          yield conversations;
        } catch (e) {
          yield [];
        }
      }
    }
  }

  // ========== 消息 ==========

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
      yield [];
    }

    if (!await _isBackendReachable()) return;

    final wsClient = _getOrCreateWsClient();

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
            yield [];
          }
        }
      } else if (type == 'compact_activity' ||
                 type == 'messages_compacted') {
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
            yield [];
          }
        }
      }
    }
  }

  // ========== 解析 ==========

  List<Conversation> _parseConversations(dynamic data, {bool archived = false}) {
    final targetValue = archived ? 1 : 0;
    return (data as List)
        .where((c) => c['is_archived'] == targetValue)
        .map((c) => Conversation.fromJson(c as Map<String, dynamic>))
        .toList();
  }

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

  Future<List<Conversation>> getConversations() async {
    final data = await _apiClient.get('/conversations');
    return _parseConversations(data);
  }

  Future<String> createConversation(String title) async {
    final response = await _apiClient.post(
      '/conversations',
      data: {'title': title},
    );
    return response['id'] as String;
  }

  // ========== 消息操作 ==========

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

  Future<void> renameConversation(String id, String newTitle) async {
    await _apiClient.put('/conversations/$id', data: {'title': newTitle});
  }

  Future<void> deleteConversation(String id) async {
    await _apiClient.delete('/conversations/$id');
  }

  Future<void> toggleArchiveConversation(String id, bool isArchived) async {
    await _apiClient.put(
      '/conversations/$id',
      data: {'is_archived': isArchived ? 1 : 0},
    );
  }

  Future<void> setConversationBackground(String id, String? background) async {
    await _apiClient.put('/conversations/$id', data: {'background': background});
  }

  Future<void> deleteMessage(String messageId) async {
    await _apiClient.delete('/messages/$messageId');
  }

  Future<int> clearMessages(String conversationId) async {
    final response = await _apiClient.delete(
      '/messages',
      queryParameters: {'conversationId': conversationId},
    );
    return response['deleted_count'] as int? ?? 0;
  }

  // ========== 压缩 / 记忆 / 梦境 ==========

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

  Future<Map<String, dynamic>> extractSessionMemory(String conversationId) async {
    final result = await _apiClient.post(
      '/session-notes/$conversationId/extract',
    );
    return result as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> triggerDream() async {
    final result = await _apiClient.post('/dream');
    return result as Map<String, dynamic>;
  }

  // ========== 监控记录操作（HTTP API） ==========

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
    final response = await _apiClient.post('/monitor/records', data: {
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
    });
    return response['id'] as String;
  }

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
    return (response['records'] as List).cast<Map<String, dynamic>>();
  }

  Future<int> getMonitorRecordCount(String conversationId) async {
    final response = await _apiClient.get(
      '/monitor/records/count',
      queryParameters: {'conversationId': conversationId},
    );
    return response['count'] as int;
  }

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

  Future<void> updateMonitorRecordInternalEvents(
    String id,
    String internalEvents,
  ) async {
    await _apiClient.put(
      '/monitor/records/$id/internal-events',
      data: {'internalEvents': internalEvents},
    );
  }

  Future<int> deleteMonitorRecordsByConversation(String conversationId) async {
    final response = await _apiClient.delete(
      '/monitor/records',
      queryParameters: {'conversationId': conversationId},
    );
    return response['deleted'] as int? ?? 0;
  }

  Future<int> deleteAllMonitorRecords() async {
    final response = await _apiClient.delete('/monitor/records/all');
    return response['deleted'] as int? ?? 0;
  }

  Future<void> deleteAllMonitorActivities() async {
    await _apiClient.delete('/monitor/activities');
  }

  Future<void> deleteOldMonitorRecords(
    String conversationId,
    int keepCount,
  ) async {
    // 获取总数，如果超出 keepCount 则删除该会话所有记录，
    // 然后重新插入保留最近 keepCount 条。
    // 简化方案：后端处理保留逻辑
    final total = await getMonitorRecordCount(conversationId);
    if (total > keepCount) {
      // 获取前 keepCount 条（最新的）
      final records = await getMonitorRecords(
        conversationId,
        limit: keepCount,
        offset: 0,
      );
      // 删除全部
      await deleteMonitorRecordsByConversation(conversationId);
      // 重新插入保留的记录
      for (final r in records.reversed) {
        await insertMonitorRecord(
          conversationId: r['conversation_id'] as String,
          requestJson: r['request_json'] as String? ?? '',
          responseRawText: r['response_raw_text'] as String? ?? '',
          isComplete: (r['is_complete'] as int?) == 1,
          promptTokens: r['prompt_tokens'] as int?,
          completionTokens: r['completion_tokens'] as int?,
          totalTokens: r['total_tokens'] as int?,
          errorCategory: r['error_category'] as String?,
          errorCode: r['error_code'] as String?,
          errorMessage: r['error_message'] as String?,
          errorSuggestion: r['error_suggestion'] as String?,
          internalEvents: r['internal_events'] as String?,
        );
      }
    }
  }
}
