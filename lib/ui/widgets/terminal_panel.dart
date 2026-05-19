import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/di/chat_provider.dart';
import 'terminal_panel_colors.dart';
import 'terminal_panel_sections.dart';

/// 终端式监控面板 — 以终端风格展示 API 请求/响应日志、子代理活动、错误信息、Token 用量
///
/// 包含子代理触发按钮栏（会话记忆/压缩/整固）和底部状态栏
class TerminalPanel extends ConsumerStatefulWidget {
  final List<ApiMonitorRecord> inputHistory;
  final VoidCallback onClear;
  final VoidCallback? onLoadMore;
  final bool hasMoreData;
  final VoidCallback? onCompact;
  final bool isCompactEnabled;
  final List<Map<String, dynamic>> subAgentActivities;
  final bool hasActiveConversation;
  final bool isSessionMemoryLoading;
  final bool isCompactLoading;
  final bool isDreamLoading;
  final VoidCallback? onTriggerSessionMemory;
  final VoidCallback? onTriggerCompact;
  final VoidCallback? onTriggerDream;

  const TerminalPanel({
    super.key,
    required this.inputHistory,
    required this.onClear,
    this.onLoadMore,
    this.hasMoreData = false,
    this.onCompact,
    this.isCompactEnabled = false,
    this.subAgentActivities = const [],
    this.hasActiveConversation = false,
    this.isSessionMemoryLoading = false,
    this.isCompactLoading = false,
    this.isDreamLoading = false,
    this.onTriggerSessionMemory,
    this.onTriggerCompact,
    this.onTriggerDream,
  });

  @override
  ConsumerState<TerminalPanel> createState() => _TerminalPanelState();
}

