import 'package:flutter/material.dart';
import '../../infrastructure/ai_adapter/models/token_usage.dart';
import 'terminal_panel_colors.dart';

/// JSON 语法高亮工具类
class JsonHighlighter {
  JsonHighlighter();

  final Map<String, List<TextSpan>> _cache = {};
  static const _maxCacheSize = 50;

  List<TextSpan> highlight(String json) {
    final cached = _cache[json];
    if (cached != null) return cached;
    if (_cache.length >= _maxCacheSize) {
      _cache.clear();
    }
    final result = _computeHighlight(json);
    _cache[json] = result;
    return result;
  }

  List<TextSpan> _computeHighlight(String json) {
    final List<TextSpan> spans = [];
    int i = 0;

    while (i < json.length) {
      final ch = json[i];

      if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r') {
        spans.add(
          TextSpan(
            text: ch,
            style: const TextStyle(color: TerminalPanelColors.textWhite),
          ),
        );
        i++;
        continue;
      }

      if (ch == '"') {
        final start = i;
        i++;
        while (i < json.length) {
          if (json[i] == '"' && json[i - 1] != '\\') {
            i++;
            break;
          }
          i++;
        }
        final raw = json.substring(start, i);
        bool isKey = false;
        int j = i;
        while (j < json.length && (json[j] == ' ' || json[j] == '\t')) {
          j++;
        }
        if (j < json.length && json[j] == ':') {
          isKey = true;
        }
        spans.add(
          TextSpan(
            text: raw,
            style: TextStyle(
              color: isKey
                  ? TerminalPanelColors.jsonKey
                  : TerminalPanelColors.jsonString,
            ),
          ),
        );
        continue;
      }

      if (_isDigit(ch) ||
          (ch == '-' && i + 1 < json.length && _isDigit(json[i + 1]))) {
        final start = i;
        i++;
        while (i < json.length &&
            (_isDigit(json[i]) ||
                json[i] == '.' ||
                json[i] == 'e' ||
                json[i] == 'E' ||
                json[i] == '+' ||
                json[i] == '-')) {
          i++;
        }
        spans.add(
          TextSpan(
            text: json.substring(start, i),
            style: const TextStyle(color: TerminalPanelColors.jsonNumber),
          ),
        );
        continue;
      }

      if (ch == 't' || ch == 'f' || ch == 'n') {
        final start = i;
        if (json.startsWith('true', i)) {
          i += 4;
        } else if (json.startsWith('false', i)) {
          i += 5;
        } else if (json.startsWith('null', i)) {
          i += 4;
        } else {
          spans.add(
            TextSpan(
              text: ch,
              style: const TextStyle(color: TerminalPanelColors.textWhite),
            ),
          );
          i++;
          continue;
        }
        spans.add(
          TextSpan(
            text: json.substring(start, i),
            style: const TextStyle(color: TerminalPanelColors.jsonBool),
          ),
        );
        continue;
      }

      if (ch == '{' ||
          ch == '}' ||
          ch == '[' ||
          ch == ']' ||
          ch == ':' ||
          ch == ',') {
        spans.add(
          TextSpan(
            text: ch,
            style: const TextStyle(color: TerminalPanelColors.textWhite),
          ),
        );
        i++;
        continue;
      }

      spans.add(
        TextSpan(
          text: ch,
          style: const TextStyle(color: TerminalPanelColors.textWhite),
        ),
      );
      i++;
    }

    return spans;
  }

  static bool _isDigit(String ch) {
    return ch.codeUnitAt(0) >= 48 && ch.codeUnitAt(0) <= 57;
  }
}

/// 请求区段 — 展示 API 请求 JSON
class RequestSectionWidget extends StatelessWidget {
  final String requestJson;
  final JsonHighlighter highlighter;

