/**
 * AI 服务配置
 *
 * 支持多 Provider 配置。每个 Provider 的 API Key 通过环境变量注入，
 * 避免硬编码到代码中。baseUrl 默认指向各 Provider 官方 API 端点。
 *
 * 新增 Provider 只需在 providers/registry.ts 中添加定义，
 * 并在此处添加对应的环境变量即可。
 */
export const aiConfig = {
  /** DeepSeek API 密钥 */
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  /** DeepSeek API 基础地址 */
  deepseekBaseUrl: 'https://api.deepseek.com',

  /** OpenAI API 密钥 */
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  /** OpenAI API 基础地址 */
  openaiBaseUrl: 'https://api.openai.com/v1',

  /** Anthropic API 密钥 */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  /** Anthropic API 基础地址 */
  anthropicBaseUrl: 'https://api.anthropic.com',

  /** Google Gemini API 密钥 */
  geminiApiKey: process.env.GEMINI_API_KEY || '',

  /** OpenRouter API 密钥 */
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  /** OpenRouter API 基础地址 */
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',

  /** Moonshot API 密钥 */
  moonshotApiKey: process.env.MOONSHOT_API_KEY || '',
  /** Moonshot API 基础地址 */
  moonshotBaseUrl: 'https://api.moonshot.cn/v1',

  /** Ollama API 基础地址（本地部署，无需 API Key） */
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
} as const;
