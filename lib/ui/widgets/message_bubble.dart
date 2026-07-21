/// 消息气泡组件 — 聊天消息的核心展示单元
///
/// 支持用户/助手两种角色的气泡样式（带三角指向），助手消息支持 Markdown 渲染、
/// 思维链折叠/展开、压缩摘要折叠、搜索高亮、流式输出闪烁光标。
/// 长按弹出上下文菜单（复制/展开思维链/删除）。
/// 包含时间分隔器、压缩边界分隔器、代码块复制按钮等辅助组件。
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:markdown/markdown.dart' as md;

import '../../core/theme/app_animations.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_radius.dart';
import '../../core/theme/app_shadows.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_spring.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/time_formatters.dart';

/// 消息配色常量集（仅包含 AppColors 中未定义的颜色）
class _Colors {
  static const Color userText = Colors.white;
  static const Color assistantSurface = Color(0xFF262B28);
}

/// 消息气泡发送状态
enum MessageBubbleStatus {
  /// 发送中
  sending,

  /// 已发送成功
  sent,

  /// 发送失败
  failed,
}

/// 清理 markdown 中的空 inline 节点，防止 flutter_markdown 渲染断言失败
/// (builder.dart:267 `_inlines.isEmpty` is not true)
String _sanitizeMarkdown(String data) {
  return data
      .split('\n')
      .map((line) {
        // 空列表项: "- " 后面无内容
        if (RegExp(r'^[\-\*\+]\s*$').hasMatch(line)) return '';
        // 纯空格的行
        if (line.trim().isEmpty) return '';
        return line;
      })
      .join('\n');
}

/// 带三角指向的气泡形状绘制器 — 用户消息三角在右侧，助手消息三角在左侧
class _BubblePainter extends CustomPainter {
  final Color color;
  final bool isUser;
  final double radius = AppRadius.md;
  final double triangleWidth = 10;
  final double triangleHeight = 10;
  final Gradient? gradient;

  _BubblePainter({required this.color, required this.isUser, this.gradient});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    final path = Path();

    final w = size.width;
    final h = size.height;
    final r = radius;
    final tw = triangleWidth;

    // 三角中心与 40px 头像的中心对齐
    const ty = 16.0;

    if (isUser) {
      // 用户消息：三角在气泡右侧
      path.moveTo(r, 0);
      path.lineTo(w - r - tw, 0);
      path.arcToPoint(
        Offset(w - tw, r),
        radius: Radius.circular(r),
        clockwise: true,
      );
      // 右侧三角
      path.lineTo(w - tw, ty - tw / 2);
      path.lineTo(w, ty);
      path.lineTo(w - tw, ty + tw / 2);
      path.lineTo(w - tw, h - r);
      path.arcToPoint(
        Offset(w - r - tw, h),
        radius: Radius.circular(r),
        clockwise: true,
      );
      path.lineTo(r, h);
      path.arcToPoint(
        Offset(0, h - r),
        radius: Radius.circular(r),
        clockwise: true,
      );
      path.lineTo(0, r);
      path.arcToPoint(
        Offset(r, 0),
        radius: Radius.circular(r),
        clockwise: true,
      );
    } else {
      // 助手消息：三角在气泡左侧
      path.moveTo(tw + r, 0);
      path.lineTo(w - r, 0);
      path.arcToPoint(
        Offset(w, r),
        radius: Radius.circular(r),
        clockwise: true,
      );
      path.lineTo(w, h - r);
      path.arcToPoint(
        Offset(w - r, h),
        radius: Radius.circular(r),
        clockwise: true,
      );
      path.lineTo(tw + r, h);
      path.arcToPoint(
        Offset(tw, h - r),
        radius: Radius.circular(r),
        clockwise: true,
      );
      path.lineTo(tw, ty + tw / 2);
      path.lineTo(0, ty);
      path.lineTo(tw, ty - tw / 2);
      path.lineTo(tw, r);
      path.arcToPoint(
        Offset(tw + r, 0),
        radius: Radius.circular(r),
        clockwise: true,
      );
    }

    path.close();
    if (gradient != null) {
      final rect = Offset.zero & size;
      canvas.drawPath(path, Paint()..shader = gradient!.createShader(rect));
    } else {
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _BubblePainter oldDelegate) =>
      oldDelegate.color != color ||
      oldDelegate.isUser != isUser ||
      oldDelegate.gradient != gradient;
}

