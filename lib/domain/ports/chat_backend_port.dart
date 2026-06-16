import '../../data/models/chat_message.dart';
import '../../data/models/conversation.dart';

/// 聊天后端端口 —— 统一封装所有远程数据访问
///
/// 职责边界：
/// - 会话的 CRUD 与实时监听
/// - 消息的 CRUD 与实时监听
/// - 监控记录的 CRUD
/// - 压缩 / 记忆提取 / 梦境整理等后台任务触发
///
/// 实现方：生产环境为 [HttpChatBackendAdapter]（HTTP + WebSocket），
/// 测试环境为 [InMemoryChatBackendAdapter]。
abstract class ChatBackendPort {
  // ========== 会话 ==========

  /// 获取所有非归档会话
  Future<List<Conversation>> getConversations();

  /// 创建新会话，返回会话 ID
  Future<String> createConversation(String title);

  /// 重命名会话
  Future<void> renameConversation(String id, String newTitle);

  /// 删除会话
  Future<void> deleteConversation(String id);

  /// 切换会话归档状态
  Future<void> toggleArchiveConversation(String id, bool isArchived);

  /// 实时监听会话列表（非归档）
  Stream<List<Conversation>> watchConversations();

  /// 实时监听归档会话列表
  Stream<List<Conversation>> watchArchivedConversations();

  // ========== 消息 ==========

  /// 获取指定会话的消息列表
  Future<List<ChatMessage>> getMessages(
    String conversationId, {
    int? limit,
    int offset = 0,
  });

  /// 发送消息到指定会话，返回消息 ID
  Future<String> sendMessage({
    required String conversationId,
    required String role,
    required String content,
    String? reasoningContent,
  });

  /// 更新消息正文
  Future<void> updateMessageContent(
    String messageId,
    String content, {
    bool skipBroadcast = false,
  });

  /// 更新消息推理内容
  Future<void> updateMessageReasoningContent(
    String messageId,
    String reasoningContent, {
    bool skipBroadcast = false,
  });

  /// 删除指定消息
  Future<void> deleteMessage(String messageId);

  /// 清空指定会话的所有消息，返回删除数量
  Future<int> clearMessages(String conversationId);

  /// 实时监听指定会话的消息列表
  Stream<List<ChatMessage>> watchMessages(
    String conversationId, {
    int? limit,
    int offset = 0,
  });

  // ========== 监控记录 ==========

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
  });

  /// 分页获取监控记录
  Future<List<Map<String, dynamic>>> getMonitorRecords(
    String conversationId, {
    int limit = 200,
    int offset = 0,
  });

  /// 获取监控记录总数
  Future<int> getMonitorRecordCount(String conversationId);

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
  });

  /// 更新监控记录的内部事件 JSON
  Future<void> updateMonitorRecordInternalEvents(
    String id,
    String internalEvents,
  );

  /// 删除指定会话的所有监控记录，返回删除数量
  Future<int> deleteMonitorRecordsByConversation(String conversationId);

  // ========== 压缩 / 记忆 / 梦境 ==========

  /// 触发上下文压缩
  Future<Map<String, dynamic>> compactConversation({
    required String conversationId,
    String model = 'deepseek-v4-pro',
    String? customInstructions,
  });

  /// 获取压缩状态（token 用量、消息数）
  Future<Map<String, dynamic>> getCompactStatus({
    required String conversationId,
    String model = 'deepseek-v4-pro',
  });

  /// 触发会话记忆提取
  Future<Map<String, dynamic>> extractSessionMemory(String conversationId);

  /// 触发梦境整理
  Future<Map<String, dynamic>> triggerDream();
}
