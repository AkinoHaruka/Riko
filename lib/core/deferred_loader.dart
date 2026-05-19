import 'package:flutter/material.dart';

/// 懒加载页面包装组件
///
/// 配合 deferred as 导入使用，在页面加载前显示加载动画，
/// 加载失败时提供重试按钮。
class DeferredPageLoader extends StatefulWidget {
  final Future<Widget Function()> Function() loader;

  const DeferredPageLoader({super.key, required this.loader});

  @override
  State<DeferredPageLoader> createState() => _DeferredPageLoaderState();
}

class _DeferredPageLoaderState extends State<DeferredPageLoader> {
  late final Future<Widget Function()> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.loader();
  }

  void _retry() {
    setState(() {
      _future = widget.loader();
    });
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Widget Function()>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Scaffold(
            body: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.error_outline, color: Color(0xFFFF4757), size: 48),
                  const SizedBox(height: 16),
                  Text(
                    '加载失败: ${snapshot.error}',
                    style: const TextStyle(color: Color(0xFFFF4757)),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: _retry,
                    child: const Text('重试'),
                  ),
                ],
              ),
            ),
          );
        }
        if (snapshot.connectionState == ConnectionState.done &&
            snapshot.hasData) {
          return snapshot.data!();
        }
        return const Scaffold(
          body: Center(child: CircularProgressIndicator(strokeWidth: 2)),
        );
      },
    );
  }
}
