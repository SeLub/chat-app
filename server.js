import express from 'express';
import fetch from 'node-fetch';
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));

app.get('/api/status', async (req, res) => {
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    const data = await response.json();
    const phi4Model = data.models?.find(m => m.name === 'phi4:latest');
    res.json({ connected: true, model: phi4Model ? 'phi4:latest' : 'unavailable' });
  } catch (error) {
    res.json({ connected: false, model: 'unavailable' });
  }
});

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  console.log('Received message:', message);

  try {
    console.log('Sending request to Ollama...');
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'phi4:latest',
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
