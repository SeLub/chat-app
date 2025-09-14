import express from 'express';
import fetch from 'node-fetch';
const app = express();
const port = 3000;

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

app.post('/api/chat', async (req, res) => {
  const { message, model } = req.body;
  console.log('Received message:', message, 'for model:', model);

  if (!model) {
    return res.status(400).json({ error: 'Model not specified' });
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
      console.error('Ollama response not ok:', response.statusText);
      return res.status(500).json({ error: 'Model unavailable' });
    }

    const data = await response.json();
    console.log('Ollama response:', data);
    
    res.json({ response: data.response });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Connection failed' });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
