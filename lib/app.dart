import 'package:flutter/material.dart';

import 'core/router.dart';
import 'core/theme/app_theme.dart';
import 'ui/widgets/toast_overlay.dart';

/// RIKO 应用根组件
///
/// 使用 MaterialApp.router + GoRouter 管理路由，使用暗色主题（无亮色模式）。
class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'RIKO',
      debugShowCheckedModeBanner: false,
      darkTheme: AppTheme.buildDarkTheme(),
      themeMode: ThemeMode.dark,
      routerConfig: appRouter,
      builder: (context, child) => ToastOverlay(
        child: DefaultTextStyle(
          style: const TextStyle(decoration: TextDecoration.none),
          child: child!,
        ),
      ),
    );
  }
}
