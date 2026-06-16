/// AI 请求错误分类模型
///
/// 定义错误类别枚举和结构化错误信息类，供适配器层将网络异常和 HTTP 错误
/// 转换为 UI 可消费的分类信息，实现差异化提示（如超时提示重试、余额不足提示充值）。
library;

/// AI 请求错误分类
///
/// 每个类别对应不同的用户提示策略：
/// - timeout: 提示检查网络后重试
/// - network: 提示确认后端已启动
/// - auth: 提示检查 API Key 配置
/// - balance: 提示前往充值页面
/// - param: 提示检查请求参数
/// - rateLimit: 提示稍后重试
/// - server: 提示等待后重试
/// - unknown: 显示原始错误信息
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
  /// 错误类别，决定 UI 展示策略
  final ErrorCategory category;

  /// 错误码（可选，来自后端或 API 供应商）
  final String? errorCode;

  /// 面向用户的错误描述
  final String message;

  /// 修复建议（可选，如"请检查 API Key 配置"）
  final String? suggestion;

  const ErrorInfo({
    required this.category,
    this.errorCode,
    required this.message,
    this.suggestion,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ErrorInfo &&
          runtimeType == other.runtimeType &&
          category == other.category &&
          errorCode == other.errorCode &&
          message == other.message &&
          suggestion == other.suggestion;

  @override
  int get hashCode => Object.hash(
        category,
        errorCode,
        message,
        suggestion,
      );
}
