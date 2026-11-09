

## 6. Conversation Lifecycle Algorithms

### 6.1 App Startup

```
1. Frontend reads localStorage:
     activeSessionId = localStorage.getItem('activeSessionId')
     viewingSessionId = localStorage.getItem('viewingSessionId') || activeSessionId

2. Frontend calls GET /api/sessions
     → Backend returns [{id, title, category, mode, message_count, updated_at}, ...]
     → Frontend populates Sidebar / Dashboard

3. If activeSessionId exists and is valid:
     → Frontend calls GET /api/sessions/:activeSessionId/messages
     → Backend returns [{role, content, question_id, model, attachments_meta, metrics}, ...]
     → Frontend renders chat

4. If activeSessionId does NOT exist (first run):
     → Frontend calls POST /api/sessions
     → Backend creates new session with title "unsavedSession 1"
     → Frontend saves: localStorage.setItem('activeSessionId', id)
     → Frontend saves: localStorage.setItem('viewingSessionId', id)
     → Frontend shows welcome screen
```

### 6.2 Sending a Message

```
1. User types message, optionally provides file paths

2. For each file path:
     a. Frontend calls POST /api/attachments/extract
        Body: { paths: ["/path/to/file.ts"], sessionId: activeSessionId }
     b. Backend reads file from disk, extracts text, saves to `attachments` table
     c. Backend returns [{fileId, name, size, type, path}]
     d. Frontend collects metadata array

3. Frontend calls POST /api/chat with:
     {
       sessionId: currentSessionId,  // = activeSessionId
       message: "...",
       model: "...",
       attachments: [{fileId, name, size, type, path}]
     }

4. Backend:
     a. Reads previous messages from SQLite for this session
     b. For any attachment in history, fetches extracted_text from `attachments` table
     c. Builds LLM prompt with conversation history + file content
     d. Queries LLM (Ollama or llama.cpp based on provider)
     e. Inserts user message into `messages` table
     f. Inserts assistant response into `messages` table
     g. Updates `sessions.message_count` and `sessions.updated_at`
     h. Returns { response, metrics, questionId }

5. Frontend:
     a. Renders the Q&A pair in UI
     b. NO localStorage write for conversation data (only pointers)
```

### 6.3 Loading a Saved Conversation (The Fix)

```
1. User clicks a conversation in Sidebar/Dashboard

2. Frontend sets:
     viewingSessionId = selectedSessionId
     localStorage.setItem('viewingSessionId', viewingSessionId)
     (activeSessionId in localStorage is UNTOUCHED)

3. Frontend calls GET /api/sessions/:viewingSessionId/messages
     → Renders the loaded conversation in UI

4. "Return to Current" button appears (because viewingSessionId !== activeSessionId)

5. If user sends a NEW message while viewing an old conversation:
     → The message is sent with sessionId = viewingSessionId
     → activeSessionId is UPDATED to viewingSessionId
     → localStorage.setItem('activeSessionId', viewingSessionId)
     → "Return to Current" button disappears (this IS now current)
```

### 6.4 "Return to Current"

```
1. User clicks "Return to Current"

2. Frontend reads: activeSessionId from localStorage

3. Frontend sets: viewingSessionId = activeSessionId
     localStorage.setItem('viewingSessionId', viewingSessionId)

4. Frontend calls GET /api/sessions/:activeSessionId/messages
     → Renders the original working conversation

5. "Return to Current" button disappears

The loaded conversation is simply replaced in UI.
No data was overwritten. Nothing was lost.
```

### 6.5 Save Conversation (Metadata Only)

"Saving" is now just updating metadata:

```
1. User clicks "Save Conversation"
2. Modal asks for Title and Category
3. Frontend calls PATCH /api/sessions/:activeSessionId
     { title: "React Refactoring", category: "JavaScript" }
4. Backend updates the `sessions` row
5. Done. The messages are already persisted.
```

### 6.6 Clear Current Chat (Archive Buffer + New Buffer)

**CRITICAL: Does NOT delete data. Only archives current buffer and creates new one.**

```
1. User clicks "Clear Current Chat"
2. Confirm dialog: "Archive current chat and start new?"

3. If confirmed:
     a. Count existing unsaved sessions:
        SELECT COUNT(*) FROM sessions WHERE title LIKE 'unsavedSession%'

     b. Rename current buffer:
        UPDATE sessions SET title = 'unsavedSession N' WHERE id = activeSessionId

     c. Create new session:
        POST /api/sessions → newId
        title = "unsavedSession N+1"

     d. Update state:
        activeSessionId = newId
        viewingSessionId = newId
        localStorage.setItem('activeSessionId', newId)
        localStorage.setItem('viewingSessionId', newId)

     e. Clear UI, show welcome message

4. Old buffer is PRESERVED in database as "unsavedSession N"
5. User can find old buffer in Dashboard or session list
6. To actually delete data, user goes to Dashboard and clicks Delete
```

### 6.7 Delete Conversation (Dashboard Only)

```
1. User goes to Dashboard
2. Selects conversation(s)
3. Clicks "Delete"
4. Confirm dialog: "Permanently delete? This cannot be undone."
5. If confirmed:
     DELETE /api/sessions/:id
     → Backend cascades: deletes messages, attachments, session
6. Refresh dashboard
```

---

## 8. Frontend State Model

### 8.1 What Lives in `localStorage` (Minimal)

```javascript
// Only pointers and preferences. ~200 bytes total.
{
    "activeSessionId": "uuid-of-working-conversation",
    "viewingSessionId": "uuid-of-currently-displayed-conversation",
    "selectedProvider": "ollama",
    "selectedModel": "qwen2.5-coder",
    "logLevel": "info"
}
```

### 8.2 What Lives in Frontend Memory (Runtime Only)

```javascript
// In-memory state. Rebuilt from API on page load. Never written to localStorage.
let currentSessionId = null;       // = activeSessionId (the "working" session)
let viewingSessionId = null;       // what's currently displayed (may differ from active)
let currentModel = null;
let currentProvider = 'ollama';
let questions = [];                // [{id, text, model, number}]
let currentConversation = [];      // [{role, content, questionId, model, attachments_meta}]
let uploadedCodeFiles = [];        // file paths for current message
let questionCounter = 0;
```

### 8.3 Key Functions Replaced

| Old Function | New Behavior |
|---|---|
| `saveCurrentConversation()` | **Removed.** Backend auto-saves on every message. |
| `loadCurrentConversation()` | Replaced by `loadSessionMessages(sessionId)` which calls `GET /api/sessions/:id/messages` |
| `rebuildSession()` | **Removed entirely.** Backend reads from SQLite internally. |
| `confirmSave()` | Replaced by `PATCH /api/sessions/:id` (metadata only) |
| `showLoadModal()` | Populated by `GET /api/sessions` |
| `loadConversation(index)` | Replaced by `loadSessionMessages(sessionId)` + set `viewingSessionId` |
| `returnToCurrent()` | Set `viewingSessionId = activeSessionId`, call `loadSessionMessages(activeSessionId)` |
| `clearChat()` | Archive buffer + create new buffer (see 6.6) |
| `exportConversation()` | `GET /api/sessions/:id/messages` → create JSON blob client-side |