class _TerminalPanelState extends ConsumerState<TerminalPanel>
    with SingleTickerProviderStateMixin {
  final _scrollController = ScrollController();
  bool _cursorVisible = true;
  late Timer _cursorTimer;
  final Set<int> _expandedIndices = {};
  final _jsonHighlighter = JsonHighlighter();

  @override
  void initState() {
    super.initState();
    _cursorTimer = Timer.periodic(const Duration(milliseconds: 530), (_) {
      if (mounted) setState(() => _cursorVisible = !_cursorVisible);
    });
    _scrollController.addListener(_onScroll);
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final maxScroll = _scrollController.position.maxScrollExtent;
    final currentScroll = _scrollController.position.pixels;
    if (maxScroll - currentScroll <= 50 &&
        widget.hasMoreData &&
        widget.onLoadMore != null) {
      widget.onLoadMore!();
    }
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _cursorTimer.cancel();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant TerminalPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.inputHistory.length > oldWidget.inputHistory.length) {
      _expandedIndices.add(widget.inputHistory.length - 1);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTextStyle(
      style: const TextStyle(decoration: TextDecoration.none),
      child: Container(
        decoration: BoxDecoration(
          color: TerminalPanelColors.bg,
          border: Border.all(color: TerminalPanelColors.border, width: 0.5),
        ),
        child: Column(
          children: [
            _buildTitleBar(),
            const Divider(
              height: 1,
              thickness: 1,
              color: TerminalPanelColors.divider,
            ),
            Expanded(child: _buildTerminalBody()),
            const Divider(
              height: 1,
              thickness: 1,
              color: TerminalPanelColors.divider,
            ),
            _buildSubAgentTriggerBar(),
            const Divider(
              height: 1,
              thickness: 1,
              color: TerminalPanelColors.divider,
            ),
            _buildBottomBar(),
          ],
        ),
      ),
    );
  }

  Widget _buildTitleBar() {
    return Container(
      height: 32,
      color: TerminalPanelColors.titleBar,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: const Row(
        children: [
          Icon(
            Icons.terminal,
            color: TerminalPanelColors.textWhite,
            size: 14,
          ),
          SizedBox(width: 6),
          Expanded(
            child: Text(
              'API Monitor',
              style: TextStyle(
                color: TerminalPanelColors.textWhite,
                fontSize: 12,
                fontFamily: 'Consolas',
                fontFamilyFallback: ['Cascadia Code', 'monospace'],
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTerminalBody() {
    return GestureDetector(
      onSecondaryTapDown: (details) {},
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildDreamStatusIndicator(),
            if (widget.subAgentActivities.isNotEmpty)
              SubAgentActivitiesWidget(activities: widget.subAgentActivities),
            if (ref.watch(dreamNotifierProvider).status != DreamStatus.idle ||
                widget.subAgentActivities.isNotEmpty)
              const SizedBox(height: 4),
            Expanded(
              child: widget.inputHistory.isEmpty
                  ? _buildEmptyState()
                  : ListView.builder(
                      controller: _scrollController,
                      padding: EdgeInsets.zero,
                      itemCount:
                          widget.inputHistory.length +
                          (widget.hasMoreData ? 1 : 0),
                      itemBuilder: (context, index) {
                        if (widget.hasMoreData &&
                            index == widget.inputHistory.length) {
                          return _buildLoadMoreHint();
                        }
                        return _buildLogEntry(
                          widget.inputHistory[index],
                          index,
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLoadMoreHint() {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 8),
      child: Center(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.arrow_upward,
              color: TerminalPanelColors.timestamp,
              size: 12,
            ),
            SizedBox(width: 4),
            Text(
              '向上滑动加载更多...',
              style: TextStyle(
                color: TerminalPanelColors.timestamp,
                fontSize: 11,
                fontFamily: 'Consolas',
                fontFamilyFallback: ['Cascadia Code', 'monospace'],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Text(
              'PS C:\\Chat\\Monitor> ',
              style: TextStyle(
                color: TerminalPanelColors.promptGreen,
                fontSize: 13,
                fontFamily: 'Consolas',
                fontFamilyFallback: ['Cascadia Code', 'monospace'],
              ),
            ),
            Container(
              width: 7,
              height: 15,
              decoration: BoxDecoration(
                color: _cursorVisible
                    ? TerminalPanelColors.textWhite
                    : Colors.transparent,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        const Text(
          'Waiting for input...',
          style: TextStyle(
            color: TerminalPanelColors.timestamp,
            fontSize: 12,
            fontFamily: 'Consolas',
            fontFamilyFallback: ['Cascadia Code', 'monospace'],
          ),
        ),
      ],
    );
  }

  Widget _buildLogEntry(ApiMonitorRecord record, int index) {
    final timeStr = DateFormat('HH:mm:ss').format(record.createdAt);
    final isExpanded = _expandedIndices.contains(index);

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            onTap: () {
              setState(() {
                if (isExpanded) {
                  _expandedIndices.remove(index);
                } else {
                  _expandedIndices.add(index);
                }
              });
            },
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 6),
              decoration: BoxDecoration(
                color: TerminalPanelColors.titleBar.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Row(
                children: [
                  Icon(
                    isExpanded
                        ? Icons.keyboard_arrow_down
                        : Icons.keyboard_arrow_right,
                    color: TerminalPanelColors.timestamp,
                    size: 14,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '[$timeStr]',
                    style: const TextStyle(
                      color: TerminalPanelColors.timestamp,
                      fontSize: 11,
                      fontFamily: 'Consolas',
                      fontFamilyFallback: ['Cascadia Code', 'monospace'],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      record.isComplete ? 'Complete' : 'Streaming...',
                      style: TextStyle(
                        color: record.isComplete
                            ? TerminalPanelColors.promptGreen
                            : TerminalPanelColors.requestYellow,
                        fontSize: 11,
                        fontFamily: 'Consolas',
                        fontFamilyFallback: ['Cascadia Code', 'monospace'],
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (isExpanded) ...[
            const SizedBox(height: 4),
            RequestSectionWidget(
              requestJson: record.requestJson,
              highlighter: _jsonHighlighter,
            ),
            ...record.internalEvents
                .where((e) => e.type == 'session_notes_init')
                .map(
                  (e) => Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: SessionNotesSectionWidget(data: e.data),
                  ),
                ),
            ...record.internalEvents
                .where((e) => e.type == 'tool_call')
                .map(
                  (e) => Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: ToolCallSectionWidget(data: e.data),
                  ),
                ),
            if (record.errorMessage != null &&
                record.errorMessage!.isNotEmpty) ...[
              const SizedBox(height: 4),
              ErrorSectionWidget(
                errorCategory: record.errorCategory,
                errorCode: record.errorCode,
                errorMessage: record.errorMessage,
                errorSuggestion: record.errorSuggestion,
              ),
            ],
            const SizedBox(height: 4),
            ResponseSectionWidget(responseRawText: record.responseRawText),
            ...record.internalEvents
                .where((e) => e.type == 'compact')
                .map(
                  (e) => Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: CompactSectionWidget(data: e.data),
                  ),
                ),
            const SizedBox(height: 4),
            UsageSectionWidget(tokenUsage: record.tokenUsage),
          ],
        ],
      ),
    );
  }

  Widget _buildDreamStatusIndicator() {
    final dreamState = ref.watch(dreamNotifierProvider);
    if (dreamState.status == DreamStatus.idle) return const SizedBox.shrink();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(4),
        border: Border(
          left: BorderSide(
            color: TerminalPanelColors.dreamCyan.withValues(alpha: 0.3),
            width: 3,
          ),
          top: BorderSide(
            color: TerminalPanelColors.dreamCyan.withValues(alpha: 0.3),
          ),
          right: BorderSide(
            color: TerminalPanelColors.dreamCyan.withValues(alpha: 0.3),
          ),
          bottom: BorderSide(
            color: TerminalPanelColors.dreamCyan.withValues(alpha: 0.3),
          ),
        ),
      ),
      child: Row(
        children: [
          if (dreamState.status == DreamStatus.running)
            TweenAnimationBuilder<double>(
              tween: Tween(begin: 0.3, end: 1.0),
              duration: const Duration(milliseconds: 800),
              builder: (context, opacity, child) {
                return Opacity(opacity: opacity, child: child);
              },
              onEnd: () {
                if (mounted && dreamState.status == DreamStatus.running) {
                  setState(() {});
                }
              },
              child: Container(
                width: 6,
                height: 6,
                decoration: const BoxDecoration(
                  color: TerminalPanelColors.dreamCyan,
                  shape: BoxShape.circle,
                ),
              ),
            )
          else
            Container(
              width: 6,
              height: 6,
              decoration: const BoxDecoration(
                color: TerminalPanelColors.dreamCyan,
                shape: BoxShape.circle,
              ),
            ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              dreamState.status == DreamStatus.running
                  ? '[DREAM] Running...'
                  : '[DREAM] Completed${dreamState.summary != null ? ' — ${dreamState.summary!.length > 80 ? '${dreamState.summary!.substring(0, 80)}...' : dreamState.summary!}' : ''}',
              style: const TextStyle(
                color: TerminalPanelColors.dreamCyan,
                fontSize: 11,
                fontWeight: FontWeight.bold,
                fontFamily: 'Consolas',
                fontFamilyFallback: ['Cascadia Code', 'monospace'],
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSubAgentTriggerBar() {
    return Container(
      height: 48,
      color: TerminalPanelColors.titleBar,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: _SubAgentTriggerButton(
              label: '记忆',
              icon: Icons.note_outlined,
              color: TerminalPanelColors.sessionNotesBlue,
              isEnabled: widget.hasActiveConversation,
              isLoading: widget.isSessionMemoryLoading,
              onPressed: widget.onTriggerSessionMemory,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _SubAgentTriggerButton(
              label: '压缩',
              icon: Icons.compress_outlined,
              color: TerminalPanelColors.compactOrange,
              isEnabled: widget.hasActiveConversation,
              isLoading: widget.isCompactLoading,
              onPressed: widget.onTriggerCompact,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _SubAgentTriggerButton(
              label: '整固',
              icon: Icons.nightlight_outlined,
              color: TerminalPanelColors.dreamCyan,
              isEnabled: true,
              isLoading: widget.isDreamLoading,
              onPressed: widget.onTriggerDream,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomBar() {
    return Container(
      height: 28,
      color: TerminalPanelColors.titleBar,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Row(
        children: [
          Text(
            '${widget.inputHistory.length} rounds',
            style: const TextStyle(
              color: TerminalPanelColors.timestamp,
              fontSize: 11,
              fontFamily: 'Consolas',
              fontFamilyFallback: ['Cascadia Code', 'monospace'],
            ),
          ),
          const Spacer(),
          if (widget.isCompactEnabled && widget.onCompact != null)
            GestureDetector(
              onTap: widget.onCompact,
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.compress,
                    color: TerminalPanelColors.compactOrange,
                    size: 14,
                  ),
                  SizedBox(width: 4),
                  Text(
                    'Compact',
                    style: TextStyle(
                      color: TerminalPanelColors.compactOrange,
                      fontSize: 11,
                      fontFamily: 'Consolas',
                      fontFamilyFallback: ['Cascadia Code', 'monospace'],
                    ),
                  ),
                ],
              ),
            ),
          if (widget.isCompactEnabled && widget.onCompact != null)
            const SizedBox(width: 12),
          GestureDetector(
            onTap: widget.onClear,
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.delete_outline,
                  color: TerminalPanelColors.timestamp,
                  size: 14,
                ),
                SizedBox(width: 4),
                Text(
                  'Clear',
                  style: TextStyle(
                    color: TerminalPanelColors.timestamp,
                    fontSize: 11,
                    fontFamily: 'Consolas',
                    fontFamilyFallback: ['Cascadia Code', 'monospace'],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SubAgentTriggerButton extends StatefulWidget {
  final String label;
  final IconData icon;
  final Color color;
  final bool isEnabled;
  final bool isLoading;
  final VoidCallback? onPressed;

  const _SubAgentTriggerButton({
    required this.label,
    required this.icon,
    required this.color,
    required this.isEnabled,
    required this.isLoading,
    this.onPressed,
  });

  @override
  State<_SubAgentTriggerButton> createState() => _SubAgentTriggerButtonState();
}

class _SubAgentTriggerButtonState extends State<_SubAgentTriggerButton> {
  bool _justCompleted = false;

  @override
  void didUpdateWidget(covariant _SubAgentTriggerButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.isLoading && !widget.isLoading) {
      setState(() => _justCompleted = true);
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) setState(() => _justCompleted = false);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.isEnabled && !widget.isLoading;
    final borderColor = _justCompleted
        ? const Color(0xFF2ED573)
        : enabled
        ? widget.color.withValues(alpha: 0.4)
        : const Color(0xFF2C2C2C);

    return SizedBox(
      height: 36,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: enabled ? widget.onPressed : null,
          borderRadius: BorderRadius.circular(6),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: borderColor, width: 1),
              color: enabled
                  ? widget.color.withValues(alpha: 0.08)
                  : const Color(0xFF252525),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (widget.isLoading)
                  SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: widget.color,
                    ),
                  )
                else if (_justCompleted)
                  const Icon(Icons.check, size: 14, color: Color(0xFF2ED573))
                else
                  Icon(
                    widget.icon,
                    size: 14,
                    color: enabled ? widget.color : const Color(0xFF555555),
                  ),
                const SizedBox(width: 6),
                Text(
                  widget.isLoading
                      ? '执行中...'
                      : _justCompleted
                      ? '完成'
                      : widget.label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: enabled
                        ? const Color(0xFFd5d5d5)
                        : const Color(0xFF555555),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
