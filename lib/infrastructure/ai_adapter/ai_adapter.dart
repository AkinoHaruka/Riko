import 'models/message.dart';
import 'models/stream_chunk.dart';
import 'models/error_info.dart';

export 'models/message.dart';
export 'models/token_usage.dart';
export 'models/stream_chunk.dart';
export 'models/error_info.dart';

/// AI 适配器抽象接口，定义统一的消息模型与聊天能力
abstract class AIAdapter {
  /// 发起流式对话请求
  ///
  /// [userMessage] 当前用户输入的消息内容
  /// [context] 历史消息上下文列表
  /// [options] 可选参数，包含 model、temperature、maxTokens、thinking_type、reasoning_effort 等
  /// [onRawSseLine] 可选回调，用于接收原始 SSE 文本行（未经解析）
  /// [onError] 可选回调，用于接收分类后的错误信息
  Stream<StreamChunk> chatStream(
    String userMessage,
    List<Message> context,
    Map<String, dynamic> options, {
    void Function(String rawLine)? onRawSseLine,
    void Function(ErrorInfo error)? onError,
  });
}
