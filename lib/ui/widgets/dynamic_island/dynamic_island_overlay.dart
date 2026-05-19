import 'package:flutter/material.dart';
import 'dynamic_island.dart';

/// 动态岛叠加层 — 将 DynamicIsland 固定在屏幕顶部居中位置
///
/// 当前为简单包装，未来可在此添加全局拖拽或手势交互。
class DynamicIslandOverlay extends StatelessWidget {
  const DynamicIslandOverlay({super.key});

  @override
  Widget build(BuildContext context) {
    return const Positioned(
      top: 12,
      left: 0,
      right: 0,
      child: Center(
        child: DynamicIsland(),
      ),
    );
  }
}
