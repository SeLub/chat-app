# Plan: Save Context During Chat with Selected Model

## Problem

The chat app sends each user message as a standalone prompt via `generate()`. The LLM has no memory of previous messages in the conversation. Both providers already implement a `chat()` method that accepts a full message array, but it is never used.

## Current State

- **Frontend**: Messages stored in `localStorage` keys (`currentConversation`, `currentQuestions`, `questionCounter`). Auto-saved after every message.
- **Backend**: `chatController.js:91-101` calls `req.provider.generate({ model, prompt })` — single-message, stateless.
- **Providers**: Both `OllamaProvider` and `LlamaCppProvider` have a working `chat({ model, messages, stream })` method that supports conversation history via `/api/chat` (Ollama) and `/v1/chat/completions` (llama.cpp).
- **No new dependencies needed**: everything required already exists.

## Architecture

```
Frontend                        Backend                          Provider
  |                               |                                |
  |  POST /api/session             |                                |
  |------------------------------>|                                |
  |  { sessionId }                 |                                |
  |<------------------------------|                                |
  |                               |                                |
  |  POST /api/chat              |                                |
  |  { message, model,            |                                |
  |    sessionId }                |                                |
  |------------------------------>|                                |
  |                               |  Build history from session     |
  |                               |  store + new user message       |
  |                               |  → messages array               |
  |                               |                                |
  |                               |  Provider.chat({ model,         |
  |                               |    messages: [...] })           |
  |                               |------------------------------>|
  |                               |<-------------------------------|
  |                               |  { response, metrics }        |
  |                               |                                |
  |  { response, metrics }        |                                |
  |<------------------------------|                                |
```

## Implementation Steps

### Step 1: Create Session Service

**File**: `src/services/sessionService.js` (NEW)

- In-memory `Map<sessionId, messages[]>` — keyed by session ID string.
- Methods:
  - `createSession()`: generates UUID, returns `{ sessionId }`. Clears any existing session for that ID if re-created.
  - `storeMessage(sessionId, { role, content, model })`: appends message to history. Returns updated history array.
  - `getHistory(sessionId)`: returns the full messages array (ready to send to provider).
  - `clearSession(sessionId)`: removes session from store.
  - `truncateToContext(history, contextLength)`: if total chars exceed `contextLength * 4`, remove oldest entries until under limit.

- Session cleanup: periodic interval (every 5 min) removes sessions unused for 30+ minutes.

### Step 2: Add Session Endpoints

**File**: `src/routes/chatRoutes.js` (MODIFY)

- `POST /api/session`:
  - Call `sessionService.createSession()`
  - Return `{ sessionId }`
  - Store sessionId in response as a cookie OR return in body for frontend to use in request body

- `DELETE /api/session`:
  - Read sessionId from request body (same way chat requests pass it)
  - Call `sessionService.clearSession(sessionId)`
  - Return `{ ok: true }`

**File**: `src/app.js` (MODIFY)

- Register the new session routes on `/api/session` before the existing route middleware chain.

### Step 3: Update Chat Controller to Use Session History

**File**: `src/controllers/chatController.js` (MODIFY)

Changes in `chatHandler()`:

1. Read `sessionId` from `req.body.sessionId`.
2. If no session exists, return 400 error with hint to create one first.
3. Store the new user message in session: `sessionService.storeMessage(sessionId, { role: 'user', content: message, model })`.
4. Retrieve full history: `const messages = sessionService.getHistory(sessionId)`.
5. Get model's context length (already available from frontend — pass it in request body, or fetch via `/api/show` on backend).
6. Truncate if needed: `const trimmed = sessionService.truncateToContext(messages, contextLength)`.
7. Instead of calling `req.provider.generate({ model, prompt: message })`, call:
   ```js
   const result = await req.provider.chat({
     model,
     messages: trimmed,
     stream: false
   });
   ```
8. Store the assistant response in session after receiving it:
   ```js
   sessionService.storeMessage(sessionId, { role: 'assistant', content: result.response, model });
   ```

### Step 4: Update Frontend Session Management

**File**: `public/script.js` (MODIFY)

Changes needed:

1. **On page load** (in `window.addEventListener('DOMContentLoaded')`):
   - Check localStorage for existing `sessionId`. If none, call `POST /api/session` and save the returned ID to localStorage.
   - Use this `sessionId` for all subsequent requests.

2. **In `sendMessage()`** (`script.js:275`):
   - Append `sessionId` to the FormData: `formData.append('sessionId', currentSessionId)`.

3. **In `clearChat()`** (`script.js:714`):
   - After clearing localStorage, also call `DELETE /api/session` with the sessionId.

4. **Pass context window to backend**:
   - When model is selected in `handleModelSelect()`, fetch its `contextLength` via `/api/show` (already done in `updateModelInfo()`). Store it in a global variable `currentContextLength`.
   - Append `formData.append('contextLength', currentContextLength)` to chat requests.

