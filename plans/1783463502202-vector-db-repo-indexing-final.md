```markdown
# Plan: Vector Database for Repository Code Indexing & Semantic Search (Final)

## Overview

Integrate Qdrant vector database into the chat app to index local code projects and enable semantic code search. The app gains **Chat** and **Project** modes. In Project mode, the user sets a project path, can attach files to questions, and asks code-related queries with RAG context from Qdrant.

**Key design decisions:**
- Embedding model (mxbai-embed-large, 335M) runs **in RAM** via llama.cpp, always-on for watch mode
- Main 35B model runs **in VRAM** via llama.cpp with MTP acceleration
- **Tree-sitter** for multi-language AST parsing (JS/TS/Python/Go/Rust/Java/C++)
- **Hybrid search** (semantic + keyword) for best retrieval quality
- **Incremental indexing** with SHA-256 hashing for efficient watch mode
- **Streaming responses** for real-time UX

---

## Architecture

### Two UI Modes

```
┌─────────────────────────────────────────────────────────────┐
│                       CHAT MODE                              │
│  • User selects provider (Ollama / llama.cpp)               │
│  • User selects model from available list                   │
│  • Standard chat flow, file uploads, code files             │
│  • No repository context                                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      PROJECT MODE                            │
│  • User sets project path                                   │
│  • Model preconfigured (llama.cpp VRAM on port 8080)        │
│  • Can attach specific files to questions                   │
│  • Chat with RAG context from Qdrant vector DB              │
│  • Watch mode keeps index updated in real-time              │
└─────────────────────────────────────────────────────────────┘
```

### Infrastructure Architecture

```
                         ┌──────────────────┐
                         │  Chat App (Node) │
                         └────────┬─────────┘
                                  │
                ┌─────────────────┼─────────────────┐
                │                 │                 │
       ┌────────▼──────┐  ┌──────▼──────┐  ┌───────▼───────┐
       │ Ollama        │  │ Qdrant      │  │ llama.cpp     │
       │ (Chat mode)   │  │             │  │ (Embedding)   │
       │ Port 11434    │  │ Port 6333   │  │ Port 8081     │
       │ Main models   │  │ Vector DB   │  │ mxbai-embed   │
       │               │  │             │  │ in RAM (CPU)  │
       └───────────────┘  └─────────────┘  └───────────────┘
                                               ▲
       ┌─────────────────────────────────────┐ │
       │ llama.cpp (Project mode)            │ │
       │ Port 8080                           │ │
       │ Qwen3.6-35B in VRAM                 │ │
       │ --n-gpu-layers 99                   │ │
       │ --spec-type draft-mtp (MTP accel)   │ │
       └─────────────────────────────────────┘ │
                                               │
       ┌───────────────────────────────────────┘
       │  Always running, watches file changes
       │  Re-indexes only changed files
       └───────────────────────────────────────
```

---

## Infrastructure Setup

### 1. Docker Compose

```yaml
services:
  # ... existing ollama (port 11434, chat models) ...
  
  qdrant:
    image: qdrant/qdrant:latest
    container_name: qdrant
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    restart: unless-stopped

volumes:
  ollama_data:     # existing
  qdrant_data:     # new — vector DB storage
