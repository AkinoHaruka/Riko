import '../../infrastructure/ai_adapter/models/message.dart';
import '../../infrastructure/ai_adapter/models/stream_chunk.dart';
import '../../infrastructure/ai_adapter/models/error_info.dart';

/// AI 流式对话端口
///
/// 职责边界：
/// - 将用户消息 + 上下文 + 选项转换为 AI 供应商特定的流式请求
/// - 通过 Dart Stream 逐块返回解析后的 [StreamChunk]
/// - 将网络/认证/限流等错误分类为 [ErrorInfo]
///
/// 实现方：生产环境为 [AdapterFactoryAiStreamAdapter]（包装现有 AdapterFactory），
/// 测试环境为 [InMemoryAiStreamAdapter]（返回预定义流）。
///
/// 注：此端口与现有 [AIAdapter] 接口语义一致，但提升为领域层端口，
/// 使深模块不再依赖 infrastructure 层的具体适配器实现。
abstract class AiStreamPort {
  /// 发起流式对话请求
  ///
  /// [userMessage] 当前用户输入的消息内容
  /// [context] 历史消息上下文列表
  /// [options] 可选参数，包含 model、temperature、maxTokens、thinking_type、reasoning_effort 等
  /// [onError] 可选回调，用于接收分类后的错误信息
  Stream<StreamChunk> chatStream(
    String userMessage,
    List<Message> context,
    Map<String, dynamic> options, {
    void Function(ErrorInfo error)? onError,
  });
}
