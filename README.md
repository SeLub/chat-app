# Chat-App — Local Web Chat for Local LLMs (llama.cpp / Ollama)

A local-first web shell for local language models: a React SPA front end plus an Express 5 + SQLite + WebSocket server, running entirely on your machine. No external APIs — the model, your files, speech transcription and usage statistics all stay local.

Key ideas of the product:

- **Smart context management** — adaptive history budget based on measured token density, pre-flight overflow check before the LLM call, manual selection of included pairs, LIFO trimming.
- **PROJECT mode** — bind a session to a project folder: reference files are read from disk in their current state on every request (see its own section below).
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
| STT | whisper.cpp (two `whisper-server` instances) + Silero VAD v5 in the browser (WASM: `@ricky0123/vad-web` 0.0.30 + `onnxruntime-web` 1.22.0) |
| Documents & URLs | pdfjs-dist (PDF), word-extractor (DOC/DOCX), xlsx (XLS/XLSX/CSV), Mozilla Readability + cheerio (web pages) |
| Tooling | pnpm 10+, Vitest (frontend), `node --test` (backend), ESLint, Docker Compose (Ollama) |

---

## Features

### Multi-provider

* One provider interface: **Ollama** (model management) and **llama.cpp** (GGUF via `llama-server`).
* Provider switch and model picker in the right panel dropdown; the choice is persisted in `localStorage`.
* Live provider status detection (`connected`/`disconnected`/`error`) and available model lists.
* A new provider (vLLM, LocalAI, etc.) is one `BaseProvider` subclass + registration in `providerManager.js` and `config/providers.js` — no controller or service changes.

### Context management

The prompt is assembled deterministically (`contextBuilder.js`):

```text
EXACTLY one system (sysprompt) + [Materials] (attachment/URL/project file text)
+ [Earlier in this session] (trimmed Q&A-pair history) + [Question] (current message)
```

**Two history modes:**

1. **Standard** — previous Q&A pairs are included automatically; when space runs out, the oldest pairs are trimmed first (LIFO). The `retainPercent` slider sets how much of the history budget past pairs may occupy.
2. **Manual** — you tick which pairs to include (`includeQuestionIds`); anything unticked never reaches the prompt.

**Adaptive history budget.** The trimming boundary is computed from the **measured density** of the session, not a constant "4 chars = 1 token": `charsPerToken = promptChars / inputTokens` of the last text answer (the app knows both the prompt character count and the real tokenizer count). Budget: `maxChars = ctx × density × 0.9` (10% margin for tokenizer variance). Density is accepted only from a trusted band **[1.0; 5.0]**; with no metrics yet (first turn) it falls back to `4` without margin. On Cyrillic (real density ~1.3–2.5 chars/token) the history budget automatically shrinks 2–3× — overflow is eliminated at the root. Current values are exposed in the server response (`contextInfo.charsPerToken`, `charsPerTokenSource`).

**Overflow pre-flight.** Before calling the LLM, the server estimates the prompt on the same measured density; if it clearly does not fit, it returns an instant `400 {code:'context_overflow', estimatedTokens, contextLength}` without touching the model. A hard 400 from llama.cpp (`exceed_context_size_error`) is parsed, and the real tokenizer numbers (`n_prompt_tokens`/`n_ctx`) are surfaced to the UI.

**Message length cap.** A message longer than **64,000 characters** is not sent: the composer blocks the Send button and Enter with a hint and counter (shown above 90% of the cap); direct API calls get an instant `400 {code:'message_too_long', messageLength, maxMessageChars}` before URL/attachment processing.

**llama.cpp cache awareness.** `inputTokens` in the metrics is the full prompt size (`usage.prompt_tokens`, fallback `timings.prompt_n + cache_n`): with llama.cpp slot caching the token bar and per-session totals are not undercounted on cache hits; `cachedTokens` is also visible in the metrics.

### Send-error UX

* A failed send does not create a fake "question-error" pair in the chat — a **banner** is shown instead, with classification (context overflow / provider down / network / server), human-readable text and compact numbers (`3.94M / 98K`).
* The question and attachments **return to the composer** — nothing is lost; the "Retry" button re-sends the original request.
* **Persistent banner:** the server writes a failure snapshot into `sessions.last_send_error`, so the incident survives F5 — the banner with timestamp and attachment names waits in the session. One-click quick actions: "Delete pair with file" (finds the last pair whose attachment is injected into every request), "New session", "Restore question to composer". The cross icon or a successful send clears the banner (dismiss route: `DELETE /api/sessions/:id/send-error`).