```

### 2. Dependencies (`package.json`)

```json
{
  "dependencies": {
    "@qdrant/js-client-rest": "^1.12.0",
    "web-tree-sitter": "^0.24.0",
    "globby": "^14.0.0",
    "chokidar": "^4.0.0",
    "node-cache": "^5.1.2",
    "p-limit": "^5.0.0"
  }
}
```

### 3. Tree-sitter WASM Files

```bash
mkdir -p wasm
# Download WASM grammars for supported languages
wget https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.23.1/tree-sitter-javascript.wasm -O wasm/tree-sitter-javascript.wasm
wget https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm -O wasm/tree-sitter-typescript.wasm
wget https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm -O wasm/tree-sitter-python.wasm
wget https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.23.4/tree-sitter-go.wasm -O wasm/tree-sitter-go.wasm
wget https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm -O wasm/tree-sitter-rust.wasm
```

### 4. Environment Variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant REST API URL |
| `EMBEDDING_LLAMA_URL` | `http://localhost:8081` | llama.cpp server for embeddings (RAM) |
| `CHAT_LLAMA_URL` | `http://localhost:8080` | llama.cpp server for chat/Project mode (VRAM) |
| `EMBEDDING_VEC_SIZE` | `1024` | Vector dimension (must match model) |
| `MAX_CHUNKS_PER_BATCH` | `20` | Chunks per embedding API call |
| `MAX_FILE_SIZE_BYTES` | `1048576` (1MB) | Skip files larger than this |
| `MAX_CONTEXT_TOKENS` | `12000` | Max tokens for RAG context |
| `CACHE_TTL_SECONDS` | `86400` | Embedding cache TTL (24h) |

### 5. Start Services

```bash
# Qdrant
docker run -p 6333:6333 -p 6334:6334 \
  -v qdrant_storage:/qdrant/storage \
  qdrant/qdrant

# Embedding server (in RAM, always running)
./build/bin/llama-server \
    --model mxbai-embed-large-q8_0.gguf \
    --port 8081 \
    --embedding \
    --n-gpu-layers 0 \
    --ctx-size 512 \
    --batch-size 256 \
    --threads 8 \
    --no-mmap

# Main chat model (in VRAM)
./build/bin/llama-server \
    --model Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf \
    --port 8080 \
    --n-gpu-layers 99 \
    --n-cpu-moe 16 \
    --parallel 1 \
    --ctx-size 32768 \
    --cache-type-k q4_0 \
    --cache-type-v q4_0 \
    --flash-attn on \
    --no-mmap --mlock \
    --temp 0.7 --top-p 0.8 --top-k 20 \
    --presence-penalty 1.5 --min-p 0.00 \
    --spec-type draft-mtp --spec-draft-n-max 2 \
    --reasoning off
```

---

## Qdrant Collection Schema

**Collection name:** `code_snippets` (single collection, filtered by `project_path`)  
**Vector size:** 1024  
**Distance:** Cosine

### Payload Schema

| Field | Type | Description |
|---|---|---|
| `file_path` | keyword | Relative path within project |
| `project_path` | keyword | Project identifier (filter) |
| `language` | keyword | File language (javascript, typescript, python, etc.) |
| `type` | keyword | `function` / `class` / `method` / `variable` / `import` / `chunk` |
| `name` | keyword (nullable) | Function/class/method name |
| `signature` | text (nullable) | Function signature |
| `line_start` | integer | Starting line number |
| `line_end` | integer | Ending line number |
| `chunk_index` | integer | Chunk position in file |
| `total_chunks` | integer | Total chunks in file |
| `imports` | array of keywords | Imported module names |
| `exports` | array of keywords | Exported names |
| `calls` | array of keywords | Functions called within this block |
| `called_by` | array of keywords | Functions that call this block |
| `content_hash` | keyword | SHA-256 hash (for incremental updates) |
| `last_indexed` | datetime | Timestamp of last indexing |
| `keywords` | array of keywords | Extracted keywords for hybrid search |

### Payload Indexes

```javascript
await qdrant.createPayloadIndex('code_snippets', 'project_path', 'keyword');
await qdrant.createPayloadIndex('code_snippets', 'language', 'keyword');
await qdrant.createPayloadIndex('code_snippets', 'file_path', 'keyword');
await qdrant.createPayloadIndex('code_snippets', 'type', 'keyword');
await qdrant.createPayloadIndex('code_snippets', 'name', 'keyword');
```

---

## New/Modified Files

