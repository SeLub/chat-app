import express from 'express';
import fetch from 'node-fetch';
import multer from 'multer';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import WordExtractor from 'word-extractor';
import * as XLSX from 'xlsx';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
const app = express();
const port = 3000;

const extractor = new WordExtractor();

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max file size
});

// Ensure upload directories exist
const uploadsDir = './uploads/images';
const thumbnailsDir = './uploads/images/thumbnails';
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(thumbnailsDir)) fs.mkdirSync(thumbnailsDir, { recursive: true });

function generateImageId() {
  return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function saveImageFiles(buffer, originalName) {
  const imageId = generateImageId();
  const ext = path.extname(originalName).toLowerCase();
  const fullPath = path.join(uploadsDir, `${imageId}${ext}`);
  const thumbPath = path.join(thumbnailsDir, `${imageId}_thumb.jpg`);
  
  // Save original image
  await fs.promises.writeFile(fullPath, buffer);
  
  // Generate and save thumbnail
  await sharp(buffer)
    .resize(150, 150, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(thumbPath);
  
  return {
    id: imageId,
    filename: originalName,
    fullUrl: `/api/images/${imageId}/full`,
    thumbnailUrl: `/api/images/${imageId}/thumb`
  };
}

app.use(express.json());
app.use(express.static('public'));

app.get('/api/models', async (req, res) => {
  try {
    console.log('Checking Ollama connection...');
    const [tagsResponse, psResponse] = await Promise.all([
      fetch('http://localhost:11434/api/tags'),
      fetch('http://localhost:11434/api/ps')
    ]);
    
    console.log('Tags response status:', tagsResponse.status);
    console.log('PS response status:', psResponse.status);
    
    if (!tagsResponse.ok || !psResponse.ok) {
      throw new Error('Ollama service not responding');
    }
    
    const availableModels = await tagsResponse.json();
    const runningModels = await psResponse.json();
    
    console.log('Available models:', availableModels);
    console.log('Running models:', runningModels);
    
    // Check if Ollama is actually working by verifying we get valid data
    if (!availableModels || !availableModels.models) {
      throw new Error('Ollama returned invalid data');
    }
    
    const runningModelNames = new Set(
      runningModels.models?.map(rm => rm.name) || []
    );
    
    const models = availableModels.models?.map(model => ({
      name: model.name,
      size: model.size,
      status: runningModelNames.has(model.name) ? 'running' : 'available'
    })).sort((a, b) => a.name.localeCompare(b.name)) || [];
    
    res.json({ models, connected: true });
  } catch (error) {
    console.error('Models API error:', error.message);
    console.error('Error type:', error.code || error.type);
    res.json({ models: [], connected: false });
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

// Serve images
app.get('/api/images/:imageId/:type', (req, res) => {
  const { imageId, type } = req.params;
  
  try {
    let filePath;
    if (type === 'thumb') {
      filePath = path.join(thumbnailsDir, `${imageId}_thumb.jpg`);
    } else if (type === 'full') {
      // Find the original file with any extension
      const files = fs.readdirSync(uploadsDir);
      const originalFile = files.find(file => file.startsWith(imageId) && !file.includes('_thumb'));
      if (!originalFile) {
        return res.status(404).json({ error: 'Image not found' });
      }
      filePath = path.join(uploadsDir, originalFile);
    } else {
      return res.status(400).json({ error: 'Invalid image type' });
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    // Set appropriate headers
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg', 
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp'
    };
    
    res.setHeader('Content-Type', mimeTypes[ext] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year cache
    
    const imageStream = fs.createReadStream(filePath);
    imageStream.pipe(res);
  } catch (error) {
    console.error('Error serving image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
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

app.post('/api/chat', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'codeFiles', maxCount: 50 }]), async (req, res) => {
  let { message, model } = req.body;
  const file = req.files?.file?.[0];
  const codeFiles = req.files?.codeFiles || [];
  
  console.log('Received message:', message, 'for model:', model, 'with file:', file?.originalname, 'code files:', codeFiles.length);

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

  // Process code files first
  if (codeFiles.length > 0) {
    try {
      let codeContent = '';
      const supportedExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.html', '.css', '.scss', '.json', '.xml', '.yaml', '.yml', '.md', '.txt', '.sql', '.php', '.rb', '.go', '.rs', '.cpp', '.c', '.h', '.cs', '.swift', '.kt', '.scala', '.sh', '.bat', '.dockerfile', '.gitignore', '.env'];
      
      codeContent += `Code Analysis Request - ${codeFiles.length} files:\n\n`;
      
      for (const codeFile of codeFiles) {
        const ext = path.extname(codeFile.originalname).toLowerCase();
        
        if (supportedExtensions.includes(ext) || !ext) {
          const fileContent = codeFile.buffer.toString('utf-8');
          codeContent += `--- File: ${codeFile.originalname} ---\n`;
          codeContent += fileContent;
          codeContent += '\n\n';
        } else {
          codeContent += `--- File: ${codeFile.originalname} (binary/unsupported) ---\n`;
          codeContent += '[Binary file - content not displayed]\n\n';
        }
      }
      
      message = codeContent + `\nUser request: ${message}`;
      console.log('Code files processed, total content length:', codeContent.length);
    } catch (error) {
      console.error('Code file processing error:', error);
      return res.status(400).json({ error: 'Failed to process code files' });
    }
  }
  // Process uploaded file
  else if (file) {
    try {
      let extractedText = '';
      
      // Handle image files for vision models
      if (file.mimetype.startsWith('image/')) {
        if (!isVision) {
          return res.status(400).json({ error: 'Images require vision models (llama3.2-vision, llava, etc.)' });
        }
        
        // Save image files and get URLs
        const imageData = await saveImageFiles(file.buffer, file.originalname);
        
        // Convert image to base64 for vision model
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
          
          return res.json({ 
            response: data.message.content, 
            model: model,
            imageData: imageData
          });
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

// Delete conversation images
app.delete('/api/conversation-images', express.json(), (req, res) => {
  try {
    const { imageUrls } = req.body;
    
    if (!imageUrls || !Array.isArray(imageUrls)) {
      return res.status(400).json({ error: 'Invalid image URLs array' });
    }
    
    let deletedCount = 0;
    
    imageUrls.forEach(url => {
      // Extract image ID from URL (e.g., '/api/images/img_123_abc/full' -> 'img_123_abc')
      const match = url.match(/\/api\/images\/([^/]+)\/(full|thumb)/);
      if (match) {
        const imageId = match[1];
        
        // Find and delete original image
        const files = fs.readdirSync(uploadsDir);
        const originalFile = files.find(file => file.startsWith(imageId) && !file.includes('_thumb'));
        if (originalFile) {
          const imagePath = path.join(uploadsDir, originalFile);
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
            deletedCount++;
          }
        }
        
        // Delete thumbnail
        const thumbPath = path.join(thumbnailsDir, `${imageId}_thumb.jpg`);
        if (fs.existsSync(thumbPath)) {
          fs.unlinkSync(thumbPath);
        }
      }
    });
    
    res.json({ success: true, deletedCount });
  } catch (error) {
    console.error('Error deleting images:', error);
    res.status(500).json({ error: 'Failed to delete images' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Network access: http://YOUR_CLIENT_IP:${port}`);
});
