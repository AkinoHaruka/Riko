import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:markdown/markdown.dart' as md;

import '../../core/di/toast_provider.dart';
import '../../core/theme/app_animations.dart';

/// 消息气泡配色常量（用户消息绿色气泡，助手消息深灰色气泡）
class _Colors {
  static const Color userBubble = Color(0xFF3eb573);
  static const Color assistantBubble = Color(0xFF292929);
  static const Color userText = Color(0xFF000000);
  static const Color assistantText = Color(0xFFd5d5d5);
  static const Color avatarBg = Color(0xFF3C3C3C);
  static const Color primaryText = Color(0xFFd5d5d5);
  static const Color secondaryText = Color(0xFF999999);
  static const Color timeSeparator = Color(0xFF666666);
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
  final double radius = 12;
  final double triangleWidth = 10;
  final double triangleHeight = 10;

  _BubblePainter({required this.color, required this.isUser});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    final path = Path();

    final w = size.width;
    final h = size.height;
    final r = radius;
    final tw = triangleWidth;

    // 三角中心与 40px 头像的中心对齐
    final ty = 16.0;

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
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _BubblePainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.isUser != isUser;
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
  final bool isCompactSummary;
  final bool isCompactBoundary;
  final Uint8List? assistantAvatar;
  final String? searchQuery;
  final bool isSearchMatch;

