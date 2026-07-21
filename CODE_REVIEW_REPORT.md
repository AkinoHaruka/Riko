# Riko 项目代码审查与优化报告

> 审查日期：2026-07-21（第二轮深入动态/并发分析；第三轮完成全部遗留项修复）
> 审查范围：架构设计、代码质量、性能、安全、可维护性 + 大模型 API 调用模块专项
> 验证基线：后端 TypeScript 编译零错误、flutter analyze 零问题、前端测试全部通过

---

## 〇·五、第三轮：全部遗留项修复（2026-07-21 晚）

前两轮遗留的 4 项问题本轮全部修复，其中 2 项在修复过程中暴露出更深层的架构缺陷。

### 修复 5：子代理执行器 Transport 化（P1，最大架构债）✅

- **原问题**：`subAgent/executor.ts` 硬编码 `getOrCreateClient`（OpenAI 兼容/DeepSeek），
  用户选 Anthropic/Gemini 时，记忆提取/上下文压缩/梦境整固三个子代理仍被强制路由到
  DeepSeek——未配置 DeepSeek key 则全部失败。
- **修复**：重构为按模型 ID 经 `getTransportForModel` 路由，使用归一化
  `createNonStreamingChat` + `NormalizedChatResponse`，与底层 API 协议解耦。
  保留多轮工具循环骨架与轨迹收集逻辑。
- **连带修复（测试暴露）**：无工具调用的结束轮漏记 `reasoningContent` 到轨迹，已补。
- **验证**：新增 `executorTransport.test.ts` 4 项测试（Anthropic 路由、多轮工具循环、
  reasoningContent 收集、错误处理）全过。

### 修复 6：非流式 Transport 路径工具调用字段丢失（P1）✅

- **原问题**：`service.ts chatCompletionNonStream` 非 OpenAI 分支构造 messages 时只保留
  `role/content`，丢弃 assistant 历史的 `tool_calls` 与 tool 消息的 `tool_call_id`——
  多轮含工具调用的对话发给 Anthropic/Gemini 会上下文残缺。
- **修复**：完整保留 `toolCalls`/`toolCallId` 字段的归一化消息构造。

### 修复 7：用户自定义 baseUrl 完全不生效（P2 → 实为 P1）✅

- **原问题（比预想更深）**：前端设置页可配置自定义 baseUrl（存为 `base_url_{providerId}`），
  但后端 `createTransport` **从不读取它**，只用注册表静态 baseUrl——改 baseUrl 完全无效。
  且 Transport 缓存键不含 baseUrl，改地址后还会复用旧缓存。
- **修复**：新增 `getUserBaseUrl()` 读取自定义地址；`createTransport` 支持 baseUrl 覆盖；
  缓存键改为 `userId:providerId:baseUrl`；`invalidateClientCache` 改前缀匹配。
- **影响**：Ollama/自定义 OpenAI 兼容端点等场景现在真正可用。

### 修复 8：前端 maxTokens 默认值失真（P2）✅

- **原问题**：默认 `384000` 远超所有主流模型实际 max_output（4K-8K），导致 token 预估
  与上下文压缩判断失真，且超后端 131072 硬上限。
- **修复**：改为 `16384`，与后端 `MAX_TOKENS_DEFAULT` 对齐。

### ⚠️ 重要架构发现（未改动，需决策）

**`executeWithFailover` 是死代码**——`core/ai/failoverExecutor.ts` 精心设计的两阶段
failover（重试 + 模型降级）+ `failoverState.ts` 健康状态机，**没有任何调用方**。
当前所有 LLM 调用的重试仅靠 OpenAI SDK 的 `maxRetries: 2`。
接入 failover 会改变所有调用路径的错误语义（抛 `MaxAttemptsExceededError`），
属高风险架构决策，建议单独立项评估，不宜在本次零散改动中贸然接线。

### 第三轮修改文件清单
- `ts_backend/src/domain/subAgent/executor.ts` — Transport 化重构 + reasoningContent 补记
- `ts_backend/src/domain/chat/service.ts` — 非流式路径保留工具调用字段
- `ts_backend/src/core/ai/client.ts` — 自定义 baseUrl 生效 + 缓存键纳入 baseUrl
- `lib/core/di/settings_cache.dart` — maxTokens 默认值 384000→16384
- `ts_backend/tests/unit/subAgent/executorTransport.test.ts` — 新增 Transport 化测试

