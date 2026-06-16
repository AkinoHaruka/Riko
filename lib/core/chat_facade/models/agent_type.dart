import 'package:flutter/foundation.dart';

/// 可扩展的代理类型标识
///
/// 使用 sealed class 允许未来添加新类型，同时保持类型安全。
/// 内置四种代理（main/memory/compact/dream），也支持自定义代理。
sealed class AgentType {
  const AgentType();

  String get key;
  String get defaultTitle;
  String get storageKey => 'agent_conv_$key';

  @override
  String toString() => 'AgentType($key)';
}

/// 主代理 — 用户直接对话的默认会话
@immutable
class MainAgentType extends AgentType {
  const MainAgentType();
  @override String get key => 'main';
  @override String get defaultTitle => '主代理';
}

/// 记忆提取代理
@immutable
class MemoryAgentType extends AgentType {
  const MemoryAgentType();
  @override String get key => 'memory';
  @override String get defaultTitle => '记忆提取';
}

/// 上下文压缩代理
@immutable
class CompactAgentType extends AgentType {
  const CompactAgentType();
  @override String get key => 'compact';
  @override String get defaultTitle => '上下文压缩';
}

/// 梦境整理代理
@immutable
class DreamAgentType extends AgentType {
  const DreamAgentType();
  @override String get key => 'dream';
  @override String get defaultTitle => '梦境整理';
}

/// 自定义代理 — 未来扩展使用
///
/// 例如：新增 'summary' 代理时，无需修改任何现有代码：
/// ```dart
/// const CustomAgentType('summary', '摘要生成')
/// ```
@immutable
class CustomAgentType extends AgentType {
  @override final String key;
  @override final String defaultTitle;
  const CustomAgentType(this.key, this.defaultTitle);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CustomAgentType && key == other.key;

  @override
  int get hashCode => key.hashCode;
}
