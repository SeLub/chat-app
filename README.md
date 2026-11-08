# Multi-Provider AI Chat App

A modern web chat interface for local LLM providers with advanced model management, real-time statistics, multi-provider support (Ollama, llama.cpp), and intelligent context management.

## Features

### 🎯 Multi-Provider Architecture
* Unified interface for multiple LLM providers.
* **Ollama** — full-featured integration with model management.
* **llama.cpp** — support for GGUF models via `llama-server`.
* Provider switching via radio buttons in UI (selection persists in `localStorage`).
* Automatic detection of provider status and available models.

### 🧠 Conversational Context & Memory Management
The application intelligently manages the context sent to the LLM to prevent overflow and allow precise control over the model's "memory".

**Context Formula:**
```text
Total Context = System Prompt + Files/URLs Text + Selected History (Q&A Pairs) + Current Prompt
```

**Two Operating Modes:**
1. **Standard Mode (Default):** Automatically includes all previous Q&A pairs. If the total context exceeds the model's limit (calculated with an 80% safety buffer), it automatically trims the oldest pairs using a LIFO (Last-In-First-Out) approach.
2. **Manual Mode:** Gives the user full control. You can select exactly which Q&A pairs to include via checkboxes. Only the selected pairs are sent to the LLM.

**KV-Cache Management (llama.cpp specific):**
When using the `llama.cpp` provider, the server caches the KV-state between requests to speed up generation. To ensure the model strictly adheres to the selected context (especially in Manual mode, where pairs are intentionally excluded), the backend dynamically sends parameters to bypass the KV-cache for that specific request.
*Note: If you switch to the `Ollama` provider, these specific cache parameters are safely ignored by Ollama's API, as it manages its own internal context state.*

### 📝 System Prompt
* Dedicated textarea in the right panel to define the AI's behavior.
* Automatically saved per session in the database.
* Injected as the `system` role at the very beginning of the context (protected from trimming).

### 🖥️ Three-Panel Layout
* **Left Panel (20%):** Questions navigation panel with model indicators and context selection (Standard/Manual modes).
* **Middle Panel (60%):** Chat interface with markdown-formatted responses.
* **Right Panel (20%):** Provider selection, model dropdown, System Prompt, and live statistics.

### 💬 Enhanced Chat Experience
* Markdown formatting for both user questions and bot responses (headers, code blocks, tables, etc.).
* Context awareness notice: If Q&A pairs are excluded from the context, a visual warning is shown above the bot's response.
* Model badges showing which model answered each question.
* Message actions: copy question, copy Q&A (as Markdown), jump between Q&A pairs, delete Q&A pairs.
* Navigation buttons: Previous/Next question jumps.

### 💾 Conversation Persistence
* Auto-save current session (survives page reload).
* Save named conversations with custom titles and categories.
* Load and manage multiple saved conversations.
* Return to current conversation after browsing saved ones.
* Export conversations to JSON files.
* Dedicated dashboard for conversation management.

### 📄 Document & Code Processing
* **Documents:** PDF, DOC/DOCX, XLS/XLSX/CSV text extraction and analysis.
* **Code:** Multiple code file upload (up to 50 files), structured analysis and recommendations.
* **Images:** Upload and analysis with vision models (llama3.2-vision, llava, gemma3).
* **Web Content:** Automatic URL detection, web page content extraction using Mozilla Readability.

### 📊 Statistics Dashboard
* Model size and Context window size (dynamic detection).
* Live question count and estimated token usage.
* Real-time response time tracking (TPS, Prompt Speed, TTFT, Load Time).

---

## Setup

### Option 1: Docker Setup (Recommended for Ollama)
Run Ollama in Docker:
```bash
chmod +x run-ollama-docker.sh
./run-ollama-docker.sh
```