  const RequestSectionWidget({
    super.key,
    required this.requestJson,
    required this.highlighter,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: TerminalPanelColors.requestYellow.withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '[REQUEST]',
            style: TextStyle(
              color: TerminalPanelColors.requestYellow,
              fontSize: 11,
              fontWeight: FontWeight.bold,
              fontFamily: 'Consolas',
              fontFamilyFallback: ['Cascadia Code', 'monospace'],
            ),
          ),
          const SizedBox(height: 4),
          Text.rich(
            TextSpan(
              children: highlighter.highlight(requestJson),
              style: const TextStyle(
                fontSize: 11,
                fontFamily: 'Consolas',
                fontFamilyFallback: ['Cascadia Code', 'monospace'],
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 响应区段 — 展示 AI 响应文本，支持思维链分段
class ResponseSectionWidget extends StatelessWidget {
  final String responseRawText;

  const ResponseSectionWidget({super.key, required this.responseRawText});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: TerminalPanelColors.responseCyan.withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '[RESPONSE]',
            style: TextStyle(
              color: TerminalPanelColors.responseCyan,
              fontSize: 11,
              fontWeight: FontWeight.bold,
              fontFamily: 'Consolas',
              fontFamilyFallback: ['Cascadia Code', 'monospace'],
            ),
          ),
          const SizedBox(height: 4),
          if (responseRawText.isEmpty)
            const Text(
              '(waiting for response...)',
              style: TextStyle(
                color: TerminalPanelColors.timestamp,
                fontSize: 11,
                fontFamily: 'Consolas',
                fontFamilyFallback: ['Cascadia Code', 'monospace'],
                fontStyle: FontStyle.italic,
              ),
            )
          else
            _buildFormattedResponse(responseRawText),
        ],
      ),
    );
  }

  Widget _buildFormattedResponse(String text) {
    final reasoningMatch = RegExp(
      r'\[Reasoning\]\n([\s\S]*?)\n\n\[Response\]\n([\s\S]*)',
    ).firstMatch(text);

    if (reasoningMatch != null) {
      final reasoning = reasoningMatch.group(1) ?? '';
      final response = reasoningMatch.group(2) ?? '';
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: const Color(0xFF1A1A1A),
              borderRadius: BorderRadius.circular(4),
              border: Border.all(
                color: TerminalPanelColors.sessionNotesBlue.withValues(
                  alpha: 0.3,
                ),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '[Reasoning]',
                  style: TextStyle(
                    color: TerminalPanelColors.sessionNotesBlue,
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    fontFamily: 'Consolas',
                    fontFamilyFallback: ['Cascadia Code', 'monospace'],
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  reasoning,
                  style: const TextStyle(
                    color: TerminalPanelColors.textWhite,
                    fontSize: 11,
                    fontFamily: 'Consolas',
                    fontFamilyFallback: ['Cascadia Code', 'monospace'],
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 6),
          Text(
            response,
            style: const TextStyle(
              color: TerminalPanelColors.textWhite,
              fontSize: 11,
              fontFamily: 'Consolas',
              fontFamilyFallback: ['Cascadia Code', 'monospace'],
              height: 1.4,
            ),
          ),
        ],
      );
    }

    final plainText = text.startsWith('[Response]\n')
        ? text.substring('[Response]\n'.length)
        : text;
    return Text(
      plainText,
      style: const TextStyle(
        color: TerminalPanelColors.textWhite,
        fontSize: 11,
        fontFamily: 'Consolas',
        fontFamilyFallback: ['Cascadia Code', 'monospace'],
        height: 1.4,
      ),
    );
  }
}

/// 错误区段 — 展示错误分类、代码、消息和建议
class ErrorSectionWidget extends StatelessWidget {
  final String? errorCategory;
  final String? errorCode;
  final String? errorMessage;
  final String? errorSuggestion;

  const ErrorSectionWidget({
    super.key,
    this.errorCategory,
    this.errorCode,
    this.errorMessage,
    this.errorSuggestion,
  });

