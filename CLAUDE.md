# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Chat desktop/mobile app ("RIKO") — a Flutter frontend with a TypeScript (Fastify) backend. The backend acts as a proxy to the DeepSeek AI API, handling chat streaming, conversation management, tool calling, context compaction, session memory extraction, and auto-dream consolidation.

- **Frontend**: Flutter 3.x (Dart SDK ^3.11.1) — cross-platform: Windows, macOS, Linux, Web, Android, iOS
- **Backend**: Fastify 5 + TypeScript 6 — runs on port 3000
- **AI Provider**: DeepSeek (deepseek-v4-flash, deepseek-v4-pro)
- **Database**: better-sqlite3 (native C++ SQLite) with sql.js WASM fallback

## Common Commands

### Backend (TypeScript — `ts_backend/`)

```bash
cd ts_backend
npm run dev          # Start with hot-reload (tsx watch src/main.ts)
npm run build        # Compile TypeScript (tsc → dist/)
npm start            # Run compiled output (node dist/main.js)
npm run lint         # ESLint
npm run format       # Prettier
npm test             # vitest run
npm run test:watch   # vitest (watch mode)
```

### Frontend (Flutter — root)

```bash
flutter pub get                  # Install dependencies
flutter run -d windows           # Run on Windows desktop
flutter run -d android           # Run on Android
flutter build apk --release      # Build Android APK
dart run build_runner build --delete-conflicting-outputs  # Regenerate drift .g.dart files
flutter analyze                  # Static analysis
flutter test                     # Run all Dart tests
flutter test --coverage          # Run with coverage
flutter test test/data/xxx_test.dart  # Run a single test file
```

### Quick Start (Windows)

```batch
start_backend.bat   # npm run dev in ts_backend/
start_frontend.bat  # flutter run -d windows
stop.bat            # Kill both processes
```

## Architecture

### Frontend Layers

```
lib/
├── main.dart                  # Entry point, window_manager config, BackendRunner
├── app.dart                   # MaterialApp.router root
├── core/
│   ├── router.dart            # GoRouter: / → /settings, /archive, /memory, /admin
│   ├── di/
│   │   ├── providers.dart     # Global Riverpod providers (apiClient, database, repositories, panelRatio, WebSocket)
│   │   ├── chat_provider.dart # ChatNotifier: SSE streaming, optimistic UI, monitor records, sub-agent activity
│   │   ├── settings_cache.dart# SettingsCacheState — mirrors backend settings into Flutter
│   │   ├── dream_notifier.dart
│   │   └── internal_event.dart
│   └── theme/                 # Dark theme only (Color(0xFF111111) base)
├── data/
│   ├── api_client.dart        # Dio-based HTTP client → 127.0.0.1:3000, JWT token management
│   ├── database.dart          # Drift AppDatabase: Conversations, Messages, Settings, Memory, ApiMonitorRecords
│   ├── database_impl.dart     # Native SQLite via drift/native (VM platforms)
│   ├── database_web.dart      # Web SQLite via drift/wasm
│   ├── repositories/          # RemoteChatRepository, RemoteSettingsRepository, RemoteMemoryRepository
│   ├── daos/                  # Drift DAOs (generated + handwritten), .g.dart files
│   └── tables/                # Drift table definitions
├── infrastructure/
│   ├── ai_adapter/
│   │   ├── ai_adapter.dart    # Abstract AIAdapter interface (chatStream)
│   │   ├── deepseek_adapter.dart # Dio-based SSE streaming to backend /chat/completions
│   │   ├── adapter_factory.dart  # Caches DeepSeekAdapter singleton
│   │   ├── sse_stream_parser.dart
│   │   └── models/            # Message, StreamChunk, TokenUsage, ErrorInfo
│   ├── websocket_client.dart  # WebSocket with auto-reconnect (5 attempts, 3s delay)
│   └── sse_client.dart
├── ui/
│   ├── app_shell.dart         # Desktop: frameless window with custom title bar + resize handles
│   ├── chat_home_page.dart    # Main chat view: message list, input bar, split-pane terminal + monitor panel
│   ├── settings_page.dart / memory_page.dart / archive_page.dart / admin_page.dart / monitor_page.dart
│   └── widgets/               # message_bubble, modern_input_bar, conversation_drawer, draggable_splitter,
│                              #   terminal_panel, sub_agent_trigger_panel, dynamic_island, desktop_title_bar
└── platform/
    ├── backend_runner.dart    # Compatibility wrapper → delegates to ProotRunner
    ├── proot_runner.dart      # MethodChannel bridge for Android embedded backend (proot + Ubuntu rootfs)
    └── bootstrap_service.dart # First-launch bootstrap: rootfs download, Node.js install, backend copy
```

### Backend Layers (`ts_backend/src/`)