### Option 2: Local Installation
1. Install [Ollama](https://ollama.com) or run `llama-server`.
2. Download models: `ollama pull qwen2.5-coder`
3. Build the frontend (React app in `webq98/`) and start the backend (pnpm is the default package manager — both lockfiles are `pnpm-lock.yaml`):
```bash
pnpm install
cd webq98 && pnpm install && pnpm run build && cd ..
pnpm start
```
Open in browser: [http://localhost:3000](http://localhost:3000) — the backend serves the production build from `webq98/dist` (SPA-fallback for deep routes; API under `/api`, WebSocket under `/ws`, VAD assets under `/vad-assets`).

### Frontend (`webq98/`)
The UI is a React 18 + Vite + Tailwind 4 SPA located in `webq98/`.
* **Development:** `cd webq98 && pnpm run dev` — Vite dev server on **:5175**, proxying `/api`, `/ws` and `/vad-assets` to the backend on :3000.
* **Production:** `pnpm run build` → outputs `webq98/dist`; the backend on :3000 serves this build, with an SPA-fallback that returns `index.html` for unknown GET routes.
* The legacy static frontend is archived read-only in `docs/reference/public-archive/` (golden master, do not modify).

### Whisper (STT)
For real-time speech recognition, start both whisper instances at once:

```bash
pnpm run whisper
```

This runs `scripts/whisper.sh`, which launches two `whisper-server` processes:
- Port **8081** — microphone (user voice)
- Port **8082** — system audio (interlocutor voice)

Both use `models/ggml-medium.bin`, language `ru`, 12 threads. Press `Ctrl+C` to stop both.

---

## Configuration

The application uses environment variables for provider configuration. Create a `.env` file or pass variables at startup:

```env
# Default provider (ollama | llama_cpp)
DEFAULT_PROVIDER=ollama

# Ollama configuration
OLLAMA_URL=http://localhost:11434
OLLAMA_ENABLED=true

# llama.cpp configuration
LLAMA_CPP_URL=http://localhost:8080
LLAMA_CPP_ENABLED=false

# Server configuration
PORT=3000
```

---

## API Endpoints

### Provider Management
* `GET /api/providers` — List all configured providers.
* `GET /api/providers/status` — Get real-time status of all providers.

### Models
* `GET /api/models` — List all available models from active provider (requires `X-Provider` header).
* `POST /api/show` — Get detailed model information including context window size.

### Sessions & Context
* `POST /api/sessions` — Create a new conversation session.
* `GET /api/sessions/:id` — Get session metadata (including `sysprompt`).
* `PATCH /api/sessions/:id` — Update session metadata (e.g., save `sysprompt`).
* `GET /api/sessions/:id/messages` — Get full message history (grouped as Q&A pairs).
* `GET /api/sessions/:id/context-config` — Get context configuration (mode, retainPercent).
* `PATCH /api/sessions/:id/context-config` — Update context configuration.
* `DELETE /api/sessions/:id/messages/:questionId` — Delete a specific Q&A pair.

### Chat
* `POST /api/chat` — Send message to selected model (multipart/form-data, requires `X-Provider` header). 
  *Accepts:* `sessionId`, `message`, `model`, `contextLength`, `retainPercent`, `includeQuestionIds` (for Manual mode).

---

## Project Structure

```text
chat-app/
 ├── src/                            # Backend (Express 5 + better-sqlite3 + WS), port :3000
 │   ├── controllers/
 │   │   └── chatController.js       # Handles context building, LLM calls, and KV-cache bypass
 │   ├── services/
 │   │   ├── contextBuilder.js       # Pure math for LIFO trimming and Q&A filtering
 │   │   ├── sessionService.js       # Session and message management
 │   │   ├── fileService.js          # PDF/DOC/XLS/code processing
 │   │   └── webService.js           # URL content extraction
 │   ├── providers/
 │   │   ├── OllamaProvider.js
 │   │   └── LlamaCppProvider.js     # Handles llama.cpp specific cache parameters
 │   ├── db/                         # SQLite repos; runtime DB files live in data/ (gitignored)
 │   └── routes/
 ├── tests/                          # Backend tests (node --test)
 ├── public/vad-assets/              # VAD/ORT assets, served with COOP/COEP headers
 ├── webq98/                         # Frontend: React 18 + Vite + Tailwind 4
 │   ├── src/                        # UI logic, Standard/Manual mode toggling
 │   └── dist/                       # Production build (gitignored), served by the backend
 └── data/                           # Runtime SQLite (chat.db), gitignored
```

---

## Adding a New Provider
To add a third provider (e.g., vLLM, LocalAI):
1. Create a class extending `BaseProvider` in `src/providers/`.
2. Register it in `src/providers/providerManager.js`.
3. Add configuration in `src/config/providers.js`.
*No changes to controllers, services, or routes are needed.*

---

## Requirements
* Node.js 18+
* pnpm 10+ — the default package manager (root and `webq98/` both use `pnpm-lock.yaml`)
* Ollama installed and running, OR
* llama.cpp server (`llama-server`) with a loaded GGUF model.

## License
MIT