  static IconData getErrorIcon(String? category) {
    switch (category) {
      case 'network':
        return Icons.wifi_off;
      case 'auth':
        return Icons.lock;
      case 'rateLimit':
        return Icons.schedule;
      case 'server':
        return Icons.dns;
      case 'param':
        return Icons.warning_amber;
      case 'config':
        return Icons.key;
      case 'stream':
        return Icons.link_off;
      case 'parse':
        return Icons.code;
      case 'timeout':
        return Icons.hourglass_empty;
      case 'database':
        return Icons.storage;
      case 'balance':
        return Icons.account_balance_wallet;
      default:
        return Icons.error_outline;
    }
  }

  static String getErrorCategoryLabel(String? category) {
    switch (category) {
      case 'network':
        return '网络错误';
      case 'auth':
        return '认证错误';
      case 'rateLimit':
        return '请求限速';
      case 'server':
        return '服务器故障';
      case 'param':
        return '参数错误';
      case 'config':
        return '配置错误';
      case 'stream':
        return '流中断';
      case 'parse':
        return '解析错误';
      case 'timeout':
        return '超时';
      case 'database':
        return '数据库错误';
      case 'balance':
        return '余额不足';
      default:
        return '未知错误';
    }
  }

  @override
  Widget build(BuildContext context) {
    final categoryLabel = getErrorCategoryLabel(errorCategory);
    final icon = getErrorIcon(errorCategory);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: TerminalPanelColors.errorBg,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: TerminalPanelColors.errorRed.withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text(
                '[ERROR]',
                style: TextStyle(
                  color: TerminalPanelColors.errorRed,
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  fontFamily: 'Consolas',
                  fontFamilyFallback: ['Cascadia Code', 'monospace'],
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Container(
                  height: 1,
                  color: TerminalPanelColors.errorRed.withValues(alpha: 0.3),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Icon(icon, color: TerminalPanelColors.errorRed, size: 14),
              const SizedBox(width: 4),
              Text(
                categoryLabel,
                style: const TextStyle(
                  color: TerminalPanelColors.errorTextLight,
                  fontSize: 11,
                  fontFamily: 'Consolas',
                  fontFamilyFallback: ['Cascadia Code', 'monospace'],
                ),
              ),
              if (errorCode != null && errorCode!.isNotEmpty) ...[
                const SizedBox(width: 4),
                Text(
                  '($errorCode)',
                  style: const TextStyle(
                    color: TerminalPanelColors.errorTextLight,
                    fontSize: 11,
                    fontFamily: 'Consolas',
                    fontFamilyFallback: ['Cascadia Code', 'monospace'],
                  ),
                ),
              ],
            ],
          ),
          if (errorMessage != null && errorMessage!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              errorMessage!,
              style: const TextStyle(
                color: TerminalPanelColors.errorTextLight,
                fontSize: 11,
                fontFamily: 'Consolas',
                fontFamilyFallback: ['Cascadia Code', 'monospace'],
              ),
            ),
          ],
          if (errorSuggestion != null && errorSuggestion!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              '建议：$errorSuggestion',
              style: const TextStyle(
                color: TerminalPanelColors.errorSuggestion,
                fontSize: 11,
                fontFamily: 'Consolas',
                fontFamilyFallback: ['Cascadia Code', 'monospace'],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// 工具调用区段 — 展示 AI 调用的工具列表
class ToolCallSectionWidget extends StatelessWidget {
  final Map<String, dynamic> data;

  const ToolCallSectionWidget({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final tools = (data['tools'] as List<dynamic>?) ?? [];
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(4),
        border: Border(
          left: const BorderSide(color: TerminalPanelColors.toolCallPurple, width: 3),
          top: BorderSide(
            color: TerminalPanelColors.toolCallPurple.withValues(alpha: 0.3),
          ),
          right: BorderSide(
            color: TerminalPanelColors.toolCallPurple.withValues(alpha: 0.3),
          ),
          bottom: BorderSide(
            color: TerminalPanelColors.toolCallPurple.withValues(alpha: 0.3),
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '[TOOL_CALL] ${tools.length} tool${tools.length != 1 ? 's' : ''} invoked',
            style: const TextStyle(
              color: TerminalPanelColors.toolCallPurple,
              fontSize: 11,
              fontWeight: FontWeight.bold,
              fontFamily: 'Consolas',
              fontFamilyFallback: ['Cascadia Code', 'monospace'],
            ),
          ),
          const SizedBox(height: 4),
          ...tools.asMap().entries.map((entry) {
            final index = entry.key;
            final tool = entry.value as Map<String, dynamic>;
            final isLast = index == tools.length - 1;
            final prefix = isLast ? '└─' : '├─';
            final name = tool['name'] as String? ?? '';
            final args = tool['arguments'] as String? ?? '';
            final result = tool['result_preview'] as String? ?? '';
            return Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        prefix,
                        style: const TextStyle(
                          color: TerminalPanelColors.timestamp,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['Cascadia Code', 'monospace'],
                        ),
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              name,
                              style: const TextStyle(
                                color: TerminalPanelColors.toolCallPurple,
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                fontFamily: 'Consolas',
                                fontFamilyFallback: [
                                  'Cascadia Code',
                                  'monospace',
                                ],
                              ),
                            ),
                            if (args.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(left: 8),
                                child: Text(
                                  'args: $args',
                                  style: const TextStyle(
                                    color: TerminalPanelColors.textWhite,
                                    fontSize: 10,
                                    fontFamily: 'Consolas',
                                    fontFamilyFallback: [
                                      'Cascadia Code',
                                      'monospace',
                                    ],
                                  ),
                                ),
                              ),
                            if (result.isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(left: 8),
                                child: Text(
                                  'result: $result',
                                  style: const TextStyle(
                                    color: TerminalPanelColors.promptGreen,
                                    fontSize: 10,
                                    fontFamily: 'Consolas',
                                    fontFamilyFallback: [
                                      'Cascadia Code',
                                      'monospace',
                                    ],
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}

/// 压缩区段 — 展示上下文压缩信息
class CompactSectionWidget extends StatelessWidget {
  final Map<String, dynamic> data;

  const CompactSectionWidget({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final strategy = data['strategy'] as String? ?? '';
    final isAuto = data['is_auto'] as bool? ?? true;
    final preTokens = data['pre_compact_tokens'] as int? ?? 0;
    final postTokens = data['post_compact_tokens'] as int? ?? 0;
    final preMsgCount = data['pre_compact_message_count'] as int? ?? 0;
    final postMsgCount = data['post_compact_message_count'] as int? ?? 0;
    final reduction = preTokens > 0
        ? ((1 - postTokens / preTokens) * 100).toStringAsFixed(0)
        : '0';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(4),
        border: Border(
          left: const BorderSide(color: TerminalPanelColors.compactOrange, width: 3),
          top: BorderSide(
            color: TerminalPanelColors.compactOrange.withValues(alpha: 0.3),
          ),
          right: BorderSide(
            color: TerminalPanelColors.compactOrange.withValues(alpha: 0.3),
          ),
          bottom: BorderSide(
            color: TerminalPanelColors.compactOrange.withValues(alpha: 0.3),
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '[COMPACT] $strategy (${isAuto ? 'auto' : 'manual'})',
            style: const TextStyle(
              color: TerminalPanelColors.compactOrange,
              fontSize: 11,
              fontWeight: FontWeight.bold,
              fontFamily: 'Consolas',
              fontFamilyFallback: ['Cascadia Code', 'monospace'],
            ),
          ),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(
                    children: [
                      const TextSpan(
                        text: 'tokens: ',
                        style: TextStyle(
                          color: TerminalPanelColors.jsonKey,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['Cascadia Code', 'monospace'],
                        ),
                      ),
                      TextSpan(
                        text: '$preTokens',
                        style: const TextStyle(
                          color: TerminalPanelColors.jsonNumber,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['Cascadia Code', 'monospace'],
                        ),
                      ),
                      const TextSpan(
                        text: ' → ',
                        style: TextStyle(
                          color: TerminalPanelColors.textWhite,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['Cascadia Code', 'monospace'],
                        ),
                      ),
                      TextSpan(
                        text: '$postTokens',
                        style: const TextStyle(
                          color: TerminalPanelColors.jsonNumber,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['Cascadia Code', 'monospace'],
                        ),
                      ),
                      TextSpan(
                        text: ' ($reduction% reduction)',
                        style: const TextStyle(
                          color: TerminalPanelColors.timestamp,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['Cascadia Code', 'monospace'],
                        ),
                      ),
                    ],
                  ),
                ),
                Text.rich(
                  TextSpan(
                    children: [
                      const TextSpan(
                        text: 'messages: ',
                        style: TextStyle(
                          color: TerminalPanelColors.jsonKey,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['Cascadia Code', 'monospace'],
                        ),
                      ),
                      TextSpan(
                        text: '$preMsgCount',
                        style: const TextStyle(
                          color: TerminalPanelColors.jsonNumber,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['Cascadia Code', 'monospace'],
                        ),
                      ),
                      const TextSpan(
                        text: ' → ',
                        style: TextStyle(
                          color: TerminalPanelColors.textWhite,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['Cascadia Code', 'monospace'],
                        ),
                      ),
                      TextSpan(
                        text: '$postMsgCount',
                        style: const TextStyle(
                          color: TerminalPanelColors.jsonNumber,
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
          ),
        ],
      ),
    );
  }
}

/// 会话笔记区段 — 展示会话记忆初始化信息
class SessionNotesSectionWidget extends StatelessWidget {
  final Map<String, dynamic> data;

  const SessionNotesSectionWidget({super.key, required this.data});

  @override
  Widget build(BuildContext context) {
    final messageCount = data['message_count'] as int? ?? 0;
    final notesPath = data['notes_path'] as String? ?? '';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(4),
        border: Border(
          left: const BorderSide(color: TerminalPanelColors.sessionNotesBlue, width: 3),
          top: BorderSide(
            color: TerminalPanelColors.sessionNotesBlue.withValues(alpha: 0.3),
          ),
          right: BorderSide(
            color: TerminalPanelColors.sessionNotesBlue.withValues(alpha: 0.3),
          ),
          bottom: BorderSide(
            color: TerminalPanelColors.sessionNotesBlue.withValues(alpha: 0.3),
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '[SESSION_NOTES] Initialized',
            style: TextStyle(
              color: TerminalPanelColors.sessionNotesBlue,
              fontSize: 11,
              fontWeight: FontWeight.bold,
              fontFamily: 'Consolas',
              fontFamilyFallback: ['Cascadia Code', 'monospace'],
            ),
          ),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(
                    children: [
                      const TextSpan(
                        text: 'threshold: ',
                        style: TextStyle(
                          color: TerminalPanelColors.jsonKey,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['Cascadia Code', 'monospace'],
                        ),
                      ),
                      TextSpan(
                        text: '$messageCount',
                        style: const TextStyle(
                          color: TerminalPanelColors.jsonNumber,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['Cascadia Code', 'monospace'],
                        ),
                      ),
                      const TextSpan(
                        text: ' messages reached',
                        style: TextStyle(
                          color: TerminalPanelColors.textWhite,
                          fontSize: 11,
                          fontFamily: 'Consolas',
                          fontFamilyFallback: ['Cascadia Code', 'monospace'],
                        ),
                      ),
                    ],
                  ),
                ),
                if (notesPath.isNotEmpty)
                  Text.rich(
                    TextSpan(
                      children: [
                        const TextSpan(
                          text: 'path: ',
                          style: TextStyle(
                            color: TerminalPanelColors.jsonKey,
                            fontSize: 11,
                            fontFamily: 'Consolas',
                            fontFamilyFallback: ['Cascadia Code', 'monospace'],
                          ),
                        ),
                        TextSpan(
                          text: notesPath,
                          style: const TextStyle(
                            color: TerminalPanelColors.jsonString,
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
          ),
        ],
      ),
    );
  }
}

/// Token 用量区段 — 展示 prompt/completion/total token 统计
class UsageSectionWidget extends StatelessWidget {
  final TokenUsage? tokenUsage;

  const UsageSectionWidget({super.key, required this.tokenUsage});

  @override
  Widget build(BuildContext context) {
    final usage = tokenUsage;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: TerminalPanelColors.usageGreen.withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '[USAGE]',
            style: TextStyle(
              color: TerminalPanelColors.usageGreen,
              fontSize: 11,
              fontWeight: FontWeight.bold,
              fontFamily: 'Consolas',
              fontFamilyFallback: ['Cascadia Code', 'monospace'],
            ),
          ),
          const SizedBox(height: 4),
          if (usage == null)
            const Text(
              '(waiting for usage...)',
              style: TextStyle(
                color: TerminalPanelColors.timestamp,
                fontSize: 11,
                fontFamily: 'Consolas',
                fontFamilyFallback: ['Cascadia Code', 'monospace'],
                fontStyle: FontStyle.italic,
              ),
            )
          else
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildUsageLine('prompt_tokens', usage.promptTokens),
                _buildUsageLine(
                  'completion_tokens',
                  usage.completionTokens,
                ),
                _buildUsageLine(
                  'total_tokens',
                  usage.promptTokens + usage.completionTokens,
                ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _buildUsageLine(String label, int value) {
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: '$label: ',
            style: const TextStyle(color: TerminalPanelColors.jsonKey),
          ),
          TextSpan(
            text: '$value',
            style: const TextStyle(color: TerminalPanelColors.jsonNumber),
          ),
        ],
        style: const TextStyle(
          fontSize: 11,
          fontFamily: 'Consolas',
          fontFamilyFallback: ['Cascadia Code', 'monospace'],
          height: 1.4,
        ),
      ),
    );
  }
}

/// 子代理活动列表 — 展示记忆/压缩/整固的运行记录
class SubAgentActivitiesWidget extends StatelessWidget {
  final List<Map<String, dynamic>> activities;

  const SubAgentActivitiesWidget({super.key, required this.activities});

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxHeight: 150),
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: TerminalPanelColors.border),
      ),
      child: ListView.builder(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: activities.length,
        itemBuilder: (context, index) {
          final a = activities[index];
          final type = a['activity_type'] as String? ?? '';
          final triggerType = a['trigger_type'] as String? ?? '--';
          final tokensBefore = a['tokens_before'];
          final tokensAfter = a['tokens_after'];
          final success = a['success'] as bool? ?? true;

          final label = switch (type) {
            'session_memory' => '会话记忆',
            'compact' => '对话压缩',
            'dream' => '梦境整固',
            _ => type,
          };
          final color = switch (type) {
            'session_memory' => TerminalPanelColors.sessionNotesBlue,
            'compact' => TerminalPanelColors.compactOrange,
            'dream' => TerminalPanelColors.dreamCyan,
            _ => TerminalPanelColors.textWhite,
          };

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
            child: Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: success ? color : TerminalPanelColors.errorRed,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  label,
                  style: TextStyle(
                    color: color,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '[$triggerType]',
                  style: const TextStyle(
                    color: TerminalPanelColors.timestamp,
                    fontSize: 11,
                  ),
                ),
                if (tokensBefore != null && tokensAfter != null) ...[
                  const SizedBox(width: 8),
                  Text(
                    '$tokensBefore→$tokensAfter tokens',
                    style: const TextStyle(
                      color: TerminalPanelColors.timestamp,
                      fontSize: 11,
                    ),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}
