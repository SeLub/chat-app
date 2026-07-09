# Plan: SQLite Integration & Conversation Management Overhaul (Final)

## 1. Overview

Replace the current `localStorage`-based conversation management with a **SQLite-backed backend** as the single source of truth. This eliminates the 5MB storage limit, fixes the broken "Return to Current" logic, enables proper file history, and prepares the database schema for the upcoming **Project Mode** with Qdrant vector search.

### 1.1 Goals

- ✅ **No 5MB limit** — conversations can grow indefinitely
- ✅ **Persistent storage** — survives server restarts, page reloads, browser cache clears
- ✅ **Correct "Return to Current"** — two-pointer navigation (buffer vs. viewing)
- ✅ **Current Chat as Buffer** — never accidentally deleted, only archived
- ✅ **File handling via paths** — backend reads files directly from disk (no uploads)
- ✅ **Project Mode ready** — schema includes `projects` and `project_files` tables
- ✅ **Zero migration** — fresh start, no backward compatibility with old `localStorage` data
- ✅ **Zero extra infrastructure** — SQLite is a single file, no separate DB server

### 1.2 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | **SQLite** (via `better-sqlite3`) | Single-file, no infra, survives restarts, fast |
| Source of truth | **Backend** | Frontend only holds pointers |
| File storage | **Paths on disk** | Backend reads directly, no uploads |
| "Current Chat" | **Buffer** | Always preserved, archived on Clear |
| Navigation | **Two-pointer** (`activeSessionId` / `viewingSessionId`) | Fixes Return to Current |
| Delete | **Dashboard only** | Prevents accidental data loss |
| Migration | **None** | Fresh start, no backward compatibility |

---

## 2. Key Concepts

### 2.1 Current Chat as Buffer

The "Current Chat" is a **working buffer** that always exists:

- Named `"unsavedSession N"` (auto-incremented)
- Preserved across app restarts
- **Never deleted** by Clear Chat — only archived
- Only deleted explicitly from the Dashboard
- Survives page reloads automatically

### 2.2 Two-Pointer Navigation

```
┌─────────────────────────────────────────────────────────┐
│  activeSessionId (Buffer)                               │
│  • Always exists                                        │
│  • Named "unsavedSession N"                             │
│  • Preserved across app restarts                        │
│  • Only "cleared" (archived + new buffer created)       │
│  • Only "deleted" from Dashboard                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  viewingSessionId (What's displayed)                    │
│  • May point to buffer OR a saved conversation          │
│  • Changed by: Load Conversation, Return to Current     │
│  • Does NOT affect buffer                               │
└─────────────────────────────────────────────────────────┘
```

### 2.3 File Handling via Paths

Since the server and files are on the same machine:

- **No FormData uploads**
- Frontend sends **file paths** to backend
- Backend reads files directly from disk
- `attachments` table stores `file_path` column
- Extracted text stored separately (keeps chat history lightweight)

---

## 3. Architecture

### 3.1 Before (Current — Buggy)

```
┌─────────────────────────────────────┐
│           Browser                    │
│  ┌───────────────────────────────┐  │
│  │ localStorage                  │  │
│  │  • currentConversation (JSON) │  │  ← 5MB limit
│  │  • currentQuestions (JSON)    │  │  ← lost on load
│  │  • savedConversations (JSON)  │  │  ← duplicates data
│  │  • sessionId                  │  │
│  └───────────────────────────────┘  │
│            │                         │
│     fetch('/api/chat')               │
│            │                         │
└────────────┼─────────────────────────┘
             │
┌────────────▼─────────────────────────┐
│     Node.js Backend                  │
│  ┌───────────────────────────────┐   │
│  │ In-Memory Map (sessions)      │   │  ← lost on restart
│  └───────────────────────────────┘   │
│  No persistence                      │
└──────────────────────────────────────┘
```

**Problems:**
- `loadConversation()` overwrites `currentConversation` in localStorage → "Return to Current" broken
- `rebuildSession()` re-sends entire history on every reload → slow, fragile
- 5MB limit → long conversations silently fail
- Files lost in history (extracted text not persisted)
- Dashboard reads localStorage → same limits

### 3.2 After (Proposed — Fixed)

```
┌─────────────────────────────────────┐
│           Browser                    │
│  ┌───────────────────────────────┐  │
│  │ localStorage (pointers only)  │  │
│  │  • activeSessionId (UUID)     │  │  ← ~40 bytes
│  │  • viewingSessionId (UUID)    │  │  ← ~40 bytes
│  │  • selectedProvider           │  │
│  │  • selectedModel              │  │
│  └───────────────────────────────┘  │
│            │                         │
│     REST API calls                   │
│            │                         │
└────────────┼─────────────────────────┘
             │
┌────────────▼─────────────────────────┐
│     Node.js Backend                  │
│  ┌───────────────────────────────┐   │
│  │ SQLite (data/chat.db)         │   │  ← persistent, no limit
│  │  • sessions                   │   │
│  │  • messages                   │   │
│  │  • attachments                │   │
│  │  • projects (future)          │   │
│  │  • project_files (future)     │   │
│  └───────────────────────────────┘   │
│                                      │
│  ┌───────────────────────────────┐   │
│  │ Qdrant (future, Project Mode) │   │
│  └───────────────────────────────┘   │
└──────────────────────────────────────┘
```

---

## 4. SQLite Schema (Complete, Including Project Mode)

### 4.1 Table: `sessions`

Stores conversation metadata. Used by Dashboard and Sidebar for listing.

