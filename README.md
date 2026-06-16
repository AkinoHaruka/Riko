# Riko

<div align="center">

**AI 对话桌面/移动端应用** — 一个具备流式对话、长期记忆、梦境整合与可扩展技能系统的个人 AI 助手。

![Flutter](https://img.shields.io/badge/Flutter-3.x-02569B?logo=flutter)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

> **⚠️ 开发中** — 本项目仍处于积极开发阶段，众多功能尚未完成适配和打磨。目前 Windows 桌面端和 Android 真机已基本可用，其他平台（macOS、Linux、Web、iOS）尚未充分验证。API 接口、数据结构和内部架构可能随时变动，不建议在生产环境中使用。

## 功能

- **流式对话** — 基于 SSE 的实时流式响应，乐观 UI 更新，多轮对话与工具调用
- **长期记忆** — FTS5 全文搜索 + BM25 排序，支持混合文件扫描回退
- **梦境整合** — 后台 AI 任务，从对话历史中提取洞察、情感与模式
- **上下文压缩** — 自动/手动上下文窗口管理，支持微压缩与 token 估算
- **技能系统** — 基于 SKILL.md 的可扩展技能定义，渐进式披露（`SkillsList` / `SkillView`）
- **MCP 集成** — 支持 Stdio 和 HTTP 传输的外部 MCP 服务器，动态工具发现
- **多 Provider** — 支持 DeepSeek、OpenAI 兼容、Anthropic、Gemini 后端
- **子 Agent** — 并行子 Agent 执行，支持工具调用与活动监控
- **安全防护** — 三层防御：Unicode 净化、威胁模式扫描、工具调用护栏
- **跨平台** — Windows、macOS、Linux、Web、Android、iOS

### 平台适配状态

| 平台 | 状态 | 说明 |
| ------ | ---- | ---- |
| Windows 桌面 | ✅ 基本可用 | 主要开发平台 |
| Android 真机 | ✅ 基本可用 | 通过 proot + Ubuntu rootfs 运行嵌入式后端 |
| macOS | 🔶 未验证 | |
| Linux | 🔶 未验证 | |
| Web | 🔶 未验证 | |
| iOS | 🔶 未验证 | |

## 架构

```text
Riko/
├── lib/                    # Flutter 前端 (Dart)
│   ├── core/               # DI 依赖注入、主题、路由、对话门面层
│   ├── data/               # API 客户端、数据库 (Drift/SQLite)、仓库层
│   ├── infrastructure/     # AI 适配器、SSE/WebSocket 客户端
│   ├── ui/                 # 页面、组件、应用外壳
│   └── platform/           # 后端运行器、proot (Android)
│
├── ts_backend/             # Fastify 后端 (TypeScript)
│   ├── src/
│   │   ├── api/            # REST 路由 (对话、记忆、设置、MCP...)
│   │   ├── core/           # AI 客户端、数据库、加密、安全、中间件
│   │   ├── domain/         # 业务逻辑 (对话、压缩、梦境、记忆、技能、MCP...)
│   │   ├── tools/          # 文件系统工具 + 记忆搜索 + 技能工具
│   │   └── prompts/        # 提示词模板
│   └── data/               # 内置技能、提示词文件
│
└── android/                # Android 原生层 (Kotlin)
    └── kotlin/com/example/riko/
        ├── BootstrapOrchestrator   # 基于步骤的 proot 引导
        ├── ProcessManager          # Node.js 进程生命周期管理
        └── BackendService          # 后台前台服务
```

## 快速开始

### 环境要求

- [Flutter SDK](https://docs.flutter.dev/get-started/install) 3.x (Dart ^3.11.1)
- [Node.js](https://nodejs.org/) 20+
- DeepSeek API Key（或其他兼容 Provider）

### 后端

```bash
cd ts_backend
cp .env.example .env        # 编辑填入你的 API Key
npm install
npm run dev                 # 启动于 http://localhost:3000
```

### 前端

```bash
flutter pub get
flutter run -d windows      # 或: chrome, macos, linux, android
```

### Windows 快速启动

```batch
start_backend.bat            # 后台启动后端
start_frontend.bat           # 启动 Flutter 桌面端
stop.bat                     # 停止两个进程
```

### Android

在 Android 上，后端运行在 proot + Ubuntu rootfs 沙箱环境中。`BootstrapManager` 会在首次启动时自动完成初始化（下载 rootfs、安装 Node.js、部署后端代码）。

```bash
flutter run -d android
```

## 配置

| 变量 | 默认值 | 说明 |
| ---- | ------ | ---- |
| `PORT` | `3000` | 后端服务端口 |
| `HOST` | `127.0.0.1` | 绑定地址 |
| `JWT_SECRET` | — | JWT 签名密钥（首次运行自动生成） |
| `DEEPSEEK_API_KEY` | — | DeepSeek API Key |
| `DB_PATH` | `./data/app.db` | SQLite 数据库路径 |
| `ENCRYPTION_KEY` | — | 32 字节十六进制 AES 加密密钥 |
| `DREAM_ENABLED` | `true` | 启用梦境整合 |
| `LOG_LEVEL` | `INFO` | 日志级别：DEBUG / INFO / WARN / ERROR |

完整配置参见 [`.env.example`](ts_backend/.env.example)。

## 技术栈

| 层级 | 技术 |
| ---- | ---- |
| 前端 | Flutter 3.x, Riverpod, Drift (SQLite), GoRouter, 延迟加载 |
| 后端 | Fastify 5, TypeScript 6, OpenAI SDK (用于 DeepSeek), better-sqlite3 |
| Android | Kotlin, MethodChannel, proot + Ubuntu rootfs |
| 数据库 | SQLite (better-sqlite3 原生, sql.js WASM 回退) |
| AI Provider | DeepSeek, OpenAI 兼容, Anthropic, Gemini |

## 许可证

[MIT](LICENSE)
