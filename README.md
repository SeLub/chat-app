# Multi-Provider AI Chat App

A modern web chat interface for local LLM providers with advanced model management, real-time statistics, and multi-provider support (Ollama, llama.cpp).

## Features

### 🎯 Multi-Provider Architecture

- **Unified interface** for multiple LLM providers
- **Ollama** — full-featured integration with model management
- **llama.cpp** — support for GGUF models via llama-server
- **Provider switching** via radio buttons in UI (selection persists in localStorage)
- **Extensible** — add new providers by implementing `BaseProvider` interface
- **Automatic detection** of provider status and available models

### 🖥️ Three-Panel Layout

- **Left Panel (20%)**: Questions navigation panel with model indicators
- **Middle Panel (60%)**: Chat interface with markdown-formatted responses
- **Right Panel (20%)**: Provider selection, model dropdown, and live statistics

### 🦙 Model Management

- Automatic detection of installed models across providers
- Real-time status monitoring (Running/Available)
- Visual indicators for model types (vision models marked with 👁️)
- Easy model switching without restart
- **Size** and **Context window** display in chat header
- Support for any Ollama or llama.cpp compatible model

### 💬 Enhanced Chat Experience

- Markdown formatting for both user questions and bot responses (headers, code blocks, tables, etc.)
- Model badges showing which model answered each question
- Question and token counting
- Responsive full-screen design
- Document and image processing with AI analysis
- Web content extraction from URLs
- Message deletion for conversation curation
- Professional image message layout with thumbnails
- Multiline input modal for complex messages with code
- **Message actions**: copy question, copy Q&A (as Markdown), jump between Q&A pairs, delete Q&A pairs
- **Navigation buttons**: Previous/Next question jumps
- Questions navigation panel with model names for easy conversation browsing

### 💾 Conversation Persistence

- Auto-save current session (survives page reload)
- Save named conversations with custom titles and categories
- Category autocomplete with Tab/Arrow key navigation
- Load and manage multiple saved conversations
- Return to current conversation after browsing saved ones
- Export conversations to JSON files
- Clear current chat functionality
- Dedicated dashboard for conversation management

### 📄 Document Processing

- PDF file upload and text extraction
- Word document processing (DOC/DOCX)
- Excel spreadsheet analysis (XLS/XLSX/CSV)
- Automatic document analysis with any text model
- File preview with name and size display
- Support for document-based conversations

### 💻 Code File Processing

- Multiple code file upload (up to 50 files)
- Support for all major programming languages (.js, .py, .java, .html, .css, etc.)
- Cumulative file selection across different folders
- Structured code analysis and recommendations
- Project-wide code review capabilities

### 🖼️ Image Processing

- Image upload and analysis with vision models
- Support for JPG, PNG, GIF, BMP, WEBP formats
- Visual recognition and image reasoning
- Image captioning and question answering
- Compatible with llama3.2-vision, llava, gemma3, and other vision models
- Professional message layout with image thumbnails and filename display
- Click thumbnails to view full-size images in modal

### 🌐 Web Content Processing

- Automatic URL detection in messages
- Web page content extraction and analysis
- Clean article text extraction using Mozilla Readability
- Support for news articles, blogs, and documentation
- Rate limiting (max 3 URLs per message) with timeout protection

### 📊 Statistics Dashboard

- Model size display
- Context window size (dynamic detection)
- Live question count (user questions only)
- Estimated token usage
- Real-time response time tracking
- TPS, Prompt Speed, TTFT, Load Time, Total Time

---

## Setup

### Option 1: Docker Setup (Recommended)

Run Ollama in Docker:

```bash
# Make script executable and run
chmod +x run-ollama-docker.sh
./run-ollama-docker.sh
```

This script will:
- Install Docker if not present
- Install NVIDIA Container Toolkit for GPU support
- Stop local Ollama service
- Start Ollama in Docker container with GPU access

Download models:

```bash
# Download models inside Docker container
docker exec -it ollama ollama pull phi4:latest
docker exec -it ollama ollama pull llama3.2
docker exec -it ollama ollama pull qwen2.5-coder
```

Install app dependencies:

```bash
npm install
```

Start the server:

```bash
npm start
```

Open in browser:
```
http://localhost:3000
```

### Option 2: Local Installation