```sql
CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,          -- UUID v4
    title           TEXT DEFAULT 'unsavedSession 1',
    category        TEXT DEFAULT 'General',
    mode            TEXT DEFAULT 'chat',       -- 'chat' | 'project'
    project_id      TEXT REFERENCES projects(id),  -- NULL for chat mode
    model           TEXT,                      -- last used model
    provider        TEXT DEFAULT 'ollama',     -- last used provider
    message_count   INTEGER DEFAULT 0,         -- denormalized for fast listing
    is_archived     INTEGER DEFAULT 0,         -- soft delete flag
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_mode ON sessions(mode);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX idx_sessions_category ON sessions(category);
CREATE INDEX idx_sessions_title ON sessions(title);
```

### 4.2 Table: `messages`

Stores individual chat messages. **No heavy file content here** — only file metadata as JSON.

```sql
CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,          -- UUID v4
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    question_id     TEXT,                      -- frontend Q&A pair identifier (e.g., 'q_1_1720000000')
    role            TEXT NOT NULL,             -- 'user' | 'assistant' | 'system'
    content         TEXT NOT NULL,             -- message text (markdown)
    model           TEXT,                      -- model that generated/received this message
    attachments_meta TEXT DEFAULT '[]',        -- JSON array: [{name, size, type, fileId, path}]
    metrics         TEXT DEFAULT '{}',         -- JSON: {tps, ttft, inputTokens, outputTokens, ...}
    image_data      TEXT DEFAULT '{}',         -- JSON: {thumbnailUrl, fullUrl, filename} (if vision)
    sort_order      INTEGER NOT NULL,          -- explicit ordering within session
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_session ON messages(session_id, sort_order);
CREATE INDEX idx_messages_question ON messages(question_id);
```

**Example `attachments_meta` value:**
```json
[
  {
    "name": "auth.ts",
    "size": 12480,
    "type": "typescript",
    "fileId": "a1b2c3d4",
    "path": "/home/user/projects/myapp/src/auth.ts"
  }
]
```

### 4.3 Table: `attachments`

Stores extracted text content from files. Separated from messages to keep chat history lightweight.

```sql
CREATE TABLE IF NOT EXISTS attachments (
    id              TEXT PRIMARY KEY,          -- UUID v4 (matches fileId in attachments_meta)
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    file_path       TEXT,                      -- absolute path on disk
    mime_type       TEXT,
    file_size       INTEGER,
    extracted_text  TEXT NOT NULL,             -- the heavy payload
    language        TEXT,                      -- detected programming language or 'text'
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_attachments_session ON attachments(session_id);
CREATE INDEX idx_attachments_path ON attachments(file_path);
```

### 4.4 Table: `projects` (For Future Project Mode)

Stores project metadata. Links to Qdrant via `project_path`.

```sql
CREATE TABLE IF NOT EXISTS projects (
    id              TEXT PRIMARY KEY,          -- UUID v4
    name            TEXT NOT NULL,
    path            TEXT NOT NULL UNIQUE,      -- absolute filesystem path
    description     TEXT DEFAULT '',
    watch_enabled   INTEGER DEFAULT 0,        -- boolean: is chokidar watching?
    last_indexed    TEXT,                      -- timestamp of last full index
    total_files     INTEGER DEFAULT 0,
    total_chunks    INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);
```

### 4.5 Table: `project_files` (For Future Project Mode)

**The sync bridge between filesystem and Qdrant.** Tracks file hashes and Qdrant point IDs for incremental indexing.

```sql
CREATE TABLE IF NOT EXISTS project_files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path       TEXT NOT NULL,             -- relative path within project
    content_hash    TEXT NOT NULL,             -- SHA-256 of file content
    language        TEXT,                      -- detected language
    file_size       INTEGER,
    chunk_count     INTEGER DEFAULT 0,         -- number of Qdrant points for this file
    qdrant_point_ids TEXT DEFAULT '[]',        -- JSON array of Qdrant point UUIDs
    last_indexed    TEXT DEFAULT (datetime('now')),
    UNIQUE(project_id, file_path)
);

CREATE INDEX idx_project_files_project ON project_files(project_id);
CREATE INDEX idx_project_files_hash ON project_files(content_hash);
```

### 4.6 Schema Initialization Code

```javascript
// src/db/init.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'chat.db');

let db;

function getDb() {
    if (!db) {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');       // concurrent read performance
        db.pragma('foreign_keys = ON');
        db.pragma('synchronous = NORMAL');     // good balance of safety/speed
        initializeSchema(db);
    }
    return db;
}

function initializeSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id              TEXT PRIMARY KEY,
            title           TEXT DEFAULT 'unsavedSession 1',
            category        TEXT DEFAULT 'General',
            mode            TEXT DEFAULT 'chat',
            project_id      TEXT REFERENCES projects(id),
            model           TEXT,
            provider        TEXT DEFAULT 'ollama',
            message_count   INTEGER DEFAULT 0,
            is_archived     INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            question_id     TEXT,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            model           TEXT,
            attachments_meta TEXT DEFAULT '[]',
            metrics         TEXT DEFAULT '{}',
            image_data      TEXT DEFAULT '{}',
            sort_order      INTEGER NOT NULL,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id              TEXT PRIMARY KEY,
            session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            filename        TEXT NOT NULL,
            file_path       TEXT,
            mime_type       TEXT,
            file_size       INTEGER,
            extracted_text  TEXT NOT NULL,
            language        TEXT,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS projects (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            path            TEXT NOT NULL UNIQUE,
            description     TEXT DEFAULT '',
            watch_enabled   INTEGER DEFAULT 0,
            last_indexed    TEXT,
            total_files     INTEGER DEFAULT 0,
            total_chunks    INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS project_files (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            file_path       TEXT NOT NULL,
            content_hash    TEXT NOT NULL,
            language        TEXT,
            file_size       INTEGER,
            chunk_count     INTEGER DEFAULT 0,
            qdrant_point_ids TEXT DEFAULT '[]',
            last_indexed    TEXT DEFAULT (datetime('now')),
            UNIQUE(project_id, file_path)
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_mode ON sessions(mode);
        CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_category ON sessions(category);
        CREATE INDEX IF NOT EXISTS idx_sessions_title ON sessions(title);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_messages_question ON messages(question_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_session ON attachments(session_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_path ON attachments(file_path);
        CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);
        CREATE INDEX IF NOT EXISTS idx_project_files_hash ON project_files(content_hash);
    `);
}

