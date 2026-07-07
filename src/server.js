// src/server.js

import 'dotenv/config';

import app from './app.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('Server');
const port = process.env.PORT || 3000;

app.listen(port, '0.0.0.0', () => {
    log.info(`Server running on http://localhost:${port}`);
    log.info(`Default provider: ${process.env.DEFAULT_PROVIDER || 'ollama'}`);
    log.info(`Ollama: ${process.env.OLLAMA_URL || 'http://localhost:11434'} (enabled: ${process.env.OLLAMA_ENABLED !== 'false'})`);
    log.info(`llama.cpp: ${process.env.LLAMA_CPP_URL || 'http://localhost:8080'} (enabled: ${process.env.LLAMA_CPP_ENABLED === 'true'})`);
});