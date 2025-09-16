#!/usr/bin/env node

// MCP Web Server - Provides web browsing capabilities to AI models
// This server can be used by Ollama models to fetch web content

import { createServer } from '@modelcontextprotocol/sdk/dist/cjs/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/dist/cjs/server/stdio';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

// Tool definition for web browsing
const tools = [
  {
    name: 'web_browse',
    description: 'Browse the web and retrieve content from a URL',
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
  },
  {
    name: 'web_search',
    description: 'Search the web for a query and return relevant results',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        },
        max_results: {
          type: 'integer',
          description: 'Maximum number of results to return (default: 5)',
          default: 5
        }
      },
      required: ['query']
    }
  }
];

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

// Implement the web_browse tool
server.setRequestHandler('web_browse', async (request) => {
  const { url, max_length = 2000 } = request.params;
  
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
});

// Implement the web_search tool
server.setRequestHandler('web_search', async (request) => {
  const { query, max_results = 5 } = request.params;
  
  try {
    console.log(`Searching for: ${query}`);
    
    // For demonstration, we'll return a simulated search result
    // In a real implementation, you would connect to a search API
    const simulatedResults = [
      {
        title: `Understanding ${query}`,
        url: `https://example.com/${query.replace(/\s+/g, '-')}`,
        snippet: `This page provides comprehensive information about ${query}. It covers the basics, advanced concepts, and practical applications.`
      },
      {
        title: `${query} - Official Documentation`,
        url: `https://docs.example.com/${query}`,
        snippet: `The official documentation for ${query} includes tutorials, API references, and best practices.`
      },
      {
        title: `Latest developments in ${query}`,
        url: `https://news.example.com/${query}`,
        snippet: `Recent news and updates about ${query} from industry experts and researchers.`
      }
    ];
    
    // Limit to max_results
    const results = simulatedResults.slice(0, max_results);
    
    const formattedResults = results.map((result, index) => 
      `${index + 1}. ${result.title}\n   URL: ${result.url}\n   Snippet: ${result.snippet}`
    ).join('\n\n');
    
    return {
      content: [{
        type: 'text',
        text: `Search results for "${query}":\n\n${formattedResults}`
      }]
    };
  } catch (error) {
    console.error('Error searching:', error);
    return {
      content: [{
        type: 'text',
        text: `Error searching for "${query}": ${error.message}`
      }]
    };
  }
});

// Start the server
async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log('MCP Web Server started');
}

startServer().catch(console.error);