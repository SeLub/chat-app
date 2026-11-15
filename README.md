# Chat-App — Local Web Chat for Local LLMs (llama.cpp / Ollama)

> Documentation in Russian: [docs/README_RUS.md](docs/README_RUS.md)

A local-first web shell for local language models: a React SPA front end plus an Express 5 + SQLite + WebSocket server, running entirely on your machine. No external APIs — the model, your files, speech transcription and usage statistics all stay local.

Key ideas of the product:

- **Streaming responses** — tokens arrive as the model generates them (TTFT 3–10 s instead of full generation time), with a reasoning block for thinking models.
- **Smart context management** — adaptive history budget based on measured token density, pre-flight overflow check before the LLM call, manual selection of included pairs, LIFO trimming.
- **Prompt library** — system prompts (radio) + user templates (checkboxes), assembled into `[Instructions]` in the prompt; persisted per-app in localStorage.
- **Dynamic generation parameters** — temperature, top_p, top_k, min_p, n_predict, presence_penalty, repeat_penalty per message, with presets (Coding / Creative / Deep Reasoning / Custom) and "not set → server default" semantics.
- **PROJECT mode** — bind a session to a project folder: reference files are read from disk in their current state on every request.
- **Attachment registry** — documents (PDF/DOCX/XLSX/CSV) with server-side text extraction, code (up to 50 files), images, web pages by URL; files are never deleted from disk.
- **Send-error UX** — a structured banner with real tokenizer numbers; the question is never lost; the banner survives page reload; one-click quick actions.
- **STT & AI Helper** — voice input via whisper.cpp and a floating meeting-capture overlay (microphone + system audio) with transcripts pushed into the chat.
- **Statistics** — context-load token bar, model size, TPS/TTFT, llama.cpp cache-aware token counting.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| Backend | Node.js 20+, Express 5, better-sqlite3 (SQLite), ws (WebSocket), multer, sharp |
| Frontend | React 18, TypeScript (strict), Vite, Tailwind CSS 4, Zustand, Radix UI, react-markdown + highlight.js, Mermaid |
| LLM providers | Ollama and llama.cpp (`llama-server`, GGUF); extensible via a common `BaseProvider` interface |
| Streaming | SSE over `fetch` + POST (multipart preserved), `ReadableStream`, rAF-throttled rendering |
| STT | whisper.cpp (two `whisper-server` instances) + Silero VAD v5 in the browser (WASM: `@ricky0123/vad-web` 0.0.30 + `onnxruntime-web` 1.22.0) |
| Documents & URLs | pdfjs-dist (PDF), word-extractor (DOC/DOCX), xlsx (XLS/XLSX/CSV), Mozilla Readability + cheerio (web pages) |
| Tooling | pnpm 10+, Vitest (frontend), `node --test` (backend), ESLint, Docker Compose (Ollama) |

---

## Features

### Streaming responses

`/api/chat` supports **two response modes** on the same endpoint:

- **JSON** (default, `Accept: application/json` or absent) — full response as one JSON object (legacy clients, vision).
- **SSE** (`Accept: text/event-stream`) — token stream:

  ```
  data: {"type":"token","delta":"Hel"}\n\n
  data: {"type":"token","delta":"lo"}\n\n
  data: {"type":"reasoning","delta":"thinking..."}\n\n
  data: {"type":"done","metrics":{...},"finishReason":"stop","questionId":"q_1_..."}\n\n
  ```

- The provider interface got an optional `onToken(type, delta)` callback — `LlamaCppProvider` and `OllamaProvider` forward every `delta.content` / `delta.reasoning_content` chunk through it.
- The frontend consumes the stream via `apiGateway.chat.sendStream` (`ReadableStream` + line buffering), accumulates content/reasoning in `sessionStore.streaming`, and renders **plain text** during the stream with **`requestAnimationFrame` throttling** (one re-render per frame). After `done` — the final `ReactMarkdown` render.
- **Partial save on disconnect:** if the client disconnects mid-stream (`req.on('close')`) or the provider errors, the accumulated partial is saved to the DB with a truncation marker (`composeAssistantAnswer`), and an `error` event is sent (no `done`). The question is never lost.
- **Vision stays JSON** — image + streaming is not supported in this track; the vision branch always uses `stream: false`.

