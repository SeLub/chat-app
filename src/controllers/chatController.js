// src/controllers/chatController.js
// Контроллер для чата

import { processDocument, processCodeFiles } from '../services/fileService.js';
import { processUrlsFromText } from '../services/webService.js';
import { saveImageFiles } from '../services/imageService.js';
import { isImageFile } from '../utils/imageUtils.js';

/**
 * Обрабатывает чат-запрос
 */
export async function chatHandler(req, res) {
  let { message, model } = req.body;
  const file = req.files?.file?.[0];
  const codeFiles = req.files?.codeFiles || [];

  console.log('Received message:', message, 'for model:', model, 'with file:', file?.originalname, 'code files:', codeFiles.length);

  try {
    // Extract and fetch web content if URLs are present
    const { processedText } = await processUrlsFromText(message);
    message = processedText;

    if (!model) {
      return res.status(400).json({ error: 'Model not specified' });
    }

    // Detect model type
    const modelType = req.provider.detectModelType(model);

    if (modelType === 'embedding') {
      return res.status(400).json({ error: 'Embedding models cannot generate text responses' });
    }

    if (modelType === 'vision' && !file) {
      return res.status(400).json({ error: 'Vision models require image inputs' });
    }

    // Process code files first
    if (codeFiles.length > 0) {
      try {
        const { formattedMessage } = await processCodeFiles(codeFiles);
        message = formattedMessage + message;
      } catch (error) {
        console.error('Code file processing error:', error);
        return res.status(400).json({ error: 'Failed to process code files' });
      }
    }
    // Process uploaded file
    else if (file) {
      try {
        // Handle image files for vision models
        if (isImageFile(file.mimetype)) {
          if (modelType !== 'vision') {
            return res.status(400).json({ error: 'Images require vision models (llama3.2-vision, llava, gemma3, etc.)' });
          }

          // Save image files and get URLs
          const imageData = await saveImageFiles(file.buffer, file.originalname);

          // Convert image to base64 for vision model
          const base64Image = file.buffer.toString('base64');

          try {
            console.log('Sending image to vision model...');
            const result = await req.provider.chat({
              model: model,
              messages: [{
                role: 'user',
                content: message || 'What is in this image?',
                images: [base64Image]
              }],
              stream: false
            });

            return res.json({
              response: result.response,
              model: model,
              imageData: imageData,
              metrics: result.metrics
            });
          } catch (error) {
            console.error('Vision model error:', error);
            return res.status(500).json({ error: 'Vision model connection failed' });
          }
        } else {
          // Process document (PDF, DOC, XLS)
          const { formattedMessage } = await processDocument(file);
          message = formattedMessage + message;
        }
      } catch (error) {
        console.error('Document processing error:', error);
        return res.status(400).json({ error: 'Failed to process document file' });
      }
    }

    // Send request to provider
    try {
      const result = await req.provider.generate({
        model: model,
        prompt: message,
        stream: false
      });

      res.json({
        response: result.response,
        model: model,
        metrics: result.metrics
      });
    } catch (error) {
      console.error('Chat error:', error);
      res.status(500).json({ error: 'Connection failed' });
    }
  } catch (error) {
    console.error('Error processing URLs:', error);
    // Continue without web content if there's an error
  }
}