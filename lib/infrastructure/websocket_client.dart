/// WebSocket 客户端模块
///
/// 封装与后端 WebSocket 服务的长连接管理，用于接收实时事件推送
///（如会话创建、消息更新、梦境活动等），避免前端轮询。
///
/// 连接管理策略：
/// - **自动重连**：非主动断开时，按固定间隔（默认 3s）重试，最多 5 次
/// - **URL Token 认证**：通过 URL 查询参数传递 JWT Token 进行握手认证（后端在连接时校验）
/// - **心跳过滤**：后端定期发送 heartbeat 类型消息，客户端静默丢弃
/// - **事件广播**：通过 StreamController.broadcast 实现多监听者订阅
/// - **优雅关闭**：disconnect() 设置 _intentionalClose 标记，阻止自动重连
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// WebSocket 事件数据模型
class WebSocketEvent {
  /// 事件类型（如 conversation_created、message_updated、dream_started 等）
  final String type;

  /// 事件负载数据
  final Map<String, dynamic> payload;

  WebSocketEvent({required this.type, required this.payload});

  factory WebSocketEvent.fromJson(Map<String, dynamic> json) {
    return WebSocketEvent(
      type: json['type'] as String,
      payload: json['payload'] as Map<String, dynamic>? ?? {},
    );
  }
}

/// WebSocket 客户端
///
/// 封装 WebSocket 连接管理，支持自动重连和事件广播。
class WebSocketClient {
  /// WebSocket 地址提供器（延迟求值，支持 token 变化后获取最新地址）
  final String Function() _urlProvider;

  /// 重连间隔（默认 3 秒）
  final Duration reconnectDelay;

  /// 最大重连尝试次数（默认 5 次）
  final int maxReconnectAttempts;

  /// JWT 认证令牌
  String? _token;

  /// 事件广播控制器，允许多个监听者同时订阅
  final StreamController<WebSocketEvent> _eventController =
      StreamController<WebSocketEvent>.broadcast();

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  bool _isDisposed = false;

  /// 是否为主动断开（主动断开不触发自动重连）
  bool _intentionalClose = false;

  WebSocketClient({
    required String Function() urlProvider,
    this.reconnectDelay = const Duration(seconds: 3),
    this.maxReconnectAttempts = 5,
    String? token,
  }) : _urlProvider = urlProvider,
       _token = token;

  /// 更新 JWT Token，下次重连时使用新 token
  void setToken(String? token) {
    _token = token;
  }

  /// 事件广播流，所有后端推送的实时事件均通过此流分发
  Stream<WebSocketEvent> get events => _eventController.stream;

  /// 梦境事件过滤流（只含 dream_started / dream_activity）
  Stream<WebSocketEvent> get dreamEvents => _eventController.stream.where(
    (e) => e.type == 'dream_started' || e.type == 'dream_activity',
  );

  /// 建立 WebSocket 连接
  ///
  /// 如果已经连接或正在连接中，则不会重复创建新连接。
  /// 允许重连：如果重连次数已耗尽但连接已断开，重置计数后重新尝试。
  void connect() {
    if (_isDisposed) return;
    // 允许重连：如果已有连接但已断开，先清理
    if (_channel != null) {
      // 已有活跃连接则不重复创建
      return;
    }
    _intentionalClose = false;
    _reconnectAttempts = 0; // 重置重连计数，允许重新尝试
    _doConnect();
  }

