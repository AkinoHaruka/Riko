/// 聊天页面 — 应用核心交互入口
///
/// 负责分割面板布局管理、WebSocket 事件订阅、代理操作（压缩/记忆/梦境）。
/// 宽屏时自动切换为左右分栏（聊天 + 终端面板），窄屏时仅显示聊天区域。
library;

import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/di/chat_background_provider.dart';
import '../core/di/chat_provider.dart';
import '../core/di/providers.dart';
import '../core/di/settings_cache.dart';
import '../core/di/toast_provider.dart';
import '../core/theme/app_animations.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_radius.dart';
import '../core/theme/app_spacing.dart';
import '../data/models/chat_message.dart';
import 'chat/chat_column.dart';
import 'chat/chat_popup_menu.dart';
import 'chat/websocket_listener_mixin.dart';
import 'widgets/avatar/avatar_crop_page.dart';
import 'widgets/avatar/avatar_provider.dart';
import 'widgets/background/background_picker.dart';
import 'widgets/draggable_splitter.dart';
import 'widgets/dynamic_island/dynamic_island.dart';
import 'widgets/terminal_panel.dart';

/// 聊天页面 — 核心交互入口
class ChatPage extends ConsumerStatefulWidget {
  const ChatPage({super.key});

  @override
  ConsumerState<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends ConsumerState<ChatPage>
    with WidgetsBindingObserver, WebSocketListenerMixin<ChatPage> {
  bool _isSessionMemoryLoading = false;
  bool _isCompactLoading = false;
  bool _isDreamLoading = false;
  bool _isSearchVisible = false;
  int _scrollToBottomRequest = 0;

  /// 上一次键盘高度，用于检测软键盘弹出/收起
  double _lastViewInsetBottom = 0;

  /// ref.listen 注册标记，避免重复注册
  bool _listenersRegistered = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // 延迟到首帧后注册 ref.listen，因为 initState 中 ref 尚不可用
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _registerListeners();
    });
    Future.microtask(() async {
      // 初始化面板比例、设置缓存、代理会话
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
      // 初始化 WebSocket 监听
      initWebSocketListener();
    });
  }

  @override
  void onWebSocketActivity(Map<String, dynamic> activity, String eventType) {
    if (eventType == 'dream_activity') {
      setState(() => _isDreamLoading = false);
      final status = activity['status'] as String?;
      if (status == 'completed') {
        final sessionsReviewed = activity['sessionsReviewed'];
        ref
            .read(toastProvider.notifier)
            .show('梦境整理完成 (审查 $sessionsReviewed 个会话)');
      }
    }
  }

  /// 注册 ref.listen（设置变更同步、会话切换重置），仅执行一次
  void _registerListeners() {
    if (_listenersRegistered) return;
    _listenersRegistered = true;
    // 设置变更时同步更新代理参数
    ref.listen(settingsCacheProvider, (prev, next) {
      ref.read(chatNotifierProvider.notifier).updateAgentParams();
    });
    // 切换会话时无需重置滚动标记，ChatMessageList 内部管理
    ref.listen(activeConversationIdProvider, (prev, next) {});
  }

  @override
  void dispose() {
    disposeWebSocketListener();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// 监听窗口尺寸变化（如软键盘弹出），触发重建以调整布局
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

  /// 发送消息 — 处理 /compact 命令和普通消息发送
  Future<void> _sendMessage(String text) async {
    if (text.toLowerCase().startsWith('/compact')) {
      final parts = text.trim().split(' ');
      final customInstructions = parts.length > 1
          ? parts.sublist(1).join(' ')
          : null;
      await _manualCompact(customInstructions: customInstructions);
      return;
    }
    await ref.read(chatNotifierProvider.notifier).sendMessage(text);
    setState(() => _scrollToBottomRequest++);
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
    } catch (e) {
      debugPrint('[ChatPage] checkCompactStatus failed: $e');
    }
  }

  void _showTokenWarning() {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 5),
        content: Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: AppColors.warning),
            AppSpacing.hSM,
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

  /// 弹出菜单项选择处理：头像、搜索、背景、清空聊天记录
  void _onPopupSelected(String value) {
    switch (value) {
      case 'avatar':
        _pickAndCropAvatar();
      case 'remove_avatar':
        _removeAvatar();
      case 'search':
        setState(() => _isSearchVisible = true);
      case 'background':
        _showBackgroundPicker();
      case 'clear_all':
        _clearCurrentAgentHistory();
    }
  }

  /// 选择并裁剪头像图片，保存到本地
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
      PageRouteBuilder<Uint8List>(
        pageBuilder: (context, animation, secondaryAnimation) {
          return AvatarCropPage(imageBytes: bytes);
        },
        transitionsBuilder: AppAnimations.slideInFromBottom,
        transitionDuration: AppAnimations.page,
        reverseTransitionDuration: AppAnimations.normal,
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

  /// 清空当前代理的聊天记录，删除对话和监控记录后重建新对话
  Future<void> _clearCurrentAgentHistory() async {
    final agentType = ref.read(activeAgentTypeProvider);
    final agentTitle = _resolveTitle(agentType);
    final confirmed = await AppAnimations.showSpringDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.lgAll),
        title: Text(
          '清空 $agentTitle',
          style: const TextStyle(color: AppColors.error),
        ),
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

  /// 打开聊天背景选择对话框
  Future<void> _showBackgroundPicker() async {
    final conversationId = ref.read(activeConversationIdProvider);
    if (conversationId == null) return;
    final result = await AppAnimations.showSpringDialog<String>(
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
    // 监听当前活跃会话和代理类型
    final activeConversationId = ref.watch(activeConversationIdProvider);
    final activeAgentType = ref.watch(activeAgentTypeProvider);
    final chatState = ref.watch(chatNotifierProvider);
    final messagesAsync = activeConversationId != null
        ? ref.watch(conversationMessagesProvider(activeConversationId))
        : null;

    return LayoutBuilder(
      builder: (context, constraints) {
        // 宽高比 > 1.0 时启用左右分栏布局
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
                  subAgentActivities: subAgentActivities,
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

  /// 构建聊天区域 Scaffold：包含标题栏、消息列表、输入栏
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
          now.difference(chatState.lastDreamAt!).inMinutes / 60.0;
      dreamProgress = (hoursSince / chatState.dreamMinHours).clamp(0.0, 1.0);
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
          .map(
            (h) =>
                Color(int.tryParse(h.replaceFirst('#', '0xFF')) ?? 0xFF111111),
          )
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
                      icon: const FaIcon(
                        FontAwesomeIcons.chevronLeft,
                        color: AppColors.textPrimary,
                        size: 20,
                      ),
                      onPressed: () => context.pop(),
                    ),
                    Expanded(
                      child: Align(
                        alignment: Alignment.topCenter,
                        child: island,
                      ),
                    ),
                    ChatPopupMenuButton(onSelected: _onPopupSelected),
                  ],
                ),
              )
            else
              SizedBox(
                height: 56,
                child: Row(
                  children: [
                    IconButton(
                      icon: const FaIcon(
                        FontAwesomeIcons.chevronLeft,
                        color: AppColors.textPrimary,
                        size: 20,
                      ),
                      onPressed: () => context.pop(),
                    ),
                    Expanded(
                      child: Text(
                        _resolveTitle(activeAgentType),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    ChatPopupMenuButton(onSelected: _onPopupSelected),
                  ],
                ),
              ),
            Expanded(
              child: ChatColumn(
                chatState: chatState,
                messagesAsync: messagesAsync,
                activeConversationId: activeConversationId,
                isMainAgent: isMainAgent,
                isSearchVisible: _isSearchVisible,
                onCloseSearch: () => setState(() => _isSearchVisible = false),
                onSendMessage: _sendMessage,
                scrollToBottomRequest: _scrollToBottomRequest,
              ),
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
}