### Reasoning block

Reasoning models (Qwen3.8, DeepSeek-R1, o1-like) return `content` + `reasoning_content`. Both are persisted:

- **`messages.reasoning`** (TEXT, nullable) — full reasoning text, survives F5.
- **`ReasoningBlock`** in the UI — collapsible (collapsed by default), shows `💭 Reasoning (N chars)`; when `finishReason === 'length'` — auto-expanded with a truncation marker.
- **Reasoning is never injected into the prompt** — `buildLLMContext` reads only `content`. Reasoning stays "internal": 10–35 KB per message would blow the context and is not needed by the model.
- **`composeAssistantAnswer`** (answer-loss-diagnostics) is preserved: when `content === ''` and reasoning exists, a status marker goes into `content` — now pointing to the Reasoning block (not "server logs").
- During streaming, `Thinking…` (collapsed) appears before the first `content` token; after `done` — full reasoning in the block.

### Prompt library

A small prompt management system replaces the old single system-prompt textarea:

- **System prompts** (radio, one active) — the model role / behaviour.
- **User templates** (checkboxes, many) — checklists, additional instructions.
- The DB table `prompts` (`id, name, type: 'system' | 'user_template', content, is_default`).
- **Prompt Manager** at `/templatemanager` (Dashboard-style page): CRUD, grouped by type, search, `is_default` guard (the last default system prompt cannot be deleted).
- **Dynamic assembly:** `buildLLMContext` builds `system(sysprompt) + user[Материалы] + user[Инструкции] + user[Ранее] + user[Вопрос]`. `[Инструкции]` — the concatenation of the selected user templates from the DB (`--- TEMPLATE: <name> ---` blocks, `created_at ASC`).
- **Model A semantics:** the checkbox is the source of truth for `[Инструкции]` (from the DB by `selectedTemplateIds`); the composer is only the current question. No duplication: if the user edits the composer, that's `[Вопрос]`; `[Инструкции]` still come from the DB. F5 restores checkboxes from localStorage (composer stays empty — intentional).
- **Selected Prompts preview** — read-only modal: system + templates + `[Вопрос]` (live, with the current composer text).
- **Persistence:** `selectedSystemId` + `selectedTemplateIds` in localStorage (global, not per-session).

### Dynamic generation parameters

Per-message generation params (P0.1), **"not set → not forwarded"**:

