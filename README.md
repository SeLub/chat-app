# Ollama Chat App

![Screenshot](Screenshot.png)

A modern web chat interface for Ollama models with advanced model management and real-time statistics.

## Features

### Three-Panel Layout
- **Left Panel (20%)**: Available models list with real-time status indicators
- **Middle Panel (70%)**: Chat interface with markdown-formatted responses
- **Right Panel (10%)**: Connection status and live statistics

### Model Management
- Automatic detection of installed Ollama models
- Real-time status monitoring (Running/Available)
- Easy model switching without restart
- Support for any Ollama model

### Enhanced Chat Experience
- Markdown formatting for bot responses (headers, code blocks, tables, etc.)
- Real-time message and token counting
- Model size and context window information
- Responsive full-screen design

### Statistics Dashboard
- Model size display
- Context window size
- Live message count
- Estimated token usage

## Setup

1. **Install Ollama:**
   - Go to [ollama.com](https://ollama.com)
   - Download and install for your operating system
   - Follow the installation prompts

2. **Download models:**
   ```bash
   # Download models (choose any you prefer)
   ollama pull phi4:latest
   ollama pull llama3.2
   ollama pull qwen2.5-coder
   ```

3. **Install app dependencies:**
   ```bash
   npm install
   ```

4. **Start the server:**
   ```bash
   node server.js
   ```

5. **Open in browser:**
   ```
   http://localhost:3000
   ```

## Usage

1. The app will automatically detect all your installed Ollama models
2. Models currently loaded in memory will show as "Running"
3. Click on any model to select it for chat
4. If a model shows "Available", start it first: `ollama run model-name`
5. Start chatting! Responses are formatted with markdown for better readability
6. Monitor your usage with real-time statistics in the right panel

## API Endpoints

- `GET /api/models` - List all available models with status
- `GET /api/status` - Check Ollama connection status
- `POST /api/chat` - Send message to selected model

## Requirements

- Node.js
- Ollama installed and running
- At least one Ollama model downloaded