/// 消息气泡 — 用户/助手的消息展示组件，支持 Markdown 渲染、思维链折叠、压缩摘要折叠、长按菜单与删除
class MessageBubble extends StatefulWidget {
  final String role;
  final String content;
  final String? reasoningContent;
  final bool isStreaming;
  final bool animateEntrance;
  final DateTime? createdAt;
  final VoidCallback? onDelete;
  final VoidCallback? onCopy;
  final bool isCompactSummary;
  final bool isCompactBoundary;
  final Uint8List? assistantAvatar;
  final String? searchQuery;
  final bool isSearchMatch;

  /// 发送状态，用于显示发送中/成功/失败图标与背景过渡
  final MessageBubbleStatus? status;

  const MessageBubble({
    super.key,
    required this.role,
    required this.content,
    this.reasoningContent,
    this.isStreaming = false,
    this.animateEntrance = true,
    this.createdAt,
    this.onDelete,
    this.onCopy,
    this.isCompactSummary = false,
    this.isCompactBoundary = false,
    this.assistantAvatar,
    this.searchQuery,
    this.isSearchMatch = false,
    this.status,
  });

  @override
  State<MessageBubble> createState() => _MessageBubbleState();
}

class _MessageBubbleState extends State<MessageBubble> {
  bool _showReasoning = false;
  bool _isSummaryExpanded = false;

  bool get _isUser => widget.role == 'user';
  bool get _isCompactSummary => widget.isCompactSummary;
  bool get _isCompactBoundary => widget.isCompactBoundary;

  bool get _hasReasoning =>
      widget.reasoningContent != null && widget.reasoningContent!.isNotEmpty;

  /// 构建无障碍语义标签：发送者 + 内容摘要 + 时间
  String _buildSemanticLabel() {
    final roleLabel = _isUser ? '我' : '助手';
    var summary = widget.content.trim();
    if (summary.isEmpty) {
      summary = widget.isStreaming ? '正在输入' : '空消息';
    }
    const maxLen = 120;
    final displaySummary = summary.length > maxLen
        ? '${summary.substring(0, maxLen)}...'
        : summary;
    final time = widget.createdAt != null
        ? TimeFormatters.fullDateTime(widget.createdAt!)
        : '';
    return '$roleLabel：$displaySummary${time.isNotEmpty ? '，发送于 $time' : ''}';
  }