### Attachments and registry

* **Documents:** PDF, DOC/DOCX, XLS/XLSX/CSV — server-side text extraction (`pdfjs`, `word-extractor`, `xlsx`); scanned PDFs without a text layer yield empty text (OCR is a separate topic).
* **Code:** up to 50 files at once, structural parsing and recommendations.
* **Images:** analyzed by vision models. Guaranteed for Ollama; llama.cpp's `images` field in `/v1/chat/completions` is not standardized (see BACKLOG).
* **URLs:** links found in the message text are automatically extracted and turned into text via Mozilla Readability.
* Everything lives in a single `attachments` table (`kind`: document/code/image/reference); files are **never deleted** from disk — not on pair deletion, not on session deletion (orphans are reserved for a future File Manager). Deleting a Q&A pair cascades only into that pair's registry rows (FK ON DELETE CASCADE).

### STT & AI Helper (speech-to-text, fully local)

Two independent voice features share the same whisper.cpp backends:

* **Voice input (composer):** the mic button records audio, the browser converts it to 16 kHz WAV PCM16 and posts it to `POST /api/stt/transcribe`; the server forwards it to whisper.cpp and the recognized text is inserted into the input field (normalized to a single line).
* **AI Helper overlay:** a floating overlay for live meeting capture with **two audio streams** — your microphone (`getUserMedia`) and system audio, i.e. the interlocutor's voice (`getDisplayMedia`). Browser-side **Silero VAD v5** (WebAssembly via `onnxruntime-web`) detects speech segments and filters out non-speech noise (keyboard, coughing, music, notifications). Segments are streamed over WebSocket `/ws/ai-helper` as base64 PCM16; the Node server wraps them into WAV and sends them to **two dedicated whisper.cpp instances in parallel** — port **8081** (user) and port **8082** (interlocutor). Transcripts stream back into the overlay in real time, are persisted to the DB, and selected excerpts can be pushed into the chat as a message. An LLM hint can be streamed on request (`hint_token`/`hint_done`).

Key characteristics: 1–3 s speech-to-text latency; 16,000 Hz PCM16 mono; Russian recognition with correct capture of English terms; everything computed locally (models in the browser + local whisper servers). The server sends cross-origin isolation headers (`COOP: same-origin`, `COEP: credentialless`) so multi-threaded WASM/`SharedArrayBuffer` works for the VAD; VAD/ONNX assets are served from `/vad-assets`.

Start both whisper servers with one command:

```bash
cd server && pnpm run whisper
```

`scripts/whisper.sh` runs two `whisper-server` processes: port **8081** — microphone (user voice); port **8082** — system audio (interlocutor voice, for the AI Helper). Both use `models/ggml-medium.bin`, language `ru`, 12 threads. `Ctrl+C` stops both.

### Sessions and history

* Autosave of the current session (survives page reload).
* Named sessions with categories, loading, return to the current one, a management dashboard, JSON export.
* Markdown rendering of questions and answers (code blocks, tables), model badges, copy question/pair to Markdown, previous/next question navigation, pair deletion.

### Statistics

* Context-load token bar: one formula for the bar and the stats dialog — session tokens (input + output) / model window, capped at 100%.
* Model size ("Size: X.X GB") and context window — dynamic detection (llama.cpp: `meta.size` → `fs.stat(model_path)`; Ollama: from the model list).
* Response metrics: TPS, prompt speed, TTFT, model load time; token counters with cache-hit awareness.

### Three-panel interface

* **Left panel (~20%):** Q&A pair navigation, Standard/Manual switcher, pair inclusion checkboxes, `retainPercent` slider.
* **Center (~60%):** chat, send-error banner, composer with attachments, STT and the context bar.
* **Right panel (~20%):** provider/model, System Prompt (persisted in the DB, injected first and protected from trimming), live statistics, PROJECT mode panel.

---

## PROJECT Mode

A separate session mode for working on a codebase or a document folder. The goal: the model always sees the **current** state of files — no re-uploading, no stale snapshots.

### How it works

1. Switch the session mode **research → project** in the right panel (switching in a live session is allowed: old Q&A pairs remain; `contextInfo.modeChangedAtQuestion` warns about the switch).
2. Pick a project folder inside `CONTEXT_BASE_DIR` (file browser with search; `node_modules`, `.git`, `dist`, `build`, `.next`, `__pycache__`, `*.min.*`, `*.map` and junk files are ignored). The session binds to the project (`sessions.project_id`); one active project per session — changing projects means a new session.
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

### Security and limits

