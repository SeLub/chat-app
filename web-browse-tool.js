// Web Browse Tool - A simple tool for fetching web content
// This tool can be used by AI models to browse the web

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

/**
 * Browse a URL and return its text content
 * @param {string} url - The URL to browse
 * @param {number} maxLength - Maximum length of content to return (default: 2000)
 * @returns {Promise<string>} The text content of the page
 */
export async function browseURL(url, maxLength = 2000) {
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

/**
 * Search the web for a query and return relevant results
 * @param {string} query - The search query
 * @param {number} maxResults - Maximum number of results to return (default: 5)
 * @returns {Promise<string>} Formatted search results
 */
export async function searchWeb(query, maxResults = 5) {
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
    
    // Limit to maxResults
    const results = simulatedResults.slice(0, maxResults);
    
    const formattedResults = results.map((result, index) => 
      `${index + 1}. ${result.title}\n   URL: ${result.url}\n   Snippet: ${result.snippet}`
    ).join('\n\n');
    
    return `Search results for "${query}":\n\n${formattedResults}`;
  } catch (error) {
    console.error('Error searching:', error);
    return `Error searching for "${query}": ${error.message}`;
  }
}

// Example usage
if (import.meta.url === `file://${process.argv[1]}`) {
  // This block runs when the script is executed directly
  const url = process.argv[2] || 'https://example.com';
  browseURL(url).then(content => {
    console.log(content);
  });
}