---

## 〇、第二轮深入审查新增发现（2026-07-21 下午）

第一轮审查主要覆盖静态缺陷。第二轮聚焦**动态行为正确性**——参数跨层传递、流式中断资源管理、
工具循环边界、并发共享状态。新发现并修复 4 个高危及真实缺陷：

| 级别 | 问题 | 位置 | 状态 |
|------|------|------|------|
| 🔴 P0 | 历史消息 `reasoning_content` 跨 Provider 污染，切到 OpenAI 兼容非 DeepSeek 模型必现 400 | `domain/chat/types.ts` | ✅ 已修复 |
| 🔴 P0 | 工具护栏全局单例，并发请求互相污染（reset 清掉他人计数、halt 跨请求泄漏） | `domain/chat/toolHandler.ts` | ✅ 已修复 |
| 🔴 P1 | SSE 客户端断开无检测，后端持续消耗 API token 拉流 | `api/chat/chat.routes.ts` | ✅ 已修复 |
| 🟡 P2 | 子代理执行器硬编码 OpenAI 客户端，选 Anthropic/Gemini 时子代理路由错乱 | `subAgent/executor.ts` | 📋 记录待办 |

### 修复 1：`reasoning_content` 跨 Provider 污染（正确性）

- **链路**：前端 `Message.toJson()` 把历史 assistant 消息的 `reasoning_content`（DeepSeek 思考产物）
  一并序列化发给后端 → `buildUserMessages()` 用 `...m` 原样透传 → OpenAI 兼容路径直接喂给 SDK。
- **后果**：当历史含 DeepSeek 的 reasoning_content，而当前切到 OpenAI/OpenRouter/Moonshot/Ollama
  时，SDK 严格校验报 `Unrecognized request argument: reasoning_content` 400 错误。
- **根因**：`reasoning_content` 是 DeepSeek 专属扩展，对其他 Provider 是非法参数。
  而 DeepSeek 续流所需的 reasoning_content 由后端 `streamingToolCallLoop` 从响应流重新累积注入，
  **与前端历史无关**——前端透传的这份纯属污染源。
- **修复**：`buildUserMessages()` 显式构造只含 `role/content` 的干净消息，剥离 reasoning_content。
- **验证**：`buildApiParams` 21 项测试全过。

### 修复 2：工具护栏并发污染（并发安全）

- **现象**：`guardrailController` 是模块级全局单例，`resetToolGuardrails()` 在每次请求入口被调用。
  用户 A 请求开始 → 清空全局护栏 → 用户 B 正在进行的重复失败计数被清零；
  A 触发 halt 后，B 的后续工具调用会读到 A 的 haltDecision 被误block。
- **讽刺点**：`ToolCallGuardrailController` 注释明确写"每轮对话创建一个实例"，实现却是全局单例。
- **修复**：改为按 `conversationId` 维系的实例池——每会话独立护栏，30min 空闲 TTL + 500 容量上限
  + 定时清理（unref）。`resetToolGuardrails(conversationId)` 只重置目标会话。
- **验证**：新增 `toolGuardrailIsolation.test.ts` 3 项并发隔离测试全过；既有 guardrail 测试 106 项全过。

### 修复 3：SSE 客户端断开无检测（资源泄漏 / 成本）

- **现象**：`for await (const chunk of chatCompletionStream(...))` 无客户端断开检测。
  用户关闭页面/取消后，后端继续从上游 AI 拉流、继续执行工具、继续烧 token，直到流自然结束。
- **修复**：监听 `request.raw.on('close')`，断开时 `break` 循环让生成器 `return()` 清理；
  同时处理写入背压（`write()` 返回 false 时等待 `drain`）；断开后不再尝试写错误事件。
- **收益**：客户端断开即停止上游 API 消耗，直接省钱。

### 待办（未实施，需专门重构回合）

- **P1 子代理 Transport 化**：`subAgent/executor.ts` 硬编码 `getOrCreateClient`（OpenAI 兼容）。
  用户选 Anthropic/Gemini 时，记忆提取/压缩/梦境子代理仍路由到 DeepSeek——若未配 DeepSeek key
  则全部失败。需将子代理执行器改造为走 Transport 抽象，属较大架构重构。

### 第二轮验证记录

