/// 聊天页面纯计算工具 — 代理进度与背景装饰解析
///
/// 从 [_ChatPageState._buildChatScaffold] 中抽取的无状态计算逻辑，
/// 便于独立测试与复用。
library;

import 'package:flutter/material.dart';

import '../../core/di/chat_provider.dart';

/// 三类代理（记忆 / 压缩 / 梦境）的进度快照
class AgentProgress {
  /// 会话记忆提取进度（0.0 - 1.0）
  final double memory;

  /// 上下文压缩进度（0.0 - 1.0）
  final double compact;

  /// 梦境整固进度（0.0 - 1.0）
  final double dream;

  const AgentProgress({
    required this.memory,
    required this.compact,
    required this.dream,
  });
}

/// 计算三类代理进度。
///
/// 仅当 [isMainAgent] 为 true 时计算记忆进度；
/// 压缩与梦境进度在任何代理类型下都计算。
AgentProgress computeAgentProgress({
  required ChatState chatState,
  required bool isMainAgent,
  DateTime? now,
}) {
  final currentTime = now ?? DateTime.now();
  double memoryProgress = 0;
  double compactProgress = 0;
  double dreamProgress = 0;

  if (isMainAgent) {
    // 消息数进度
    final msgProgress = chatState.memoryMinMessages > 0
        ? (chatState.messageCount % chatState.memoryMinMessages) /
              chatState.memoryMinMessages
        : 0.0;
    // Token 增长进度
    final tokenGrowth = chatState.tokenCount - chatState.lastMemoryTokenCount;
    final tokenProgress = chatState.memoryMinTokensBetweenUpdate > 0
        ? (tokenGrowth / chatState.memoryMinTokensBetweenUpdate).clamp(
            0.0,
            1.0,
          )
        : 0.0;
    // 取较快的阈值作为实际进度
    memoryProgress = msgProgress > tokenProgress
        ? msgProgress
        : tokenProgress;
  }
  if (chatState.compactTriggerTokens > 0) {
    compactProgress = (chatState.tokenCount / chatState.compactTriggerTokens)
        .clamp(0.0, 1.0);
  }
  if (chatState.lastDreamAt != null && chatState.dreamMinHours > 0) {
    final hoursSince =
        currentTime.difference(chatState.lastDreamAt!).inMinutes / 60.0;
    dreamProgress = (hoursSince / chatState.dreamMinHours).clamp(0.0, 1.0);
  }

  return AgentProgress(
    memory: memoryProgress,
    compact: compactProgress,
    dream: dreamProgress,
  );
}

/// 解析聊天背景配置。
///
/// 支持两种格式：
/// - `solid:#RRGGBB` → 返回纯色 [Color]
/// - `gradient:#RRGGBB|#RRGGBB|...` → 返回含渐变色的 [BoxDecoration]
///
/// 不匹配时两者均为 null，调用方应使用默认背景色。
({Color? color, BoxDecoration? decoration}) resolveChatBackground(
  String? background,
) {
  if (background == null) {
    return (color: null, decoration: null);
  }

  if (background.startsWith('solid:')) {
    final hex = background.substring(6).replaceFirst('#', '0xFF');
    return (
      color: Color(int.tryParse(hex) ?? 0xFF111111),
      decoration: null,
    );
  }

  if (background.startsWith('gradient:')) {
    final colors = background
        .substring(9)
        .split('|')
        .map(
          (h) =>
              Color(int.tryParse(h.replaceFirst('#', '0xFF')) ?? 0xFF111111),
        )
        .toList();
    return (
      color: null,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: colors,
        ),
      ),
    );
  }

  return (color: null, decoration: null);
}