module.exports = { getDb };
```

---

## 5. Backend API Endpoints

### 5.1 Session Management

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List all sessions (lightweight metadata only) |
| `GET` | `/api/sessions/:id` | Get single session metadata |
| `POST` | `/api/sessions` | Create new empty session, returns `{ id, title }` |
| `PATCH` | `/api/sessions/:id` | Update session title, category, model, provider |
| `DELETE` | `/api/sessions/:id` | Delete session + cascade messages + attachments |
| `GET` | `/api/sessions/:id/messages` | Get full message history for a session |

### 5.2 Chat (Modified Existing)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat` | Send message. Backend reads history from SQLite, appends new Q&A, queries LLM, saves response. |

**Key change:** The `/api/chat` endpoint no longer receives the full conversation history from the frontend. It reads it from SQLite using `sessionId`. This eliminates `rebuildSession()` entirely.

### 5.3 Attachments (Files by Path)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/attachments/extract` | Body: `{ paths: ["/path/to/file.ts"], sessionId }`. Backend reads files from disk, extracts text, saves to `attachments` table, returns metadata array. |
| `GET` | `/api/attachments/:fileId` | Get extracted text for a file (used internally for LLM context) |

### 5.4 Project Mode (Future)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/projects` | Register a new project |
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects/:id/index` | Trigger full/incremental indexing |
| `POST` | `/api/projects/:id/watch` | Start watch mode |
| `DELETE` | `/api/projects/:id/watch` | Stop watch mode |

---

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

## 7. File Handling: Detailed Flow (Paths, Not Uploads)

### 7.1 Upload Flow (User Sends Message with Code Files)

```
Step 1: Frontend collects file paths from user input
        (e.g., via file input that exposes paths, or manual path entry)
        filePaths = ["/home/user/projects/myapp/src/auth.ts", "/home/user/projects/myapp/src/utils.js"]

Step 2: Frontend calls:
        POST /api/attachments/extract
        Body: {
            paths: ["/home/user/projects/myapp/src/auth.ts", "/home/user/projects/myapp/src/utils.js"],
            sessionId: "active-session-uuid"
        }

Step 3: Backend processes each file:
        a. Read file from disk: fs.readFile(filePath, 'utf-8')
        b. Detect language from extension (.ts → typescript)
        c. Generate UUID for fileId
        d. INSERT INTO attachments (id, session_id, filename, file_path, mime_type, file_size, extracted_text, language)
        e. Return [{ fileId, name, size, type, path }]

Step 4: Frontend collects metadata array:
        attachmentsMeta = [
            { name: "auth.ts", size: 12480, type: "typescript", fileId: "abc-123", path: "/home/user/..." },
            { name: "utils.js", size: 3200, type: "javascript", fileId: "def-456", path: "/home/user/..." }
        ]

Step 5: Frontend calls POST /api/chat:
        {
            sessionId: "...",
            message: "Review this auth code",
            model: "qwen2.5-coder",
            attachments: attachmentsMeta
        }

Step 6: Backend builds LLM prompt:
        a. Fetch previous messages from `messages` table
        b. For the CURRENT message's attachments, fetch extracted_text from `attachments` table
        c. For PREVIOUS messages' attachments, optionally fetch extracted_text (for context continuity)
        d. Build prompt:
           [SYSTEM] You are a code assistant...
           [PREVIOUS CONTEXT] Q1: ... A1: ...
           [ATTACHED FILE: auth.ts] <extracted_text>
           [ATTACHED FILE: utils.js] <extracted_text>
           [USER] Review this auth code
        e. Query LLM
        f. Save user message to `messages` (with attachments_meta JSON, NOT extracted text)
        g. Save assistant response to `messages`
        h. Return response
```

### 7.2 Rendering History with Files

```
When loading old conversation messages:

1. Backend returns messages with attachments_meta:
   {
     role: "user",
     content: "Review this auth code",
     attachments_meta: [{"name": "auth.ts", "size": 12480, "type": "typescript", "fileId": "abc-123", "path": "..."}]
   }

2. Frontend renders file badge in UI:
   📎 auth.ts (12.19 KB) [TypeScript]

3. The heavy extracted_text is NEVER sent to the frontend for display.
   It only lives in the `attachments` table for LLM context reconstruction.
```

### 7.3 Project Mode File Handling

```
1. User sets project path: "/home/user/my-project"
2. Backend indexes all files in that directory (via indexerService.js)
3. When user asks a question, backend:
     • Reads relevant files from disk (using stored paths)
     • Builds RAG context from Qdrant
     • Queries LLM
4. File content is read on-demand from disk, not stored in chat history
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

---

## 9. Backend Service Layer

### 9.1 File Structure