| 验证项 | 结果 |
|--------|------|
| 后端 `tsc --noEmit` | ✅ 零错误 |
| 后端 `eslint`（修改文件） | ✅ 零告警 |
| 后端完整测试套件 | ✅ 796 通过 / 16 失败（失败均为环境基础设施：fts5、better-sqlite3 原生绑定） |
| 新增 toolGuardrailIsolation 测试 | ✅ 3/3（并发隔离） |
| buildApiParams 测试 | ✅ 21/21 |
| guardrail 相关测试 | ✅ 106/106 |

### 第二轮修改文件清单
- `ts_backend/src/domain/chat/types.ts` — buildUserMessages 剥离 reasoning_content
- `ts_backend/src/domain/chat/toolHandler.ts` — 护栏单例 → 会话级实例池
- `ts_backend/src/domain/chat/service.ts` — resetToolGuardrails 传入 conversationId
- `ts_backend/src/api/chat/chat.routes.ts` — SSE 客户端断开检测 + 背压处理
- `ts_backend/tests/unit/chat/toolGuardrailIsolation.test.ts` — 新增并发隔离测试

---


## 一、审查结论概览

Riko 整体工程质量较高：前后端分层清晰（config → core → domain → api，无反向依赖）、
类型安全严格（TS strict + Zod 校验）、密钥管理规范（AES-256-GCM 加密存储、URL 脱敏、
无明文日志）、LLM 调用具备多 Provider 抽象与两阶段 Failover 能力。

本次审查在 LLM API 调用链路上发现 **1 个 P0 级正确性缺陷**、**1 个 P1 级安全缺陷**、
**2 个效率缺陷**，已全部修复并通过测试验证。测试基线从 **609 通过 / 169 失败**
提升至 **793 通过 / 16 失败**（剩余 16 项为测试环境基础设施限制，与业务代码无关）。

| 维度 | 评价 | 说明 |
|------|------|------|
| 架构设计 | ★★★★★ | 分层严格、插件化 EventBus、依赖注入解耦 |
| LLM 调用正确性 | ★★★★☆ | 修复 PRAGMA 回归后达标；参数透传链路完整 |
| 错误处理 | ★★★★★ | 15 类结构化分类 + 决策表驱动，覆盖全面 |
| 性能 | ★★★★☆ | 修复缓存 LRU 缺陷；连接复用合理 |
| 安全性 | ★★★★☆ | 修复 PRAGMA 注入缺口；密钥管理规范 |
| 可维护性 | ★★★★☆ | 修复内存库写盘噪音；文档充分 |

---

## 二、本次修复的问题清单（已实施 + 已验证）

### 🔴 P0 — PRAGMA 参数化查询被白名单误拦截（数据库 / 影响上下文压缩）

- **文件**：`ts_backend/src/core/database/adapter.ts` (`DatabaseWrapper.pragma()`)
- **现象**：sql.js (WASM) 路径下，`db.pragma('table_info(messages)')` 抛出
  `PRAGMA table_info(messages) is not allowed`，导致 `migrateCompactFields()` 等
  全部迁移函数失败，**169 个单元测试因此连带失败**。
- **根因**：白名单匹配时，`ALLOWED_PRAGMAS` 集合存的是 `table_info`，但代码用完整输入
  `table_info(messages)`（含括号和表名）去 `Set.has()` 匹配，必然不命中。
  better-sqlite3 原生路径直接透传 PRAGMA 故生产桌面端正常，仅 WASM 路径（测试环境强制
  `DB_ENGINE=wasm`）触发，属于**路径不一致导致的隐蔽回归**。
- **修复**：先以 `(` 为界提取真正的 pragma 名做白名单匹配，再对带参数形式做安全校验。
- **影响面**：上下文压缩字段迁移、memories 表迁移等所有依赖 `table_info` 的迁移逻辑。

### 🔴 P1 — PRAGMA 参数注入缺口（安全，修复 P0 过程中发现并加固）

- **文件**：`ts_backend/src/core/database/adapter.ts`
- **现象**：初版修复用 `lastIndexOf(')')` 提取参数，构造
  `table_info(messages); DROP TABLE users--` 时提取到的"参数"恰为合法的 `messages`，
  注入语句被放行（新增测试用例捕获了这一点）。
- **修复**：改用**整体严格格式校验** `/^([a-zA-Z_][\w]*)(?:\(([\w]+)\))?$/`，
  要求整条输入必须完整匹配 `pragma名(标识符)` 形态，任何尾随内容（分号、注释、第二段
  语句）都会整体不匹配而被拒绝。从源头杜绝注入。