```
src/
  config/
    providers.js              — MODIFY: add projectModeProvider config
  services/
    vectorDbService.js        — NEW: Qdrant client wrapper
    embeddingService.js       — NEW: llama.cpp embedding API + cache
    parserService.js          — NEW: Tree-sitter multi-language parser
    indexerService.js         — NEW: file discovery, chunking, watch mode
    projectModeService.js     — NEW: Project mode state management
    contextManager.js         — NEW: RAG context builder with token budget
  routes/
    repoRoutes.js             — NEW: Express routes for /api/repos/*
    projectRoutes.js          — NEW: Express routes for /api/project/*
  controllers/
    repoController.js         — NEW: index/search/list/delete handlers
    projectController.js      — NEW: Project mode query handler (RAG + chat)
wasm/
  tree-sitter-javascript.wasm
  tree-sitter-typescript.wasm
  tree-sitter-python.wasm
  tree-sitter-go.wasm
  tree-sitter-rust.wasm
```

---

## API Endpoints

### Repository / Indexing Routes (`/api/repos`)

| Method | Path | Description |
|---|---|---|
| POST | `/api/repos/index` | Index a local project directory (full or incremental) |
| POST | `/api/repos/search` | Hybrid search (semantic + keyword) over indexed code |
| GET | `/api/repos/collections` | List all indexed projects with stats |
| DELETE | `/api/repos/collections/:projectPath` | Delete vectors for a project |
| POST | `/api/repos/watch` | Start watch mode for a project |
| DELETE | `/api/repos/watch/:projectPath` | Stop watch mode for a project |

### Project Mode Routes (`/api/project`)

| Method | Path | Description |
|---|---|---|
| POST | `/api/project/setup` | Set project path, start indexing + watch |
| GET | `/api/project/status` | Get current project state (path, watch status, indexed files) |
| POST | `/api/project/query` | Ask a question with RAG + streaming response |
| POST | `/api/project/attach-file` | Add a single file to the active session context |

---

## Project Mode Query Flow

### Request

```json
{
  "message": "How does authentication work?",
  "attachedFiles": ["src/middleware/auth.ts", "src/utils/jwt.ts"],
  "sessionId": "..."
}
```

### Flow

```
1. Extract keywords from message
   ↓
2. Get embedding of message via llama.cpp (port 8081)
   ↓
3. Hybrid search in Qdrant:
   • Semantic search (top-K by vector similarity)
   • Keyword search (exact matches on function_name, name)
   ↓
4. Merge and deduplicate results
   ↓
5. Optional: rerank results (if reranker available)
   ↓
6. Expand results with relations (calls, called_by, imports)
   ↓
7. Build context with token budget (contextManager.js)
   • Attached files (priority)
   • Relevant snippets (by relevance score)
   • Stop when MAX_CONTEXT_TOKENS reached
   ↓
8. Format prompt:
   [RELEVANT_CODE_SNIPPETS]
   [ATTACHED_FILES]
   [USER_QUESTION]
   ↓
9. Stream response from llama.cpp (port 8080)
   ↓
10. Return response with source citations
```

---

## Key Service Implementations

### 1. `parserService.js` — Multi-language Tree-sitter Parser