Install Ollama:
- Go to [ollama.com](https://ollama.com)
- Download and install for your operating system
- Follow the installation prompts

Download models:

```bash
ollama pull phi4:latest
ollama pull llama3.2
ollama pull qwen2.5-coder
```

Install app dependencies and start:

```bash
npm install
npm start
```

Open in browser:
```
http://localhost:3000
```

---

## Configuration

The application uses environment variables for provider configuration. Create a `.env` file or pass variables at startup:

```bash
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

### Example: Enable both providers

```bash
LLAMA_CPP_ENABLED=true npm start
```

### Example: Use llama.cpp by default

```bash
DEFAULT_PROVIDER=llama_cpp LLAMA_CPP_ENABLED=true npm start
```

---

## Usage

1. The app will automatically detect all installed models from enabled providers
2. Select a provider using the radio buttons in the right panel (Ollama / llama.cpp)
3. Choose a model from the dropdown list
4. Start chatting! Responses are formatted with markdown for better readability
5. Use **📝 MULTILINE** button for complex messages with code blocks and formatting
6. Upload documents using **📎 PDF,DOC,XLS** button or images using **🖼️ IMG** button
7. Upload code files using **📁 CODE** button (supports multiple files)
8. Include URLs in messages for automatic web content analysis
9. Use message actions: copy questions/answers, jump between Q&A pairs, delete unwanted pairs
10. View uploaded images as clean thumbnails with filenames displayed below
11. Monitor your usage with real-time statistics in the right panel
12. Use the menu to save, load, or export conversations
13. Navigate through your conversation using the Questions panel

Your current conversation auto-saves and restores on page reload.

---

## API Endpoints

### Provider Management
- `GET /api/providers` — List all configured providers and default provider

### Models
- `GET /api/models` — List all available models from active provider (requires `X-Provider` header)
- `POST /api/show` — Get detailed model information including context window size

### Chat
- `POST /api/chat` — Send message to selected model (multipart/form-data, requires `X-Provider` header)

### Images
- `GET /api/images/:imageId/:type` — Serve uploaded images (full/thumb)
- `DELETE /api/conversation-images` — Delete images from conversation

### Headers

All provider-specific endpoints accept the `X-Provider` header to select the active provider:

```bash
curl -H "X-Provider: ollama" http://localhost:3000/api/models
curl -H "X-Provider: llama_cpp" http://localhost:3000/api/models
```

If header is not provided, `DEFAULT_PROVIDER` from config is used.

---

## Project Structure

```
server/
├── server.js                       # Entry point (starts src/server.js)
├── package.json
├── docker-compose.yml
├── run-ollama-docker.sh
│
├── src/
│   ├── server.js                   # Server bootstrap
│   ├── app.js                      # Express initialization
│   │
│   ├── config/
│   │   └── providers.js            # Provider configuration (from ENV)
│   │
│   ├── providers/                  # Multi-provider core
│   │   ├── BaseProvider.js         # Abstract base class
│   │   ├── OllamaProvider.js       # Ollama implementation
│   │   ├── LlamaCppProvider.js     # llama.cpp implementation
│   │   └── providerManager.js      # Factory/provider registry
│   │
│   ├── controllers/                # HTTP request handlers
│   │   ├── chatController.js
│   │   ├── modelController.js
│   │   └── imageController.js
│   │
│   ├── services/                   # Provider-agnostic business logic
│   │   ├── fileService.js          # PDF/DOC/XLS/code processing
│   │   ├── imageService.js         # Image save/delete
│   │   ├── webService.js           # URL content extraction
│   │   └── metricsService.js       # Metrics normalization
│   │
│   ├── routes/
│   │   ├── chatRoutes.js
│   │   ├── modelRoutes.js
│   │   └── imageRoutes.js
│   │
│   ├── middleware/
│   │   ├── uploadMiddleware.js     # Multer configuration
│   │   ├── providerMiddleware.js   # Provider selection from request
│   │   └── errorHandler.js
│   │
│   └── utils/
│       ├── fileUtils.js
│       ├── urlUtils.js
│       └── imageUtils.js
│
├── uploads/
│   └── images/
│       └── thumbnails/
│
└── public/                         # Frontend
    ├── index.html
    ├── style.css
    ├── script.js
    └── dashboard.html
```

---

## Adding a New Provider

To add a third provider (e.g., vLLM, LocalAI, OpenAI-compatible):

### 1. Create provider class

```javascript
// src/providers/VllmProvider.js
import { BaseProvider } from './BaseProvider.js';

export class VllmProvider extends BaseProvider {
  async getModels() { /* ... */ }
  async showModel(name) { /* ... */ }
  async generate({ model, prompt, stream }) { /* ... */ }
  async chat({ model, messages, stream }) { /* ... */ }
  async healthCheck() { /* ... */ }
  normalizeMetrics(raw) { /* ... */ }
}
```

### 2. Register in providerManager.js

```javascript
const registry = {
  ollama: () => import('./OllamaProvider.js').then(m => m.OllamaProvider),
  llama_cpp: () => import('./LlamaCppProvider.js').then(m => m.LlamaCppProvider),
  vllm: () => import('./VllmProvider.js').then(m => m.VllmProvider),
};
```

### 3. Add configuration

```javascript
// src/config/providers.js
vllm: {
  type: 'vllm',
  url: process.env.VLLM_URL || 'http://localhost:8000',
  enabled: process.env.VLLM_ENABLED === 'true',
}
```

That's it — no changes to controllers, services, or routes needed.

---

## Features in Detail

### Conversation Management

- **Auto-save**: Current conversation automatically saved to localStorage
- **Named saves**: Save important conversations with custom names and categories
- **Category system**: Organize conversations by topics (Javascript, English, Python, etc.)
- **Smart autocomplete**: Existing categories suggested with Tab/Arrow navigation
- **Update conversations**: Modify loaded conversations and update original or save as new
- **Current conversation backup**: Preserves working conversation when browsing saved ones
- **Return to current**: Easy way to get back to your working conversation
- **Dashboard**: Dedicated page for managing all conversations with category organization
- **Accordion interface**: Collapsible category sections for better organization
- **Search & Filter**: Find conversations by name or content across all categories
- **Bulk Operations**: Select and manage multiple conversations at once
- **Export**: Download individual or multiple conversations as JSON files
- **Rename**: Edit conversation names inline
- **Statistics**: View total conversations and message counts per category

### Smart Statistics

- **Questions**: Counts only user questions (not total messages)
- **Response time**: Live timer showing model response speed
- **Tokens**: Estimated token usage for cost tracking
- **Model info**: Size and dynamic context window detection for each model
- **Context detection**: Automatically detects custom context window sizes (e.g., 64K, 128K)
- **Unified metrics**: Normalized across all providers (TPS, TTFT, Load Time)

### Dashboard Features

- **Category Organization**: Conversations grouped by learning topics
- **Accordion Categories**: Click category headers to collapse/expand sections
- **Conversation Grid**: Visual cards showing all saved conversations
- **Search Functionality**: Real-time search through conversation names and content
- **Bulk Operations**: Select multiple conversations for batch export or deletion
- **Statistics Overview**: Total conversations, messages, and selection counts per category
- **Individual Management**: Rename, export, delete, or open any conversation
- **Direct Loading**: Open conversations directly from dashboard to main chat

### Model Support

- **Text models**: Full chat support with document and code processing (phi4, llama, qwen, etc.)
- **Vision models**: Image analysis and visual reasoning (llama3.2-vision, llava, gemma3, etc.) — marked with 👁️ eye icon
- **Embedding models**: Detected and marked as unavailable for chat
- **Document analysis**: All text models can process PDF, DOC, DOCX, XLS, XLSX, CSV files
- **Code analysis**: All text models can analyze multiple code files for reviews and recommendations
- **Image analysis**: Vision models can analyze JPG, PNG, GIF, BMP, WEBP images
- **Web content**: All text models can analyze content from URLs automatically
- **Alphabetical sorting**: Models displayed in alphabetical order for easy navigation

---

## Requirements

### For Docker Setup:
- Node.js 18+
- Docker and Docker Compose
- NVIDIA GPU (optional, for GPU acceleration)
- NVIDIA Container Toolkit (for GPU support)

### For Local Setup:
- Node.js 18+
- Ollama installed and running, OR
- llama.cpp server with a loaded model
- At least one model downloaded

---

## Docker Configuration

The `docker-compose.yml` includes:
- GPU support with NVIDIA runtime
- Persistent model storage
- Optimized memory and context settings (32K context, flash attention)
- Port mapping to localhost:11434
- Health checks and auto-restart

---

## Dependencies

### Core
- `express` — Web server framework
- `node-fetch` — HTTP client for provider APIs
- `multer` — File upload handling
- `sharp` — Image processing and thumbnail generation

### Document Processing
- `pdfjs-dist` — PDF text extraction
- `word-extractor` — DOC/DOCX text extraction
- `xlsx` — Excel spreadsheet processing

### Web Content
- `@mozilla/readability` — Web content extraction
- `jsdom` — Server-side DOM parsing
- `cheerio` — HTML parsing utilities

---

## License

MIT