  const MessageBubble({
    super.key,
    required this.role,
    required this.content,
    this.reasoningContent,
    this.isStreaming = false,
    this.animateEntrance = true,
    this.createdAt,
    this.onDelete,
    this.isCompactSummary = false,
    this.isCompactBoundary = false,
    this.assistantAvatar,
    this.searchQuery,
    this.isSearchMatch = false,
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
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 12),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!_isUser) _buildAvatar(),
            if (!_isUser) const SizedBox(width: 4),
            Flexible(
              child: GestureDetector(
                onLongPress: () => _showContextMenu(context),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  decoration: widget.isSearchMatch
                      ? BoxDecoration(
                          borderRadius: BorderRadius.circular(14),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFF3eb573).withValues(alpha: 0.5),
                              blurRadius: 12,
                              spreadRadius: 2,
                            ),
                          ],
                        )
                      : null,
                  child: CustomPaint(
                    painter: _BubblePainter(
                      color: _isUser
                          ? _Colors.userBubble
                          : _Colors.assistantBubble,
                      isUser: _isUser,
                    ),
                    child: Container(
                      padding: EdgeInsets.only(
                        left: _isUser ? 12 : 20,
                        right: _isUser ? 20 : 12,
                        top: 10,
                        bottom: 10,
                      ),
                      constraints: BoxConstraints(
                        maxWidth: maxBubbleW,
                        minHeight: 44,
                      ),
                      child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (_hasReasoning && !_isUser) _buildReasoningToggle(),
                        if (_hasReasoning && _showReasoning && !_isUser)
                          _buildReasoningContent(),
                        if (_hasReasoning && _showReasoning && !_isUser)
                          const SizedBox(height: 10),
                        _buildMainContent(),
                        if (widget.isStreaming && widget.content.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: _buildBlinkingCursor(),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            ),
            if (_isUser) const SizedBox(width: 4),
            if (_isUser) _buildAvatar(),
          ],
        ),
      ),
    );

        if (!widget.animateEntrance) return bubble;
        return AppAnimations.messageEntrance(isUser: _isUser, child: bubble);
      },
    );
  }

  /// 方形圆角头像 — 助手侧面有自定义头像图片则显示图片
  Widget _buildAvatar() {
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: _Colors.avatarBg,
        borderRadius: BorderRadius.circular(6),
      ),
      clipBehavior: Clip.antiAlias,
      child: _isUser || widget.assistantAvatar == null
          ? Icon(
              _isUser ? Icons.person : Icons.smart_toy,
              size: 22,
              color: _Colors.secondaryText,
            )
          : Image.memory(
              widget.assistantAvatar!,
              fit: BoxFit.cover,
            ),
    );
  }

  /// 思维链折叠/展开切换按钮
  Widget _buildReasoningToggle() {
    return GestureDetector(
      onTap: () => setState(() => _showReasoning = !_showReasoning),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0xFF3C3C3C),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              _showReasoning ? Icons.lightbulb : Icons.lightbulb_outline,
              color: _Colors.secondaryText,
              size: 14,
            ),
            const SizedBox(width: 6),
            Text(
              _showReasoning ? '隐藏思维链' : '查看思维链',
              style: const TextStyle(
                color: _Colors.secondaryText,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(width: 4),
            Icon(
              _showReasoning
                  ? Icons.keyboard_arrow_up
                  : Icons.keyboard_arrow_down,
              color: _Colors.secondaryText,
              size: 14,
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
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFF3C3C3C)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.psychology, color: _Colors.secondaryText, size: 14),
              const SizedBox(width: 6),
              Text(
                '思维链',
                style: TextStyle(
                  color: _Colors.secondaryText.withValues(alpha: 0.8),
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            widget.reasoningContent!,
            style: const TextStyle(
              color: _Colors.secondaryText,
              fontSize: 13,
              height: 1.5,
              fontStyle: FontStyle.italic,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMainContent() {
    final searchQ = widget.searchQuery;
    if (_isUser) {
      final textWidget = Text(
        widget.content,
        style: const TextStyle(
          color: _Colors.userText,
          fontSize: 15,
          height: 1.5,
        ),
      );
      if (searchQ != null && searchQ.isNotEmpty) {
        return _buildHighlightedContent(widget.content, searchQ, _Colors.userText);
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
          color: _Colors.assistantText,
          fontSize: 15,
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
      return _buildHighlightedContent(widget.content, searchQ, _Colors.assistantText);
    }

    return MarkdownBody(
      data: _sanitizeMarkdown(widget.content.trimRight()),
      builders: {'pre': _CodeBlockBuilder()},
      styleSheet: MarkdownStyleSheet(
        p: const TextStyle(
          color: _Colors.assistantText,
          fontSize: 15,
          height: 1.6,
        ),
        code: const TextStyle(
          color: Color(0xFFE0E0E0),
          fontSize: 13,
          backgroundColor: Color(0xFF1A1A1A),
          fontFamily: 'monospace',
        ),
        codeblockDecoration: BoxDecoration(
          color: const Color(0xFF1A1A1A),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFF3C3C3C)),
        ),
        h1: const TextStyle(
          color: _Colors.primaryText,
          fontSize: 20,
          fontWeight: FontWeight.bold,
        ),
        h2: const TextStyle(
          color: _Colors.primaryText,
          fontSize: 18,
          fontWeight: FontWeight.bold,
        ),
        h3: const TextStyle(
          color: _Colors.primaryText,
          fontSize: 16,
          fontWeight: FontWeight.w600,
        ),
        a: const TextStyle(
          color: Color(0xFF7EC8E3),
          decoration: TextDecoration.underline,
        ),
        blockquote: const TextStyle(
          color: _Colors.secondaryText,
          fontStyle: FontStyle.italic,
        ),
        blockquoteDecoration: const BoxDecoration(
          border: Border(
            left: BorderSide(color: _Colors.secondaryText, width: 3),
          ),
          color: Color(0xFF252525),
        ),
        listBullet: const TextStyle(color: _Colors.primaryText),
      ),
    );
  }

  static const _highlightBg = Color(0x503eb573);

  Widget _buildHighlightedContent(String text, String query, Color baseColor) {
    if (query.isEmpty) {
      return Text(text, style: TextStyle(color: baseColor, fontSize: 15, height: 1.5));
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
      spans.add(TextSpan(
        text: text.substring(start, start + query.length),
        style: const TextStyle(backgroundColor: _highlightBg),
      ));
      lastEnd = start + query.length;
    }
    if (lastEnd < text.length) {
      spans.add(TextSpan(text: text.substring(lastEnd)));
    }
    return RichText(
      text: TextSpan(
        style: TextStyle(color: baseColor, fontSize: 15, height: 1.5),
        children: spans,
      ),
    );
  }

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
            color: const Color(0xFF1A1A1A),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: const Color(0xFF3C3C3C)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.summarize, color: _Colors.secondaryText, size: 14),
                  SizedBox(width: 6),
                  Text(
                    '对话摘要',
                    style: TextStyle(
                      color: _Colors.secondaryText,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.5,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              if (_isSummaryExpanded && widget.content.trim().isNotEmpty)
                MarkdownBody(
                  data: _sanitizeMarkdown(widget.content.trimRight()),
                  styleSheet: MarkdownStyleSheet(
                    p: const TextStyle(color: _Colors.assistantText, fontSize: 14),
                    code: const TextStyle(color: Color(0xFFE0E0E0), backgroundColor: Color(0xFF1A1A1A), fontSize: 13),
                  ),
                )
              else
                Text(
                  previewLines,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: _Colors.assistantText,
                    fontSize: 13,
                    height: 1.5,
                  ),
                ),
            ],
          ),
        ),
        GestureDetector(
          onTap: () => setState(() => _isSummaryExpanded = !_isSummaryExpanded),
          child: Container(
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFF3C3C3C),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  _isSummaryExpanded
                      ? Icons.keyboard_arrow_up
                      : Icons.keyboard_arrow_down,
                  color: _Colors.secondaryText,
                  size: 14,
                ),
                const SizedBox(width: 4),
                Text(
                  _isSummaryExpanded ? '收起摘要' : '展开摘要',
                  style: const TextStyle(
                    color: _Colors.secondaryText,
                    fontSize: 12,
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
    return const Text(
      '|',
      style: TextStyle(
        color: _Colors.secondaryText,
        fontWeight: FontWeight.w300,
      ),
    );
  }

  void _showContextMenu(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF2C2C2C),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.copy, color: _Colors.secondaryText),
              title: const Text(
                '复制内容',
                style: TextStyle(color: _Colors.primaryText),
              ),
              onTap: () {
                Clipboard.setData(ClipboardData(text: widget.content));
                Navigator.pop(context);
                ProviderScope.containerOf(context)
                    .read(toastProvider.notifier)
                    .show('已复制到剪贴板');
              },
            ),
            if (_hasReasoning)
              ListTile(
                leading: Icon(
                  _showReasoning ? Icons.lightbulb : Icons.lightbulb_outline,
                  color: _Colors.secondaryText,
                ),
                title: Text(
                  _showReasoning ? '折叠思维链' : '展开思维链',
                  style: const TextStyle(color: _Colors.primaryText),
                ),
                onTap: () {
                  Navigator.pop(context);
                  setState(() => _showReasoning = !_showReasoning);
                },
              ),
            if (widget.onDelete != null)
              ListTile(
                leading: const Icon(Icons.delete, color: Color(0xFFFF4757)),
                title: const Text(
                  '删除消息',
                  style: TextStyle(color: Color(0xFFFF4757)),
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
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 16),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFF1A1A1A),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFF3C3C3C)),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.compress, color: _Colors.secondaryText, size: 14),
            SizedBox(width: 8),
            Text(
              '以上为历史对话摘要',
              style: TextStyle(color: _Colors.secondaryText, fontSize: 12),
            ),
          ],
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
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFF3C3C3C)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 顶部栏 — 语言标识 + 复制按钮
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: const BoxDecoration(
              color: Color(0xFF252525),
              borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
              border: Border(bottom: BorderSide(color: Color(0xFF3C3C3C))),
            ),
            child: Row(
              children: [
                if (widget.language.isNotEmpty)
                  Text(
                    widget.language,
                    style: const TextStyle(
                      color: _Colors.secondaryText,
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                const Spacer(),
                GestureDetector(
                  onTap: _copyCode,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        _copied ? Icons.check : Icons.copy,
                        color: _copied
                            ? const Color(0xFF3eb573)
                            : _Colors.secondaryText,
                        size: 14,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        _copied ? '已复制' : '复制',
                        style: TextStyle(
                          color: _copied
                              ? const Color(0xFF3eb573)
                              : _Colors.secondaryText,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // 代码正文区域
          Padding(
            padding: const EdgeInsets.all(12),
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

/// 时间分隔器组件
/// 时间分隔器 — 消息列表中相隔超过 5 分钟时插入的时间标签
class TimeSeparator extends StatelessWidget {
  final DateTime dateTime;

  const TimeSeparator({super.key, required this.dateTime});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 16),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        decoration: BoxDecoration(
          color: const Color(0xFF2C2C2C).withValues(alpha: 0.6),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Text(
          _formatTime(dateTime),
          style: const TextStyle(color: _Colors.timeSeparator, fontSize: 12),
        ),
      ),
    );
  }

  String _formatTime(DateTime time) {
    final localTime = time.toLocal();
    final now = DateTime.now();

    final today = DateTime(now.year, now.month, now.day);
    final messageDate = DateTime(
      localTime.year,
      localTime.month,
      localTime.day,
    );
    final diffDays = today.difference(messageDate).inDays;

    final hm = '${_twoDigits(localTime.hour)}:${_twoDigits(localTime.minute)}';

    if (diffDays == 0) {
      return hm;
    } else if (diffDays == 1) {
      return '昨天 $hm';
    } else {
      return '${localTime.month}月${localTime.day}日 $hm';
    }
  }

  String _twoDigits(int n) => n.toString().padLeft(2, '0');
}
