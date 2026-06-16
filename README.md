# Riko

<div align="center">

**AI Chat Desktop/Mobile App** — A personal AI assistant with streaming chat, long-term memory, dream consolidation, and extensible tool/skill system.

![Flutter](https://img.shields.io/badge/Flutter-3.x-02569B?logo=flutter)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

## Features

- **Streaming Chat** — Real-time SSE streaming with optimistic UI, multi-turn conversations, and tool calling
- **Long-term Memory** — FTS5-powered full-text search with hybrid file-scan fallback for persistent memories
- **Dream Consolidation** — Background AI task that extracts insights, emotions, and patterns from conversation history
- **Context Compaction** — Automatic and manual context window management with micro-compact and token estimation
- **Skill System** — SKILL.md-based extensible skills with progressive disclosure (`SkillsList` / `SkillView` tools)
- **MCP Integration** — Stdio and HTTP transport for external MCP servers with dynamic tool discovery
- **Multi-Provider** — Supports DeepSeek, OpenAI-compatible, Anthropic, and Gemini backends
- **Sub-Agent** — Parallel sub-agent execution with tool calling and activity monitoring
- **Security** — Three-layer defense: Unicode sanitization, threat pattern scanning, tool call guardrails
- **Cross-Platform** — Windows, macOS, Linux, Web, Android, iOS

## Architecture

```text
Riko/
├── lib/                    # Flutter frontend (Dart)
│   ├── core/               # DI providers, theme, router, chat facade
│   ├── data/               # API client, database (Drift/SQLite), repositories
│   ├── infrastructure/     # AI adapters, SSE/WebSocket clients
│   ├── ui/                 # Pages, widgets, app shell
│   └── platform/           # Backend runner, proot (Android)
│
├── ts_backend/             # Fastify backend (TypeScript)
│   ├── src/
│   │   ├── api/            # REST routes (chat, conversation, memory, settings, mcp...)
│   │   ├── core/           # AI client, database, encryption, security, middleware
│   │   ├── domain/         # Business logic (chat, compact, dream, memory, skill, mcp...)
│   │   ├── tools/          # File-system tools + memory search + skill tools
│   │   └── prompts/        # Prompt templates
│   └── data/               # Bundled skills, prompt files
│
└── android/                # Android native layer (Kotlin)
    └── kotlin/com/example/riko/
        ├── BootstrapOrchestrator   # Step-based proot bootstrap
        ├── ProcessManager          # Node.js process lifecycle
        └── BackendService          # Foreground service for backend
```

## Quick Start

### Prerequisites

- [Flutter SDK](https://docs.flutter.dev/get-started/install) 3.x (Dart ^3.11.1)
- [Node.js](https://nodejs.org/) 20+
- DeepSeek API key (or compatible provider)

### Backend

```bash
cd ts_backend
cp .env.example .env        # Edit with your API key
npm install
npm run dev                 # Starts on http://localhost:3000
```

### Frontend

```bash
flutter pub get
flutter run -d windows      # Or: chrome, macos, linux, android
```

### Windows Quick Start

```batch
start_backend.bat            # Starts backend in background
start_frontend.bat           # Starts Flutter desktop
stop.bat                     # Stops both
```

### Android

On Android, the backend runs embedded inside a proot + Ubuntu rootfs environment. The `BootstrapManager` handles first-launch initialization automatically (rootfs download, Node.js install, backend deployment).

```bash
flutter run -d android
```

## Configuration

| Variable | Default    | Description |
| ---------- | ---------- | ----------- |
| `PORT` | `3000`     | Backend server port |
| `HOST` | `127.0.0.1` | Bind address |
| `JWT_SECRET` | — | JWT signing key (auto-generated on first run) |
| `DEEPSEEK_API_KEY` | — | Your DeepSeek API key |
| `DB_PATH` | `./data/app.db` | SQLite database path |
| `ENCRYPTION_KEY` | — | 32-byte hex key for AES encryption |
| `DREAM_ENABLED` | `true` | Enable dream consolidation |
| `LOG_LEVEL` | `INFO` | DEBUG / INFO / WARN / ERROR |

See [`.env.example`](ts_backend/.env.example) for the full list.

## Tech Stack

| Layer      | Technology |
| ---------- | ---------- |
| Frontend   | Flutter 3.x, Riverpod, Drift (SQLite), GoRouter, deferred loading |
| Backend | Fastify 5, TypeScript 6, OpenAI SDK (for DeepSeek), better-sqlite3 |
| Android | Kotlin, MethodChannel, proot + Ubuntu rootfs |
| Database | SQLite (better-sqlite3 native, sql.js WASM fallback) |
| AI Providers | DeepSeek, OpenAI-compatible, Anthropic, Gemini |

## License

[MIT](LICENSE)
