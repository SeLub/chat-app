// src/utils/docExtract.js — BACKLOG #6: восстановление извлечения текста из документов.
//
// История: fileService.processDocument (pdfjs-dist / word-extractor / xlsx — честный
// текст в промпт) демонтирован в PR #16 вместе с инлайн-документами; переезд на
// реестр attachments потерял парсеры: extractFromPaths остался utf-8-сырым — PDF в
// extracted_text превращался в сырой байтовый поток (%PDF-1.6...FlateDecode-мусор),
// который попадал в [Материалы]. Этот модуль возвращает парсеры в точку извлечения.
// Пакеты уже были в package.json (использовались только webService) — новые
// зависимости не добавляются.
//
// Контракт: extractText(buffer, filename) — async; по расширению имени:
//   .pdf            → pdfjs-dist (legacy build), постранично getTextContent;
//   .doc / .docx    → word-extractor → getBody();
//   .xls / .xlsx    → xlsx: первый лист → sheet_to_csv (с заголовком «Sheet: <имя>»);
//   .csv            → тоже xlsx (как в старом processDocument);
//   прочее          → utf-8 as-is (код, txt, md).
// Ошибка парсера пробрасывается вызывающей стороне (extractFromPaths → errors[],
// buildLLMContext → MISSING-блок не пишется — файл просто не кэшируется с мусором).

import path from 'path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import WordExtractor from 'word-extractor';
import * as XLSX from 'xlsx';

const wordExtractor = new WordExtractor();

/** Расширения, извлекаемые парсерами (всё остальное — utf-8 as-is). */
export const DOC_EXTRACT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv']);

/** true, если по имени файла нужен парсер (а не сырой utf-8). */
export function isDocExtractPath(filename) {
    const ext = path.extname(filename || '').toLowerCase();
    return DOC_EXTRACT_EXTENSIONS.has(ext);
}

/**
 * Извлечь текст из буфера по имени файла (BACKLOG #6).
 * @param {Buffer} buffer - содержимое файла
 * @param {string} filename - имя файла (расширение определяет парсер)
 * @returns {Promise<string>} извлечённый текст (для не-документов — utf-8)
 */
export async function extractText(buffer, filename) {
    const ext = path.extname(filename || '').toLowerCase();
    if (ext === '.pdf') return extractPdf(buffer);
    if (ext === '.doc' || ext === '.docx') return extractWord(buffer);
    if (ext === '.xls' || ext === '.xlsx' || ext === '.csv') return extractSheet(buffer);
    return buffer.toString('utf-8');
}

/**
 * PDF: pdfjs-dist legacy build — постранично getTextContent (как в старом
 * processDocument). destroy() в finally — батчевые вызовы не копят ресурсы воркера.
 */
async function extractPdf(buffer) {
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    let text = '';
    try {
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            text += textContent.items.map((item) => item.str).join(' ') + '\n';
        }
    } finally {
        await pdf.destroy();
    }
    return text;
}

/** DOC/DOCX: word-extractor → getBody() (один путь для обоих — как в старом processDocument). */
async function extractWord(buffer) {
    const doc = await wordExtractor.extract(buffer);
    return doc.getBody();
}

/** XLSX/XLS/CSV: первый лист → sheet_to_csv (как в старом processDocument). */
function extractSheet(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const csvData = XLSX.utils.sheet_to_csv(worksheet);
    return `Sheet: ${sheetName}\n\n${csvData}`;
}
