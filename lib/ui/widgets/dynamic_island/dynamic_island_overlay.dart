/// 动态岛悬浮覆盖层
///
/// 将 [DynamicIsland] 定位在屏幕顶部状态栏下方，并居中显示。
/// 支持把外部状态（Token 用量、子代理进度）透传给动态岛。
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'dynamic_island.dart';

/// 动态岛悬浮覆盖层
///
/// 通过 [Positioned] 把动态岛固定在 [Scaffold] 或 [Stack] 的最上层，
/// 自动适配刘海/挖孔屏的安全区顶部边距。
/// 使用 [LayoutBuilder] 测量可用宽度，使动态岛在窄空间内自动收缩。
class DynamicIslandOverlay extends StatelessWidget {
  final int tokenCount;
  final int maxTokens;
  final double memoryProgress;
  final double compactProgress;
  final double dreamProgress;

  const DynamicIslandOverlay({
    super.key,
    this.tokenCount = 0,
    this.maxTokens = 1000000,
    this.memoryProgress = 0,
    this.compactProgress = 0,
    this.dreamProgress = 0,
  });

  @override
  Widget build(BuildContext context) {
    final topPadding = MediaQuery.of(context).padding.top;

    return Positioned(
      top: topPadding + 12,
      left: 0,
      right: 0,
      child: LayoutBuilder(
        builder: (context, constraints) {
          // 窗口尚未就绪（尺寸为 0）时不渲染动态岛，避免 0 尺寸/未布局的
          // render box 参与 hit test，导致启动阶段断言崩溃
          if (constraints.maxWidth <= 0 || constraints.maxHeight <= 0) {
            return const SizedBox(width: 1, height: 1);
          }
          // 展开宽度不超过可用宽度的 90%（给窄窗口更多空间），且上限 320；
          // 同时保证不小于展开态最小宽度，避免内容溢出
          final maxIslandWidth = math.max(
            280.0,
            math.min(320.0, constraints.maxWidth * 0.9),
          );
          return Center(
            child: DynamicIsland(
              tokenCount: tokenCount,
              maxTokens: maxTokens,
              memoryProgress: memoryProgress,
              compactProgress: compactProgress,
              dreamProgress: dreamProgress,
              maxWidth: maxIslandWidth,
            ),
          );
        },
      ),
    );
  }
}
