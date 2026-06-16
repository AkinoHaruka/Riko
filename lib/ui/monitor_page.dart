/// 监控面板 — 子代理活动记录查看器
///
/// 显示会话记忆提取、上下文压缩、梦境整固三种子代理的活动记录，
/// 支持 WebSocket 实时推送与高亮动画。每项活动可展开查看详细指标、提示词和记忆内容。
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/di/providers.dart';
import '../core/theme/app_animations.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_radius.dart';
import '../core/theme/app_spacing.dart';
import '../core/theme/app_typography.dart';
import '../infrastructure/websocket_client.dart';

/// 监控面板 — 显示子代理（会话记忆/压缩/梦境整固）的活动记录，支持 WebSocket 实时推送与高亮动画
///
/// 顶部带刷新按钮，每项活动可展开查看详细指标、提示词内容和记忆内容。新推送的活动带发光高亮效果。
class MonitorPage extends ConsumerStatefulWidget {
  const MonitorPage({super.key});

  @override
  ConsumerState<MonitorPage> createState() => _MonitorPageState();
}

class _MonitorPageState extends ConsumerState<MonitorPage> {
  List<Map<String, dynamic>> _activities = [];
  bool _isLoading = true;
  String? _error;
  StreamSubscription<WebSocketEvent>? _wsSubscription;
  final Set<String> _highlightKeys = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadActivities();
      _subscribeWebSocket();
    });
  }

  @override
  void dispose() {
    _wsSubscription?.cancel();
    super.dispose();
  }

  /// 从后端加载历史活动记录，归一化 metadata 字段到顶层
  Future<void> _loadActivities() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.get(
        '/monitor/activities',
        queryParameters: {'limit': 50, 'offset': 0},
      );
      final List<dynamic> items = response is List
          ? response
          : (response['activities'] as List<dynamic>? ?? []);
      final normalizedItems = items.map((item) {
        final map = Map<String, dynamic>.from(item as Map);
        map['activity_type'] = map['activity_type'] ?? map['type'];
        final metadata = map['metadata'];
        if (metadata is Map) {
          for (final entry in metadata.entries) {
            map.putIfAbsent(entry.key as String, () => entry.value);
          }
        }
        return map;
      }).toList();
      if (mounted) {
        setState(() {
          _activities = normalizedItems;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  /// 订阅 WebSocket 实时活动事件
  void _subscribeWebSocket() {
    // connect() 由 webSocketClientProvider 在 initReady 后自动调用
    final wsClient = ref.read(webSocketClientProvider);
    _wsSubscription = wsClient.events.listen(
      _onWebSocketEvent,
      onError: (Object e) => debugPrint('[MonitorPage] WS stream error: $e'),
    );
  }

  /// 处理 WebSocket 推送的活动事件，插入列表顶部并添加 2 秒高亮效果
  void _onWebSocketEvent(WebSocketEvent event) {
    final typeMap = {
      'session_memory_activity': 'session_memory',
      'compact_activity': 'compact',
      'dream_activity': 'dream',
    };
    final activityType = typeMap[event.type];
    if (activityType == null) return;

    final activity = Map<String, dynamic>.from(event.payload);
    activity['activity_type'] = activityType;

    final key = '${activityType}_${DateTime.now().millisecondsSinceEpoch}';
    _highlightKeys.add(key);
    activity['_highlight_key'] = key;

    if (mounted) {
      setState(() {
        _activities = [activity, ..._activities];
      });
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) {
          setState(() {
            _highlightKeys.remove(key);
          });
        }
      });
    }
  }

  /// 格式化时间戳为相对时间（如"3分钟前"），超过 7 天则显示完整日期
  String _formatTimestamp(dynamic timestamp) {
    DateTime dt;
    if (timestamp is String) {
      dt = DateTime.tryParse(timestamp) ?? DateTime.now();
    } else if (timestamp is num) {
      dt = DateTime.fromMillisecondsSinceEpoch(timestamp.toInt());
    } else {
      return '--';
    }

    final now = DateTime.now();
    final diff = now.difference(dt);

    if (diff.inSeconds < 60) return '${diff.inSeconds}秒前';
    if (diff.inMinutes < 60) return '${diff.inMinutes}分钟前';
    if (diff.inHours < 24) return '${diff.inHours}小时前';
    if (diff.inDays < 7) return '${diff.inDays}天前';

    return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-'
        '${dt.day.toString().padLeft(2, '0')} '
        '${dt.hour.toString().padLeft(2, '0')}:'
        '${dt.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTextStyle(
      style: const TextStyle(decoration: TextDecoration.none),
      child: Scaffold(
        backgroundColor: AppColors.bgPrimary,
        appBar: AppBar(
          backgroundColor: AppColors.bgTertiary,
          elevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: AppColors.textSecondary),
            onPressed: () => context.go('/'),
          ),
          title: const Text(
            '监控面板',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: AppTypography.title,
              fontWeight: FontWeight.bold,
            ),
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh, color: AppColors.textSecondary),
              onPressed: _loadActivities,
            ),
          ],
        ),
        body: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.textPrimary),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: AppColors.error, size: 48),
            AppSpacing.vMD,
            Text(
              '加载失败: $_error',
              style: const TextStyle(color: AppColors.error),
              textAlign: TextAlign.center,
            ),
            AppSpacing.vMD,
            ElevatedButton(onPressed: _loadActivities, child: const Text('重试')),
          ],
        ),
      );
    }

    if (_activities.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.monitor_heart_outlined,
              size: 64,
              color: AppColors.textTertiary.withValues(alpha: 0.5),
            ),
            AppSpacing.vMD,
            const Text(
              '暂无子代理活动记录',
              style: TextStyle(color: AppColors.textTertiary, fontSize: AppTypography.subtitle),
            ),
            AppSpacing.vSM,
            const Text(
              '子代理运行后，活动将在此处实时显示',
              style: TextStyle(color: AppColors.textTertiary, fontSize: 13),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      color: AppColors.green,
      backgroundColor: AppColors.surface,
      onRefresh: _loadActivities,
      child: ListView.separated(
        padding: const EdgeInsets.all(AppSpacing.md),
        itemCount: _activities.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, index) {
          final activity = _activities[index];
          return _ActivityCard(
            activity: activity,
            isHighlighted: _highlightKeys.contains(activity['_highlight_key']),
            formatTimestamp: _formatTimestamp,
          );
        },
      ),
    );
  }
}