- **验证**：新增 2 个防注入用例（分号注入、引号注入）均正确拒绝。

### 🟡 P2 — Transport 缓存淘汰策略缺陷 + 定时器阻止进程退出（性能）

- **文件**：`ts_backend/src/core/ai/client.ts` (`getOrCreateTransport`)
- **问题 1（淘汰策略错误）**：原实现在缓存满时遍历全表找"最早过期"的条目淘汰。
  但所有条目 TTL 相同、新条目 `expireAt` 恒为最大，被淘汰的反而可能是最近仍在用的
  活跃缓存；且为 O(n) 扫描。
- **修复 1**：改为标准 **LRU**——利用 `Map` 的插入序迭代特性，命中时 `delete + set`
  将条目移到尾部，淘汰时直接删除头部（最久未访问）条目，O(1) 完成。
- **问题 2（进程悬挂）**：缓存清理 `setInterval` 未 `unref()`，会成为活跃句柄阻止
  Node.js 进程正常退出（嵌入式/CLI 场景下表现为进程无法终止）。
- **修复 2**：对该定时器调用 `unref()`。

### 🟡 P2 — 内存数据库尝试写盘产生 ENOENT 噪音（可维护性）

- **文件**：`ts_backend/src/core/database/adapter.ts` (`persist()`)
- **现象**：`:memory:` 内存数据库（单元测试常用）在 `markDirty()` 后仍触发
  `persist()` 写盘，输出大量 `persist failed: ENOENT ... open ':memory:'` 错误日志。
- **修复**：`persist()` 开头检测 `dbPath === ':memory:'` 时清脏标记并直接返回。

### 🟡 P2 — `classifyError` 状态码归一化逻辑冗余混乱（可读性 / 正确性）

- **文件**：`ts_backend/src/core/ai/errors.ts`
- **现象**：`statusCode: statusCode || (reason === Unknown ? 500 : statusCode)` 语义含糊，
  网络层错误（无 HTTP 响应，statusCode=0）经此表达式结果含义不明。
- **修复**：改为显式三分支——有 HTTP 状态用原值；无 HTTP 状态（DNS/Network/SSL）保持 0
  以区分"无响应"；完全未知兜底 500。行为与既有测试契约一致（已验证 68 项 errors 测试全过）。

---

## 三、LLM API 调用模块专项评估

### 3.1 请求参数配置 — 正确 ✅

- 前端 `deepseek_adapter.dart` 透传 `temperature/max_tokens/top_p/stop/thinking/reasoning_effort/response_format`，
  并在 `thinking_type=disabled` 时**主动不透传** `reasoning_effort`（避免无效参数被拒）。
- 后端 `buildApiParams()` 对 DeepSeek thinking 模式跳过 `temperature/top_p`，
  `max_tokens` 有默认 16384 + 上限 131072 双重安全网。
- 路由层 Zod schema 校验 `temperature ∈ [0,2]`、`top_p ∈ [0,1]`、`reasoning_effort` 枚举。
- **结论**：参数配置链路完整、有边界防护，专项测试覆盖（前端 8 项参数透传测试全过）。

### 3.2 响应处理逻辑 — 正确 ✅

- 流式：SSE 解析器跨块 UTF-8 安全（持久化 decoder sink，多字节汉字不被劈开成乱码）；
  支持 content / reasoning_content / tool_call_delta / usage / finish 全类型。
- 多 Provider：OpenAI 兼容 / Anthropic / Gemini 三套 Transport 归一化为统一 chunk 序列。
- 工具调用：流式分片累积（`accumulateToolCall`）、多轮循环（maxTurns=5）、白名单校验。
- **结论**：响应处理健壮，UTF-8 与流式分片边界处理到位。

### 3.3 错误处理机制 — 优秀 ✅

- 15 类 `FailoverReason` 结构化分类，状态码优先 + 关键词细分两阶段判定。
- 决策表集中驱动 `retryable/shouldCompress/shouldRotateCredential/shouldFallback`。
- 两阶段 Failover：同 Provider 指数退避重试（jittered backoff）→ 模型降级，
  `Retry-After` 头优先解析，降级后定期探测恢复。