- **Fields:** `temperature`, `top_p`, `top_k`, `min_p`, `n_predict`, `presence_penalty`, `repeat_penalty`.
- **Server validation:** `src/utils/generationParams.js` — coercion from FormData strings, integer check, `n_predict=0` rejected, unknown keys ignored. Out-of-range → `400 {code:'invalid_generation_param', field, min, max}` (question rolled back to composer, `fieldError` highlights the field in the modal).
- **Providers:** hardcoded `temperature: 0.7` removed from `chat()` (both providers). `n_predict` → `max_tokens` (llama.cpp) / `num_predict` (Ollama) with priority over the legacy `maxTokens` argument. Empty params = server defaults (unchanged behaviour for old clients).
- **Presets** (in `generationParams.ts`): **Coding** (low temp, strict penalties), **Creative** (high temp, loose), **Deep Reasoning** (lower temp, strict nucleus — `n_predict` intentionally not set; the server's `--n-predict` applies), **Custom** (user-edited).
- **UI:** `⚙ Params` button in the stat footer with a preset badge (`⚙ Params · Coding` / `· Custom` / no suffix). Modal — on `Dialog` (same as TPS/Save/Load), `max-w-lg`, sliders for 6 params, number input for `n_predict`, `Reset to Server Defaults`, field error highlight.
- **Persistence:** params + activePreset in localStorage (`generation-params-v1`); on load — sanitized against the spec (broken `localStorage` cannot break sending).

### Multi-provider

* One provider interface: **Ollama** (model management) and **llama.cpp** (GGUF via `llama-server`).
* Provider switch and model picker in the header dropdown; the choice is persisted in `localStorage`.
* Live provider status detection (`connected`/`disconnected`/`error`) and available model lists.
* A new provider (vLLM, LocalAI, etc.) is one `BaseProvider` subclass + registration in `providerManager.js` and `config/providers.js` — no controller or service changes.

### Context management

The prompt is assembled deterministically (`contextBuilder.js`):

```text
EXACTLY one system (sysprompt) + [Materials] (attachment/URL/project file text)
+ [Instructions] (user templates) + [Earlier in this session] (trimmed Q&A-pair history)
+ [Question] (current message)
```

**Two history modes:**

1. **Standard** — previous Q&A pairs are included automatically; when space runs out, the oldest pairs are trimmed first (LIFO). The `retainPercent` slider sets how much of the history budget past pairs may occupy.
2. **Manual** — you tick which pairs to include (`includeQuestionIds`); anything unticked never reaches the prompt.

**Adaptive history budget.** The trimming boundary is computed from the **measured density** of the session, not a constant "4 chars = 1 token": `charsPerToken = promptChars / inputTokens` of the last text answer. Budget: `maxChars = ctx × density × 0.9` (10% margin for tokenizer variance). Density is accepted only from a trusted band **[1.0; 5.0]**; with no metrics yet (first turn) it falls back to `4` without margin. Current values are exposed in the server response (`contextInfo.charsPerToken`, `charsPerTokenSource`).

**Overflow pre-flight.** Before calling the LLM, the server estimates the prompt on the same measured density; if it clearly does not fit, it returns an instant `400 {code:'context_overflow', estimatedTokens, contextLength}` without touching the model. A hard 400 from llama.cpp (`exceed_context_size_error`) is parsed, and the real tokenizer numbers (`n_prompt_tokens`/`n_ctx`) are surfaced to the UI.

**Message length cap.** A message longer than **64,000 characters** is not sent: the composer blocks the Send button and Enter with a hint and counter (shown above 90% of the cap); direct API calls get an instant `400 {code:'message_too_long', messageLength, maxMessageChars}` before URL/attachment processing.

**llama.cpp cache awareness.** `inputTokens` in the metrics is the full prompt size (`usage.prompt_tokens`, fallback `timings.prompt_n + cache_n`): with llama.cpp slot caching the token bar and per-session totals are not undercounted on cache hits; `cachedTokens` is also visible in the metrics.

### Last prompt

The final LLM context (system + user messages + metadata) from the last request is persisted per session and viewable in the UI:

- **Persistence:** `sessions.last_prompt` (JSON, TEXT) — overwritten on every chat/vision request. Written **before** the provider call (so a provider failure still shows what was sent), then updated after `done`/error with `finishReason` and `usage`.
- **API:** `GET /api/sessions/:id/last-prompt` → `{ prompt: PromptMessage[], meta: LastPromptMeta }` or `404` if no prompt yet.
- **UI:** `👁 Prompt` button next to `⚙ Params` in the stat footer opens a modal with:
  - **Meta section** — model, mode, provider, question ID, timestamp, finish reason, token usage, context budget breakdown, generation params.
  - **Prompt messages** — rendered as Markdown (same pipeline as chat: GFM, breaks, syntax highlighting). Images are shown as `**[images: N × base64]**` (base64 content is never stored).
  - **Copy button** — copies the prompt as Markdown (`## System` / `## User:` headers, `---` separators), not JSON.
- **States:** loading spinner → content; `404` → "Промпта ещё нет"; other errors → destructive text.

### Send-error UX

* A failed send does not create a fake "question-error" pair in the chat — a **banner** is shown instead, with classification (context overflow / provider down / network / server), human-readable text and compact numbers (`3.94M / 98K`).
* The question and attachments **return to the composer** — nothing is lost; the "Retry" button re-sends the original request.
* **Persistent banner:** the server writes a failure snapshot into `sessions.last_send_error`, so the incident survives F5 — the banner with timestamp and attachment names waits in the session. One-click quick actions: "Delete pair with file", "New session", "Restore question to composer". The cross icon or a successful send clears the banner (`DELETE /api/sessions/:id/send-error`).

### Attachments and registry

* **Documents:** PDF, DOC/DOCX, XLS/XLSX/CSV — server-side text extraction (`pdfjs`, `word-extractor`, `xlsx`); scanned PDFs without a text layer yield empty text (OCR is a separate topic).
* **Code:** up to 50 files at once, structural parsing and recommendations.
* **Images:** analyzed by vision models. Guaranteed for Ollama; llama.cpp's `images` field in `/v1/chat/completions` is not standardized (see BACKLOG).
* **URLs:** links found in the message text are automatically extracted and turned into text via Mozilla Readability.
* Everything lives in a single `attachments` table (`kind`: document/code/image/reference); files are **never deleted** from disk — not on pair deletion, not on session deletion (orphans are reserved for a future File Manager). Deleting a Q&A pair cascades only into that pair's registry rows (FK ON DELETE CASCADE).

### STT & AI Helper (speech-to-text, fully local)

Two independent voice features share the same whisper.cpp backends:

* **Voice input (composer):** the mic button records audio, the browser converts it to 16 kHz WAV PCM16 and posts it to `POST /api/stt/transcribe`; the server forwards it to whisper.cpp and the recognized text is inserted into the input field (normalized to a single line).
* **AI Helper overlay:** a floating, **resizable** overlay for live meeting capture with **two audio streams** — your microphone (`getUserMedia`) and system audio, i.e. the interlocutor's voice (`getDisplayMedia`). Browser-side **Silero VAD v5** (WebAssembly via `onnxruntime-web`) detects speech segments and filters out non-speech noise. Segments are streamed over WebSocket `/ws/ai-helper` as base64 PCM16; the Node server wraps them into WAV and sends them to **two dedicated whisper.cpp instances in parallel** — port **8081** (user) and port **8082** (interlocutor). Transcripts stream back into the overlay in real time, are persisted to the DB, and selected excerpts can be pushed into the chat as a message. An LLM hint can be streamed on request (`hint_token`/`hint_done`). The overlay is **draggable and resizable** (`min(80vw, 1200px)` default size, `minWidth 320 / minHeight 240`, `maxWidth 95vw / maxHeight 95vh`).

Start both whisper servers with one command:

```bash
cd server && pnpm run whisper
```

`scripts/whisper.sh` runs two `whisper-server` processes: port **8081** — microphone (user voice); port **8082** — system audio (interlocutor voice). Both use `models/ggml-medium.bin`, language `ru`, 12 threads. `Ctrl+C` stops both.

### Sessions and history

* Autosave of the current session (survives page reload).
* Named sessions with categories, loading, return to the current one, a management dashboard, JSON export.
* Markdown rendering of questions and answers (code blocks, tables), model badges, copy question/pair to Markdown, previous/next question navigation, pair deletion.

### Statistics

* Context-load token bar: one formula for the bar and the stats dialog — session tokens (input + output) / model window, capped at 100%.
* Model size ("Size: X.X GB") and context window — dynamic detection (llama.cpp: `meta.size` → `fs.stat(model_path)`; Ollama: from the model list).
* Response metrics: TPS, prompt speed, TTFT, model load time; token counters with cache-hit awareness.

### Three-panel interface

* **Left panel (~20%):** Context tab — Q&A pair navigation, Standard/Manual switcher, pair inclusion checkboxes, `retainPercent` slider; Prompts tab — system prompts (radio), user templates (checkboxes), Prompt Manager / Selected Prompts buttons.
* **Center (~60%):** chat, streaming response with reasoning block, send-error banner, composer with attachments, STT and the context bar; `⚙ Params` button in the stat footer.
* **Right panel (~20%):** provider/model dropdown, mode toggle (Research / Project), project panel (Project mode).

---

## PROJECT Mode

A separate session mode for working on a codebase or a document folder. The goal: the model always sees the **current** state of files — no re-uploading, no stale snapshots.

### How it works

1. Switch the session mode **research → project** in the right panel.
2. Pick a project folder inside `CONTEXT_BASE_DIR`. The session binds to the project (`sessions.project_id`); one active project per session — changing projects means a new session.
3. Attach reference files to the session pool (up to **100 files**, each up to **1 MB** — `MAX_REFERENCE_FILE_SIZE`). Files are **not copied**: a `kind='reference'` registry row is created with a path relative to `CONTEXT_BASE_DIR`.
4. On every request the server reads the attached files **from disk** and puts the current content into `[Materials]` marked "(current version)". mtime cache: if a file has not changed since the last turn, the cached text is reused; if it has, it is re-read.

### RESEARCH vs PROJECT

| | RESEARCH (default) | PROJECT |
|---|---|---|
| Attachments | multipart upload (documents/code/images/URLs) | reference files from the project folder; multipart is rejected (`400`) |
| Text in `[Materials]` | snapshot at send time (`extracted_text`) | read from disk on every request, "(current version)" |
| File changed on disk | does not affect past requests | taken into account from the next request (mtime cache) |
| Folder binding | none | a project inside `CONTEXT_BASE_DIR` is required |
| Diagnostics | `contextInfo` (included/excluded pairs) | + `mode`, `filesAttached`, `filesMissing`, `filesTooLarge` |
| Streaming | SSE supported | SSE supported (RAG layer will extend the same pipeline) |

### Security and limits

* All paths resolve strictly inside `CONTEXT_BASE_DIR` — escaping the base (`..`) is rejected (`400`).
* Project files are opened **read-only** — the app never writes to or deletes anything in your folder.
* If an attached file is deleted from disk or outgrows the limit, its row gets a `missing`/`stale`/`too-large` badge and is excluded from the prompt.
* `CONTEXT_BASE_DIR` not configured → `GET /api/config` returns `ok:false`, the UI shows a red banner and blocks Projects; RESEARCH works without it.
* Detach the project: `DELETE /api/sessions/:id/project` (`project_id=NULL`, mode → `research`, reference rows detached; files on disk untouched).

---

## Installation

### Option 1: Docker (Ollama)

Run Ollama in Docker via the repo's `docker-compose.yml` (GPU through the NVIDIA runtime, persistent volume, 32k context):

```bash
docker compose up -d
```

### Option 2: Local installation

1. Install [Ollama](https://ollama.com) or run `llama-server`.
2. Pull models: `ollama pull qwen2.5-coder`.
3. Build the front end and start the backend (package manager — pnpm):

```bash
cd server && pnpm install && cd ..
cd frontend && pnpm install && pnpm run build && cd ..
cd server && pnpm start
```

Open [http://localhost:3000](http://localhost:3000) — the backend serves the production build from `frontend/dist` (SPA fallback for deep routes; API under `/api`, WebSocket under `/ws`, VAD assets under `/vad-assets`).

### Frontend (`frontend/`)

React 18 + Vite + Tailwind 4 SPA.

* **Development:** `cd frontend && pnpm run dev` — Vite server on **:5175**, proxying `/api`, `/ws`, `/vad-assets` to the backend on :3000.
* **Production:** `pnpm run build` → `frontend/dist`, served by the backend.
* The legacy static front end is archived read-only in `docs/reference/public-archive/` (do not modify).

### Tests and lint

```bash
# Frontend: unit tests (vitest), lint, production build
cd frontend && pnpm run test:run && pnpm run lint && pnpm run build

# Backend: node --test
cd server && pnpm run test:backend
```

### Whisper (STT)

Both whisper servers with a single command:

```bash
cd server && pnpm run whisper
```

---

## Configuration

Configuration is done via environment variables. Create `server/.env` (copy from `server/.env.example`; loaded relative to the backend module — the working directory does not matter; a legacy `.env` in the repo root is also picked up, but `server/.env` takes priority):

```env
# Default provider (ollama | llama_cpp)
DEFAULT_PROVIDER=ollama

# Ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_ENABLED=true

# llama.cpp
LLAMA_CPP_URL=http://localhost:8080
LLAMA_CPP_ENABLED=false

# Server
PORT=3000

# Base directory for relative-path files (REQUIRED for PROJECT mode).
# CONTEXT_BASE_DIR=/home/user/Documents/progs

# Max size of a single reference file in PROJECT mode (bytes, default 1048576 = 1 MB)
# MAX_REFERENCE_FILE_SIZE=1048576
```

STT-related variables (optional, defaults shown): `WHISPER_USER_URL=http://127.0.0.1:8081/inference`, `WHISPER_INTERLOCUTOR_URL=http://127.0.0.1:8082/inference`.

---

## API

### Providers and models

* `GET /api/providers` — configured providers.
* `GET /api/providers/status` — real-time status of all providers.
* `GET /api/models` — models of the active provider (`X-Provider` header).
* `POST /api/show` — model details, including the context window size.

### Prompts

* `GET /api/prompts` — all prompts (sorted by `type`, `created_at`).
* `POST /api/prompts` — create `{ name, type, content }` (validated: name ≤ 200, content ≤ 100 000).
* `PUT /api/prompts/:id` — update `{ name?, content? }` (`type` and `is_default` are immutable).
* `DELETE /api/prompts/:id` — delete (the last default system prompt cannot be deleted).

### Sessions and context

* `POST /api/sessions` — create a session (defaults to `mode='research'`).
* `GET /api/sessions/:id` — session metadata (`mode`, `project_id`, `last_send_error`).
* `PATCH /api/sessions/:id` — update metadata (switching `mode` between `research`/`project`).
* `GET /api/sessions/:id/messages` — message history (grouped into Q&A pairs, each answer includes `answerReasoning`).
* `GET|PATCH /api/sessions/:id/context-config` — context configuration.
* `DELETE /api/sessions/:id/messages/:questionId` — delete a Q&A pair.
* `DELETE /api/sessions/:id/send-error` — dismiss the persistent send-error banner.
* `GET /api/sessions/:id/attachments?kind=reference` — session reference files with `missing`/`mtimeStale` badges.
* `DELETE /api/sessions/:id/project` — detach the project.

### Configuration

* `GET /api/config` — `CONTEXT_BASE_DIR` status: `{ contextBaseDir: { ok, path, error } }`.

### Projects (PROJECT mode)

* `POST /api/projects` — register (or find, idempotent by `path`) a project `{ sessionId, relativePath }`.
* `GET /api/projects/:id` — project info.
* `GET /api/projects/:id/files?filter=<substring>` — recursive file list for the browser.
* `POST /api/projects/:id/attach` — attach reference files `{ sessionId, relativePaths }`.

### Chat

* `POST /api/chat` — send a message to the selected model (multipart/form-data, `X-Provider` header, **`Accept: text/event-stream` for streaming**).
  *Accepts:* `sessionId`, `message`, `model`, `contextLength`, `retainPercent`, `includeQuestionIds`, `generationParams` (7 fields), `syspromptId`, `selectedTemplateIds` (JSON string), `file` (one document **or** image), `codeFiles` (up to 50) — all combinable (except PROJECT mode restrictions).
  *Limits:* `message` > 64 000 chars → instant `400 {code:'message_too_long'}`; prompt overflow → `400 {code:'context_overflow', estimatedTokens, contextLength}`.
  *Streaming response format:* SSE events — `token` (`{delta}`), `reasoning` (`{delta}`), `done` (`{metrics, finishReason, questionId, excludedIndices, contextInfo}`), `error` (`{error, ...}`). Mid-stream disconnect — partial saved, no `done`.
  *Non-streaming response:* JSON `{ response, reasoning, metrics, questionId, attachmentsMeta, excludedIndices, contextInfo }` (as before).
  *Vision:* JSON only (no streaming).

### Speech-to-text

* `POST /api/stt/transcribe` — multipart audio file (`audio` field) → whisper.cpp → `{ text }`.
* `WS /ws/ai-helper` — AI Helper protocol: `audio_chunk` (PCM16 base64) in, `transcript` / streaming LLM hints out.

### Attachments

* `GET /api/attachments/:fileId` — metadata (registry row).
* `GET /api/attachments/:fileId/raw` — the original file.
* `GET /api/attachments/:fileId/thumb` — 150×150 thumbnail (images only).
* `DELETE /api/attachments/:fileId` — detach: only the registry row is removed; the file on disk is untouched.

---

## Project Structure

```text
chat-app/
├── server/                         # Backend (Express 5 + better-sqlite3 + WS), port :3000
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── chatController.js   # Streaming (SSE), reasoning, message cap, pre-flight, error snapshots
│   │   │   ├── promptController.js # /api/prompts CRUD
│   │   │   └── sttController.js
│   │   ├── services/
│   │   │   ├── contextBuilder.js   # Prompt assembly: system + [Материалы] + [Инструкции] + [Ранее] + [Вопрос]; adaptive budget
│   │   │   ├── metricsService.js   # Response metrics; full prompt inputTokens
│   │   │   ├── projectService.js
│   │   │   ├── sessionService.js
│   │   │   └── attachmentService.js
│   │   ├── db/
│   │   │   ├── init.js             # prompts, messages.reasoning, sysprompt_id, etc.
│   │   │   ├── promptRepo.js, promptSeeds.js
│   │   │   ├── messageRepo.js, sessionRepo.js, attachmentRepo.js, projectRepo.js
│   │   ├── providers/
│   │   │   ├── OllamaProvider.js   # stream with onToken, buffered SSE, reasoning_content
│   │   │   └── LlamaCppProvider.js # stream with onToken, buffered SSE, reasoning_content
│   │   ├── utils/
│   │   │   ├── generationParams.js # Per-message param validation
│   │   │   └── docExtract.js
│   │   ├── ws/aiHelperWs.js
│   │   └── routes/
│   ├── scripts/whisper.sh
│   ├── tests/
│   ├── public/vad-assets/
│   └── data/                       # SQLite + uploads (gitignored)
├── frontend/                       # React 18 + Vite + Tailwind 4
│   ├── src/
│   │   ├── features/
│   │   │   ├── chat/components/chat-area.tsx      # Chat + streaming UI + ReasoningBlock
│   │   │   ├── chat/components/reasoning-block.tsx
│   │   │   ├── chat/components/generation-params-modal.tsx
│   │   │   ├── questions/components/questions-panel.tsx
│   │   │   ├── prompts/components/prompt-manager.tsx, prompt-form-modal.tsx,
│   │   │   │   prompts-tab.tsx, selected-prompts-modal.tsx
│   │   │   ├── models/components/settings-panel.tsx, mode-toggle.tsx, project-panel.tsx
│   │   │   ├── sessions/components/save-modal.tsx, load-modal.tsx
│   │   │   ├── dashboard/components/dashboard.tsx
│   │   │   ├── ai-helper/components/ai-helper-overlay.tsx
│   │   │   └── stt/components/stt-input.tsx
│   │   ├── lib/
│   │   │   ├── apiGateway.ts       # chatApi.send + chatApi.sendStream (SSE)
│   │   │   ├── generationParams.ts # client-side spec + presets
│   │   │   ├── messageCap.ts, sendError.ts, stats.ts, export.ts, audio.ts
│   │   │   ├── vadManager.ts, aiHelperSocket.ts, chatRender.ts
│   │   │   └── logger.ts
│   │   ├── stores/
│   │   │   ├── sessionStore.ts     # includes streaming state + sendMessageStream
│   │   │   ├── providerStore.ts
│   │   │   ├── generationParamsStore.ts
│   │   │   ├── promptStore.ts
│   │   │   ├── projectStore.ts
│   │   │   ├── uiStore.ts
│   │   │   └── aiHelperStore.ts
│   │   └── types/index.ts
│   └── dist/                       # production build
├── docs/                           # WORKLOG, WORKFLOW, plans, STT_SYSTEM, reference
└── BACKLOG.md
```

---

## Adding a New Provider

1. Create a class extending `BaseProvider` in `server/src/providers/`.
2. Register it in `server/src/providers/providerManager.js`.
3. Add its configuration to `server/src/config/providers.js`.

*Controllers, services and routes stay untouched. If the provider supports reasoning/streaming, forward `onToken(type, delta)` inside its `chat()` method — the transport layer will handle the rest.*

---

## Requirements

* Node.js 20+
* pnpm 10+
* Ollama installed and running, **or** a llama.cpp server (`llama-server`) with a loaded GGUF model
* (optional, for STT) [whisper.cpp](https://github.com/ggml-org/whisper.cpp) built with `whisper-server` and a `ggml-medium.bin` model — see `server/scripts/whisper.sh`

## License

MIT