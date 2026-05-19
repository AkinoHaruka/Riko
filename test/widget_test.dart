import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:riko/app.dart';

void main() {
  testWidgets('App renders with ProviderScope', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: App()),
    );

    // 验证 AppBar 标题或页面基本结构存在
    expect(find.byType(MaterialApp), findsOneWidget);

    // 让 apiClientProvider 的后台 timer 有机会完成
    await tester.pump(const Duration(seconds: 3));
  });
}
