// src/server.js
// Тонкая точка входа. Запускает app из src/app.js.

import app from './app.js';

const port = process.env.PORT || 3000;

app.listen(port, '0.0.0.0', () => {
  console.log(`[NEW] Server running on http://localhost:${port}`);
  console.log(`[NEW] Network access: http://YOUR_CLIENT_IP:${port}`);
});