import { describe, it, expect } from 'vitest';
import { bufferToWave, normalizeTranscript, type WaveBuffer } from './audio';

function makeMockBuffer(
  channels: Float32Array[],
  sampleRate: number,
): WaveBuffer {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    getChannelData: (i: number) => channels[i],
  };
}

describe('bufferToWave', () => {
  it('1. returns a blob with type audio/wav', () => {
    const buf = makeMockBuffer([new Float32Array(1600)], 16000);
    const blob = bufferToWave(buf, 1600);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/wav');
  });

  it('2. size = 44 + len * channels * 2', () => {
    const buf = makeMockBuffer([new Float32Array(1600), new Float32Array(1600)], 16000);
    const blob = bufferToWave(buf, 1600);
    expect(blob.size).toBe(44 + 1600 * 2 * 2);
  });

  it('3. RIFF header: bytes 0-3 = "RIFF", 8-11 = "WAVE"', async () => {
    const buf = makeMockBuffer([new Float32Array(1600)], 16000);
    const blob = bufferToWave(buf, 1600);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
  });

  it('4. sampleRate written little-endian at offset 24', async () => {
    const buf = makeMockBuffer([new Float32Array(1600)], 16000);
    const blob = bufferToWave(buf, 1600);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(16000);
  });

  it('5. one channel [0, 0.5, -0.5] → Int16 [0, 16383, -16383] at offset 44', async () => {
    const buf = makeMockBuffer([new Float32Array([0, 0.5, -0.5])], 16000);
    const blob = bufferToWave(buf, 3);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(16383);
    // exact port of the reference: (0.5 + s < 0 ? s*32768 : s*32767)|0 → -16383 for -0.5
    expect(view.getInt16(48, true)).toBe(-16383);
  });
});

describe('bufferToWave — sampleRateOverride (TZ-A.6: страховка 16 kHz для whisper)', () => {
  it('6. override принудительно пишет 16 kHz в заголовок, даже если буфер «уверен» в другом', async () => {
    const buf = makeMockBuffer([new Float32Array(1600)], 44100);
    const blob = bufferToWave(buf, 1600, 16000);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(16000 * 2 * 1); // byte rate
  });

  it('7. без override — abuffer.sampleRate (обратная совместимость)', async () => {
    const buf = makeMockBuffer([new Float32Array(1600)], 44100);
    const blob = bufferToWave(buf, 1600);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(24, true)).toBe(44100);
  });
});

describe('normalizeTranscript (TZ-A.5: чистка текста STT от переносов)', () => {
  it('8. одиночные \\n внутри текста → пробелы', () => {
    expect(normalizeTranscript('первая строка\nвторая строка')).toBe('первая строка вторая строка');
  });

  it('9. сжимает повторные пробелы и обрезает края', () => {
    expect(normalizeTranscript('  hello   \n world \n')).toBe('hello world');
  });

  it('10. текст только из переносов → пустая строка', () => {
    expect(normalizeTranscript('\n \n')).toBe('');
  });
});
