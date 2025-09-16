import express from 'express';
import fetch from 'node-fetch';
import multer from 'multer';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import WordExtractor from 'word-extractor';
import * as XLSX from 'xlsx';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
const app = express();
const port = 3000;

const extractor = new WordExtractor();

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static('public'));

app.get('/api/models', async (req, res) => {
  try {
    const [tagsResponse, psResponse] = await Promise.all([
      fetch('http://localhost:11434/api/tags'),
      fetch('http://localhost:11434/api/ps')
    ]);
    
    const availableModels = await tagsResponse.json();
    const runningModels = await psResponse.json();
    
    const runningModelNames = new Set(
      runningModels.models?.map(rm => rm.name) || []
    );
    
    const models = availableModels.models?.map(model => ({
      name: model.name,
      size: model.size,
      status: runningModelNames.has(model.name) ? 'running' : 'available'
    })) || [];
    
    console.log('Running models from /api/ps:', runningModelNames);
    res.json({ models });
  } catch (error) {
    console.error('Models API error:', error);
    res.json({ models: [] });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const response = await fetch('http://localhost:11434/api/ps');
    const data = await response.json();
    console.log('Status check - running models:', data);
    const hasRunningModels = data.models && data.models.length > 0;
    res.json({ connected: true, hasRunningModels });
  } catch (error) {
    console.error('Status API error:', error);
    res.json({ connected: false, hasRunningModels: false });
  }
});

app.post('/api/show', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Model name is required' });
    }
    
    const response = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Ollama show API error:', response.statusText, errorText);
      return res.status(response.status).json({ error: response.statusText });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Show API error:', error);
    res.status(500).json({ error: 'Failed to get model information' });
  }
});

function isSpecialModel(modelName) {
  const embedModels = ['nomic-embed-text', 'embed'];
  const visionModels = ['vision', 'llava'];
  
  const isEmbed = embedModels.some(type => modelName.includes(type));
  const isVision = visionModels.some(type => modelName.includes(type));
  
  return { isEmbed, isVision };
}

function extractUrls(text) {
  const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g;
  return text.match(urlRegex) || [];
}

async function fetchWebContent(url) {
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

app.post('/api/chat', upload.single('file'), async (req, res) => {
  let { message, model } = req.body;
  const file = req.file;
  
  console.log('Received message:', message, 'for model:', model, 'with file:', file?.originalname);

  // Extract and fetch web content if URLs are present
  const urls = extractUrls(message);
  if (urls.length > 0) {
    try {
      console.log('Found URLs:', urls);
      
      // Limit to 3 URLs to prevent abuse
      const urlsToFetch = urls.slice(0, 3);
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
      if (webContents.length > 0) {
        const webContentText = webContents.map(content => 
          `\n\n--- Web Content from ${content.url} ---\nTitle: ${content.title}\n\n${content.content}`
        ).join('');
        
        message = message + webContentText + '\n\n--- End of Web Content ---';
      }
    } catch (error) {
      console.error('Error processing URLs:', error);
      // Continue without web content if there's an error
    }
  }

  if (!model) {
    return res.status(400).json({ error: 'Model not specified' });
  }

  const { isEmbed, isVision } = isSpecialModel(model);
  
  if (isEmbed) {
    return res.status(400).json({ error: 'Embedding models cannot generate text responses' });
  }
  
  if (isVision && !file) {
    return res.status(400).json({ error: 'Vision models require image inputs' });
  }

  // Process uploaded file
  if (file) {
    try {
      let extractedText = '';
      
      // Handle image files for vision models
      if (file.mimetype.startsWith('image/')) {
        if (!isVision) {
          return res.status(400).json({ error: 'Images require vision models (llama3.2-vision, llava, etc.)' });
        }
        
        // Convert image to base64
        const base64Image = file.buffer.toString('base64');
        
        try {
          console.log('Sending image to vision model...');
          const response = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: model,
              messages: [{
                role: 'user',
                content: message || 'What is in this image?',
                images: [base64Image]
              }],
              stream: false
            }),
          });

          console.log('Vision model response status:', response.status);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error('Vision model response not ok:', response.statusText, errorText);
            return res.status(500).json({ error: `Vision model error: ${response.statusText}` });
          }

          const data = await response.json();
          console.log('Vision model response:', data);
          
          return res.json({ response: data.message.content, model: model });
        } catch (error) {
          console.error('Vision model error:', error);
          return res.status(500).json({ error: 'Vision model connection failed' });
        }
      } else if (file.mimetype === 'application/pdf') {
        // Process PDF
        const uint8Array = new Uint8Array(file.buffer);
        const loadingTask = pdfjs.getDocument({ data: uint8Array });
        const pdf = await loadingTask.promise;
        
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          extractedText += pageText + '\n';
        }
      } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 file.mimetype === 'application/msword') {
        // Process DOC/DOCX
        const extracted = await extractor.extract(file.buffer);
        extractedText = extracted.getBody();
      } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                 file.mimetype === 'application/vnd.ms-excel' ||
                 file.mimetype === 'text/csv') {
        // Process Excel files (XLSX, XLS, CSV)
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0]; // First sheet
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to CSV format for better readability
        const csvData = XLSX.utils.sheet_to_csv(worksheet);
        extractedText = `Sheet: ${sheetName}\n\n${csvData}`;
      } else {
        return res.status(400).json({ error: 'Supported files: PDF, DOC, DOCX, XLS, XLSX, CSV, and images (JPG, PNG, etc.)' });
      }
      
      message = `Document: ${file.originalname}\n\nExtracted text:\n${extractedText}\n\nUser question: ${message}`;
      let fileType = 'Unknown';
      if (file.mimetype.includes('pdf')) fileType = 'PDF';
      else if (file.mimetype.includes('word') || file.mimetype.includes('document')) fileType = 'DOC/DOCX';
      else if (file.mimetype.includes('sheet') || file.mimetype.includes('excel') || file.mimetype.includes('csv')) fileType = 'Excel/CSV';
      
      console.log(`${fileType} processed, extracted`, extractedText.length, 'characters');
    } catch (error) {
      console.error('Document processing error:', error);
      return res.status(400).json({ error: 'Failed to process document file' });
    }
  }

  try {
    console.log('Sending request to Ollama...');
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: message,
        stream: false,
      }),
    });

    console.log('Ollama response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Ollama response not ok:', response.statusText, errorText);
      return res.status(500).json({ error: `Model error: ${response.statusText}` });
    }

    const data = await response.json();
    console.log('Ollama response:', data);
    
    res.json({ response: data.response, model: model });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Connection failed' });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