### Step 5: Enable Streaming in Provider `chat()` Methods (Optional but Recommended)

**File**: `src/providers/OllamaProvider.js` (MODIFY)

- In `chat()`, add SSE streaming support when `stream: true`:
  - Read the response body as a stream of JSON lines
  - Accumulate content chunks
  - Extract metrics from the final chunk
  - Return `{ response, metrics }` just like non-streaming mode

**File**: `src/providers/LlamaCppProvider.js` (MODIFY)

- Same SSE streaming support in `chat()` for `/v1/chat/completions` stream endpoint.

This enables step 5 below.

### Step 6: Update Chat Routes to Accept Stream Parameter

**File**: `src/controllers/chatController.js` (MODIFY)

- Add optional `stream` parameter from request body.
- If `stream: true`, set up SSE response to client instead of JSON:
  - Send each token chunk as a line: `data: { token: "..." }\n\n`
  - Final chunk includes metrics: `data: { done: true, metrics: {...} }\n\n`

**File**: `public/script.js` (MODIFY)

- In `sendMessage()`, if streaming is enabled, switch from `fetch().json()` to reading the response stream with `getReader()` and appending tokens to the bot message in real-time.

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/services/sessionService.js` | **NEW** | In-memory session store with history, truncation, cleanup |
| `src/controllers/chatController.js` | MODIFY | Use session history, call `chat()` instead of `generate()`, pass context length |
| `src/routes/chatRoutes.js` | MODIFY | Add `POST /api/session` and `DELETE /api/session` routes |
| `src/app.js` | MODIFY | Register `/api/session` routes |
| `public/script.js` | MODIFY | Session ID lifecycle (create/load/store/clear), pass sessionId + contextLength to requests |
| `src/providers/OllamaProvider.js` | MODIFY | Add SSE streaming support in `chat()` |
| `src/providers/LlamaCppProvider.js` | MODIFY | Add SSE streaming support in `chat()` |

## Data Flow Detail

### First message (no prior history):
1. Frontend sends `{ message: "Hello", model: "phi4", sessionId: "abc", contextLength: 131072 }`
2. Backend stores user message in session: `[{ role: 'user', content: 'Hello', model: 'phi4' }]`
3. Backend calls `provider.chat({ model: 'phi4', messages: [...] })` → Ollama `/api/chat`
4. Backend stores assistant response in session: `[{ user: ... }, { assistant: "Hi there..." } ]`
5. Response returned to frontend.

### Second message (history exists):
1. Frontend sends `{ message: "What was my first question?", model: "phi4", sessionId: "abc", contextLength: 131072 }`
2. Backend retrieves history from session, appends new user message: `[{ user: 'Hello' }, { assistant: 'Hi there...' }, { user: 'What was my first question?' }]`
3. If total chars > `contextLength * 4`, truncate oldest entries.
4. Backend calls `provider.chat({ model, messages: trimmed })` — full context sent to LLM.
5. Assistant response stored in session.

### Clear chat:
1. Frontend calls `DELETE /api/session?sessionId=abc` (or via body).
2. Backend removes session from store.
3. Frontend clears localStorage as it does now.

## Context Truncation Logic

```
totalChars = messages.reduce((sum, m) => sum + m.content.length, 0)
maxChars = contextLength * 4   // rough token estimate: ~4 chars per token

if totalChars > maxChars:
    Remove oldest user/assistant pairs one at a time
    Until totalChars <= maxChars * 0.8  (20% safety margin)
```

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| In-memory Map lost on server restart | History cleared | Acceptable for single-user app; localStorage preserves UI state. If needed later, replace with file-based JSON store or SQLite. |
| Very long conversations exceed context window | LLM ignores old messages anyway | Truncation removes oldest pairs first, keeping recent context which is usually more relevant. |
| Session ID leaked in logs | Privacy concern | Only log session ID prefix (first 8 chars) if at all. Never log message content in session-related logs. |
| Multiple tabs open simultaneously | Each tab gets its own session → separate histories | This is actually desired behavior — each tab = independent conversation. If shared history needed later, use localStorage as the single source of truth and sync via `storage` event. |

## Validation

1. **Start app**: `npm start`
2. **Create session**: Send message to `/api/session`, receive `sessionId`.
3. **First roundtrip**: Send chat with sessionId + contextLength → verify response, verify history stored in session.
4. **Second roundtrip**: Send follow-up message → verify model responds with awareness of first message (test: ask "what did I just say?").
5. **Context truncation**: Send many messages exceeding context window → verify oldest messages are dropped and recent ones retained.
6. **Clear chat**: Verify session cleared, localStorage cleared, no history leak.
7. **Provider parity**: Test with both Ollama and llama.cpp providers — both must pass message array to their respective chat endpoints.
8. **Reload test**: Reload page → verify sessionId restored from localStorage → chat continues with existing context.