```
src/
├── main.ts                    # Fastify server startup, registers routes + WebSocket
├── config/                    # ai.ts, auth.ts, database.ts, encryption.ts
├── core/
│   ├── ai/                    # OpenAI SDK client wrapper for DeepSeek, error classification
│   ├── events/                # EventManager — typed SSE/WS event dispatch (conversation_created, message_updated, etc.)
│   ├── security/              # Unicode sanitization, threat pattern scanning, tool call guardrails
│   ├── types/                 # Shared type definitions (ToolHandler, ToolContext, ToolCallResult)
│   ├── middleware/             # CORS, rate-limit, gzip, auth (JWT), request logging
│   ├── encryption/            # AES crypto
│   ├── validation/            # Frontmatter parsing
│   └── utils/
├── domain/
│   ├── auth/                  # JWT service, bcrypt
│   ├── conversation/          # CRUD service + repository
│   ├── message/               # CRUD service + repository
│   ├── memory/                # Memory service + repository + FTS5 full-text search
│   ├── setting/               # Settings CRUD
│   ├── chat/                  # Chat orchestration: SSE streaming, tool calling handler, Unicode sanitization
│   ├── compact/               # Auto/manual context compaction (token estimation + micro-compact + trigger)
│   ├── sessionMemory/         # Session notes extraction via AI
│   ├── subAgent/              # Sub-agent prompt building and execution
│   ├── autoDream/             # Background dream/consolidation task scheduler + threat scanning on write
│   ├── skill/                 # Skill discovery and loading (SKILL.md frontmatter parsing)
│   └── mcp/                   # MCP client manager (Stdio/HTTP transport, tool discovery, dynamic registration)
├── api/
│   ├── routes.ts              # Central route registration
│   ├── chat/                  # POST /chat/completions (SSE streaming)
│   ├── conversation/          # CRUD /conversations
│   ├── message/               # CRUD /messages
│   ├── auth/                  # /auth/*
│   ├── setting/               # /settings/*
│   ├── memory/                # /memories/*
│   ├── compact/               # /compact, /compact/status
│   ├── dream/                 # /dream
│   ├── events/                # WebSocket /ws/events
│   ├── monitor/               # /monitor/*
│   ├── mcp/                   # /mcp/servers (MCP Server CRUD + reconnect)
│   └── tool/                  # /tool/*
├── tools/                     # File-system tools: readFile, writeFile, editFile, grep, findFiles, listFiles, etc.
│                              #   + memorySearch (FTS5 + file scan hybrid), skillsList, skillView
│                              #   + MCP tools (dynamically registered, mcp__ prefix)
└── prompts/                   # Prompt templates and migrator
```

### Data Flow

1. User sends message → Flutter `ModernInputBar` → `ChatNotifier.sendMessage()`
2. Optimistic UI: user message added to `pendingMessages`, assistant placeholder created
3. `DeepSeekAdapter.chatStream()` → POST `/chat/completions` on backend
4. Backend `chat/chat.routes.ts` → streams SSE (content chunks, reasoning, tool calls, status events)
5. `ChatNotifier` accumulates chunks in `streamingContent`/`streamingReasoningContent`, throttles PUT to backend at 150ms intervals
6. On stream end: final content saved, message list refreshed, monitor record completed

### Database Platform Strategy

Conditional imports in `database.dart`:
- **VM platforms** (Windows, Android, iOS, Linux, macOS): `database_impl.dart` → Native SQLite via `drift/native`
- **Web**: `database_web.dart` → `drift/wasm` with sqlite3.wasm
- **Fallback**: `database_stub.dart` throws `UnsupportedError`

### Key Design Decisions

- **No API keys on frontend**: All AI requests go through the backend. The frontend never directly calls DeepSeek.
- **Mobile embedded backend**: On Android, `ProotRunner` uses a MethodChannel (`com.example.riko/backend`) to interact with the Kotlin native layer (`ProotPlugin` → `BackendService` → `ProcessManager`), which runs Node.js inside a proot + Ubuntu rootfs. `BootstrapManager` handles first-launch initialization (rootfs download/extraction, Node.js install, bionic bypass injection). On desktop, the backend runs as a separate process (no proot). See `ANDROID_PORT_PLAN.md`.
- **Optimistic UI with SSE**: User messages appear instantly (negative IDs), then sync when the SSE push arrives.
- **Deferred loading**: Settings, Archive, Memory, Admin pages use `deferred as` imports for smaller initial load.
- **Single dark theme**: No light mode — dark theme with green accent (#3eb573) and MiSans font family.
- **Single-user, no auth**: This is a personal local app. Do NOT add login, registration, or authentication pages/guards. The API token is obtained automatically via `/auth/bootstrap` on first launch. There is no `authProvider`, `AuthState`, or `AuthNotifier` in the frontend.

### New Modules (2026-06)

- **Security (core/security/)**: Three-layer defense — `sanitizeUnicode` (NFKC + invisible char removal on user input), `threatPatterns` (7 threat categories, 3 scope levels, used in dream write scanning), `toolGuardrails` (exact-repeat/same-tool/idle detection, block/warn/halt responses)
- **FTS5 Search (domain/memory/)**: SQLite FTS5 virtual table with Unicode61 tokenizer, BM25 ranking, relative score floor (0.3), snippet highlighting, hybrid search (FTS5 + file scan)
- **Skill System (domain/skill/)**: SKILL.md frontmatter-based skill definitions, `data/skills/bundled/` for built-in skills, `SkillsList`/`SkillView` tools for progressive disclosure
- **MCP Client (domain/mcp/)**: Stdio/HTTP transport, auto tool discovery → `toolRegistry` registration, `mcp__` prefix namespace, REST API for server management, graceful shutdown with SIGKILL fallback
- **Emotions Memory**: `emotions/` memory type in dream consolidation, emotion-oriented prompt guidance in `dream_prompt.md`
- **EventBus Events**: `mcp:server:connected/disconnected/error`, `mcp:tool:called`, `skill:loaded/error`, `security:threat:detected`, `security:guardrail:blocked`
