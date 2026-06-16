/// AI 适配器抽象接口模块
///
/// 定义前端与 AI 服务交互的统一契约。所有具体适配器（如 DeepSeek）
/// 均实现此接口，使上层调用方无需关心底层 API 差异。
///
/// 设计原则：
/// - 流式输出：通过 Dart Stream 逐块返回 AI 响应，适配 SSE 协议
/// - 错误分类：通过 [ErrorInfo] 将网络/认证/限流等错误结构化，便于 UI 差异化展示
/// - 原始数据透传：[onRawSseLine] 回调允许上层获取未经解析的 SSE 行，用于调试或日志
library;

import 'models/message.dart';
import 'models/stream_chunk.dart';
import 'models/error_info.dart';

export 'models/message.dart';
export 'models/token_usage.dart';
export 'models/stream_chunk.dart';
export 'models/error_info.dart';

/// AI 适配器抽象接口，定义统一的消息模型与聊天能力
///
/// 上层（ChatNotifier）通过此接口发起对话，不依赖具体 AI 供应商的实现细节。
abstract class AIAdapter {
  /// 发起流式对话请求
  ///
  /// [userMessage] 当前用户输入的消息内容
  /// [context] 历史消息上下文列表
  /// [options] 可选参数，包含 model、temperature、maxTokens、thinking_type、reasoning_effort 等
  /// [onRawSseLine] 可选回调，用于接收原始 SSE 文本行（未经解析），可用于调试日志
  /// [onError] 可选回调，用于接收分类后的错误信息，便于 UI 展示差异化提示
  ///
  /// 返回 [Stream<StreamChunk>]，消费者通过 listen 逐块接收 AI 响应
  Stream<StreamChunk> chatStream(
    String userMessage,
    List<Message> context,
    Map<String, dynamic> options, {
    void Function(String rawLine)? onRawSseLine,
    void Function(ErrorInfo error)? onError,
  });
}