```
src/
  db/
    init.js                  ← SQLite initialization + schema
    sessionRepo.js           ← Session CRUD queries
    messageRepo.js           ← Message CRUD queries
    attachmentRepo.js        ← Attachment CRUD queries
    projectRepo.js           ← Project + project_files CRUD (future)
  services/
    chatService.js           ← LLM query orchestration (modified)
    fileService.js           ← File extraction logic (modified: reads from disk)
    contextBuilder.js        ← Build LLM prompt from SQLite messages + attachments
  routes/
    sessionRoutes.js         ← /api/sessions/*
    chatRoutes.js            ← /api/chat (modified)
    attachmentRoutes.js      ← /api/attachments/*
    projectRoutes.js         ← /api/projects/* (future)
```

### 9.2 Key Repository Functions

```javascript
// src/db/sessionRepo.js
const { getDb } = require('./init');
const crypto = require('crypto');

function createSession(title = null, mode = 'chat', projectId = null) {
    const id = crypto.randomUUID();
    const db = getDb();

    // Auto-generate title if not provided
    if (!title) {
        const count = db.prepare(
            "SELECT COUNT(*) as count FROM sessions WHERE title LIKE 'unsavedSession%'"
        ).get().count;
        title = `unsavedSession ${count + 1}`;
    }

    db.prepare(`
        INSERT INTO sessions (id, title, mode, project_id)
        VALUES (?, ?, ?, ?)
    `).run(id, title, mode, projectId);

    return { id, title };
}

function getSession(id) {
    return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function listSessions(options = {}) {
    const { mode, limit = 100, offset = 0, search } = options;
    let sql = 'SELECT * FROM sessions WHERE is_archived = 0';
    const params = [];
    if (mode) { sql += ' AND mode = ?'; params.push(mode); }
    if (search) { sql += ' AND (title LIKE ? OR category LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return getDb().prepare(sql).all(...params);
}

function updateSession(id, updates) {
    const fields = Object.keys(updates);
    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(id);
    getDb().prepare(`
        UPDATE sessions SET ${sets}, updated_at = datetime('now') WHERE id = ?
    `).run(...values);
}

function deleteSession(id) {
    // CASCADE handles messages and attachments
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function archiveSession(id, newTitle) {
    getDb().prepare(`
        UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?
    `).run(newTitle, id);
}
```

```javascript
// src/db/messageRepo.js
const { getDb } = require('./init');
const crypto = require('crypto');

function addMessage(sessionId, message) {
    const db = getDb();
    const id = crypto.randomUUID();

    // Get current max sort_order
    const max = db.prepare(
        'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM messages WHERE session_id = ?'
    ).get(sessionId);

    db.prepare(`
        INSERT INTO messages (id, session_id, question_id, role, content, model, attachments_meta, metrics, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id, sessionId, message.questionId, message.role, message.content,
        message.model, JSON.stringify(message.attachmentsMeta || []),
        JSON.stringify(message.metrics || {}), max.max_order + 1
    );

    // Update session message count
    db.prepare(`
        UPDATE sessions SET message_count = message_count + 1, updated_at = datetime('now')
        WHERE id = ?
    `).run(sessionId);

    return id;
}

function getMessagesBySession(sessionId) {
    return getDb().prepare(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY sort_order ASC'
    ).all(sessionId);
}

function deleteMessagesByQuestionId(questionId) {
    const db = getDb();
    const msgs = db.prepare('SELECT session_id FROM messages WHERE question_id = ?').all(questionId);
    db.prepare('DELETE FROM messages WHERE question_id = ?').run(questionId);
    // Update counts
    if (msgs.length > 0) {
        const sessionId = msgs[0].session_id;
        db.prepare(`
            UPDATE sessions SET message_count = (
                SELECT COUNT(*) FROM messages WHERE session_id = ?
            ), updated_at = datetime('now') WHERE id = ?
        `).run(sessionId, sessionId);
    }
}
```

```javascript
// src/db/attachmentRepo.js
const { getDb } = require('./init');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

