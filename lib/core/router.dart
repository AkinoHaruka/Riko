import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../ui/app_shell.dart';
import '../ui/agent_list_page.dart';
import '../ui/chat_page.dart';
import '../ui/admin_page.dart' deferred as admin_page;
import '../ui/archive_page.dart' deferred as archive_page;
import '../ui/memory_page.dart' deferred as memory_page;
import '../ui/settings_page.dart' deferred as settings_page;
import '../ui/widgets/icon_gallery.dart' deferred as icon_gallery;

import 'deferred_loader.dart';

/// GoRouter 路由配置
///
/// 采用 ShellRoute 包裹统一布局（AppShell），
/// 使用 CustomTransitionPage 实现页面切换动画：
/// /archive 和 /memory 使用垂直滑入，其余页面使用水平滑入。
/// Settings、Archive、Memory、Admin、/icons 使用 deferred 懒加载。
final GoRouter appRouter = GoRouter(
  initialLocation: '/agents',
  routes: [
    ShellRoute(
      builder: (context, state, child) => AppShell(child: child),
      routes: [
        GoRoute(path: '/agents', builder: (context, state) => const AgentListPage()),
        GoRoute(
          path: '/chat',
          pageBuilder: (context, state) => CustomTransitionPage(
            child: const ChatPage(),
            transitionsBuilder:
                (context, animation, secondaryAnimation, child) {
                  const begin = Offset(1.0, 0.0);
                  const end = Offset.zero;
                  const curve = Curves.easeInOutCubic;
                  final tween = Tween(
                    begin: begin,
                    end: end,
                  ).chain(CurveTween(curve: curve));
                  return SlideTransition(
                    position: animation.drive(tween),
                    child: child,
                  );
                },
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
            transitionsBuilder:
                (context, animation, secondaryAnimation, child) {
                  const begin = Offset(1.0, 0.0);
                  const end = Offset.zero;
                  const curve = Curves.easeInOutCubic;
                  final tween = Tween(
                    begin: begin,
                    end: end,
                  ).chain(CurveTween(curve: curve));
                  return SlideTransition(
                    position: animation.drive(tween),
                    child: child,
                  );
                },
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
            transitionsBuilder:
                (context, animation, secondaryAnimation, child) {
                  const begin = Offset(0.0, 1.0);
                  const end = Offset.zero;
                  const curve = Curves.easeInOutCubic;
                  final tween = Tween(
                    begin: begin,
                    end: end,
                  ).chain(CurveTween(curve: curve));
                  return SlideTransition(
                    position: animation.drive(tween),
                    child: child,
                  );
                },
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
            transitionsBuilder:
                (context, animation, secondaryAnimation, child) {
                  const begin = Offset(0.0, 1.0);
                  const end = Offset.zero;
                  const curve = Curves.easeInOutCubic;
                  final tween = Tween(
                    begin: begin,
                    end: end,
                  ).chain(CurveTween(curve: curve));
                  return SlideTransition(
                    position: animation.drive(tween),
                    child: child,
                  );
                },
          ),
        ),
        GoRoute(
          path: '/admin',
          builder: (context, state) => DeferredPageLoader(
            loader: () async {
              await admin_page.loadLibrary();
              return () => admin_page.AdminPage();
            },
          ),
        ),
        GoRoute(
          path: '/icons',
          builder: (context, state) => DeferredPageLoader(
            loader: () async {
              await icon_gallery.loadLibrary();
              return () => icon_gallery.IconGalleryPage();
            },
          ),
        ),
      ],
    ),
  ],
);
