import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// 输入栏状态 — 用于将 ModernInputBar 的本地状态暴露给 DynamicIsland
///
/// 字段说明：
/// - [isFocused]：输入栏是否获得焦点
/// - [textLength]：当前输入文本长度（用于判断长消息）
/// - [isLoading]：是否正在发送/等待 AI 响应
/// - [isWaitingReply]：消息已发出，正在等待首 token 回复
@immutable
class InputBarState {
  final bool isFocused;
  final int textLength;
  final bool isLoading;
  final bool isWaitingReply;

  const InputBarState({
    this.isFocused = false,
    this.textLength = 0,
    this.isLoading = false,
    this.isWaitingReply = false,
  });

  InputBarState copyWith({
    bool? isFocused,
    int? textLength,
    bool? isLoading,
    bool? isWaitingReply,
  }) {
    return InputBarState(
      isFocused: isFocused ?? this.isFocused,
      textLength: textLength ?? this.textLength,
      isLoading: isLoading ?? this.isLoading,
      isWaitingReply: isWaitingReply ?? this.isWaitingReply,
    );
  }

  /// 是否输入了长消息（超过 200 字符）
  bool get hasLongText => textLength > 200;
}

/// 输入栏状态管理器
class InputBarNotifier extends StateNotifier<InputBarState> {
  InputBarNotifier() : super(const InputBarState());

  void setFocused(bool value) {
    if (state.isFocused == value) return;
    state = state.copyWith(isFocused: value);
  }

  void setTextLength(int value) {
    if (state.textLength == value) return;
    state = state.copyWith(textLength: value);
  }

  void setLoading(bool value) {
    if (state.isLoading == value) return;
    state = state.copyWith(isLoading: value);
  }

  void setWaitingReply(bool value) {
    if (state.isWaitingReply == value) return;
    state = state.copyWith(isWaitingReply: value);
  }

  /// 重置为初始状态，用于切换会话时清理旧状态
  void reset() {
    state = const InputBarState();
  }
}

/// 输入栏状态 Provider
///
/// 由 [ModernInputBar] 写入，[DynamicIsland] 读取，避免跨层传参。
final inputBarStateProvider =
    StateNotifierProvider<InputBarNotifier, InputBarState>((ref) {
      return InputBarNotifier();
    });