```javascript
import Parser from 'web-tree-sitter';

const parsers = {};

export async function initParsers() {
  await Parser.init();
  
  const languages = {
    javascript: 'tree-sitter-javascript.wasm',
    typescript: 'tree-sitter-typescript.wasm',
    python: 'tree-sitter-python.wasm',
    go: 'tree-sitter-go.wasm',
    rust: 'tree-sitter-rust.wasm'
  };

  for (const [lang, wasmFile] of Object.entries(languages)) {
    const Language = await Parser.Language.load(`./wasm/${wasmFile}`);
    parsers[lang] = new Parser();
    parsers[lang].setLanguage(Language);
  }
}

export function parseCode(content, language) {
  const parser = parsers[language];
  if (!parser) {
    // Fallback: text chunking for unsupported languages
    return chunkText(content);
  }

  const tree = parser.parse(content);
  return extractStructures(tree.rootNode, language);
}

function extractStructures(rootNode, language) {
  const structures = [];

  function visit(node) {
    const functionTypes = [
      'function_declaration', 'arrow_function', 
      'method_definition', 'function_definition'
    ];
    
    if (functionTypes.includes(node.type)) {
      structures.push({
        type: 'function',
        name: getFunctionName(node),
        signature: getSignature(node),
        content: node.text,
        lineStart: node.startPosition.row,
        lineEnd: node.endPosition.row,
        calls: extractCalls(node),
        imports: [],
        exports: []
      });
    }

    if (node.type === 'class_declaration' || node.type === 'class_definition') {
      structures.push({
        type: 'class',
        name: getClassName(node),
        content: node.text,
        lineStart: node.startPosition.row,
        lineEnd: node.endPosition.row
      });
    }

    if (node.type === 'import_statement' || node.type === 'import_declaration') {
      structures.push({
        type: 'import',
        content: node.text,
        lineStart: node.startPosition.row,
        lineEnd: node.endPosition.row
      });
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(rootNode);
  
  // Fallback: if no structures found, chunk by text
  if (structures.length === 0) {
    return chunkText(rootNode.text);
  }
  
  return structures;
}
```

### 2. `embeddingService.js` — With Cache

```javascript
import NodeCache from 'node-cache';

const embeddingCache = new NodeCache({ 
  stdTTL: parseInt(process.env.CACHE_TTL_SECONDS) || 86400,
  checkperiod: 3600,
  useClones: false
});

export async function getEmbedding(text, contentHash = null) {
  // Check cache by content hash
  if (contentHash) {
    const cached = embeddingCache.get(contentHash);
    if (cached) return cached;
  }

  // Retry logic with exponential backoff
  for (let i = 0; i < 3; i++) {
    try {
      const response = await fetch(`${process.env.EMBEDDING_LLAMA_URL}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text, model: 'mxbai-embed-large' })
      });

      if (!response.ok) throw new Error(`Embedding API error: ${response.status}`);
      
      const data = await response.json();
      const embedding = data.data[0].embedding;
      
      if (contentHash) {
        embeddingCache.set(contentHash, embedding);
      }
      
      return embedding;
    } catch (error) {
      if (i === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
}

export async function getEmbeddingsBatch(texts, contentHashes = null) {
  const results = [];
  const batchSize = parseInt(process.env.MAX_CHUNKS_PER_BATCH) || 20;
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchHashes = contentHashes?.slice(i, i + batchSize);
    
    const embeddings = await Promise.all(
      batch.map((text, idx) => getEmbedding(text, batchHashes?.[idx]))
    );
    
    results.push(...embeddings);
  }
  
  return results;
}
```

### 3. `indexerService.js` — Watch Mode

```javascript
import chokidar from 'chokidar';
import crypto from 'crypto';
import { globby } from 'globby';

const activeWatches = new Map();

export async function indexProject(projectPath, onProgress) {
  const files = await globby([
    '**/*.{js,jsx,ts,tsx,py,go,rs,java,c,cpp,h,hpp}',
    '!**/node_modules/**',
    '!**/.git/**',
    '!**/dist/**',
    '!**/build/**',
    '!**/.next/**',
    '!**/__pycache__/**',
    '!**/*.min.*',
    '!**/*.map'
  ], { cwd: projectPath, absolute: true });

  const totalFiles = files.length;
  let processedFiles = 0;

  for (const file of files) {
    try {
      await indexFile(projectPath, file);
      processedFiles++;
      
      onProgress?.({
        type: 'file',
        current: processedFiles,
        total: totalFiles,
        file: file.replace(projectPath + '/', ''),
        status: 'indexed'
      });
    } catch (error) {
      onProgress?.({
        type: 'error',
        file: file.replace(projectPath + '/', ''),
        error: error.message
      });
    }
  }

  return { indexed: processedFiles, total: totalFiles };
}

