/// MCP（Model Context Protocol）API 客户端与数据模型
///
/// 封装对后端 `/mcp/servers` 接口的 CRUD 调用，
/// 包含 MCP 传输配置、连接状态等 Dart 模型定义。
library;

import 'api_client.dart';

// ===== 枚举类型 =====

/// MCP 传输类型
enum McpTransportType {
  stdio('stdio'),
  http('http');

  final String value;
  const McpTransportType(this.value);

  /// 从字符串解析传输类型，无法识别时默认返回 stdio
  static McpTransportType fromString(String value) {
    return McpTransportType.values.firstWhere(
      (e) => e.value == value,
      orElse: () => McpTransportType.stdio,
    );
  }
}

/// MCP 连接状态
enum McpConnectionStatus {
  disconnected('disconnected'),
  connecting('connecting'),
  connected('connected'),
  failed('failed');

  final String value;
  const McpConnectionStatus(this.value);

  /// 从字符串解析连接状态，无法识别时默认返回 disconnected
  static McpConnectionStatus fromString(String value) {
    return McpConnectionStatus.values.firstWhere(
      (e) => e.value == value,
      orElse: () => McpConnectionStatus.disconnected,
    );
  }
}

// ===== 配置模型 =====

/// Stdio 传输配置 — 通过子进程启动 MCP Server
class McpStdioConfig {
  final String type = 'stdio';
  final String command;
  final List<String>? args;
  final Map<String, String>? env;

  const McpStdioConfig({
    required this.command,
    this.args,
    this.env,
  });

  Map<String, dynamic> toJson() => {
        'type': type,
        'command': command,
        if (args != null) 'args': args,
        if (env != null) 'env': env,
      };
}

/// HTTP 传输配置 — 通过 HTTP/SSE 连接远程 MCP Server
class McpHttpConfig {
  final String type = 'http';
  final String url;
  final Map<String, String>? headers;

  const McpHttpConfig({
    required this.url,
    this.headers,
  });

  Map<String, dynamic> toJson() => {
        'type': type,
        'url': url,
        if (headers != null) 'headers': headers,
      };
}

/// MCP Server 配置联合类型（stdio 或 http）
class McpServerConfig {
  final McpStdioConfig? stdio;
  final McpHttpConfig? http;

  const McpServerConfig({this.stdio, this.http});

  /// 传输类型
  McpTransportType get transportType =>
      stdio != null ? McpTransportType.stdio : McpTransportType.http;

  /// 序列化为 JSON（供 POST 请求使用）
  Map<String, dynamic> toJson() {
    if (stdio != null) return stdio!.toJson();
    if (http != null) return http!.toJson();
    return {};
  }
}

// ===== 连接信息模型 =====

/// MCP Server 连接信息 — 对应后端 McpConnectionInfo
class McpConnectionInfo {
  /// 服务器名称（唯一标识）
  final String name;

  /// 当前连接状态
  final McpConnectionStatus status;

  /// 错误信息（仅在 failed 状态时有值）
  final String? error;

  /// 已注册的工具数量
  final int? toolCount;

  const McpConnectionInfo({
    required this.name,
    required this.status,
    this.error,
    this.toolCount,
  });

  factory McpConnectionInfo.fromJson(Map<String, dynamic> json) {
    return McpConnectionInfo(
      name: json['name'] as String,
      status: McpConnectionStatus.fromString(json['status'] as String? ?? ''),
      error: json['error'] as String?,
      toolCount: json['toolCount'] as int?,
    );
  }
}

/// 添加/重连服务器后的响应模型
class McpServerActionResponse {
  final String name;
  final McpConnectionStatus status;
  final int? toolCount;
  final String? error;

  const McpServerActionResponse({
    required this.name,
    required this.status,
    this.toolCount,
    this.error,
  });

  factory McpServerActionResponse.fromJson(Map<String, dynamic> json) {
    return McpServerActionResponse(
      name: json['name'] as String,
      status: McpConnectionStatus.fromString(json['status'] as String? ?? ''),
      toolCount: json['toolCount'] as int?,
      error: json['error'] as String?,
    );
  }
}

// ===== API 客户端 =====

/// MCP Server 管理 API 客户端
///
/// 封装对后端 `/mcp/servers` 的 CRUD 操作，
/// 依赖 [ApiClient] 进行 HTTP 通信（通过构造函数注入）。
class McpApiClient {
  final ApiClient _apiClient;

  McpApiClient(this._apiClient);

  /// 获取所有 MCP Server 列表
  Future<List<McpConnectionInfo>> listServers() async {
    final response = await _apiClient.get('/mcp/servers');
    // 兼容 `{ servers: [...] }` 和纯数组两种响应格式
    final raw = response is Map ? response['servers'] : null;
    if (raw is! List) return [];
    return raw
        .map((e) => McpConnectionInfo.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  /// 添加 MCP Server
  ///
  /// [name] 服务器名称（唯一标识）
  /// [config] 服务器配置（stdio 或 http）
  Future<McpServerActionResponse> addServer(
    String name,
    McpServerConfig config,
  ) async {
    final json = await _apiClient.post(
      '/mcp/servers',
      data: {
        'name': name,
        'config': config.toJson(),
      },
    );
    return McpServerActionResponse.fromJson(json as Map<String, dynamic>);
  }

  /// 删除 MCP Server
  ///
  /// [name] 要删除的服务器名称
  Future<void> removeServer(String name) async {
    await _apiClient.delete('/mcp/servers/$name');
  }

  /// 重连 MCP Server
  ///
  /// [name] 要重连的服务器名称
  Future<McpServerActionResponse> reconnectServer(String name) async {
    final json = await _apiClient.post('/mcp/servers/$name/reconnect');
    return McpServerActionResponse.fromJson(json as Map<String, dynamic>);
  }
}
