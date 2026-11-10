// tests/utils/docExtract.test.js — BACKLOG #6: восстановление извлечения текста
// из документов (pdfjs-dist / word-extractor / xlsx, потерянные при демонтаже
// fileService в PR #16). Фикстуры: PDF — программный генератор (helpers/pdf-fixture.js),
// XLSX — тем же пакетом xlsx (XLSX.write), CSV — текстовый.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, isDocExtractPath, DOC_EXTRACT_EXTENSIONS } from '../../src/utils/docExtract.js';
import * as XLSX from 'xlsx';
import { buildMinimalPdf } from '../helpers/pdf-fixture.js';

describe('docExtract (BACKLOG #6)', () => {
    describe('extractText — PDF (pdfjs-dist)', () => {
        it('извлекает текстовый слой постранично', async () => {
            const pdf = buildMinimalPdf('Hello PDF extract');
            const text = await extractText(pdf, 'doc.pdf');
            assert.ok(text.includes('Hello PDF extract'), `got: ${JSON.stringify(text)}`);
            assert.ok(!text.includes('%PDF'), 'нет сырых байтов контейнера');
        });

        it('битый файл (не PDF-структура) → reject (ошибку решает вызывающая сторона)', async () => {
            await assert.rejects(() => extractText(Buffer.from('not a pdf at all'), 'broken.pdf'));
        });
    });

    describe('extractText — XLSX/CSV (xlsx)', () => {
        it('xlsx: первый лист → заголовок Sheet: + csv-данные', async () => {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['name', 'qty'], ['alpha', '1']]), 'Data');
            const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
            const text = await extractText(buf, 'table.xlsx');
            assert.ok(text.includes('Sheet: Data'), `got: ${JSON.stringify(text)}`);
            assert.ok(text.includes('alpha'));
            assert.ok(text.includes('1'));
        });

        it('csv: парсится через xlsx (как в старом processDocument)', async () => {
            const buf = Buffer.from('name,qty\nalpha,1\n', 'utf-8');
            const text = await extractText(buf, 'data.csv');
            assert.ok(text.includes('alpha'));
            assert.ok(text.includes('1'));
        });
    });

    describe('extractText — прочее (utf-8 as-is)', () => {
        it('код/txt/md → utf-8 без изменений', async () => {
            const src = 'export function chat() { return 1; }\n';
            assert.equal(await extractText(Buffer.from(src, 'utf-8'), 'chat.ts'), src);
            assert.equal(await extractText(Buffer.from('# md\n'), 'note.md'), '# md\n');
        });
    });

    describe('isDocExtractPath / DOC_EXTRACT_EXTENSIONS', () => {
        it('документные расширения → true', () => {
            for (const name of ['a.pdf', 'b.doc', 'c.docx', 'd.xls', 'e.xlsx', 'f.csv', 'g.PDF']) {
                assert.equal(isDocExtractPath(name), true, name);
            }
        });

        it('код/текст → false', () => {
            for (const name of ['a.ts', 'b.json', 'c.md', 'd.bin', 'e.txt', 'noext']) {
                assert.equal(isDocExtractPath(name), false, name);
            }
        });

        it('DOC_EXTRACT_EXTENSIONS — ровно 6 расширений', () => {
            assert.deepEqual([...DOC_EXTRACT_EXTENSIONS].sort(), ['.csv', '.doc', '.docx', '.pdf', '.xls', '.xlsx']);
        });
    });
});