export async function indexFile(projectPath, filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  
  // Check if file already indexed with same hash
  const existing = await vectorDbService.getFileByHash(projectPath, filePath, contentHash);
  if (existing) return { skipped: true };
  
  // Delete old points for this file
  await vectorDbService.deletePointsForFile(projectPath, filePath);
  
  // Parse and chunk
  const language = getLanguage(filePath);
  const structures = parserService.parseCode(content, language);
  
  // Get embeddings
  const texts = structures.map(s => s.content);
  const hashes = structures.map(() => contentHash);
  const embeddings = await embeddingService.getEmbeddingsBatch(texts, hashes);
  
  // Upsert to Qdrant
  const points = structures.map((structure, idx) => ({
    id: generatePointId(projectPath, filePath, idx),
    vector: embeddings[idx],
    payload: {
      file_path: filePath.replace(projectPath + '/', ''),
      project_path: projectPath,
      language,
      type: structure.type,
      name: structure.name || null,
      signature: structure.signature || null,
      line_start: structure.lineStart,
      line_end: structure.lineEnd,
      chunk_index: idx,
      total_chunks: structures.length,
      imports: structure.imports || [],
      exports: structure.exports || [],
      calls: structure.calls || [],
      called_by: [],
      content_hash: contentHash,
      last_indexed: new Date().toISOString(),
      keywords: extractKeywords(structure.content)
    }
  }));
  
  await vectorDbService.upsertPoints(points);
  return { indexed: structures.length };
}

export function startWatch(projectPath, onFileChange) {
  if (activeWatches.has(projectPath)) return;
  
  const watcher = chokidar.watch(projectPath, {
    ignored: [
      '**/.git/**', '**/node_modules/**', '**/dist/**', '**/build/**',
      '**/.next/**', '**/__pycache__/**', '**/*.min.*', '**/*.map'
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 }
  });

  watcher.on('change', async (filePath) => {
    await onFileChange(projectPath, filePath);
  });
  
  watcher.on('add', async (filePath) => {
    await onFileChange(projectPath, filePath);
  });
  
  watcher.on('unlink', async (filePath) => {
    await vectorDbService.deletePointsForFile(projectPath, filePath);
  });

  activeWatches.set(projectPath, watcher);
}

export function stopWatch(projectPath) {
  const watcher = activeWatches.get(projectPath);
  if (watcher) {
    watcher.close();
    activeWatches.delete(projectPath);
  }
}
```

### 4. `contextManager.js` — Token Budget

```javascript
const MAX_CONTEXT_TOKENS = parseInt(process.env.MAX_CONTEXT_TOKENS) || 12000;

export async function buildContext(query, snippets, attachedFiles = []) {
  let context = '';
  let tokenCount = 0;

  // 1. Attached files (priority)
  for (const file of attachedFiles) {
    const content = await fs.readFile(file.path, 'utf-8');
    const tokens = estimateTokens(content);
    
    if (tokenCount + tokens > MAX_CONTEXT_TOKENS) break;
    
    context += `\n[ATTACHED FILE: ${file.path}]\n${content}\n`;
    tokenCount += tokens;
  }

  // 2. Relevant snippets (by relevance)
  for (const snippet of snippets) {
    const tokens = estimateTokens(snippet.content);
    
    if (tokenCount + tokens > MAX_CONTEXT_TOKENS) break;
    
    context += `\n[CODE: ${snippet.file_path}:${snippet.line_start}-${snippet.line_end}]`;
    context += `\n[${snippet.type}: ${snippet.name || 'anonymous'}]\n`;
    context += snippet.content + '\n';
    tokenCount += tokens;
  }

  return context;
}

