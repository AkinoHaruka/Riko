/// 基础设施层桶导出文件
///
/// 统一导出实时通信相关客户端，供上层 DI 层一次性导入。
/// 当前仅导出 WebSocket 客户端（SSE 解析逻辑内嵌于 ai_adapter 模块中）。
library;

export 'websocket_client.dart';
