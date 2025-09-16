#!/usr/bin/env node

// Simple Web Browse Tool - A standalone tool for fetching web content
// This demonstrates the concept of an MCP tool without using the MCP SDK

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

/**
 * Browse a URL and return its text content
 * @param {string} url - The URL to browse
 * @param {number} maxLength - Maximum length of content to return (default: 2000)
 * @returns {Promise<string>} The text content of the page
 */
async function browseURL(url, maxLength = 2000) {
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
    
    // Truncate to maxLength
    const truncatedContent = textContent.length > maxLength 
      ? textContent.substring(0, maxLength) + '...' 
      : textContent;
    
    return `Content from ${url}:\n\n${truncatedContent}`;
  } catch (error) {
    console.error('Error browsing URL:', error);
    return `Error browsing URL ${url}: ${error.message}`;
  }
}

// Listen for input from stdin (how MCP tools communicate)
process.stdin.setEncoding('utf8');

process.stdin.on('data', async (data) => {
  try {
    // Parse the input as JSON
    const request = JSON.parse(data.toString());
    
    // Handle different types of requests
    if (request.method === 'tools') {
      // Return the list of available tools
      const response = {
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
      console.log(JSON.stringify(response));
    } else if (request.method === 'call_tool') {
      // Handle tool calls
      const { name, arguments: args } = request.params;
      
      if (name === 'browse_url') {
        const { url, max_length = 200 } = args;
        const content = await browseURL(url, max_length);
        
        const response = {
          content: [{
            type: 'text',
            text: content
          }]
        };
        console.log(JSON.stringify(response));
      } else {
        const response = {
          content: [{
            type: 'text',
            text: `Unknown tool: ${name}`
          }]
        };
        console.log(JSON.stringify(response));
      }
    } else {
      const response = {
        content: [{
          type: 'text',
          text: `Unknown method: ${request.method}`
        }]
      };
      console.log(JSON.stringify(response));
    }
  } catch (error) {
    console.error('Error processing request:', error);
    const response = {
      content: [{
        type: 'text',
        text: `Error processing request: ${error.message}`
      }]
    };
    console.log(JSON.stringify(response));
  }
});

console.log('Simple MCP Web Browse Tool started');
console.log('Ready to provide web browsing capabilities');