function estimateTokens(text) {
  // ~3 chars per token for code
  return Math.ceil(text.length / 3);
}
```

### 5. Hybrid Search

```javascript
export async function hybridSearch(query, projectPath, options = {}) {
  // 1. Semantic search
  const queryEmbedding = await embeddingService.getEmbedding(query);
  const semanticResults = await qdrant.search('code_snippets', {
    vector: queryEmbedding,
    filter: {
      must: [{ key: 'project_path', match: { value: projectPath } }]
    },
    limit: options.semanticLimit || 10,
    with_payload: true
  });

  // 2. Keyword search (exact matches on names)
  const keywords = extractKeywords(query);
  const keywordResults = keywords.length > 0 ? await qdrant.search('code_snippets', {
    filter: {
      must: [
        { key: 'project_path', match: { value: projectPath } },
        {
          should: [
            ...keywords.map(kw => ({ key: 'name', match: { text: kw } })),
            ...keywords.map(kw => ({ key: 'keywords', match: { text: kw } }))
          ]
        }
      ]
    },
    limit: options.keywordLimit || 5,
    with_payload: true
  }) : [];

  // 3. Merge and deduplicate
  const merged = mergeResults(semanticResults, keywordResults);
  
  // 4. Expand with relations
  const expanded = await expandWithRelations(merged);
  
  return expanded.slice(0, options.limit || 10);
}

async function expandWithRelations(results) {
  const expanded = [...results];
  const seen = new Set(results.map(r => r.id));
  
  for (const result of results) {
    // Add functions that this function calls
    if (result.payload.calls?.length > 0) {
      const called = await qdrant.search('code_snippets', {
        filter: {
          must: [
            { key: 'project_path', match: { value: result.payload.project_path } },
            { key: 'name', match: { any: result.payload.calls } },
            { key: 'type', match: { value: 'function' } }
          ]
        },
        limit: 3,
        with_payload: true
      });
      
      for (const c of called) {
        if (!seen.has(c.id)) {
          expanded.push(c);
          seen.add(c.id);
        }
      }
    }
  }
  
  return expanded;
}
```

---

## Frontend UI Changes

### Mode Selector

```html
<div class="mode-selector">
  <button class="mode-btn active" data-mode="chat" onclick="switchMode('chat')">
    💬 Chat
  </button>
  <button class="mode-btn" data-mode="project" onclick="switchMode('project')">
    📁 Project
  </button>
</div>
```

### Project Panel (Right Side)

```html
<div class="project-section">
  <h3>Project</h3>
  
  <div class="project-path">
    <label>Project Path</label>
    <input type="text" id="projectPath" placeholder="/path/to/project">
    <button onclick="browseProject()">Browse</button>
  </div>

  <div class="project-status">
    <div class="status-indicator">
      <span class="status-icon">📁</span>
      <span class="status-text" id="statusText">Not indexed</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" id="progressFill" style="width: 0%"></div>
    </div>
    <div class="status-details" id="statusDetails"></div>
  </div>

  <div class="watch-status">
    <label class="switch">
      <input type="checkbox" id="watchToggle" onchange="toggleWatch()">
      <span class="slider"></span>
    </label>
    <span class="watch-label">Live Watch</span>
    <span class="watch-indicator">
      <span class="pulse-dot" id="watchDot"></span>
      <span id="watchText">Inactive</span>
    </span>
  </div>

  <div class="attached-files">
    <h4>Attached Files</h4>
    <ul id="attachedFilesList"></ul>
  </div>
</div>
```

### Search Results Preview

```html
<div class="search-result">
  <div class="result-header">
    <span class="file-path">src/utils/auth.ts</span>
    <span class="line-range">45-62</span>
    <span class="result-type">function</span>
  </div>
  <div class="result-name">validateToken</div>
  <pre class="result-content"><code>function validateToken(token: string): Promise&lt;boolean&gt; {
  // ...
}</code></pre>
  <div class="result-relations">
    <span class="relation">Calls: decodeJWT, checkExpiry</span>
    <span class="relation">Called by: authMiddleware</span>
  </div>
