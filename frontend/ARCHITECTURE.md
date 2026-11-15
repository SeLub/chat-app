# Architecture

## Overview
React 18 SPA with TypeScript, Vite 6, Zustand, React Router v7, and Tailwind CSS 4.
Proxy `/api` and `/ws` to the Express backend at `localhost:3000`.

## Directory Structure
```
frontend/
├── src/
│   ├── app/
│   │   └── App.tsx              # Root component with Routes
│   ├── features/
│   │   ├── chat/
│   │   │   └── components/
│   │   │       ├── chat-area.tsx              # Main chat with streaming, markdown, attachments
│   │   │       ├── reasoning-block.tsx        # Collapsible reasoning display (truncated marker)
│   │   │       ├── generation-params-modal.tsx # ⚙ Params dialog (presets, sliders, fieldError)
│   │   │       └── sidebar.tsx                # Session list with search, grouping, CRUD
│   │   ├── models/
│   │   │   └── components/
│   │   │       └── settings-panel.tsx         # Provider/Model/Sysprompt/Context config
│   │   ├── prompts/
│   │   │   └── components/                    # Prompt Manager (CRUD, Dashboard-style)
│   │   ├── sessions/
│   │   │   └── components/
│   │   │       └── save-modal.tsx             # Save conversation modal
│   │   ├── dashboard/
│   │   │   └── components/
│   │   │       └── dashboard.tsx              # Full dashboard with grouping, search, bulk actions
│   │   ├── ai-helper/
│   │   │   └── components/
│   │   │       └── ai-helper-overlay.tsx      # Draggable + resizable overlay with VAD + WebSocket
│   │   └── stt/
│   │       └── components/
│   │           └── stt-input.tsx              # Voice input via microphone
│   ├── shared/
│   │   ├── components/
│   │   │   ├── top-bar.tsx                    # Header with navigation, shortcuts
│   │   │   ├── sidebar.tsx                    # Left sidebar (moved from features/chat)
│   │   │   ├── command-palette.tsx            # Cmd+K search overlay
│   │   │   └── save-modal.tsx                 # Save conversation modal
│   │   └── hooks/                             # Custom hooks
│   ├── stores/
│   │   ├── providerStore.ts                   # Zustand: providers, models, model detail
│   │   ├── sessionStore.ts                    # Zustand: sessions, messages, context, streaming
│   │   ├── generationParamsStore.ts           # Zustand: per-message generation params (persist)
│   │   ├── promptStore.ts                     # Zustand: selected prompts (persist in localStorage)
│   │   └── uiStore.ts                         # Zustand: UI state, toasts
│   ├── lib/
│   │   ├── apiGateway.ts                      # Typed API client (fetch-based) + sendStream
│   │   ├── generationParams.ts                # Generation params types, presets, validation
│   │   └── logger.ts                          # Logger with level filtering
│   ├── types/
│   │   └── index.ts                           # TypeScript interfaces
│   ├── main.tsx                               # Entry point
│   └── index.css                              # Tailwind CSS + theme
├── public/
├── vite.config.ts
├── tsconfig.json
├── package.json
├── eslint.config.js
└── .env.example
```

## State Management (Zustand)
- **providerStore**: Providers (ollama/llama.cpp), models, current model, model detail, context length
- **sessionStore**: Active/viewing session, messages, Q&A pairs, context config, streaming state
- **generationParamsStore**: Per-message generation params (temperature, top_p, top_k, min_p, n_predict, presence_penalty, repeat_penalty), persist in localStorage
- **promptStore**: Selected system prompt + user templates, persist in localStorage
- **uiStore**: Sidebar/panel toggles, toasts, modals, command palette

## API Gateway
Typed fetch-based client wrapping all backend endpoints:
- `sessionsApi`: CRUD + messages + context config
- `chatApi`: Message sending with streaming support
- `modelsApi`: Model listing and detail
- `providersApi`: Provider status
- `sttApi`: Speech-to-text transcription
- `attachmentsApi`: File extraction

## Key Features
1. **Chat**: Streaming responses (SSE), reasoning block, markdown, Q&A grouping, attachments — streaming via `apiGateway.chat.sendStream`, `sessionStore.streaming` state, rAF-throttled render
2. **Dashboard**: Grouped sessions, search, bulk delete, inline editing
3. **Prompts**: `/templatemanager` (CRUD, Dashboard-style), PromptsTab (radio system + checkbox templates), SelectedPromptsModal, promptStore (persist in localStorage)
4. **Generation params**: ⚙ Params in stat footer, presets (Coding/Creative/Deep Reasoning/Custom), per-message override, fieldError highlight
5. **Settings**: Provider selection, model picker, context config (standard/manual)
6. **AI Helper**: Draggable + resizable overlay, VAD, WebSocket streaming
7. **STT**: Voice transcription via microphone
8. **Command Palette**: Cmd+K session search
9. **Keyboard Shortcuts**: Cmd+K, Cmd+B
