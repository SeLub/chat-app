// src/services/fileService.js
// Обработка документов и кода

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import WordExtractor from 'word-extractor';
import * as XLSX from 'xlsx';
import path from 'path';
import { getSupportedCodeExtensions } from '../utils/fileUtils.js';

const extractor = new WordExtractor();

/**
 * Обрабатывает загруженный документ (PDF, DOC, XLS)
 */
export async function processDocument(file) {
  let extractedText = '';

  if (file.mimetype === 'application/pdf') {
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
    throw new Error('Supported files: PDF, DOC, DOCX, XLS, XLSX, CSV');
  }

  let fileType = 'Unknown';
  if (file.mimetype.includes('pdf')) fileType = 'PDF';
  else if (file.mimetype.includes('word') || file.mimetype.includes('document')) fileType = 'DOC/DOCX';
  else if (file.mimetype.includes('sheet') || file.mimetype.includes('excel') || file.mimetype.includes('csv')) fileType = 'Excel/CSV';

  console.log(`${fileType} processed, extracted`, extractedText.length, 'characters');

  return {
    extractedText,
    fileType,
    formattedMessage: `Document: ${file.originalname}\n\nExtracted text:\n${extractedText}\n\nUser question: `
  };
}

/**
 * Обрабатывает загруженные файлы кода
 */
export async function processCodeFiles(codeFiles) {
  let codeContent = '';
  const supportedExtensions = getSupportedCodeExtensions();

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

  console.log('Code files processed, total content length:', codeContent.length);

  return {
    codeContent,
    formattedMessage: codeContent + '\nUser request: '
  };
}