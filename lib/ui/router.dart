/// GoRouter 路由配置模块
///
/// 采用 Provider 驱动的 GoRouter，所有页面均在 ShellRoute 内由 AppShell 统一布局。
///
/// 路由结构：
/// - ShellRoute 内的业务页面（AppShell 包裹）：
///   /agents、/chat、/settings、/archive、/memory、/admin、/icons
///
/// 【重要】本应用为单用户本地应用，不需要登录/注册功能。
/// 不要添加任何认证守卫、登录页面或注册页面。
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'app_shell.dart';
import 'agent_list_page.dart';
import 'chat_page.dart';
import 'admin_page.dart' deferred as admin_page;
import 'archive_page.dart' deferred as archive_page;
import 'memory_page.dart' deferred as memory_page;
import 'settings_page.dart' deferred as settings_page;
import 'widgets/icon_gallery.dart' deferred as icon_gallery;

import '../core/deferred_loader.dart';
import '../core/theme/app_animations.dart';

/// GoRouter Provider
///
/// 单用户模式：无认证守卫，直接进入主页面。
final routerProvider = Provider<GoRouter>((ref) {
  final router = GoRouter(
    initialLocation: '/agents',
    routes: [
      // 业务页面（AppShell 统一布局）
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/agents',
            pageBuilder: (context, state) => const CustomTransitionPage(
              child: AgentListPage(),
              transitionDuration: AppAnimations.page,
              transitionsBuilder: AppAnimations.fadeThrough,
            ),
          ),
          GoRoute(
            path: '/chat',
            pageBuilder: (context, state) => const CustomTransitionPage(
              child: ChatPage(),
              transitionDuration: AppAnimations.page,
              transitionsBuilder: AppAnimations.slideInFromRight,
            ),
          ),
          GoRoute(
            path: '/settings',
            pageBuilder: (context, state) => CustomTransitionPage(
              child: DeferredPageLoader(
                loader: () async {
                  await settings_page.loadLibrary();
                  return () => settings_page.SettingsPage();
                },
              ),
              transitionDuration: AppAnimations.page,
              transitionsBuilder: AppAnimations.slideInFromRight,
            ),
          ),
          GoRoute(
            path: '/archive',
            pageBuilder: (context, state) => CustomTransitionPage(
              child: DeferredPageLoader(
                loader: () async {
                  await archive_page.loadLibrary();
                  return () => archive_page.ArchivePage();
                },
              ),
              transitionDuration: AppAnimations.page,
              transitionsBuilder: AppAnimations.slideInFromBottom,
            ),
          ),
          GoRoute(
            path: '/memory',
            pageBuilder: (context, state) => CustomTransitionPage(
              child: DeferredPageLoader(
                loader: () async {
                  await memory_page.loadLibrary();
                  return () => memory_page.MemoryPage();
                },
              ),
              transitionDuration: AppAnimations.page,
              transitionsBuilder: AppAnimations.slideInFromBottom,
            ),
          ),
          GoRoute(
            path: '/admin',
            pageBuilder: (context, state) => CustomTransitionPage(
              child: DeferredPageLoader(
                loader: () async {
                  await admin_page.loadLibrary();
                  return () => admin_page.AdminPage();
                },
              ),
              transitionDuration: AppAnimations.page,
              transitionsBuilder: AppAnimations.scaleFadeIn,
            ),
          ),
          GoRoute(
            path: '/icons',
            pageBuilder: (context, state) => CustomTransitionPage(
              child: DeferredPageLoader(
                loader: () async {
                  await icon_gallery.loadLibrary();
                  return () => icon_gallery.IconGalleryPage();
                },
              ),
              transitionDuration: AppAnimations.page,
              transitionsBuilder: AppAnimations.fadeThrough,
            ),
          ),
        ],
      ),
    ],
  );

  ref.onDispose(() {
    router.dispose();
  });

  return router;
});