* All paths resolve strictly inside `CONTEXT_BASE_DIR` — escaping the base (`..`) is rejected (`400`).
* Project files are opened **read-only** — the app never writes to or deletes anything in your folder.
* If an attached file is deleted from disk or outgrows the limit, its row gets a `missing`/`stale`/`too-large` badge in the attached list (`GET /api/sessions/:id/attachments?kind=reference`) and is excluded from the prompt.
* `CONTEXT_BASE_DIR` not configured → `GET /api/config` returns `ok:false`, the UI shows a red banner and blocks Projects; RESEARCH mode works without it.
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
3. Build the front end and start the backend (package manager — pnpm, both packages have `pnpm-lock.yaml`):

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

Both whisper servers with a single command — see the "STT & AI Helper" section above:

```bash
cd server && pnpm run whisper
```

---

## Configuration

Configuration is done via environment variables. Create `server/.env` (copy from `server/.env.example`; the file is loaded relative to the backend module — the working directory does not matter; a legacy `.env` in the repo root is also picked up, but `server/.env` takes priority) or pass variables at startup:

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
# Projects and reference files (attachments with path_base='context') resolve
# inside it; escaping it is rejected. RESEARCH works without it.
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

### Sessions and context

* `POST /api/sessions` — create a session (defaults to `mode='research'`).
* `GET /api/sessions/:id` — session metadata (`sysprompt`, `mode`, `project_id`, `last_send_error`).
* `PATCH /api/sessions/:id` — update metadata (incl. `sysprompt`, switching `mode` between `research`/`project`; other values → `400`).
* `GET /api/sessions/:id/messages` — message history (grouped into Q&A pairs).
* `GET|PATCH /api/sessions/:id/context-config` — context configuration (`mode`, `retainPercent`).
* `DELETE /api/sessions/:id/messages/:questionId` — delete a Q&A pair.
* `DELETE /api/sessions/:id/send-error` — dismiss the persistent send-error banner.
* `GET /api/sessions/:id/attachments?kind=reference` — session reference files with `missing`/`mtimeStale` badges.
* `DELETE /api/sessions/:id/project` — detach the project (`project_id=NULL`, `mode='research'`, reference rows detached; disk files untouched).

### Configuration

* `GET /api/config` — `CONTEXT_BASE_DIR` status: `{ contextBaseDir: { ok, path, error } }` (checked on every request; `ok:false` → red banner, Projects blocked).

### Projects (PROJECT mode)

* `POST /api/projects` — register (or find, idempotent by `path`) a project `{ sessionId, relativePath }` relative to `CONTEXT_BASE_DIR`; binds `sessions.project_id`, sets `mode='project'`, counts files (excluding `node_modules/.git/dist/build/.next/__pycache__/*.min.*/*.map/.DS_Store/Thumbs.db`). Traversal / missing directory / no base → `400`.
* `GET /api/projects/:id` — project info (`id`, `name`, `path`).
* `GET /api/projects/:id/files?filter=<substring>` — recursive file list for the browser (case-insensitive filter, first 500, `truncated` flag; sizes only, content is not read).
* `POST /api/projects/:id/attach` — attach reference files `{ sessionId, relativePaths }`: rows in `attachments` (`kind='reference'`, `path_base='context'`, `extracted_text=''`); files are not copied. Idempotent by `session_id+file_path`; oversized (> `MAX_REFERENCE_FILE_SIZE`) / traversal / missing → per-path `errors`. Max 100 reference files per session.

### Chat

* `POST /api/chat` — send a message to the selected model (multipart/form-data, `X-Provider` header).
  *Accepts:* `sessionId`, `message`, `model`, `contextLength`, `retainPercent`, `includeQuestionIds` (for Manual mode), `file` (one document **or** image), `codeFiles` (up to 50) — all combinable.
  *Limits:* `message` longer than 64,000 characters → instant `400 {code:'message_too_long'}` (before URL/attachment processing); a prompt that clearly does not fit the context → `400 {code:'context_overflow', estimatedTokens, contextLength}` (pre-flight, before the LLM call).
  *RESEARCH* assembles `[Materials]` document → code → user text via the single registry; *PROJECT* ignores multipart attachments (passing `file`/`codeFiles`/images → `400`) and reads the current pool of reference files from disk with an mtime cache ("(current version)" in `[Materials]`, `contextInfo.mode/filesAttached/filesMissing/filesTooLarge`).

### Speech-to-text