  @override
  Widget build(BuildContext context) {
    if (_isCompactBoundary) {
      return const CompactBoundarySeparator();
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        // 实际可用宽度（宽屏模式下聊天面板只占部分宽度）
        final availableW = constraints.maxWidth;
        // 两侧各保留 56px（头像 40 + 间距 4 + 边距 12）给头像区域
        final maxBubbleW = availableW > 112 ? availableW - 112 : availableW;

        final bubble = Align(
          alignment: _isUser ? Alignment.centerRight : Alignment.centerLeft,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              vertical: AppSpacing.xs,
              horizontal: AppSpacing.mdSm,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (!_isUser) _buildAvatar(),
                if (!_isUser) AppSpacing.hXS,
                Flexible(
                  child: GestureDetector(
                    onLongPress: () => _showContextMenu(context),
                    child: AnimatedContainer(
                      duration: AppAnimations.duration(
                        context,
                        AppAnimations.normal,
                      ),
                      curve: AppAnimations.curve(
                        context,
                        AppAnimations.easeOut,
                      ),
                      decoration: _buildBubbleDecoration(),
                      child: CustomPaint(
                        painter: _BubblePainter(
                          color: _isUser
                              ? AppColors.green
                              : _Colors.assistantSurface,
                          isUser: _isUser,
                          gradient: _isUser
                              ? const LinearGradient(
                                  colors: [
                                    AppColors.green,
                                    AppColors.greenLight,
                                  ],
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                )
                              : null,
                        ),
                        child: Container(
                          padding: EdgeInsets.only(
                            left: _isUser ? AppSpacing.mdSm : AppSpacing.md,
                            right: _isUser ? AppSpacing.md : AppSpacing.mdSm,
                            top: AppSpacing.sm + 2,
                            bottom: AppSpacing.sm + 2,
                          ),
                          constraints: BoxConstraints(
                            maxWidth: maxBubbleW,
                            minHeight: 44,
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (_hasReasoning && !_isUser)
                                _buildReasoningToggle(),
                              AnimatedSize(
                                duration: AppAnimations.duration(
                                  context,
                                  AppAnimations.page,
                                ),
                                curve: AppAnimations.curve(
                                  context,
                                  AppAnimations.easeOutBack,
                                ),
                                alignment: Alignment.topCenter,
                                child:
                                    _hasReasoning && _showReasoning && !_isUser
                                    ? _buildReasoningContent()
                                    : const SizedBox.shrink(),
                              ),
                              if (_hasReasoning && _showReasoning && !_isUser)
                                const SizedBox(height: 10),
                              _buildMainContent(),
                              if (widget.isStreaming &&
                                  widget.content.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: _buildBlinkingCursor(),
                                ),
                              if (_isUser && widget.status != null)
                                Align(
                                  alignment: Alignment.centerRight,
                                  child: Padding(
                                    padding: const EdgeInsets.only(top: 4),
                                    child: _MessageStatusIndicator(
                                      status: widget.status,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                if (_isUser) AppSpacing.hXS,
                if (_isUser) _buildAvatar(),
              ],
            ),
          ),
        );

        final child = !widget.animateEntrance
            ? bubble
            : SpringEntrance(
                fromScale: 0.88,
                fromOffset: Offset(_isUser ? 16.0 : -16.0, 12),
                spring: AppSprings.bouncy,
                child: bubble,
              );

        // 为消息气泡提供完整的语义信息：发送者 + 摘要 + 时间
        return Semantics(
          container: true,
          label: _buildSemanticLabel(),
          onLongPressHint: '长按打开消息菜单',
          child: child,
        );
      },
    );
  }

  /// 根据搜索匹配态/失败态/角色构建气泡外层装饰（多层级扩散阴影）
  ///
  /// 视觉升级：用户气泡使用主色辉光阴影（强化"我发出的"存在感），
  /// 助手气泡使用中性柔和浮起阴影（2 层扩散，避免干扰阅读）。
  BoxDecoration? _buildBubbleDecoration() {
    if (widget.isSearchMatch) {
      return BoxDecoration(
        borderRadius: AppRadius.mdAll,
        boxShadow: AppShadows.searchHighlight,
      );
    }
    if (widget.status == MessageBubbleStatus.failed) {
      return BoxDecoration(
        borderRadius: AppRadius.mdAll,
        boxShadow: AppShadows.error,
      );
    }
    // 用户气泡：绿色辉光扩散阴影
    if (_isUser) {
      return BoxDecoration(
        borderRadius: AppRadius.mdAll,
        boxShadow: AppShadows.userBubble(AppColors.green),
      );
    }
    // 助手气泡：中性柔和浮起阴影
    return BoxDecoration(
      borderRadius: AppRadius.mdAll,
      boxShadow: AppShadows.assistantBubble,
    );
  }

  /// 方形圆角头像 — 助手侧面有自定义头像图片则显示图片
  Widget _buildAvatar() {
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: AppColors.borderLight,
        borderRadius: AppRadius.xsAll,
      ),
      clipBehavior: Clip.antiAlias,
      child: _isUser || widget.assistantAvatar == null
          ? Icon(
              _isUser ? Icons.person : Icons.smart_toy,
              size: 22,
              color: AppColors.textSecondary,
            )
          : Image.memory(widget.assistantAvatar!, fit: BoxFit.cover),
    );
  }

  /// 思维链折叠/展开切换按钮 — 弹簧按压 + 旋转箭头
  Widget _buildReasoningToggle() {
    return SpringScaleTap(
      onTap: () => setState(() => _showReasoning = !_showReasoning),
      scaleDown: 0.95,
      child: AnimatedContainer(
        duration: AppAnimations.duration(context, AppAnimations.quick),
        curve: AppAnimations.curve(context, AppAnimations.easeOut),
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: AppColors.borderLight,
          borderRadius: AppRadius.smAll,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              _showReasoning ? Icons.lightbulb : Icons.lightbulb_outline,
              color: AppColors.textSecondary,
              size: 14,
            ),
            const SizedBox(width: 6),
            Text(
              _showReasoning ? '隐藏思维链' : '查看思维链',
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: AppTypography.caption,
                fontWeight: FontWeight.w500,
              ),
            ),
            AppSpacing.hXS,
            AnimatedRotation(
              turns: _showReasoning ? 0.5 : 0.0,
              duration: AppAnimations.duration(context, AppAnimations.normal),
              curve: AppAnimations.curve(context, AppSprings.bouncyCurve),
              child: const Icon(
                Icons.keyboard_arrow_down,
                color: AppColors.textSecondary,
                size: 14,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// 思维链内容展示
  Widget _buildReasoningContent() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.mdSm),
      decoration: BoxDecoration(
        color: AppColors.bgSecondary,
        borderRadius: AppRadius.mdAll,
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.psychology,
                color: AppColors.textSecondary,
                size: 14,
              ),
              const SizedBox(width: 6),
              Text(
                '思维链',
                style: TextStyle(
                  color: AppColors.textSecondary.withValues(alpha: 0.8),
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
          AppSpacing.vSM,
          Text(
            widget.reasoningContent!,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 13,
              height: 1.5,
              fontStyle: FontStyle.italic,
            ),
          ),
        ],
      ),
    );
  }

  /// 构建消息主体内容：用户消息纯文本，助手消息 Markdown 渲染，流式输出纯文本
  Widget _buildMainContent() {
    final searchQ = widget.searchQuery;
    if (_isUser) {
      final textWidget = Text(
        widget.content,
        style: const TextStyle(
          color: _Colors.userText,
          fontSize: AppTypography.bodyLg,
          height: 1.5,
        ),
      );
      if (searchQ != null && searchQ.isNotEmpty) {
        return _buildHighlightedContent(
          widget.content,
          searchQ,
          _Colors.userText,
        );
      }
      return textWidget;
    }
    if (widget.isStreaming && widget.content.isEmpty) {
      return const SizedBox.shrink();
    }
    if (widget.isStreaming) {
      return Text(
        widget.content.trimRight(),
        style: const TextStyle(
          color: AppColors.textPrimary,
          fontSize: AppTypography.bodyLg,
          height: 1.6,
        ),
      );
    }

    if (_isCompactSummary) {
      return _buildCompactSummaryContent();
    }

    if (widget.content.trim().isEmpty) {
      return const SizedBox.shrink();
    }

    if (searchQ != null && searchQ.isNotEmpty) {
      return _buildHighlightedContent(
        widget.content,
        searchQ,
        AppColors.textPrimary,
      );
    }

    return MarkdownBody(
      data: _sanitizeMarkdown(widget.content.trimRight()),
      builders: {'pre': _CodeBlockBuilder()},
      styleSheet: MarkdownStyleSheet(
        p: const TextStyle(
          color: AppColors.textPrimary,
          fontSize: AppTypography.bodyLg,
          height: 1.6,
        ),
        code: const TextStyle(
          color: Color(0xFFE0E0E0),
          fontSize: 13,
          backgroundColor: AppColors.bgSecondary,
          fontFamily: 'monospace',
        ),
        codeblockDecoration: BoxDecoration(
          color: AppColors.bgSecondary,
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border.all(color: AppColors.borderLight),
        ),
        h1: const TextStyle(
          color: AppColors.textPrimary,
          fontSize: AppTypography.display,
          fontWeight: FontWeight.bold,
        ),
        h2: const TextStyle(
          color: AppColors.textPrimary,
          fontSize: AppTypography.headline,
          fontWeight: FontWeight.bold,
        ),
        h3: const TextStyle(
          color: AppColors.textPrimary,
          fontSize: AppTypography.title,
          fontWeight: FontWeight.w600,
        ),
        a: const TextStyle(
          color: Color(0xFF7EC8E3),
          decoration: TextDecoration.underline,
        ),
        blockquote: const TextStyle(
          color: AppColors.textSecondary,
          fontStyle: FontStyle.italic,
        ),
        blockquoteDecoration: const BoxDecoration(
          border: Border(
            left: BorderSide(color: AppColors.textSecondary, width: 3),
          ),
          color: AppColors.surface,
        ),
        listBullet: const TextStyle(color: AppColors.textPrimary),
      ),
    );
  }

  static const _highlightBg = Color(0x503eb573);

  /// 搜索高亮渲染：将匹配关键词的部分用绿色半透明背景标记
  Widget _buildHighlightedContent(String text, String query, Color baseColor) {
    if (query.isEmpty) {
      return Text(
        text,
        style: TextStyle(
          color: baseColor,
          fontSize: AppTypography.bodyLg,
          height: 1.5,
        ),
      );
    }
    final spans = <InlineSpan>[];
    int lastEnd = 0;
    final lowerText = text.toLowerCase();
    final lowerQuery = query.toLowerCase();
    while (true) {
      final start = lowerText.indexOf(lowerQuery, lastEnd);
      if (start == -1) break;
      if (start > lastEnd) {
        spans.add(TextSpan(text: text.substring(lastEnd, start)));
      }
      spans.add(
        TextSpan(
          text: text.substring(start, start + query.length),
          style: const TextStyle(backgroundColor: _highlightBg),
        ),
      );
      lastEnd = start + query.length;
    }
    if (lastEnd < text.length) {
      spans.add(TextSpan(text: text.substring(lastEnd)));
    }
    return RichText(
      text: TextSpan(
        style: TextStyle(
          color: baseColor,
          fontSize: AppTypography.bodyLg,
          height: 1.5,
        ),
        children: spans,
      ),
    );
  }

  /// 压缩摘要内容：默认显示前两行预览，可展开查看完整 Markdown 内容
  Widget _buildCompactSummaryContent() {
    final lines = widget.content.split('\n');
    final previewLines = lines.take(2).join('\n');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: AppColors.bgSecondary,
            borderRadius: AppRadius.smAll,
            border: Border.all(color: AppColors.borderLight),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(
                    Icons.summarize,
                    color: AppColors.textSecondary,
                    size: 14,
                  ),
                  SizedBox(width: 6),
                  Text(
                    '对话摘要',
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.5,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              AnimatedSize(
                duration: AppAnimations.duration(context, AppAnimations.page),
                curve: AppAnimations.curve(context, AppAnimations.easeOutBack),
                alignment: Alignment.topCenter,
                child: _isSummaryExpanded && widget.content.trim().isNotEmpty
                    ? MarkdownBody(
                        data: _sanitizeMarkdown(widget.content.trimRight()),
                        styleSheet: MarkdownStyleSheet(
                          p: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: AppTypography.body,
                          ),
                          code: const TextStyle(
                            color: Color(0xFFE0E0E0),
                            backgroundColor: AppColors.bgSecondary,
                            fontSize: 13,
                          ),
                        ),
                      )
                    : Text(
                        previewLines,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 13,
                          height: 1.5,
                        ),
                      ),
              ),
            ],
          ),
        ),
        AppAnimations.scaleTap(
          onTap: () => setState(() => _isSummaryExpanded = !_isSummaryExpanded),
          scaleDown: 0.95,
          child: Container(
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.borderLight,
              borderRadius: AppRadius.xsAll,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedRotation(
                  turns: _isSummaryExpanded ? 0.5 : 0.0,
                  duration: AppAnimations.duration(
                    context,
                    AppAnimations.normal,
                  ),
                  curve: AppAnimations.curve(context, AppSprings.bouncyCurve),
                  child: const Icon(
                    Icons.keyboard_arrow_down,
                    color: AppColors.textSecondary,
                    size: 14,
                  ),
                ),
                AppSpacing.hXS,
                Text(
                  _isSummaryExpanded ? '收起摘要' : '展开摘要',
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: AppTypography.caption,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildBlinkingCursor() {
    return AppAnimations.blinkingCursor();
  }

  /// 长按上下文菜单：复制内容、展开/折叠思维链、删除消息
  void _showContextMenu(BuildContext context) {
    AppAnimations.showSpringBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.copy, color: AppColors.textSecondary),
              title: const Text(
                '复制内容',
                style: TextStyle(color: AppColors.textPrimary),
              ),
              onTap: () {
                Clipboard.setData(ClipboardData(text: widget.content));
                Navigator.pop(context);
                widget.onCopy?.call();
              },
            ),
            if (_hasReasoning)
              ListTile(
                leading: Icon(
                  _showReasoning ? Icons.lightbulb : Icons.lightbulb_outline,
                  color: AppColors.textSecondary,
                ),
                title: Text(
                  _showReasoning ? '折叠思维链' : '展开思维链',
                  style: const TextStyle(color: AppColors.textPrimary),
                ),
                onTap: () {
                  Navigator.pop(context);
                  setState(() => _showReasoning = !_showReasoning);
                },
              ),
            if (widget.onDelete != null)
              ListTile(
                leading: const Icon(Icons.delete, color: AppColors.error),
                title: const Text(
                  '删除消息',
                  style: TextStyle(color: AppColors.error),
                ),
                onTap: () {
                  Navigator.pop(context);
                  widget.onDelete!();
                },
              ),
          ],
        ),
      ),
    );
  }
}

