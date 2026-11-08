// src/services/webService.js
// Извлечение контента с веб-страниц

import fetch from 'node-fetch';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

/**
 * Получает контент с веб-страницы
 */
export async function fetchWebContent(url) {
  try {
    console.log('Fetching content from:', url);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ChatBot/1.0)'
      },
      timeout: 10000 // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article && article.textContent) {
      const cleanText = article.textContent.trim();
      console.log(`Extracted ${cleanText.length} characters from ${url}`);
      return {
        title: article.title || 'Web Page',
        content: cleanText,
        url: url
      };
    } else {
      // Fallback: extract basic text content
      const textContent = dom.window.document.body?.textContent || '';
      return {
        title: dom.window.document.title || 'Web Page',
        content: textContent.trim(),
        url: url
      };
    }
  } catch (error) {
    console.error('Error fetching web content:', error);
    throw new Error(`Failed to fetch content from ${url}: ${error.message}`);
  }
}

/**
 * Извлекает и обрабатывает все URL из текста
 */
export async function processUrlsFromText(text, maxUrls = 3) {
  const { extractUrls } = await import('../utils/urlUtils.js');
  const urls = extractUrls(text);
  
  if (urls.length === 0) {
    return { processedText: text, webContents: [] };
  }

  console.log('Found URLs:', urls);
  const urlsToFetch = urls.slice(0, maxUrls);
  const webContents = [];

  for (const url of urlsToFetch) {
    try {
      const content = await fetchWebContent(url);
      webContents.push(content);
    } catch (error) {
      console.error(`Failed to fetch ${url}:`, error.message);
      webContents.push({
        title: 'Error',
        content: `Unable to fetch content from ${url}: ${error.message}`,
        url: url
      });
    }
  }

  // Append web content to message
  let processedText = text;
  if (webContents.length > 0) {
    const webContentText = webContents.map(content =>
      `\n\n--- Web Content from ${content.url} ---\nTitle: ${content.title}\n\n${content.content}`
    ).join('');
    processedText = text + webContentText + '\n\n--- End of Web Content ---';
  }

  return { processedText, webContents };
}