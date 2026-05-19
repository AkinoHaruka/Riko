/// AI 请求错误分类
enum ErrorCategory {
  timeout,
  network,
  auth,
  balance,
  param,
  rateLimit,
  server,
  unknown,
}

/// 分类后的错误信息，供 UI 层差异化展示和用户提示
class ErrorInfo {
  final ErrorCategory category;
  final String? errorCode;
  final String message;
  final String? suggestion;

  const ErrorInfo({
    required this.category,
    this.errorCode,
    required this.message,
    this.suggestion,
  });
}