/// 压缩边界分隔器 — 标记历史摘要与当前对话的分界
class CompactBoundarySeparator extends StatelessWidget {
  const CompactBoundarySeparator({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SpringEntrance(
        fromScale: 0.9,
        fromOffset: Offset.zero,
        spring: AppSprings.gentle,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: AppSpacing.md),
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: AppColors.bgSecondary,
            borderRadius: AppRadius.smAll,
            border: Border.all(color: AppColors.borderLight),
            boxShadow: AppShadows.assistantBubble,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.compress,
                color: AppColors.textSecondary,
                size: 14,
              ),
              AppSpacing.hSM,
              const Text(
                '以上为历史对话摘要',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: AppTypography.caption,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 自定义代码块 builder，为代码块添加复制按钮
class _CodeBlockBuilder extends MarkdownElementBuilder {
  @override
  bool isBlockElement() => true;

  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    // pre > code 结构中提取代码文本
    final codeElement = element.children?.isNotEmpty == true
        ? element.children!.first
        : null;
    final codeText = codeElement is md.Element
        ? codeElement.children?.map((c) => c.textContent).join() ?? ''
        : element.textContent;

    // 从 code 元素的 class 属性提取语言标识
    final language = codeElement is md.Element
        ? (codeElement.attributes['class'] ?? '').replaceFirst('language-', '')
        : '';

    return _CodeBlockWithCopy(code: codeText, language: language);
  }
}

/// 带复制按钮的代码块组件
class _CodeBlockWithCopy extends StatefulWidget {
  final String code;
  final String language;

  const _CodeBlockWithCopy({required this.code, required this.language});

  @override
  State<_CodeBlockWithCopy> createState() => _CodeBlockWithCopyState();
}

class _CodeBlockWithCopyState extends State<_CodeBlockWithCopy> {
  bool _copied = false;

  /// 复制代码到剪贴板，2 秒后按钮恢复为"复制"状态
  Future<void> _copyCode() async {
    await Clipboard.setData(ClipboardData(text: widget.code));
    if (!mounted) return;
    setState(() => _copied = true);
    await Future<void>.delayed(const Duration(seconds: 2));
    if (mounted) setState(() => _copied = false);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.bgSecondary,
        borderRadius: AppRadius.smAll,
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 顶部栏 — 语言标识 + 复制按钮
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: const BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.vertical(
                top: Radius.circular(AppRadius.sm),
              ),
              border: Border(bottom: BorderSide(color: AppColors.borderLight)),
            ),
            child: Row(
              children: [
                if (widget.language.isNotEmpty)
                  Text(
                    widget.language,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: AppTypography.caption,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                const Spacer(),
                AppAnimations.scaleTap(
                  onTap: _copyCode,
                  scaleDown: 0.90,
                  child: AnimatedSwitcher(
                    duration: AppAnimations.micro,
                    transitionBuilder: (child, animation) => FadeTransition(
                      opacity: animation,
                      child: ScaleTransition(
                        scale: animation.drive(
                          Tween(
                            begin: 0.6,
                            end: 1.0,
                          ).chain(CurveTween(curve: AppSprings.bouncyCurve)),
                        ),
                        child: child,
                      ),
                    ),
                    child: Row(
                      key: ValueKey(_copied),
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          _copied ? Icons.check : Icons.copy,
                          color: _copied
                              ? AppColors.green
                              : AppColors.textSecondary,
                          size: 14,
                        ),
                        AppSpacing.hXS,
                        Text(
                          _copied ? '已复制' : '复制',
                          style: TextStyle(
                            color: _copied
                                ? AppColors.green
                                : AppColors.textSecondary,
                            fontSize: AppTypography.caption,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          // 代码正文区域
          Padding(
            padding: const EdgeInsets.all(AppSpacing.mdSm),
            child: SelectableText(
              widget.code,
              style: const TextStyle(
                color: Color(0xFFE0E0E0),
                fontSize: 13,
                fontFamily: 'monospace',
                height: 1.5,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 消息状态指示器 — 发送中/成功/失败图标动画
///
/// 状态切换时使用缩放+淡入淡出过渡；成功图标会在显示 2 秒后自动隐藏，
/// 避免对历史消息造成持续干扰。尊重系统动画减少设置。
class _MessageStatusIndicator extends StatefulWidget {
  final MessageBubbleStatus? status;

  const _MessageStatusIndicator({required this.status});

  @override
  State<_MessageStatusIndicator> createState() =>
      _MessageStatusIndicatorState();
}

class _MessageStatusIndicatorState extends State<_MessageStatusIndicator> {
  bool _sentVisible = false;
  bool _hasBeenSending = false;
  Timer? _hideSentTimer;

  @override
  void initState() {
    super.initState();
    if (widget.status == MessageBubbleStatus.sending) {
      _hasBeenSending = true;
    }
  }

  @override
  void didUpdateWidget(covariant _MessageStatusIndicator oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.status == MessageBubbleStatus.sending) {
      _hasBeenSending = true;
    }
    if (widget.status == MessageBubbleStatus.sent &&
        _hasBeenSending &&
        oldWidget.status != MessageBubbleStatus.sent) {
      _sentVisible = true;
      _hideSentTimer?.cancel();
      _hideSentTimer = Timer(const Duration(seconds: 2), () {
        if (mounted) setState(() => _sentVisible = false);
      });
    } else if (widget.status != MessageBubbleStatus.sent) {
      _sentVisible = false;
      _hideSentTimer?.cancel();
    }
  }

  @override
  void dispose() {
    _hideSentTimer?.cancel();
    super.dispose();
  }

  MessageBubbleStatus? get _effectiveStatus {
    if (widget.status == MessageBubbleStatus.sending) {
      return MessageBubbleStatus.sending;
    }
    if (widget.status == MessageBubbleStatus.failed) {
      return MessageBubbleStatus.failed;
    }
    if (widget.status == MessageBubbleStatus.sent &&
        _sentVisible &&
        _hasBeenSending) {
      return MessageBubbleStatus.sent;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final effective = _effectiveStatus;
    return AnimatedSwitcher(
      duration: AppAnimations.duration(context, AppAnimations.micro),
      switchInCurve: AppAnimations.curve(context, AppAnimations.spring),
      switchOutCurve: AppAnimations.curve(context, AppAnimations.easeIn),
      transitionBuilder: (child, animation) {
        return ScaleTransition(
          scale: animation,
          child: FadeTransition(opacity: animation, child: child),
        );
      },
      child: _buildIcon(effective),
    );
  }

  Widget _buildIcon(MessageBubbleStatus? status) {
    if (status == null) {
      return const SizedBox.shrink(key: ValueKey('status_empty'));
    }
    switch (status) {
      case MessageBubbleStatus.sending:
        return const SizedBox(
          key: ValueKey('status_sending'),
          width: 12,
          height: 12,
          child: CircularProgressIndicator(
            strokeWidth: 1.5,
            valueColor: AlwaysStoppedAnimation<Color>(Colors.white70),
          ),
        );
      case MessageBubbleStatus.sent:
        return const Icon(
          key: ValueKey('status_sent'),
          Icons.check_circle_outline,
          size: 14,
          color: AppColors.success,
        );
      case MessageBubbleStatus.failed:
        return const Icon(
          key: ValueKey('status_failed'),
          Icons.error_outline,
          size: 14,
          color: AppColors.error,
        );
    }
  }
}

/// 时间分隔器组件
/// 时间分隔器 — 消息列表中相隔超过 5 分钟时插入的时间标签
class TimeSeparator extends StatelessWidget {
  final DateTime dateTime;

  const TimeSeparator({super.key, required this.dateTime});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SpringEntrance(
        fromScale: 0.92,
        fromOffset: const Offset(0, 8),
        spring: AppSprings.gentle,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: AppSpacing.md),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            color: AppColors.surface.withValues(alpha: 0.6),
            borderRadius: AppRadius.xsAll,
            boxShadow: AppShadows.assistantBubble,
          ),
          child: Text(
            _formatTime(dateTime),
            style: const TextStyle(
              color: AppColors.textTertiary,
              fontSize: AppTypography.caption,
            ),
          ),
        ),
      ),
    );
  }

  String _formatTime(DateTime time) {
    return TimeFormatters.chatSeparator(time);
  }
}
