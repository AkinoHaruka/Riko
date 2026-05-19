# 工作流：提示词运行流程（v2）

本文档描述所有代理的提示词组装与运行流程，以及各模块之间的协作关系。

---

## 目录结构

```
data/
├── prompts/                          # 提示词目录（所有 .md 为唯一真相来源）
│   ├── main_prompt.md                # 主代理系统提示词（可自定义）
│   ├── tool_rules.md                 # 工具调用规则（function calling 机制）
│   ├── session_memory_prompt.md      # 会话记忆子代理专属提示词
│   ├── compact_prompt.md             # 压缩子代理专属提示词
│   ├── dream_prompt.md               # 梦境子代理专属提示词
│   └── workflow.md                   # 本文档
└── memories/                         # 记忆目录（运行时自动创建）
    ├── persistent_memory.md          # 常驻记忆（~1000字，每次对话注入 System Prompt）
    ├── auto_dream/                   # 长期记忆（梦境代理维护，存储不注入）
    │   ├── INDEX.md                  # 长期记忆索引
    │   ├── traits_roles/             # 特质与角色
    │   ├── interaction_rules/        # 互动规则
    │   ├── key_experiences/          # 重要经历
    │   └── promises_goals/           # 约定与目标
    └── session_memory/               # 会话笔记目录
        └── <conversation_id>/
            └── summary.md            # 10 章节笔记文件
```

---

## 一、主代理（Main Agent）

每次对话请求，提示词按**严格顺序**组装：

| 位置 | 来源 | 说明 |
|------|------|------|
| System | main_prompt.md | 主提示词：角色、行为准则 |
| System | tool_rules.md | 工具调用规则：function calling、并行策略 |
| System | persistent_memory.md | 常驻记忆：~1000字精简上下文，保证会话连续性。不含长期记忆详情 |
| User | compact 上下文 | `<compact-context>` 标签包裹的压缩摘要 |
| User | 未 compact 原始对话 | 最近尚未压缩的原始消息（含 session-memory-update） |

**组装代码**：`src/domain/chat/service.ts` → `buildSystemPrompt()` + `buildUserMessages()`

---

## 二、后采样钩子（Post-Sampling Hooks）

每次主代理响应完成后，按顺序执行三个独立钩子：

```
主代理响应完成
    │
    ├── 1. Compact Hook（优先，释放上下文）
    │      检查：未 compact token > 200K（可配置）
    │      输出：新 compact 上下文 + 最近 20K token 对话
    │
    ├── 2. Session Memory Hook
    │      检查：消息数 ≥ 6 或 token 增长 ≥ 2000（可配置）
    │      输出：10 章节笔记 + <session-memory-update> 标记
    │
    └── 3. Auto Dream Hook（fire-and-forget）
           检查：距上次 ≥ 24h 且新会话 ≥ 5（可配置）
           输出：长期记忆（auto_dream/）+ 常驻记忆（persistent_memory.md）双更新
```

**代码路径**：`src/domain/chat/postSampling.ts`

---

## 三、子代理统一提示词结构

三个子代理各自有专属提示词，但**继承主代理全部上下文**：

```
子代理完整提示词 =
    主提示词 (main_prompt.md)
  + 工具调用规则 (tool_rules.md)
  + 常驻记忆 (persistent_memory.md，精简版)
  + compact 上下文
  + 未 compact 原始对话
  + 子代理专属提示词
```

**代码路径**：`src/subAgent/promptBuilder.ts` → `buildSubAgentMessages()`

---

## 四、会话记忆子代理

**触发**：消息 ≥ 6 条初始化；token 增长 ≥ 2000 + 工具调用 ≥ 3 次更新

**流程**：构建子代理提示词 → 读取当前笔记 → edit_tool/write_tool 更新 → 注入标记

**笔记注入**：
- 主聊天页面**不展示** `<session-memory-update>` 内容
- 终端监控面板**展示** session_memory_activity 事件

---

## 五、压缩子代理

**触发**：未 compact token > 200K（默认），或手动 `/compact`

**流程**：构建子代理提示词 → 9 章节压缩（禁止工具调用）→ 替换旧 compact + 未 compact 对话

**压缩后主代理**：compact 上下文（新）+ 最近 20K token 对话

---

## 六、梦境子代理

**触发**：距上次 ≥ 24h + 新会话 ≥ 5 + PID 文件锁

**流程**：SQLite 查询活跃会话 → 获取锁 → 5 阶段整合 → 验证常驻记忆

**五阶段**：定位 → 收集 → 整合（长期记忆）→ 修剪与索引（长期记忆）→ 常驻记忆更新

**双输出模型**：

| 输出 | 位置 | 用途 |
|------|------|------|
| **长期记忆** | `auto_dream/` 分类目录 + INDEX.md | 完整归档，存储不注入。主代理可通过 SearchMemory 工具检索 |
| **常驻记忆** | `persistent_memory.md` | ~1000 字精简上下文，每次对话注入 System Prompt |

**常驻记忆更新原则**：梦境代理在第五阶段直接覆写 persistent_memory.md。只保留连续性关键信息（身份/角色、进行中任务、关键决策、活跃约定），自由格式，总量 ~4000 token。

---

## 七、配置参数

所有参数可在前端设置页面修改：

| 参数 | 默认 | 说明 |
|------|------|------|
| session_memory_min_messages | 6 | 初始化触发消息数 |
| session_memory_min_tokens_between_update | 2000 | 更新触发 token 增长 |
| session_memory_tool_calls_between_updates | 3 | 更新触发工具调用数 |
| compact_trigger_tokens | 200000 | compact 触发阈值 |
| compact_recent_dialogue_tokens | 20000 | 保留的最近对话 token |
| dream_min_hours | 24 | Dream 最小间隔（小时） |
| dream_min_sessions | 5 | Dream 最小新会话数 |

---

## 八、前端展示规则

- **主聊天页面**：隐藏 `<session-memory-update>`，隐藏 compact/dream 内部过程
- **监控面板**：展示 session_memory_activity、compact_activity、dream_activity
