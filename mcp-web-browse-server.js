#!/usr/bin/env node

// MCP Web Browse Server - Provides web browsing capabilities to AI models
// This server can be used by Ollama models to fetch web content

import { createServer } from '@modelcontextprotocol/sdk/dist/cjs/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/dist/cjs/server/stdio';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

// Create the MCP server
const server = createServer(
  {
    name: 'web-browse-server',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Tool definition for browsing a URL
server.setRequestHandler('tools', () => {
  return {
    tools: [
      {
        name: 'browse_url',
        description: 'Browse a URL and retrieve its text content',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to browse'
            },
            max_length: {
              type: 'integer',
              description: 'Maximum length of content to return (default: 2000)',
              default: 2000
            }
          },
          required: ['url']
        }
      }
    ]
  };
});

// Implement the browse_url tool
server.setRequestHandler('call_tool', async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === 'browse_url') {
    const { url, max_length = 2000 } = args;
    
    try {
      console.log(`Browsing URL: ${url}`);
      
      // Fetch the web page
      const response = await fetch(url);
      const html = await response.text();
      
      // Parse the HTML and extract text content
      const dom = new JSDOM(html);
      const document = dom.window.document;
      
      // Remove script and style elements
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        scripts[i].remove();
      }
      
      const styles = document.getElementsByTagName('style');
      for (let i = styles.length - 1; i >= 0; i--) {
        styles[i].remove();
      }
      
      // Extract text content
      const textContent = document.body.textContent || document.body.innerText || '';
      
      // Truncate to max_length
      const truncatedContent = textContent.length > max_length 
        ? textContent.substring(0, max_length) + '...' 
        : textContent;
      
      return {
        content: [{
          type: 'text',
          text: `Content from ${url}:\n\n${truncatedContent}`
        }]
      };
    } catch (error) {
      console.error('Error browsing URL:', error);
      return {
        content: [{
          type: 'text',
          text: `Error browsing URL ${url}: ${error.message}`
        }]
      };
    }
  } else {
    return {
      content: [{
        type: 'text',
        text: `Unknown tool: ${name}`
      }]
    };
  }
});

// Start the server
async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log('MCP Web Browse Server started');
  console.log('Ready to provide web browsing capabilities to AI models');
}

startServer().catch(console.error);