</div>
```

---

## Implementation Phases

### Phase 1: Infrastructure (Day 1-2)

- [ ] Update `docker-compose.yml` — add `qdrant` service
- [ ] Add `qdrant_data` volume
- [ ] Update `package.json` — add dependencies
- [ ] Download Tree-sitter WASM files
- [ ] Add `.env` entries
- [ ] Start Qdrant and verify

### Phase 2: Backend Services (Day 3-7)

- [ ] `src/services/vectorDbService.js` — Qdrant wrapper
- [ ] `src/services/embeddingService.js` — llama.cpp embedding + cache
- [ ] `src/services/parserService.js` — Tree-sitter multi-language parser
- [ ] `src/services/indexerService.js` — indexing, watch, incremental updates
- [ ] `src/services/contextManager.js` — RAG context builder
- [ ] `src/services/projectModeService.js` — Project mode state

### Phase 3: Routes & Controllers (Day 8-10)

- [ ] `src/routes/repoRoutes.js` — `/api/repos/*`
- [ ] `src/controllers/repoController.js` — index/search/list/delete
- [ ] `src/routes/projectRoutes.js` — `/api/project/*`
- [ ] `src/controllers/projectController.js` — query with streaming
- [ ] Register routes in `src/app.js`

### Phase 4: Frontend (Day 11-14)

- [ ] Mode selector toggle
- [ ] Project panel in right side
- [ ] Progress indicators for indexing
- [ ] Watch mode toggle and status
- [ ] Search results with code preview
- [ ] Streaming response UI
- [ ] File attachment handling

### Phase 5: Testing & Optimization (Day 15-17)

- [ ] Unit tests for services
- [ ] Integration tests for API
- [ ] Performance testing (batch size, cache hit rate)
- [ ] UI/UX testing
- [ ] Documentation

---

## Failure Modes & Handling

| Scenario | Handling |
|---|---|
| Embedding llama.cpp not running (port 8081) | Return 503: "Embedding service unavailable" |
| Qdrant not running | Return 503: "Vector DB unavailable" |
| Chat llama.cpp not running (port 8080) | Return 503 in project queries |
| File too large (>1MB) | Skip file, log warning |
| Invalid code (bad syntax) | Catch parse error, fall back to text chunking |
| Duplicate index of same path | Delete existing points first |
| Watch mode fails on a file | Log error, continue watching others |
| Embedding API timeout | Retry 3x with exponential backoff |
| Context exceeds token limit | Truncate by relevance score |

---

## Performance Targets

| Metric | Target |
|---|---|
| Initial indexing (1000 files) | < 5 minutes |
| Incremental re-index (1 file) | < 2 seconds |
| Semantic search latency | < 200ms |
| Hybrid search latency | < 300ms |
| Embedding cache hit rate | > 80% |
| Watch mode file change detection | < 3 seconds |
| Streaming response TTFT | < 1 second |
| Generation TPS (Project mode) | 60-85 t/s |

---

## Future Enhancements

1. **Reranker model** — cross-encoder for better result ranking
2. **Multi-project support** — search across multiple projects simultaneously
3. **Git integration** — track changes via git history
4. **Code graph visualization** — show dependency graph in UI
5. **Incremental LLM context** — remember conversation context across queries
6. **Custom embedding models** — allow user to swap embedding model
7. **Export/import indexes** — share project indexes between users
8. **Webhook notifications** — notify on indexing completion/errors
```

Этот план готов к сохранению в `.md` файл. Он объединяет лучшее из обоих вариантов и добавляет ключевые улучшения:

**Ключевые решения:**
- ✅ Tree-sitter для мультиязычности (вместо typescript-estree)
- ✅ Hybrid search (semantic + keyword)
- ✅ Кэширование embeddings с retry логикой
- ✅ Streaming responses
- ✅ Context window management с token budget
- ✅ Progress indicators и watch mode UI
- ✅ Расширение результатов связями (calls, called_by)
- ✅ Multi-language support из коробки