/// 子代理活动卡片 — 按类型（会话记忆/压缩/整固）显示详情，支持高亮动画和可折叠内容
class _ActivityCard extends StatefulWidget {
  final Map<String, dynamic> activity;
  final bool isHighlighted;
  final String Function(dynamic) formatTimestamp;

  const _ActivityCard({
    required this.activity,
    required this.isHighlighted,
    required this.formatTimestamp,
  });

  @override
  State<_ActivityCard> createState() => _ActivityCardState();
}

class _ActivityCardState extends State<_ActivityCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _highlightController;
  late final Animation<double> _highlightAnimation;
  bool _showPrompt = false;
  bool _showMemory = false;

  @override
  void initState() {
    super.initState();
    _highlightController = AnimationController(
      vsync: this,
      duration: AppAnimations.normal,
    );
    _highlightAnimation = CurvedAnimation(
      parent: _highlightController,
      curve: AppAnimations.easeOut,
    );
    if (widget.isHighlighted) {
      _highlightController.forward();
    }
  }

  @override
  void didUpdateWidget(covariant _ActivityCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isHighlighted && !oldWidget.isHighlighted) {
      _highlightController.forward(from: 0.0);
    }
  }

  @override
  void dispose() {
    _highlightController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final type = widget.activity['activity_type'] as String? ?? '';
    final config = _typeConfig(type);
    final time = widget.formatTimestamp(
      widget.activity['triggered_at'] ?? widget.activity['timestamp'],
    );

    return AnimatedBuilder(
      animation: _highlightAnimation,
      builder: (context, child) {
        final glowAlpha = _highlightAnimation.value * 0.15;
        return Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: AppRadius.mdAll,
            border: Border.all(color: AppColors.border),
            boxShadow: glowAlpha > 0.01
                ? [
                    BoxShadow(
                      color: config.accentColor.withValues(alpha: glowAlpha),
                      blurRadius: 12,
                      spreadRadius: 2,
                    ),
                  ]
                : null,
          ),
          child: ClipRRect(
            borderRadius: AppRadius.mdAll,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 4,
                  height: double.infinity,
                  color: config.accentColor,
                ),
                Expanded(child: child!),
              ],
            ),
          ),
        );
      },
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildHeader(config, time),
            const SizedBox(height: 10),
            _buildBody(config),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(_ActivityTypeConfig config, String time) {
    return Row(
      children: [
        Icon(config.icon, size: 18, color: config.accentColor),
        AppSpacing.hSM,
        Text(
          config.label,
          style: TextStyle(
            color: config.accentColor,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
        const Spacer(),
        Text(
          time,
          style: const TextStyle(color: AppColors.textTertiary, fontSize: AppTypography.caption),
        ),
      ],
    );
  }

  Widget _buildBody(_ActivityTypeConfig config) {
    switch (config.type) {
      case 'session_memory':
        return _buildSessionMemoryBody();
      case 'compact':
        return _buildCompactBody();
      case 'dream':
        return _buildDreamBody();
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _buildSessionMemoryBody() {
    final a = widget.activity;
    final triggerType = a['trigger_type'] as String? ?? '--';
    final tokenBefore = a['token_before'] ?? a['tokens_before'];
    final tokenAfter = a['token_after'] ?? a['tokens_after'];
    final summary = a['summary'] as String?;
    final fullPrompt = a['full_prompt'] as String?;
    final memoryContent = a['session_memory_content'] as String?;
    final success = a['success'] as bool? ?? true;
    final error = a['error'] as String?;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildMetricRow('触发类型', triggerType),
        _buildMetricRow('状态', success ? '成功' : '失败'),
        if (error != null && error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              '错误: $error',
              style: const TextStyle(color: Colors.redAccent, fontSize: AppTypography.caption),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        if (tokenBefore != null || tokenAfter != null)
          _buildMetricRow(
            'Token 变化',
            '${tokenBefore ?? '?'} → ${tokenAfter ?? '?'}',
          ),
        if (summary != null && summary.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              summary,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: AppTypography.caption,
              ),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        if (fullPrompt != null && fullPrompt.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                GestureDetector(
                  onTap: () => setState(() => _showPrompt = !_showPrompt),
                  child: Row(
                    children: [
                      Icon(
                        _showPrompt
                            ? Icons.keyboard_arrow_down
                            : Icons.keyboard_arrow_right,
                        color: AppColors.textTertiary,
                        size: 16,
                      ),
                      AppSpacing.hXS,
                      const Text(
                        '提示词内容',
                        style: TextStyle(
                          color: AppColors.textTertiary,
                          fontSize: AppTypography.caption,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                if (_showPrompt)
                  Container(
                    margin: const EdgeInsets.only(top: 6),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: AppRadius.smAll,
                      border: Border.all(color: AppColors.border),
                    ),
                    constraints: const BoxConstraints(maxHeight: 300),
                    child: SingleChildScrollView(
                      child: Text(
                        fullPrompt,
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['monospace'],
                          height: 1.5,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        if (memoryContent != null && memoryContent.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                GestureDetector(
                  onTap: () => setState(() => _showMemory = !_showMemory),
                  child: Row(
                    children: [
                      Icon(
                        _showMemory
                            ? Icons.keyboard_arrow_down
                            : Icons.keyboard_arrow_right,
                        color: AppColors.textTertiary,
                        size: 16,
                      ),
                      AppSpacing.hXS,
                      const Text(
                        '会话记忆内容',
                        style: TextStyle(
                          color: AppColors.textTertiary,
                          fontSize: AppTypography.caption,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                if (_showMemory)
                  Container(
                    margin: const EdgeInsets.only(top: 6),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: AppRadius.smAll,
                      border: Border.all(color: AppColors.border),
                    ),
                    constraints: const BoxConstraints(maxHeight: 300),
                    child: SingleChildScrollView(
                      child: Text(
                        memoryContent,
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['monospace'],
                          height: 1.5,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildCompactBody() {
    final a = widget.activity;
    final strategy = a['strategy'] as String? ?? '--';
    final preTokens = a['pre_compact_tokens'] ?? a['tokens_before'];
    final postTokens = a['post_compact_tokens'] ?? a['tokens_after'];
    final recentTokens = a['recent_dialogue_tokens'];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildMetricRow('压缩策略', strategy),
        if (preTokens != null || postTokens != null)
          _buildMetricRow(
            'Token 变化',
            '${preTokens ?? '?'} → ${postTokens ?? '?'}',
          ),
        if (recentTokens != null)
          _buildMetricRow('保留对话 Token', '$recentTokens'),
      ],
    );
  }

  Widget _buildDreamBody() {
    final a = widget.activity;
    final sessionCount = a['sessionsReviewed'];
    final updatedFiles = a['updated_files'];
    final summary = a['summary'] as String?;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (sessionCount != null) _buildMetricRow('处理会话数', '$sessionCount'),
        if (updatedFiles != null) ...[
          if (updatedFiles is List) ...[
            _buildMetricRow('更新文件数', '${updatedFiles.length}'),
            if (updatedFiles.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4, left: 12),
                child: Text(
                  updatedFiles.take(3).join(', '),
                  style: const TextStyle(
                    color: AppColors.textTertiary,
                    fontSize: 11,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
          ] else
            _buildMetricRow('更新文件', '$updatedFiles'),
        ],
        if (summary != null && summary.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              summary,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: AppTypography.caption,
              ),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
    );
  }

  Widget _buildMetricRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.textTertiary,
                fontSize: AppTypography.caption,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: AppTypography.caption,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  _ActivityTypeConfig _typeConfig(String type) {
    switch (type) {
      case 'session_memory':
        return _ActivityTypeConfig(
          type: 'session_memory',
          label: '会话记忆',
          icon: Icons.note_outlined,
          accentColor: Colors.blue.shade400,
        );
      case 'compact':
        return const _ActivityTypeConfig(
          type: 'compact',
          label: '自动压缩',
          icon: Icons.compress_outlined,
          accentColor: AppColors.green,
        );
      case 'dream':
        return _ActivityTypeConfig(
          type: 'dream',
          label: '自动整固',
          icon: Icons.nightlight_outlined,
          accentColor: Colors.purple.shade400,
        );
      default:
        return _ActivityTypeConfig(
          type: type,
          label: type,
          icon: Icons.info_outline,
          accentColor: AppColors.textTertiary,
        );
    }
  }
}

/// 活动类型配色配置 — 标签、图标和强调色的映射
class _ActivityTypeConfig {
  final String type;
  final String label;
  final IconData icon;
  final Color accentColor;

  const _ActivityTypeConfig({
    required this.type,
    required this.label,
    required this.icon,
    required this.accentColor,
  });
}
