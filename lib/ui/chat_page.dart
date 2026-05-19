import 'dart:async';
import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/di/chat_background_provider.dart';
import '../core/di/chat_provider.dart';
import '../core/di/chat_search_provider.dart';
import '../core/di/providers.dart';
import '../core/di/settings_cache.dart';
import '../core/di/toast_provider.dart';
import '../core/theme/app_animations.dart';
import '../core/theme/app_colors.dart';
import '../data/models/chat_message.dart';
import '../infrastructure/websocket_client.dart';
import 'widgets/draggable_splitter.dart';
import 'widgets/dynamic_island/dynamic_island.dart';
import 'widgets/avatar/avatar_crop_page.dart';
import 'widgets/avatar/avatar_provider.dart';
import 'widgets/background/background_picker.dart';
import 'widgets/message_bubble.dart';
import 'widgets/modern_input_bar.dart';
import 'widgets/search/chat_search_bar.dart';
import 'widgets/terminal_panel.dart';

/// 聊天页面 — 核心交互入口
///
/// 负责消息列表渲染、SSE 流式输出展示、子代理进度面板、分割面板布局管理、WebSocket 事件订阅。
class ChatPage extends ConsumerStatefulWidget {
  const ChatPage({super.key});

  @override
  ConsumerState<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends ConsumerState<ChatPage>
    with WidgetsBindingObserver {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  bool _hasInitialScrolled = false;
  double _temperature = 0.7;
  int _maxTokens = 384000;
  bool _isSessionMemoryLoading = false;
  bool _isCompactLoading = false;
  bool _isDreamLoading = false;
  bool _isSearchVisible = false;
  final List<Map<String, dynamic>> _subAgentActivities = [];
  StreamSubscription<WebSocketEvent>? _wsSub;
  double _lastViewInsetBottom = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Future.microtask(() async {
      await ref.read(panelRatioProvider.notifier).init();
      if (!mounted) return;
      await ref.read(settingsCacheInitProvider.future);
      if (!mounted) return;
      await ref.read(chatNotifierProvider.notifier).ensureAgentConversations();
      if (!mounted) return;
      ref.read(chatNotifierProvider.notifier).updateAgentParams();
      // 延迟到首帧之后，避免动画初始化期间的帧冲突
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          ref.read(chatNotifierProvider.notifier).fetchTokenStatus();
        }
      });
      if (!mounted) return;
      // connect() 由 webSocketClientProvider 在 initReady 后自动调用
      final wsClient = ref.read(webSocketClientProvider);
      _wsSub = wsClient.events.listen((event) {
        if (event.type == 'session_memory_activity' ||
            event.type == 'compact_activity' ||
            event.type == 'dream_activity') {
          final activity = Map<String, dynamic>.from(event.payload);
          activity['activity_type'] = switch (event.type) {
            'session_memory_activity' => 'session_memory',
            'compact_activity' => 'compact',
            'dream_activity' => 'dream',
            _ => event.type,
          };
          if (mounted) {
            setState(() {
              _subAgentActivities.insert(0, activity);
              if (_subAgentActivities.length > 20) {
                _subAgentActivities.removeLast();
              }
            });
            if (activity['trace'] != null && mounted) {
              ref
                  .read(chatNotifierProvider.notifier)
                  .addSubAgentActivityToHistory(activity);
              ref
                  .read(chatNotifierProvider.notifier)
                  .saveSubAgentOutputToConversation(activity);
            }
            if (event.type == 'dream_activity' && mounted) {
              setState(() => _isDreamLoading = false);

              final status = activity['status'] as String?;
              if (status == 'completed') {
                final sessionsReviewed = activity['sessionsReviewed'];
                ref.read(toastProvider.notifier).show(
                      '梦境整理完成 (审查 $sessionsReviewed 个会话)',
                    );
              }
            }
          }
        }
      });
    });
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  void didChangeMetrics() {
    super.didChangeMetrics();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final bottomInset = MediaQuery.of(context).viewInsets.bottom;
      if (bottomInset != _lastViewInsetBottom) {
        _lastViewInsetBottom = bottomInset;
        setState(() {});
      }
    });
  }

  /// 滚动消息列表到底部（新消息到达时调用）
  void _scrollToBottom() {
    if (_scrollController.hasClients) {
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: AppAnimations.normal,
        curve: AppAnimations.easeOutExpo,
      );
    }
  }

  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.toLowerCase().startsWith('/compact')) {
      _messageController.clear();
      final parts = text.trim().split(' ');
      final customInstructions =
          parts.length > 1 ? parts.sublist(1).join(' ') : null;
      await _manualCompact(customInstructions: customInstructions);
      return;
    }
    if (text.isEmpty) return;

    _messageController.clear();
    await ref.read(chatNotifierProvider.notifier).sendMessage(text);
    Future.delayed(const Duration(milliseconds: 100), _scrollToBottom);
    await _checkCompactStatus();
  }

  /// 手动触发上下文压缩，可选传入自定义指令
  Future<void> _manualCompact({String? customInstructions}) async {
    final conversationId = ref.read(activeConversationIdProvider);
    if (conversationId == null) return;

    setState(() => _isCompactLoading = true);
    try {
      final repo = ref.read(chatRepositoryProvider);
      await repo.compactConversation(
        conversationId: conversationId,
        model: ref.read(selectedModelProvider),
        customInstructions: customInstructions,
      );
      ref.invalidate(conversationMessagesProvider(conversationId));
      if (mounted) {
        ref.read(toastProvider.notifier).show('Conversation compacted');
      }
    } catch (e) {
      if (mounted) {
        ref.read(toastProvider.notifier).show('Compact failed: $e');
      }
    } finally {
      if (mounted) setState(() => _isCompactLoading = false);
    }
  }

  /// 触发会话记忆提取
  Future<void> _triggerSessionMemory() async {
    final conversationId = ref.read(activeConversationIdProvider);
    if (conversationId == null) return;

    setState(() => _isSessionMemoryLoading = true);
    try {
      final repo = ref.read(chatRepositoryProvider);
      final result = await repo.extractSessionMemory(conversationId);
      final success = result['success'] as bool? ?? false;
      if (mounted) {
        if (success) {
          ref.read(toastProvider.notifier).show('Session memory extracted');
        } else {
          final message = result['message'] as String? ?? 'Unknown error';
          ref.read(toastProvider.notifier).show('Extraction failed: $message');
        }
      }
    } catch (e) {
      if (mounted) {
        ref.read(toastProvider.notifier).show('Extraction failed: $e');
      }
    } finally {
      if (mounted) setState(() => _isSessionMemoryLoading = false);
    }
  }

  /// 触发后台梦境整固任务
  Future<void> _triggerDream() async {
    setState(() => _isDreamLoading = true);
    try {
      final repo = ref.read(chatRepositoryProvider);
      await repo.triggerDream();
      if (mounted) {
        ref.read(toastProvider.notifier).show('整固任务已启动');
        // _isDreamLoading 保持 true，等 dream_activity WebSocket 事件到达后再关闭
      }
    } catch (e) {
      if (mounted) {
        ref.read(toastProvider.notifier).show('整固启动失败: $e');
        setState(() => _isDreamLoading = false);
      }
    }
  }

  /// 检查当前对话的 Token 使用状态，超出警告阈值时弹窗提示压缩
  Future<void> _checkCompactStatus() async {
    final conversationId = ref.read(activeConversationIdProvider);
    if (conversationId == null) return;

    try {
      final repo = ref.read(chatRepositoryProvider);
      final status = await repo.getCompactStatus(
        conversationId: conversationId,
      );
      final warningState = status['warning_state'] as Map<String, dynamic>?;
      if (warningState != null && mounted) {
        final isAboveWarning =
            warningState['is_above_warning_threshold'] as bool? ?? false;
        if (isAboveWarning) {
          _showTokenWarning();
        }
      }
    } catch (_) {}
  }

  void _showTokenWarning() {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 5),
        content: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: Color(0xFFFFA500)),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Context nearing token limit. Use /compact to compress.',
              ),
            ),
          ],
        ),
        action: SnackBarAction(label: 'Compact', onPressed: _manualCompact),
      ),
    );
  }

  /// 根据代理类型返回中文标题
  String _resolveTitle(String agentType) {
    return switch (agentType) {
      'main' => '主代理',
      'memory' => '记忆提取',
      'compact' => '上下文压缩',
      'dream' => '梦境整理',
      _ => 'RIKO',
    };
  }

  Future<void> _pickAndCropAvatar() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      withData: true,
    );
    if (result == null || result.files.isEmpty) return;
    final bytes = result.files.first.bytes;
    if (bytes == null) return;

    if (!mounted) return;
    final cropped = await Navigator.push<Uint8List>(
      context,
      MaterialPageRoute(
        builder: (_) => AvatarCropPage(imageBytes: bytes),
      ),
    );
    if (cropped == null || !mounted) return;
    await saveAvatar(ref, cropped);
    if (mounted) {
      ref.read(toastProvider.notifier).show('头像已更新');
    }
  }

  Future<void> _removeAvatar() async {
    await removeAvatar(ref);
    if (mounted) {
      ref.read(toastProvider.notifier).show('头像已移除');
    }
  }

  Future<void> _clearCurrentAgentHistory() async {
    final agentType = ref.read(activeAgentTypeProvider);
    final agentTitle = _resolveTitle(agentType);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('清空 $agentTitle', style: const TextStyle(color: AppColors.error)),
        content: Text(
          '此操作将清空「$agentTitle」的所有消息，不可恢复。',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('确认', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      final convId = ref.read(activeConversationIdProvider);
      final chatRepo = ref.read(chatRepositoryProvider);
      if (convId != null) {
        try {
          await chatRepo.deleteConversation(convId);
        } on Exception catch (e) {
          debugPrint('清除对话失败 ($convId): $e');
        }
        try {
          await chatRepo.deleteMonitorRecordsByConversation(convId);
        } on Exception catch (e) {
          debugPrint('清除 monitor 记录失败 ($convId): $e');
        }
      }
      // 清理 SharedPreferences 中该 agent 的绑定，确保重建新对话
      final prefs = await SharedPreferences.getInstance();
      final key = 'agent_conv_$agentType';
      await prefs.remove(key);
      ref.read(chatNotifierProvider.notifier).resetAgents();
      // ensureAgentConversations 会在发现该 agent 缺少对话时自动创建新对话
      if (!mounted) return;
      await ref.read(chatNotifierProvider.notifier).ensureAgentConversations();
      if (mounted) {
        ref.read(toastProvider.notifier).show('$agentTitle已清空');
      }
    } on Exception catch (e) {
      if (mounted) {
        ref.read(toastProvider.notifier).show('清空失败: $e');
      }
    }
  }

  List<PopupMenuEntry<String>> _buildPopupMenuItems() {
    final hasAvatar = ref.watch(mainAgentAvatarProvider).valueOrNull != null;
    return [
      const PopupMenuItem(
        value: 'avatar',
        child: Row(
          children: [
            Icon(Icons.face, color: AppColors.textSecondary, size: 18),
            SizedBox(width: 10),
            Text('更换头像', style: TextStyle(color: AppColors.textPrimary, fontSize: 14)),
          ],
        ),
      ),
      if (hasAvatar)
        const PopupMenuItem(
          value: 'remove_avatar',
          child: Row(
            children: [
              Icon(Icons.face_retouching_off, color: AppColors.error, size: 18),
              SizedBox(width: 10),
              Text('移除头像', style: TextStyle(color: AppColors.error, fontSize: 14)),
            ],
          ),
        ),
      const PopupMenuDivider(),
      const PopupMenuItem(
        value: 'search',
        child: Row(
          children: [
            Icon(Icons.search, color: AppColors.textSecondary, size: 18),
            SizedBox(width: 10),
            Text('搜索消息', style: TextStyle(color: AppColors.textPrimary, fontSize: 14)),
          ],
        ),
      ),
      const PopupMenuDivider(),
      const PopupMenuItem(
        value: 'background',
        child: Row(
          children: [
            Icon(Icons.wallpaper, color: AppColors.textSecondary, size: 18),
            SizedBox(width: 10),
            Text('聊天背景', style: TextStyle(color: AppColors.textPrimary, fontSize: 14)),
          ],
        ),
      ),
      const PopupMenuDivider(),
      const PopupMenuItem(
        value: 'clear_all',
        child: Row(
          children: [
            Icon(Icons.delete_sweep, color: AppColors.error, size: 18),
            SizedBox(width: 10),
            Text('清空聊天记录', style: TextStyle(color: AppColors.error, fontSize: 14)),
          ],
        ),
      ),
    ];
  }

  void _showSearchBar() {
    setState(() => _isSearchVisible = true);
  }

  Future<void> _showBackgroundPicker() async {
    final conversationId = ref.read(activeConversationIdProvider);
    if (conversationId == null) return;
    final result = await showDialog<String>(
      context: context,
      builder: (context) => const BackgroundPicker(),
    );
    if (result == null || !mounted) return;
    final repo = ref.read(chatRepositoryProvider);
    final background = result.isEmpty ? null : result;
    await repo.setConversationBackground(conversationId, background);
    ref.invalidate(conversationsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final activeConversationId = ref.watch(activeConversationIdProvider);
    final activeAgentType = ref.watch(activeAgentTypeProvider);
    final chatState = ref.watch(chatNotifierProvider);
    final messagesAsync = activeConversationId != null
        ? ref.watch(conversationMessagesProvider(activeConversationId))
        : null;

    ref.listen(settingsCacheProvider, (prev, next) {
      ref.read(chatNotifierProvider.notifier).updateAgentParams();
    });

    return LayoutBuilder(
      builder: (context, constraints) {
        final ratio =
            constraints.maxWidth /
            constraints.maxHeight.clamp(1, double.infinity);
        final showSplit = ratio > 1.0;

        if (showSplit) {
          final savedRatio = ref.watch(panelRatioProvider);
          final height = constraints.maxHeight;
          final width = constraints.maxWidth;

          final minRatio = (height * 0.5) / width;
          final maxRatio = 1.0 - minRatio;

          final defaultRatio = (height * 9.0 / 16.0) / width;
          var leftRatio = savedRatio;
          if (leftRatio < minRatio || leftRatio > maxRatio) {
            leftRatio = defaultRatio.clamp(minRatio, maxRatio);
          }

          return Row(
            children: [
              SizedBox(
                width: width * leftRatio,
                child: _buildChatScaffold(
                  chatState,
                  messagesAsync,
                  activeConversationId,
                  activeAgentType,
                ),
              ),
              DraggableSplitter(
                parentWidth: width,
                leftRatio: leftRatio,
                minRatio: minRatio,
                maxRatio: maxRatio,
                onRatioChanged: (newRatio) {
                  ref.read(panelRatioProvider.notifier).setRatio(newRatio);
                },
              ),
              Expanded(
                child: TerminalPanel(
                  inputHistory: chatState.apiInputHistory,
                  onClear: () => ref
                      .read(chatNotifierProvider.notifier)
                      .clearApiInputHistory(),
                  onLoadMore: () => ref
                      .read(chatNotifierProvider.notifier)
                      .loadMoreMonitorRecords(),
                  hasMoreData: chatState.hasMoreMonitorRecords,
                  onCompact: activeConversationId != null
                      ? () => _manualCompact()
                      : null,
                  isCompactEnabled: activeConversationId != null,
                  subAgentActivities: _subAgentActivities,
                  hasActiveConversation: activeConversationId != null,
                  isSessionMemoryLoading: _isSessionMemoryLoading,
                  isCompactLoading: _isCompactLoading,
                  isDreamLoading: _isDreamLoading,
                  onTriggerSessionMemory: activeConversationId != null
                      ? _triggerSessionMemory
                      : null,
                  onTriggerCompact: activeConversationId != null
                      ? () => _manualCompact()
                      : null,
                  onTriggerDream: _triggerDream,
                ),
              ),
            ],
          );
        }

        return _buildChatScaffold(
          chatState,
          messagesAsync,
          activeConversationId,
          activeAgentType,
        );
      },
    );
  }

  Widget _buildChatScaffold(
    ChatState chatState,
    AsyncValue<List<ChatMessage>>? messagesAsync,
    String? activeConversationId,
    String activeAgentType,
  ) {
    final isMainAgent = activeAgentType == 'main';

    // 计算子代理进度：取消息数进度与 Token 增长进度的较快者
    final now = DateTime.now();
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
          ? (tokenGrowth / chatState.memoryMinTokensBetweenUpdate).clamp(0.0, 1.0)
          : 0.0;
      // 取较快的阈值作为实际进度
      memoryProgress = msgProgress > tokenProgress ? msgProgress : tokenProgress;
    }
    if (chatState.compactTriggerTokens > 0) {
      compactProgress =
          (chatState.tokenCount / chatState.compactTriggerTokens).clamp(0.0, 1.0);
    }
    if (chatState.lastDreamAt != null && chatState.dreamMinHours > 0) {
      final hoursSince =
          now.difference(chatState.lastDreamAt!).inMinutes / 60.0;
      dreamProgress =
          (hoursSince / chatState.dreamMinHours).clamp(0.0, 1.0);
    }

    final island = DynamicIsland(
      tokenCount: chatState.tokenCount,
      maxTokens: 1000000,
      memoryProgress: memoryProgress,
      compactProgress: compactProgress,
      dreamProgress: dreamProgress,
    );

    final background = ref.watch(activeConversationBackgroundProvider);
    BoxDecoration? bgBoxDecoration;
    Color? bgColor;
    if (background != null && background.startsWith('solid:')) {
      final hex = background.substring(6).replaceFirst('#', '0xFF');
      bgColor = Color(int.tryParse(hex) ?? 0xFF111111);
    } else if (background != null && background.startsWith('gradient:')) {
      final colors = background
          .substring(9)
          .split('|')
          .map((h) => Color(int.tryParse(h.replaceFirst('#', '0xFF')) ?? 0xFF111111))
          .toList();
      bgBoxDecoration = BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: colors,
        ),
      );
    }

    final scaffold = Scaffold(
      backgroundColor: bgColor ?? AppColors.bgPrimary,
      body: SafeArea(
        child: Column(
          children: [
            if (isMainAgent)
              Padding(
                padding: const EdgeInsets.only(top: 7),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    IconButton(
                      icon: const FaIcon(FontAwesomeIcons.chevronLeft, color: AppColors.textPrimary, size: 20),
                      onPressed: () => context.pop(),
                    ),
                    Expanded(
                      child: Align(
                        alignment: Alignment.topCenter,
                        child: island,
                      ),
                    ),
                    PopupMenuButton<String>(
                      icon: const FaIcon(FontAwesomeIcons.ellipsis, color: AppColors.textPrimary),
                      color: AppColors.surface,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      offset: const Offset(0, 40),
                      onSelected: (value) {
                        switch (value) {
                          case 'avatar':
                            _pickAndCropAvatar();
                          case 'remove_avatar':
                            _removeAvatar();
                          case 'search':
                            _showSearchBar();
                          case 'background':
                            _showBackgroundPicker();
                          case 'clear_all':
                            _clearCurrentAgentHistory();
                        }
                      },
                      itemBuilder: (context) => _buildPopupMenuItems(),
                    ),
                  ],
                ),
              )
            else
              SizedBox(
                height: 56,
                child: Row(
                  children: [
                    IconButton(
                      icon: const FaIcon(FontAwesomeIcons.chevronLeft, color: AppColors.textPrimary, size: 20),
                      onPressed: () => context.pop(),
                    ),
                    Expanded(
                      child: Text(
                        _resolveTitle(activeAgentType),
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: AppColors.textPrimary, fontSize: 17, fontWeight: FontWeight.w600),
                      ),
                    ),
                    PopupMenuButton<String>(
                      icon: const FaIcon(FontAwesomeIcons.ellipsis, color: AppColors.textPrimary),
                      color: AppColors.surface,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      offset: const Offset(0, 40),
                      onSelected: (value) {
                        switch (value) {
                          case 'avatar':
                            _pickAndCropAvatar();
                          case 'remove_avatar':
                            _removeAvatar();
                          case 'search':
                            _showSearchBar();
                          case 'background':
                            _showBackgroundPicker();
                          case 'clear_all':
                            _clearCurrentAgentHistory();
                        }
                      },
                      itemBuilder: (context) => _buildPopupMenuItems(),
                    ),
                  ],
                ),
              ),
            Expanded(
              child: _buildChatColumn(chatState, messagesAsync, activeConversationId, isMainAgent),
            ),
          ],
        ),
      ),
    );
    if (bgBoxDecoration != null) {
      return Container(decoration: bgBoxDecoration, child: scaffold);
    }
    return scaffold;
  }

  Widget _buildMessageList(
    AsyncValue<List<ChatMessage>>? messagesAsync,
    ChatState chatState,
  ) {
    if (messagesAsync?.hasValue == true &&
        chatState.pendingMessages.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          ref.read(chatNotifierProvider.notifier).clearPendingIfMatched();
        }
      });
    }

    return messagesAsync?.when(
          data: (messages) {
            if (messages.isEmpty &&
                chatState.pendingMessages.isEmpty &&
                !chatState.isLoading) {
              return const Center(
                child: Text(
                  'Send your first message to start',
                  style: TextStyle(color: AppColors.textSecondary),
                ),
              );
            }
            final allMessages = _mergeAndSort(messages, chatState);
            final items = _buildRenderItems(allMessages, chatState, ref);
            if (!_hasInitialScrolled && items.isNotEmpty) {
              _hasInitialScrolled = true;
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted) _scrollToBottom();
              });
            }
            return ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: items.length,
              itemBuilder: (context, index) => items[index].build(context),
            );
          },
          loading: () => const Center(
            child: CircularProgressIndicator(color: AppColors.success),
          ),
          error: (error, _) => Center(
            child: Text(
              'Failed to load messages: $error',
              style: const TextStyle(color: AppColors.error),
            ),
          ),
        ) ??
        const Center(
          child: CircularProgressIndicator(color: AppColors.success),
        );
  }

  /// 合并轮询消息和待处理消息（乐观 UI），去除重复 ID
  List<ChatMessage> _mergeAndSort(
    List<ChatMessage> polled,
    ChatState chatState,
  ) {
    final seen = <String>{};
    final result = <ChatMessage>[];

    for (final m in polled) {
      seen.add(m.id);
      result.add(m);
    }
    for (final p in chatState.pendingMessages) {
      if (seen.contains(p.id)) continue;
      result.add(p);
    }

    final sid = chatState.streamingAssistantMessageId;
    if (sid != null && !seen.contains(sid) && chatState.isLoading) {
      result.add(
        ChatMessage(
          id: sid,
          conversationId: polled.isNotEmpty ? polled.first.conversationId : '',
          role: 'assistant',
          content: '',
          reasoningContent: null,
          isCompactSummary: false,
          createdAt: DateTime.now(),
        ),
      );
    }

    result.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    return result;
  }

  /// 构建渲染项列表：插入时间分隔器、过滤系统消息、绑定流式内容
  List<_RenderItem> _buildRenderItems(
    List<ChatMessage> messages,
    ChatState chatState,
    WidgetRef ref,
  ) {
    final avatarBytes = ref.watch(mainAgentAvatarProvider).valueOrNull;
    final searchState = _isSearchVisible ? ref.watch(chatSearchProvider) : null;
    final searchMatchList = searchState?.hasMatches == true
        ? searchState!.matchIndices
        : <int>[];
    final searchMatchSet = searchMatchList.toSet();
    final currentSearchIndex = searchState?.currentMatchIndex;
    final searchQuery = searchState?.isActive == true ? searchState!.query : null;

    // 搜索激活时，只保留匹配消息及其前后各 2 条上下文
    List<ChatMessage> filteredMessages;
    Map<int, int> sourceIndexToFiltered; // source index -> filtered index
    if (searchQuery != null && searchMatchSet.isNotEmpty) {
      final keepIndices = <int>{};
      for (final mi in searchMatchSet) {
        for (int j = (mi - 2).clamp(0, messages.length - 1);
            j <= (mi + 2).clamp(0, messages.length - 1);
            j++) {
          keepIndices.add(j);
        }
      }
      filteredMessages = [];
      sourceIndexToFiltered = {};
      for (int i = 0; i < messages.length; i++) {
        if (keepIndices.contains(i)) {
          sourceIndexToFiltered[i] = filteredMessages.length;
          filteredMessages.add(messages[i]);
        }
      }
    } else {
      filteredMessages = messages;
      sourceIndexToFiltered = {};
      for (int i = 0; i < messages.length; i++) {
        sourceIndexToFiltered[i] = i;
      }
    }
    // source index → filtered index 反向映射
    final filteredIndexToSource = <int, int>{};
    for (final e in sourceIndexToFiltered.entries) {
      filteredIndexToSource[e.value] = e.key;
    }

    final items = <_RenderItem>[];
    DateTime? lastTime;

    for (int i = 0; i < filteredMessages.length; i++) {
      final message = filteredMessages[i];

      if (message.role == 'system') {
        final content = message.content;
        if (content.contains('<session-memory-update>')) {
          continue;
        }
      }
      if (message.role == 'system' &&
          message.compactMetadata != null &&
          message.compactMetadata!.contains('compact_boundary')) {
        continue;
      }
      if (message.isCompactSummary &&
          message.role == 'user' &&
          message.content.contains('此会话从之前的对话继续')) {
        continue;
      }

      if (lastTime == null ||
          message.createdAt.difference(lastTime).inMinutes > 5) {
        items.add(
          _RenderItem((_) => TimeSeparator(dateTime: message.createdAt)),
        );
      }
      lastTime = message.createdAt;

      final isStreamingTarget =
          message.id == chatState.streamingAssistantMessageId;
      final animateEntrance = !message.id.startsWith('-') && !isStreamingTarget;

      final isCompactBoundary =
          message.isCompactSummary &&
          i + 1 < filteredMessages.length &&
          !filteredMessages[i + 1].isCompactSummary;

      final sourceIdx = filteredIndexToSource[i] ?? -1;
      final isMatch = searchMatchSet.contains(sourceIdx);
      final isFocused = isMatch &&
          currentSearchIndex != null &&
          currentSearchIndex < searchMatchList.length &&
          searchMatchList[currentSearchIndex] == sourceIdx;

      // 段落拆分：AI 多段落回复（以空行分隔）拆成独立气泡+头像
      final isAssistant = message.role == 'assistant';
      final shouldSplit = isAssistant &&
          searchQuery == null &&
          !message.isCompactSummary;

      if (shouldSplit) {
        final rawContent = isStreamingTarget
            ? chatState.streamingContent
            : message.content;
        final normalized = rawContent.replaceAll('\r\n', '\n');

        // 包含代码块（```）的消息不拆分，避免破坏 markdown 结构导致渲染断言失败
        final hasCodeFence = normalized.contains('```');

        if (!hasCodeFence && normalized.contains('\n\n')) {
          final parts = normalized.split(RegExp(r'\n\n+'));
          while (parts.isNotEmpty && parts.last.isEmpty) {
            parts.removeLast();
          }
          if (parts.length >= 2) {
            final baseOnDelete =
                !message.id.startsWith('-') && !isStreamingTarget
                    ? () => ref
                        .read(chatNotifierProvider.notifier)
                        .deleteMessage(message.id)
                    : null;

            final streamingDone = !isStreamingTarget ||
                RegExp(r'\n\n+$').hasMatch(normalized);
            final doneCount = streamingDone ? parts.length : parts.length - 1;

            for (int p = 0; p < doneCount; p++) {
              final speakContent = parts[p].trimRight();
              items.add(_buildParagraphItem(
                role: message.role,
                content: speakContent,
                reasoningContent: p == 0
                    ? (isStreamingTarget
                        ? (chatState.streamingReasoningContent.isNotEmpty
                            ? chatState.streamingReasoningContent
                            : null)
                        : message.reasoningContent)
                    : null,
                isStreaming: false,
                animateEntrance: p == 0 && animateEntrance,
                createdAt: message.createdAt,
                onDelete: baseOnDelete,
                assistantAvatar: avatarBytes,
                searchQuery: isMatch ? searchQuery : null,
                isSearchMatch: isFocused,
              ));
            }

            if (!streamingDone) {
              items.add(_buildParagraphItem(
                role: message.role,
                content: parts.last.trimRight(),
                reasoningContent: null,
                isStreaming: true,
                animateEntrance: false,
                createdAt: message.createdAt,
                onDelete: null,
                assistantAvatar: avatarBytes,
                searchQuery: isMatch ? searchQuery : null,
                isSearchMatch: isFocused,
                key: const ValueKey('__streaming_target__'),
              ));
            }
            continue;
          }
        }
      }

      items.add(
        _RenderItem(
          (_) => RepaintBoundary(
            child: MessageBubble(
              key: isStreamingTarget
                  ? const ValueKey('__streaming_target__')
                  : null,
              role: message.role,
              content: (isStreamingTarget
                  ? chatState.streamingContent
                  : message.content).trimRight(),
              reasoningContent: isStreamingTarget
                  ? (chatState.streamingReasoningContent.isNotEmpty
                        ? chatState.streamingReasoningContent
                        : null)
                  : message.reasoningContent,
              createdAt: message.createdAt,
              animateEntrance: animateEntrance,
              isStreaming: isStreamingTarget,
              isCompactSummary: message.isCompactSummary,
              isCompactBoundary: isCompactBoundary,
              assistantAvatar: avatarBytes,
              searchQuery: isMatch ? searchQuery : null,
              isSearchMatch: isFocused,
              onDelete: !message.id.startsWith('-') && !isStreamingTarget
                  ? () => ref
                        .read(chatNotifierProvider.notifier)
                        .deleteMessage(message.id)
                  : null,
            ),
          ),
        ),
      );
    }

    return items;
  }

  /// 构建单一段落气泡，用于多段落 AI 回复拆分
  _RenderItem _buildParagraphItem({
    required String role,
    required String content,
    required String? reasoningContent,
    required bool isStreaming,
    required bool animateEntrance,
    required DateTime createdAt,
    required VoidCallback? onDelete,
    required Uint8List? assistantAvatar,
    required String? searchQuery,
    required bool isSearchMatch,
    Key? key,
  }) {
    return _RenderItem(
      (_) => RepaintBoundary(
        child: MessageBubble(
          key: key,
          role: role,
          content: content,
          reasoningContent: reasoningContent,
          isStreaming: isStreaming,
          animateEntrance: animateEntrance,
          createdAt: createdAt,
          onDelete: onDelete,
          isCompactSummary: false,
          isCompactBoundary: false,
          assistantAvatar: assistantAvatar,
          searchQuery: searchQuery,
          isSearchMatch: isSearchMatch,
        ),
      ),
    );
  }

  Widget _buildChatColumn(
    ChatState chatState,
    AsyncValue<List<ChatMessage>>? messagesAsync,
    String? activeConversationId,
    bool isMainAgent,
  ) {
    return Column(
      children: [
        if (chatState.error != null)
          Container(
            width: double.infinity,
            color: AppColors.errorBg,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                const Icon(
                  Icons.error_outline,
                  color: AppColors.error,
                  size: 18,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    chatState.error!,
                    style: const TextStyle(
                      color: AppColors.error,
                      fontSize: 13,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(
                    Icons.close,
                    color: AppColors.error,
                    size: 18,
                  ),
                  onPressed: () =>
                      ref.read(chatNotifierProvider.notifier).clearError(),
                ),
              ],
            ),
          ),
        if (_isSearchVisible)
          ChatSearchBar(
            onClose: () => setState(() => _isSearchVisible = false),
            onSearchChanged: (q) {
              final messages = messagesAsync?.valueOrNull ?? [];
              final contents = messages.map((m) => m.content).toList();
              ref.read(chatSearchProvider.notifier).setQuery(q, contents);
            },
          ),
        Expanded(
          child: activeConversationId == null
              ? const SizedBox.shrink()
              : _buildMessageList(messagesAsync, chatState),
        ),
        if (isMainAgent)
          ModernInputBar(
            controller: _messageController,
            isLoading: chatState.isLoading,
            onSend: _sendMessage,
            temperature: _temperature,
            maxTokens: _maxTokens,
            onTemperatureChanged: (v) => setState(() => _temperature = v),
            onMaxTokensChanged: (v) => setState(() => _maxTokens = v),
          )
        else
          SafeArea(
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: const BoxDecoration(
                color: AppColors.bgSecondary,
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: const Text(
                '仅显示输出内容',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textTertiary, fontSize: 13),
              ),
            ),
          ),
        ],
      );
    }
  }

/// 渲染项 — 消息列表中的单条内容（消息气泡或时间分隔符），按需构建
class _RenderItem {
  final Widget Function(BuildContext) build;
  _RenderItem(this.build);
}
