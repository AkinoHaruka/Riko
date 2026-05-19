/** DeepSeek AI 的配置：API Key 和 Base URL */
export const aiConfig = {
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  baseUrl: 'https://api.deepseek.com',
} as const;
