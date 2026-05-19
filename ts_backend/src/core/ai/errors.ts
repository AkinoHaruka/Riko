/**
 * AI API 错误分类与映射。
 * 将 OpenAI SDK 抛出的错误按 HTTP 状态码映射为用户可读的中文提示。
 */
import type { OpenAIError } from 'openai';

export interface MappedApiError {
  statusCode: number;
  message: string;
}

export function mapApiError(error: unknown): MappedApiError {
  if (error && typeof error === 'object' && 'status' in error) {
    const openaiError = error as OpenAIError & { status?: number };
    const status = openaiError.status || 500;
    const message = openaiError.message || 'AI API 调用失败';

    switch (status) {
      case 400:
        return { statusCode: 400, message: '请求参数错误，请检查输入内容' };
      case 401:
        return { statusCode: 401, message: 'API Key 无效或已过期' };
      case 402:
        return { statusCode: 402, message: 'API 余额不足，请充值后重试' };
      case 403:
        return { statusCode: 403, message: '无权访问该 AI 资源' };
      case 408:
        return { statusCode: 408, message: 'AI 请求超时，请稍后重试' };
      case 422:
        return { statusCode: 422, message: '请求参数错误，请根据提示修改参数' };
      case 429:
        return { statusCode: 429, message: 'API 请求速率已达上限，请稍后重试' };
      case 500:
        return { statusCode: 500, message: 'AI 服务内部错误，请稍后重试' };
      case 503:
        return { statusCode: 503, message: 'AI 服务暂时不可用' };
      default:
        return { statusCode: status, message: `AI API 调用失败: ${message}` };
    }
  }

  return { statusCode: 500, message: 'AI API 调用失败' };
}
