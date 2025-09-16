# MCP Integration for Chat App

This document explains how to integrate Model Context Protocol (MCP) servers with the chat application to provide additional capabilities to AI models.

## Overview

The chat application can be enhanced with MCP servers that provide tools for AI models to access external resources like web browsing, file system access, code execution, etc.

## Available MCP Servers

### 1. Web Browse Server (`mcp-web-browse-server.js`)

This server provides web browsing capabilities to AI models.

**Tool Provided:**
- `browse_url`: Browse a URL and retrieve its text content

**Usage:**
1. Start the MCP server:
   ```bash
   node mcp-web-browse-server.js
   ```

2. Configure your AI model to connect to this MCP server

3. When the model needs to browse a website, it can use the `browse_url` tool

## Integration with Ollama

To use MCP servers with Ollama models:

1. Start the MCP server(s) you want to use
2. Configure your Ollama model to connect to the MCP server
3. When interacting with the model, mention that it has access to tools

Example prompt:
```
Read and describe https://tanstack.com/router/latest
You have access to a web browsing tool that can fetch content from URLs.
```

## How It Works

1. The MCP server runs as a separate process
2. The AI model connects to the MCP server through the Model Context Protocol
3. When the model needs to use a tool, it sends a request to the MCP server
4. The MCP server performs the requested action and returns the results
5. The model incorporates the results into its response

## Creating Custom MCP Servers

To create your own MCP server:

1. Use the `@modelcontextprotocol/sdk` package
2. Define the tools your server provides
3. Implement the tool functionality
4. Use `StdioServerTransport` for local communication

Example structure:
```javascript
import { createServer } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';

const server = createServer(
  {
    name: 'my-custom-server',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler('tools', () => {
  return {
    tools: [
      {
        name: 'my_tool',
        description: 'Description of what this tool does',
        inputSchema: {
          type: 'object',
          properties: {
            // Define input parameters
          },
          required: []
        }
      }
    ]
  };
});

server.setRequestHandler('call_tool', async (request) => {
  // Implement tool functionality
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Benefits

1. **Enhanced Capabilities**: Models can access external resources
2. **Real-time Information**: Models can browse the web for current information
3. **Custom Tools**: You can create specialized tools for specific tasks
4. **Secure**: MCP provides a secure way to expose system capabilities to AI models

## Limitations

1. **Setup Required**: MCP servers need to be running and properly configured
2. **Model Awareness**: Models need to be prompted to use available tools
3. **Security Considerations**: Careful consideration needed when exposing system capabilities