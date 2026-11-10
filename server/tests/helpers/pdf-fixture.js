// tests/helpers/pdf-fixture.js — генератор минимального валидного PDF 1.4
// с текстовым слоем (для BACKLOG #6). xref-таблица считается честно
// (байтовые смещения), чтобы pdfjs не уходил в recovery-mode.
// Текст — только ASCII (Helvetica WinAnsi); кавычки/скобки — не использовать:
// Tj-строка вставляется как есть.

/**
 * @param {string} text - текст текстового слоя (ASCII)
 * @returns {Buffer} валидный одностраничный PDF
 */
export function buildMinimalPdf(text) {
    const objects = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
    objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>';
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects[4] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
    objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

    let out = '%PDF-1.4\n';
    const offsets = [];
    for (let i = 1; i <= 5; i++) {
        offsets[i] = Buffer.byteLength(out, 'latin1');
        out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefStart = Buffer.byteLength(out, 'latin1');
    out += 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) {
        out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return Buffer.from(out, 'latin1');
}
