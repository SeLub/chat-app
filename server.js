import express from 'express';
import fetch from 'node-fetch';
import multer from 'multer';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const app = express();
const port = 3000;

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

function isSpecialModel(modelName) {
  const embedModels = ['nomic-embed-text', 'embed'];
  const visionModels = ['vision', 'llava'];
  
  const isEmbed = embedModels.some(type => modelName.includes(type));
  const isVision = visionModels.some(type => modelName.includes(type));
  
  return { isEmbed, isVision };
}

app.post('/api/chat', upload.single('file'), async (req, res) => {
  let { message, model } = req.body;
  const file = req.file;
  
  console.log('Received message:', message, 'for model:', model, 'with file:', file?.originalname);

  if (!model) {
    return res.status(400).json({ error: 'Model not specified' });
  }

  const { isEmbed, isVision } = isSpecialModel(model);
  
  if (isEmbed) {
    return res.status(400).json({ error: 'Embedding models cannot generate text responses' });
  }
  
  if (isVision) {
    return res.status(400).json({ error: 'Vision models require image inputs (not supported yet)' });
  }

  // Process PDF file if uploaded
  if (file && file.mimetype === 'application/pdf') {
    try {
      const uint8Array = new Uint8Array(file.buffer);
      const loadingTask = pdfjs.getDocument({ data: uint8Array });
      const pdf = await loadingTask.promise;
      let extractedText = '';
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        extractedText += pageText + '\n';
      }
      
      message = `Document: ${file.originalname}\n\nExtracted text:\n${extractedText}\n\nUser question: ${message}`;
      console.log('PDF processed, extracted', extractedText.length, 'characters');
    } catch (error) {
      console.error('PDF processing error:', error);
      return res.status(400).json({ error: 'Failed to process PDF file' });
    }
  } else if (file) {
    return res.status(400).json({ error: 'Only PDF files are supported currently' });
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