  /// 实际建立连接的内部方法
  ///
  /// 先清理旧连接（如有），再通过 URL 提供器获取最新地址并附加 token 参数建立新连接。
  ///
  /// **Token 传递方式**：通过 URL query（`?token=xxx`）而非 HTTP Header 传递，
  /// 原因：
  /// 1. 浏览器环境的 WebSocket API 不支持自定义 Header，必须使用 URL query
  ///    才能跨平台（桌面/移动/Web）保持一致的实现
  /// 2. Riko 是单用户本地应用，前后端均运行在用户本机，token 不经网络出站
  /// 3. 后端在连接握手时即校验 token，无效连接会被立刻关闭
  ///
  /// **安全性评估**（本地场景可接受）：
  /// - 风险：URL 可能出现在后端访问日志中；浏览器历史/书签可能记录 URL
  /// - 缓解：本应用不维护访问日志；WebSocket URL 不进入浏览器历史
  /// - 公网部署时建议改用 Subprotocol header 或短期一次性 ticket
  ///
  /// **重置时机**：仅在 `WebSocketChannel.ready` Future 完成（握手成功）后重置
  /// `_reconnectAttempts`，避免连接失败时计数被反复清零导致无限重连。
  Future<void> _doConnect() async {
    if (_isDisposed) return;

    // 清理旧连接，避免资源泄漏
    if (_channel != null) {
      _subscription?.cancel();
      _subscription = null;
      await _channel!.sink.close();
      _channel = null;
    }

    // 在 URL 中附加 token 参数，供后端在握手时校验
    // 注：日志输出仅打印 wsUrl（不含 token），避免 token 泄露到日志
    final wsUrl = _urlProvider();
    final uri = (_token != null && _token!.isNotEmpty)
        ? '$wsUrl?token=$_token'
        : wsUrl;
    final channel = WebSocketChannel.connect(Uri.parse(uri));
    _channel = channel;

    // 先订阅流，避免握手完成前到达的消息丢失
    _subscription = channel.stream.listen(
      _onMessage,
      onError: _onError,
      onDone: _onDone,
    );

    // 等待握手完成：失败时 ready 会抛出异常，不会重置重连计数
    try {
      await channel.ready;
      // 握手成功，重置重连计数
      _reconnectAttempts = 0;
      debugPrint('[WebSocket] 已连接: $wsUrl');
    } catch (e) {
      debugPrint('[WebSocket] 连接握手失败: $e');
      // 握手失败：清理本次失败连接的资源，进入重连流程
      await _subscription?.cancel();
      _subscription = null;
      await channel.sink.close();
      if (_channel == channel) {
        _channel = null;
      }
      _scheduleReconnect();
    }
  }

  /// 处理收到的 WebSocket 消息
  ///
  /// 支持 String 和 Map 两种消息格式，过滤心跳消息并广播到事件流。
  void _onMessage(dynamic data) {
    try {
      final Map<String, dynamic> json;
      if (data is String) {
        json = jsonDecode(data) as Map<String, dynamic>;
      } else if (data is Map) {
        // 某些平台（如 Web）可能直接传递已解析的 Map
        json = Map<String, dynamic>.from(data);
      } else {
        throw const FormatException('不支持的 WebSocket 消息格式');
      }

      final event = WebSocketEvent.fromJson(json);

      // 过滤心跳消息，不向业务层透传
      if (event.type == 'heartbeat') return;

      if (!_eventController.isClosed) {
        _eventController.add(event);
      }
    } catch (e) {
      debugPrint('[WebSocket] 消息解析失败: $e');
    }
  }

  void _onError(Object error) {
    debugPrint('[WebSocket] 错误: $error');
  }

  /// 连接断开回调
  ///
  /// 仅在非主动断开时触发自动重连；清理已断开的 channel 引用。
  void _onDone() {
    debugPrint('[WebSocket] 连接已断开: ${_urlProvider()}');
    _channel = null;
    _subscription = null;
    if (!_intentionalClose) {
      _scheduleReconnect();
    }
  }

  /// 调度重连任务
  ///
  /// 超过最大重连次数后，向事件流发送错误并停止重试；清理 channel 以允许后续手动重连。
  void _scheduleReconnect() {
    if (_isDisposed || _intentionalClose) return;

    if (_reconnectAttempts >= maxReconnectAttempts) {
      debugPrint('[WebSocket] 已达最大重连次数($maxReconnectAttempts)，停止重连');
      // 清理断开的 channel，允许后续手动调用 connect() 重新连接
      _channel = null;
      _subscription = null;
      if (!_eventController.isClosed) {
        _eventController.addError(Exception('WebSocket 连接失败，已达最大重连次数'));
      }
      return;
    }

    _reconnectAttempts++;
    debugPrint(
      '[WebSocket] 将在 ${reconnectDelay.inSeconds} 秒后重连 '
      '(第 $_reconnectAttempts/$maxReconnectAttempts 次)',
    );

    // 取消之前的重连定时器，避免重复调度
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(reconnectDelay, _doConnect);
  }

  /// 关闭 WebSocket 连接（不触发重连）
  void disconnect() {
    _intentionalClose = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _subscription?.cancel();
    _subscription = null;
    _channel?.sink.close();
    _channel = null;
    debugPrint('[WebSocket] 主动断开连接');
  }

  /// 释放所有资源
  ///
  /// 调用后不可再使用此实例，需重新创建
  void dispose() {
    disconnect();
    _isDisposed = true;
    _eventController.close();
    debugPrint('[WebSocket] 资源已释放');
  }
}
