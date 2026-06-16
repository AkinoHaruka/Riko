import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';

import 'package:riko/app.dart';
import 'package:riko/core/di/providers.dart';
import 'package:riko/data/api_client.dart';
import 'package:riko/infrastructure/websocket_client.dart';
import 'package:riko/ui/router.dart';

/// Mock ApiClient，避免真实网络请求
class MockApiClient extends Mock implements ApiClient {}

/// Mock WebSocketClient，避免真实 WebSocket 连接
class MockWebSocketClient extends Mock implements WebSocketClient {}

void main() {
  late MockApiClient mockApiClient;
  late MockWebSocketClient mockWebSocketClient;

  setUp(() {
    mockApiClient = MockApiClient();
    mockWebSocketClient = MockWebSocketClient();

    // 配置 MockApiClient
    when(() => mockApiClient.hasToken).thenReturn(true);
    when(() => mockApiClient.wsBaseUrl).thenReturn('ws://127.0.0.1:3000');
    when(() => mockApiClient.initReady).thenAnswer((_) async {});
    when(() => mockApiClient.currentToken).thenReturn('test-token');
  });

  testWidgets('App 渲染 MaterialApp', (WidgetTester tester) async {
    // 桌面端环境，跳过移动端后端等待逻辑
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    try {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            // 覆盖 API 客户端，避免真实网络请求
            apiClientProvider.overrideWithValue(mockApiClient),
            // 覆盖 WebSocket 客户端，避免真实连接
            webSocketClientProvider.overrideWithValue(mockWebSocketClient),
            // 覆盖路由，使用空页面避免深层 Provider 依赖
            routerProvider.overrideWithValue(
              GoRouter(
                routes: [
                  GoRoute(
                    path: '/',
                    builder: (context, state) => const SizedBox.shrink(),
                  ),
                ],
              ),
            ),
          ],
          child: const App(),
        ),
      );

      // 验证 MaterialApp 存在
      expect(find.byType(MaterialApp), findsOneWidget);

      await tester.pump();
    } finally {
      // 在 _verifyInvariants 检查前还原平台变量
      debugDefaultTargetPlatformOverride = null;
    }
  });
}
