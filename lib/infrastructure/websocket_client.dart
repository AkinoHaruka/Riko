import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// WebSocket 事件数据模型
class WebSocketEvent {
  final String type;
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
  final String url;
  final Duration reconnectDelay;
  final int maxReconnectAttempts;
  String? _token;

  final StreamController<WebSocketEvent> _eventController =
      StreamController<WebSocketEvent>.broadcast();

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  bool _isDisposed = false;
  bool _intentionalClose = false;

  WebSocketClient({
    required this.url,
    this.reconnectDelay = const Duration(seconds: 3),
    this.maxReconnectAttempts = 5,
    String? token,
  }) : _token = token;

  /// 更新 JWT Token，下次重连时使用新 token
  void setToken(String? token) {
    _token = token;
  }

  /// 事件广播流
  Stream<WebSocketEvent> get events => _eventController.stream;

  /// 梦境事件过滤流（只含 dream_started / dream_completed）
  Stream<WebSocketEvent> get dreamEvents => _eventController.stream.where(
    (e) => e.type == 'dream_started' || e.type == 'dream_completed',
  );

  /// 建立 WebSocket 连接
  ///
  /// 如果已经连接或正在连接中，则不会重复创建新连接。
  void connect() {
    if (_isDisposed) return;
    if (_channel != null) return;
    _intentionalClose = false;
    _doConnect();
  }

  Future<void> _doConnect() async {
    if (_isDisposed) return;

    if (_channel != null) {
      _subscription?.cancel();
      _subscription = null;
      await _channel!.sink.close();
      _channel = null;
    }

    try {
      var wsUrl = url;
      if (_token != null && _token!.isNotEmpty) {
        final separator = wsUrl.contains('?') ? '&' : '?';
        wsUrl = '$wsUrl${separator}token=$_token';
      }
      _channel = WebSocketChannel.connect(Uri.parse(wsUrl));
      debugPrint('[WebSocket] 已连接: $wsUrl');

      _reconnectAttempts = 0;

      _subscription = _channel!.stream.listen(
        _onMessage,
        onError: _onError,
        onDone: _onDone,
      );
    } catch (e) {
      debugPrint('[WebSocket] 连接失败: $e');
      _scheduleReconnect();
    }
  }

  void _onMessage(dynamic data) {
    try {
      final Map<String, dynamic> json;
      if (data is String) {
        json = jsonDecode(data) as Map<String, dynamic>;
      } else if (data is Map) {
        json = Map<String, dynamic>.from(data);
      } else {
        throw const FormatException('不支持的 WebSocket 消息格式');
      }

      final event = WebSocketEvent.fromJson(json);

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

  void _onDone() {
    debugPrint('[WebSocket] 连接已断开: $url');
    if (!_intentionalClose) {
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    if (_isDisposed || _intentionalClose) return;

    if (_reconnectAttempts >= maxReconnectAttempts) {
      debugPrint('[WebSocket] 已达最大重连次数($maxReconnectAttempts)，停止重连');
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
  void dispose() {
    disconnect();
    _isDisposed = true;
    _eventController.close();
    debugPrint('[WebSocket] 资源已释放');
  }
}