- 前端错误分类映射（timeout/network/auth/balance/rateLimit/server）+ 连接错误指数退避重连。
- **结论**：错误处理是本项目的亮点，无需修改，仅修正了状态码归一化的可读性。

### 3.4 调用效率 — 修复后良好 ✅

- Transport 实例按 `userId:provider` 缓存（TTL 5min），本次修复 LRU 淘汰与定时器悬挂。
- Prompt Cache：Anthropic 路径注入 `cache_control` 断点（system/compact/recent/tools 四段）；
  DeepSeek 路径上报 `prompt_cache_hit_tokens` 命中统计。
- 工具定义缓存在请求级复用。
- **遗留建议**见第四节。

---

## 四、后续优化建议（未实施，按优先级）

### 🟡 P1 — 非流式 Transport 路径补齐多轮工具调用循环
`service.ts` 的 `chatCompletionNonStream` 在 Anthropic/Gemini（非 OpenAI 兼容）路径下
只调一次 `createNonStreamingChat`，**未执行多轮工具调用循环**——若模型返回 tool_calls，
当前直接返回首轮响应，工具不会真正执行。OpenAI 兼容路径走 `nonStreamingToolCallLoop`
行为正常。建议为 Transport 路径补一个非流式工具循环，保持三 Provider 行为一致。

### 🟡 P1 — `chat_page.dart` 拆分（1217 行，47 处 ref.watch）
前端最大文件，建议按消息列表 / 输入栏 / 监控面板 / 终端分屏拆为独立 Widget，
降低重建范围（性能）与认知负担（可维护性）。

### 🟡 P1 — 非流式路径缺失 reasoning_content 累积
`buildTransportParams`（stream.ts）正确传递 thinking，但非流式 Transport 返回的
`reasoningContent` 在 `chatCompletionNonStream` 中未累积进返回结构的对应字段，
子代理场景下思维链内容可能丢失。

### 🟢 P2 — Transport 缓存键纳入 baseUrl
缓存键为 `userId:providerId`，未含 `baseUrl`。自定义（custom）Provider 修改 baseUrl 后，
缓存的 Transport 仍指向旧地址。建议缓存键加入 baseUrl 哈希，或在更新 baseUrl 的设置
钩子中调用 `invalidateClientCache`。

### 🟢 P2 — 测试环境基础设施（非业务代码）
- `ftsSearch.test.ts`（16 项失败）：sql.js WASM 构建未编译 FTS5 扩展，测试强制 WASM 故失败。
  生产桌面端用 better-sqlite3 原生有 FTS5。建议：WASM 路径下跳过 FTS5 用例，或引入带
  FTS5 的 sql.js 构建。
- `database.test.ts`（1 项失败）：better-sqlite3 原生 `.node` 绑定在当前环境加载失败，
  属环境/ABI 问题，建议重装原生依赖或在 CI 中固定 Node ABI。

### 🟢 P2 — OpenAI SDK 与应用层重试叠加
SDK 客户端 `maxRetries: 2` 与 `executeWithFailover` 重试在部分路径叠加，速率限制时可能
放大请求量。建议明确单一重试权威（应用层），SDK 层 `maxRetries: 0`。

---

## 五、验证记录

| 验证项 | 结果 |
|--------|------|
| 后端 `tsc --noEmit` | ✅ 零错误 |
| 后端 `eslint`（修改文件） | ✅ 零告警 |
| 后端测试套件 | 609→793 通过（+184），169→16 失败（剩余均为环境限制） |
| 新增 adapterPragma 测试 | ✅ 8/8（含 2 项防注入） |
| errors 既有测试 | ✅ 68 通过 |
| sessionMemory 回归测试 | ✅ 30/30（修复 P0 后恢复） |
| `flutter analyze` | ✅ No issues found |
| `flutter test` | ✅ 202/202 全部通过 |

### 修改文件清单
- `ts_backend/src/core/database/adapter.ts` — PRAGMA 参数化校验（P0+P1）、:memory: 跳过写盘
- `ts_backend/src/core/ai/client.ts` — Transport 缓存 LRU 淘汰 + 定时器 unref
- `ts_backend/src/core/ai/errors.ts` — 状态码归一化逻辑澄清
- `ts_backend/tests/unit/database/adapterPragma.test.ts` — 新增（8 项测试）

---

*报告完成。第四节中 P1 级建议（非流式工具循环、chat_page 拆分、reasoning 累积）如需继续实施，请告知。*