async function extractFromPaths(paths, sessionId) {
    const db = getDb();
    const results = [];

    for (const filePath of paths) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const fileId = crypto.randomUUID();
            const filename = path.basename(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const language = detectLanguage(ext);
            const stats = await fs.stat(filePath);

            db.prepare(`
                INSERT INTO attachments (id, session_id, filename, file_path, mime_type, file_size, extracted_text, language)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(fileId, sessionId, filename, filePath, getMimeType(ext), stats.size, content, language);

            results.push({
                fileId,
                name: filename,
                size: stats.size,
                type: language,
                path: filePath
            });
        } catch (error) {
            console.error(`Failed to extract file ${filePath}:`, error);
            throw new Error(`Cannot read file: ${filePath}`);
        }
    }

    return results;
}

function getAttachment(fileId) {
    return getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(fileId);
}

function getAttachmentsByIds(fileIds) {
    if (fileIds.length === 0) return [];
    const placeholders = fileIds.map(() => '?').join(',');
    return getDb().prepare(
        `SELECT * FROM attachments WHERE id IN (${placeholders})`
    ).all(...fileIds);
}

function detectLanguage(ext) {
    const map = {
        '.js': 'javascript', '.jsx': 'javascript',
        '.ts': 'typescript', '.tsx': 'typescript',
        '.py': 'python', '.go': 'go', '.rs': 'rust',
        '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
        '.html': 'html', '.css': 'css', '.json': 'json',
        '.md': 'markdown', '.txt': 'text'
    };
    return map[ext] || 'text';
}

function getMimeType(ext) {
    const map = {
        '.js': 'text/javascript', '.ts': 'text/typescript',
        '.py': 'text/x-python', '.json': 'application/json'
    };
    return map[ext] || 'text/plain';
}

module.exports = { extractFromPaths, getAttachment, getAttachmentsByIds };
```

### 9.3 Context Builder (Replaces `rebuildSession`)

```javascript
// src/services/contextBuilder.js
const { getDb } = require('../db/init');

async function buildLLMContext(sessionId, currentAttachments = []) {
    const db = getDb();

    // 1. Fetch all previous messages for this session
    const messages = db.prepare(
        'SELECT role, content, attachments_meta FROM messages WHERE session_id = ? ORDER BY sort_order ASC'
    ).all(sessionId);

    // 2. Collect all fileIds referenced in history
    const allFileIds = new Set();
    for (const msg of messages) {
        const meta = JSON.parse(msg.attachments_meta || '[]');
        meta.forEach(m => allFileIds.add(m.fileId));
    }
    // Add current message attachments
    currentAttachments.forEach(a => allFileIds.add(a.fileId));

    // 3. Fetch extracted text for all referenced files
    const fileContents = {};
    if (allFileIds.size > 0) {
        const placeholders = [...allFileIds].map(() => '?').join(',');
        const rows = db.prepare(
            `SELECT id, filename, extracted_text FROM attachments WHERE id IN (${placeholders})`
        ).all(...allFileIds);
        rows.forEach(r => { fileContents[r.id] = { filename: r.filename, text: r.extracted_text }; });
    }

    // 4. Build conversation array for LLM API
    const conversation = [];

    // Inject file contents as system context if present
    if (Object.keys(fileContents).length > 0) {
        let fileContext = 'The user has shared the following files:\n\n';
        for (const [fileId, file] of Object.entries(fileContents)) {
            fileContext += `--- FILE: ${file.filename} ---\n${file.text}\n\n`;
        }
        conversation.push({ role: 'system', content: fileContext });
    }

    // Add conversation history
    for (const msg of messages) {
        conversation.push({ role: msg.role, content: msg.content });
    }

    return conversation;
}

module.exports = { buildLLMContext };
```

---

## 10. Frontend Changes (Detailed)

### 10.1 New Core Functions in `script.js`

```javascript
// === Session API Functions ===

async function fetchSessions() {
    const response = await fetch('/api/sessions');
    return response.json(); // [{id, title, category, mode, message_count, updated_at}]
}

async function fetchSessionMessages(sessionId) {
    const response = await fetch(`/api/sessions/${sessionId}/messages`);
    return response.json(); // [{role, content, question_id, model, attachments_meta, metrics}]
}

async function createSession() {
    const response = await fetch('/api/sessions', { method: 'POST' });
    const data = await response.json();
    return data; // {id, title}
}

async function updateSessionMeta(sessionId, { title, category }) {
    await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, category })
    });
}

async function deleteSession(sessionId) {
    await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
}

async function archiveSession(sessionId, newTitle) {
    await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
    });
}
```

### 10.2 Rewritten `sendMessage()`

```javascript
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message || !currentModel) return;
    input.value = '';

    // 1. Extract files from paths, collect metadata
    let attachmentsMeta = [];
    if (uploadedCodeFiles.length > 0) {
        const res = await fetch('/api/attachments/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                paths: uploadedCodeFiles,
                sessionId: currentSessionId
            })
        });
        attachmentsMeta = await res.json();
    }

    // 2. Add question to UI immediately
    const questionId = addQuestion(message, currentModel, attachmentsMeta);

    // 3. Send chat request (backend reads history from SQLite)
    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Provider': currentProvider
        },
        body: JSON.stringify({
            sessionId: currentSessionId,  // ← activeSessionId
            message,
            model: currentModel,
            attachments: attachmentsMeta
        })
    });

    const data = await response.json();
    addBotMessage(data.response, currentModel, data.metrics, null, questionId);
    updateStats(data.metrics);

    uploadedCodeFiles = [];
    document.getElementById('filePreview').classList.remove('active');
}
```

### 10.3 Rewritten `loadConversation()`

```javascript
async function loadConversation(sessionId) {
    // Set viewing pointer (do NOT touch activeSessionId)
    viewingSessionId = sessionId;
    localStorage.setItem('viewingSessionId', viewingSessionId);

    // Show "Return to Current" button if viewing !== active
    toggleReturnButton(viewingSessionId !== activeSessionId);

    // Fetch and render
    const messages = await fetchSessionMessages(sessionId);
    renderMessagesFromAPI(messages);
    closeLoadModal();
}

function returnToCurrent() {
    viewingSessionId = activeSessionId;
    localStorage.setItem('viewingSessionId', viewingSessionId);
    toggleReturnButton(false);
    fetchSessionMessages(activeSessionId).then(renderMessagesFromAPI);
    showToast('Returned to current conversation', 'success');
}

function toggleReturnButton(show) {
    const btn = document.querySelector('[data-action="return-to-current"]');
    if (btn) btn.style.display = show ? 'block' : 'none';
}
```

### 10.4 Rewritten `confirmSave()`

```javascript
async function confirmSave() {
    const name = document.getElementById('conversationName').value;
    const category = document.getElementById('conversationCategory').value;
    if (!name) { showToast('Please enter a name', 'error'); return; }

    await updateSessionMeta(activeSessionId, { title: name, category: category || 'General' });
    showToast('Conversation saved!', 'success');
    closeSaveModal();

    // Refresh sidebar
    refreshSessionList();
}
```

### 10.5 Rewritten `clearChat()` (Archive + New Buffer)

```javascript
async function clearChat() {
    if (!confirm('Archive current chat and start new?')) return;

    // 1. Count existing unsaved sessions
    const sessions = await fetchSessions();
    const unsavedCount = sessions.filter(s => s.title.startsWith('unsavedSession')).length;
    const newArchiveTitle = `unsavedSession ${unsavedCount + 1}`;

    // 2. Archive current buffer
    await archiveSession(activeSessionId, newArchiveTitle);

    // 3. Create new session
    const newSession = await createSession();
    activeSessionId = newSession.id;
    currentSessionId = newSession.id;
    viewingSessionId = newSession.id;
    localStorage.setItem('activeSessionId', newSession.id);
    localStorage.setItem('viewingSessionId', newSession.id);

    // 4. Reset UI
    questions = [];
    questionCounter = 0;
    currentConversation = [];
    document.getElementById('chatMessages').innerHTML = /* welcome message */;
    updateQuestionsList();
    toggleReturnButton(false);

    // 5. Refresh sidebar
    refreshSessionList();

    log.info(`Chat cleared. Old buffer archived as "${newArchiveTitle}". New buffer created.`);
}
```

### 10.6 Rewritten `addQuestion()` and `addBotMessage()`

```javascript
function addQuestion(message, model, attachmentsMeta = []) {
    questionCounter++;
    const questionId = `q_${questionCounter}_${Date.now()}`;
    questions.push({
        id: questionId,
        text: message,
        model: model,
        number: questionCounter
    });
    updateQuestionsList();

    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user-message';
    messageDiv.dataset.questionId = questionId;

    // Render file badges if attachments present
    let attachmentsHtml = '';
    if (attachmentsMeta.length > 0) {
        attachmentsHtml = '<div class="message-attachments">' +
            attachmentsMeta.map(a =>
                `<span class="file-badge">📎 ${a.name} (${formatSize(a.size)}) [${a.type}]</span>`
            ).join('') +
            '</div>';
    }

    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="message-header">
                <div class="message-model">Q${questionCounter} • You • ${model}</div>
                <div class="message-nav-buttons">
                    <button class="nav-btn prev-btn" onclick="jumpToPreviousQuestion('${questionId}')">↑ Prev</button>
                    <button class="nav-btn next-btn" onclick="jumpToNextQuestion('${questionId}')">Next ↓</button>
                </div>
            </div>
            <div class="message-text">${escapeHtml(message)}</div>
            ${attachmentsHtml}
            <div class="message-actions">
                <button class="message-action-btn" onclick="copyQuestion('${questionId}')">📋 Copy Question</button>
                <button class="message-action-btn" onclick="deleteQAPair('${questionId}')">🗑️ Delete</button>
            </div>
        </div>
    `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Note: NO saveCurrentConversation() call — backend auto-saves
    return questionId;
}
```

### 10.7 Rewritten `renderMessagesFromAPI()`

```javascript
function renderMessagesFromAPI(messages) {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '';
    questions = [];
    currentConversation = [];
    questionCounter = 0;

    for (const msg of messages) {
        questionCounter++;
        const questionId = msg.question_id || `q_${questionCounter}_restored`;

        if (msg.role === 'user') {
            questions.push({
                id: questionId,
                text: msg.content,
                model: msg.model,
                number: questionCounter
            });

            const messageDiv = document.createElement('div');
            messageDiv.className = 'message user-message';
            messageDiv.dataset.questionId = questionId;

            let attachmentsHtml = '';
            const attachments = JSON.parse(msg.attachments_meta || '[]');
            if (attachments.length > 0) {
                attachmentsHtml = '<div class="message-attachments">' +
                    attachments.map(a =>
                        `<span class="file-badge">📎 ${a.name} (${formatSize(a.size)}) [${a.type}]</span>`
                    ).join('') +
                    '</div>';
            }

            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="message-header">
                        <div class="message-model">Q${questionCounter} • You • ${msg.model || 'unknown'}</div>
                        <div class="message-nav-buttons">
                            <button class="nav-btn prev-btn" onclick="jumpToPreviousQuestion('${questionId}')">↑ Prev</button>
                            <button class="nav-btn next-btn" onclick="jumpToNextQuestion('${questionId}')">Next ↓</button>
                        </div>
                    </div>
                    <div class="message-text">${escapeHtml(msg.content)}</div>
                    ${attachmentsHtml}
                    <div class="message-actions">
                        <button class="message-action-btn" onclick="copyQuestion('${questionId}')">📋 Copy Question</button>
                        <button class="message-action-btn" onclick="deleteQAPair('${questionId}')">🗑️ Delete</button>
                    </div>
                </div>
            `;
            chatMessages.appendChild(messageDiv);
        } else {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message bot-message';
            messageDiv.dataset.questionId = questionId;
            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="message-header">
                        <div class="message-model">🤖 ${msg.model || 'unknown'}</div>
                    </div>
                    <div class="message-text">${formatMarkdown(msg.content)}</div>
                    <div class="message-actions">
                        <button class="message-action-btn" onclick="jumpToQuestion('${questionId}')">🔼 Question</button>
                        <button class="message-action-btn" onclick="copyQAPair('${questionId}')">📋 Copy Q&A</button>
                        <button class="message-action-btn" onclick="deleteQAPair('${questionId}')">🗑️ Delete</button>
                    </div>
                </div>
            `;
            chatMessages.appendChild(messageDiv);
        }

        currentConversation.push({
            role: msg.role,
            content: msg.content,
            questionId: questionId,
            model: msg.model
        });
    }

    updateQuestionsList();
}
```

---

## 11. Dashboard Changes (`dashboard.html`)

### 11.1 Data Source Switch

**Before:** Dashboard reads `JSON.parse(localStorage.getItem('savedConversations'))`

**After:** Dashboard calls `GET /api/sessions` and renders from API response.

### 11.2 New Dashboard Functions

```javascript
// dashboard.js (new or inline)

async function loadDashboard() {
    const sessions = await fetch('/api/sessions').then(r => r.json());

    // Group by category
    const grouped = {};
    sessions.forEach(s => {
        if (!grouped[s.category]) grouped[s.category] = [];
        grouped[s.category].push(s);
    });

    // Render categories with accordions
    renderCategoryAccordions(grouped);

    // Update stats
    document.getElementById('totalConversations').textContent = sessions.length;
    document.getElementById('totalMessages').textContent =
        sessions.reduce((sum, s) => sum + s.message_count, 0);
}

async function deleteConversation(sessionId) {
    if (!confirm('Delete this conversation? This cannot be undone.')) return;
    await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    loadDashboard(); // refresh
}

async function openConversation(sessionId) {
    // Navigate to chat with this session as viewing
    window.location.href = `/?session=${sessionId}`;
}

async function searchSessions(query) {
    const sessions = await fetch(`/api/sessions?search=${encodeURIComponent(query)}`).then(r => r.json());
    renderSessionList(sessions);
}
```

---

## 12. Implementation Phases

### Phase 1: Database Foundation (Backend)
- [ ] Install `better-sqlite3`: `npm install better-sqlite3`
- [ ] Create `data/` directory with `.gitkeep`
- [ ] Create `src/db/init.js` — database connection + schema creation
- [ ] Create `src/db/sessionRepo.js` — session CRUD
- [ ] Create `src/db/messageRepo.js` — message CRUD
- [ ] Create `src/db/attachmentRepo.js` — attachment CRUD (reads from disk)
- [ ] Write unit tests for all repository functions

### Phase 2: API Endpoints (Backend)
- [ ] Create `src/routes/sessionRoutes.js`
- [ ] Implement `GET /api/sessions` (list)
- [ ] Implement `POST /api/sessions` (create)
- [ ] Implement `GET /api/sessions/:id/messages` (get history)
- [ ] Implement `PATCH /api/sessions/:id` (update metadata)
- [ ] Implement `DELETE /api/sessions/:id` (delete with cascade)
- [ ] Create `src/routes/attachmentRoutes.js`
- [ ] Implement `POST /api/attachments/extract` (reads files from disk)
- [ ] Implement `GET /api/attachments/:fileId`
- [ ] Register all routes in `app.js`

### Phase 3: Chat Integration (Backend)
- [ ] Modify `/api/chat` to read history from SQLite instead of request body
- [ ] Create `src/services/contextBuilder.js` — build LLM prompt from SQLite
- [ ] Modify `/api/chat` to save messages to SQLite after LLM response
- [ ] **Remove** `/api/chat/seed` endpoint (no longer needed)
- [ ] **Remove** in-memory session Map from chat service

### Phase 4: Frontend Overhaul
- [ ] Replace `saveCurrentConversation()` with no-op (backend auto-saves)
- [ ] Replace `loadCurrentConversation()` with `fetchSessionMessages()`
- [ ] Remove `rebuildSession()` entirely
- [ ] Implement two-pointer system (`activeSessionId` / `viewingSessionId`)
- [ ] Rewrite `loadConversation()` to use `viewingSessionId`
- [ ] Rewrite `returnToCurrent()` to use `activeSessionId`
- [ ] Rewrite `confirmSave()` to use `PATCH /api/sessions/:id`
- [ ] Rewrite `clearChat()` to archive buffer + create new buffer
- [ ] Rewrite `sendMessage()` to use JSON body + pre-extract attachments from paths
- [ ] Add "Return to Current" button visibility logic
- [ ] Update `renderMessage()` to display file badges from `attachments_meta`

### Phase 5: Dashboard Update
- [ ] Replace localStorage reads with `GET /api/sessions`
- [ ] Update delete to use `DELETE /api/sessions/:id`
- [ ] Update open to navigate with `?session=` parameter
- [ ] Update stats calculations from API data
- [ ] Add search filtering via API query parameters

### Phase 6: Cleanup
- [ ] Remove all legacy localStorage conversation keys
- [ ] Remove `savedConversations` from localStorage
- [ ] Clean up unused functions in `script.js`
- [ ] Update `README.md` with new architecture documentation

### Phase 7: Project Mode Preparation (Future)
- [ ] `src/db/projectRepo.js` — project + project_files CRUD
- [ ] `src/routes/projectRoutes.js` — project API endpoints
- [ ] Integrate with `indexerService.js` (Qdrant + Tree-sitter)
- [ ] Watch mode uses `project_files.content_hash` for incremental updates
- [ ] Sessions with `mode = 'project'` link to `projects` table

---

## 13. Testing Checklist

### 13.1 Conversation Lifecycle
- [ ] New user opens app → empty session created with title "unsavedSession 1", `activeSessionId` set
- [ ] User sends 5 messages → all persisted in SQLite, UI renders correctly
- [ ] User refreshes page → conversation loads from API, identical to before
- [ ] User saves conversation with title → `sessions.title` updated
- [ ] User loads old conversation → `viewingSessionId` changes, `activeSessionId` unchanged
- [ ] User clicks "Return to Current" → original conversation restored perfectly
- [ ] User sends message while viewing old conversation → old conversation becomes active
- [ ] User clears chat → old session archived as "unsavedSession N", new session created
- [ ] Archived sessions visible in Dashboard
- [ ] User deletes session from Dashboard → data permanently removed

### 13.2 File Handling
- [ ] User provides file paths → backend reads from disk, extracts text, saves to `attachments`
- [ ] Metadata saved in message (`attachments_meta`), NOT extracted text
- [ ] User loads old conversation with file → file badge renders correctly
- [ ] User continues old conversation → LLM has access to previously uploaded file content
- [ ] User provides large file (>1MB) → handled gracefully (truncated or rejected)
- [ ] User provides invalid path → error returned to frontend

### 13.3 Dashboard
- [ ] Dashboard lists all sessions with correct titles, categories, message counts
- [ ] Search filters sessions correctly
- [ ] Delete from dashboard removes session + messages + attachments from SQLite
- [ ] Open from dashboard navigates to chat with correct session loaded
- [ ] Archived "unsavedSession N" sessions visible and manageable

### 13.4 Server Restart
- [ ] Restart Node.js server → all conversations preserved in `chat.db`
- [ ] Restart Node.js server → sessions, messages, attachments all intact
- [ ] `chat.db` file can be backed up / copied to another machine

### 13.5 Edge Cases
- [ ] User sends message without selecting model → error shown
- [ ] User tries to delete active session → prevented or handled gracefully
- [ ] Multiple tabs open → each maintains own `viewingSessionId`, shared `activeSessionId`
- [ ] Database file missing → auto-created on first access
- [ ] Concurrent writes → WAL mode handles correctly

---

## 14. Performance Considerations

| Operation | Expected Time | Notes |
|-----------|--------------|-------|
| Create session | < 5ms | Single INSERT |
| Save message | < 10ms | INSERT + UPDATE count |
| Load 100 messages | < 20ms | Indexed SELECT with sort_order |
| List 500 sessions | < 50ms | Metadata only, no message content |
| Fetch attachment text | < 10ms | Single row by UUID primary key |
| Extract file from disk | < 50ms | Depends on file size |
| Delete session (cascade) | < 30ms | CASCADE deletes messages + attachments |
| Archive + create new (Clear) | < 20ms | UPDATE + INSERT |

**SQLite WAL mode** ensures reads don't block writes, so the dashboard can list sessions while the user is actively chatting.

---

## 15. Dependencies

```json
{
  "dependencies": {
    "better-sqlite3": "^11.7.0"
  }
}
```

No other new dependencies required. `better-sqlite3` is synchronous, which simplifies code significantly compared to async SQLite wrappers, and is the fastest SQLite driver for Node.js.

---

## 16. File Structure After Implementation

```
project/
├── data/
│   ├── .gitkeep
│   └── chat.db                    ← SQLite database (auto-created)
├── public/
│   ├── script.js                  ← MODIFIED: API-based conversation management
│   ├── index.html                 ← MODIFIED: return button visibility logic
│   ├── dashboard.html             ← MODIFIED: API-based data loading
│   ├── dashboard.js               ← NEW: dashboard logic extracted
│   └── logger.js                  ← unchanged
├── src/
│   ├── db/
│   │   ├── init.js                ← NEW: SQLite connection + schema
│   │   ├── sessionRepo.js         ← NEW: session CRUD
│   │   ├── messageRepo.js         ← NEW: message CRUD
│   │   ├── attachmentRepo.js      ← NEW: attachment CRUD (reads from disk)
│   │   └── projectRepo.js         ← NEW (future): project CRUD
│   ├── services/
│   │   ├── chatService.js         ← MODIFIED: reads from SQLite
│   │   ├── contextBuilder.js      ← NEW: builds LLM prompt from DB
│   │   └── fileService.js         ← MODIFIED: reads from disk paths
│   ├── routes/
│   │   ├── sessionRoutes.js       ← NEW
│   │   ├── attachmentRoutes.js    ← NEW
│   │   ├── chatRoutes.js          ← MODIFIED
│   │   └── projectRoutes.js       ← NEW (future)
│   └── app.js                     ← MODIFIED: register new routes
├── package.json                   ← MODIFIED: add better-sqlite3
└── .gitignore                     ← MODIFIED: add data/chat.db
```

---

## 17. Summary of Key Behaviors

| Action | What Happens |
|--------|--------------|
| **Open app (first time)** | Create new session "unsavedSession 1", set as `activeSessionId` |
| **Open app (returning)** | Load `activeSessionId` from localStorage, fetch messages from API |
| **Send message** | Save to SQLite via backend, no localStorage write |
| **Save conversation** | Update session title/category in SQLite |
| **Load saved conversation** | Set `viewingSessionId`, buffer untouched |
| **Return to Current** | Set `viewingSessionId = activeSessionId`, fetch buffer |
| **Send message in loaded chat** | Loaded chat becomes new `activeSessionId` |
| **Clear chat** | Archive buffer as "unsavedSession N", create new buffer |
| **Delete conversation** | Dashboard only, permanent delete from SQLite |
| **Server restart** | All data preserved in `chat.db` |
| **Upload file** | Backend reads from disk path, saves metadata + extracted text separately |

---

## 18. Migration Notes

**No migration required.** This is a fresh start. Old `localStorage` data (`currentConversation`, `currentQuestions`, `savedConversations`, `sessionId`, `currentSessionId`) will be ignored and can be manually cleared by the user via browser dev tools if desired.

The new system:
- Does not read old `localStorage` conversation data
- Does not attempt to import old conversations
- Starts with a clean slate in SQLite
- Old data remains in browser localStorage until user clears it manually

---