* `POST /api/stt/transcribe` — multipart audio file (`audio` field) → whisper.cpp → `{ text }`.
* `WS /ws/ai-helper` — AI Helper protocol: `audio_chunk` (role `user`|`interlocutor`, PCM16 base64) in, `transcript` / streaming LLM hints (`hint_token`/`hint_done`) out.

### Attachments

* `GET /api/attachments/:fileId` — metadata (registry row).
* `GET /api/attachments/:fileId/raw` — the original file (`path_base='data'` → `server/data/uploads`, `path_base='context'` → `CONTEXT_BASE_DIR`; traversal → `400`).
* `GET /api/attachments/:fileId/thumb` — 150×150 thumbnail (images only).
* `DELETE /api/attachments/:fileId` — detach: only the registry row is removed; the file on disk is untouched (`attachments_meta` of past messages remains an immutable snapshot).

Images live in the unified `attachments` registry (`kind='image'`, `path_base='data'`, file under `server/data/uploads/`); previews in history are built from `attachments_meta`. Files are **never** deleted when Q&A pairs or sessions are removed (orphans are reserved for a future File Manager).

---

## Project Structure

```text
chat-app/
 ├── server/                         # Backend (Express 5 + better-sqlite3 + WS), port :3000
 │   ├── src/
 │   │   ├── controllers/
 │   │   │   ├── chatController.js   # [Question] (vision — + images), registry, message cap, pre-flight, persistent error snapshots
 │   │   │   └── sttController.js    # Voice input: multipart audio → whisper.cpp → text
 │   │   ├── services/
 │   │   │   ├── contextBuilder.js   # Prompt assembly: one system + [Materials]/[Earlier]; adaptive budget, LIFO trimming
 │   │   │   ├── metricsService.js   # Response metrics; inputTokens = full prompt (usage → prompt_n+cache_n → prompt_n)
 │   │   │   ├── projectService.js   # PROJECT mode: project registration, file browser, reference attach
 │   │   │   ├── sessionService.js   # Sessions and messages (+ last_send_error)
 │   │   │   ├── attachmentService.js # Attachment registry: storage + text extraction
 │   │   │   └── webService.js       # URL content extraction
 │   │   ├── ws/
 │   │   │   └── aiHelperWs.js       # AI Helper WebSocket: audio chunks → whisper → transcripts
 │   │   ├── utils/
 │   │   │   └── docExtract.js       # Text extraction by extension (pdfjs/word-extractor/xlsx; otherwise utf-8)
 │   │   ├── providers/
 │   │   │   ├── OllamaProvider.js
 │   │   │   └── LlamaCppProvider.js # 400 parsing (exceed_context_size_error → n_prompt_tokens/n_ctx), model size
 │   │   └── routes/
 │   ├── scripts/whisper.sh          # Starts both whisper-server instances (:8081, :8082)
 │   ├── tests/                      # Backend tests (node --test)
 │   ├── public/vad-assets/          # VAD/ORT assets, served with COOP/COEP
 │   └── data/                       # Runtime, gitignored: SQLite (chat.db) + uploads/ (images and thumbnails)
 ├── frontend/                       # Frontend: React 18 + Vite + Tailwind 4
 │   ├── src/
 │   │   ├── features/               # chat / questions / models / sessions / stt / ai-helper / dashboard
 │   │   ├── lib/                    # Pure helpers: apiGateway, stats, sendError, messageCap, audio, export…
 │   │   ├── stores/                 # Zustand: session, provider, project, ui, aiHelper
 │   │   └── shared/                 # Sidebar, TopBar, command palette
 │   └── dist/                       # Production build (gitignored), served by the backend
 ├── BACKLOG.md                      # Deferred tasks (repo root)
└── docs/                            # WORKLOG/WORKFLOW + plans/ + STT_SYSTEM.md + reference/ (legacy archives)
```

---

## Adding a New Provider

To add a third provider (e.g. vLLM, LocalAI):

1. Create a class extending `BaseProvider` in `server/src/providers/`.
2. Register it in `server/src/providers/providerManager.js`.
3. Add its configuration to `server/src/config/providers.js`.

*Controllers, services and routes stay untouched.*

---

## Requirements

* Node.js 20+
* pnpm 10+ — the default package manager (`server/` and `frontend/` use `pnpm-lock.yaml`)
* Ollama installed and running, **or**
* a llama.cpp server (`llama-server`) with a loaded GGUF model
* (optional, for STT) [whisper.cpp](https://github.com/ggml-org/whisper.cpp) built with `whisper-server` and a `ggml-medium.bin` model — see `server/scripts/whisper.sh`

## License

MIT
