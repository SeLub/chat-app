// Minimal structural type so bufferToWave is testable without WebAudio (jsdom).
export interface WaveBuffer {
  numberOfChannels: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

// TZ-A.5: whisper возвращает многострочный текст — нормализуем в одну строку
// (переносы внутри слова ломают ввод; одиночные \n LLM-практики дают постоянно)
export function normalizeTranscript(text: string): string {
  return text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

// Exact port of public/script.js bufferToWave: RIFF/WAVE header, PCM16,
// channel interleaving, clamp to [-1, 1], s<0 ? s*0x8000 : s*0x7FFF.
// TZ-A.6: sampleRateOverride — страховка для whisper.cpp (ждёт ровно 16 kHz):
// AudioContext({ sampleRate: 16000 }) уже гарантирует abuffer.sampleRate === 16000,
// но STT-путь фиксирует значение явно, не доверяя буферу.
export function bufferToWave(abuffer: WaveBuffer, len: number, sampleRateOverride?: number): Blob {
  const numOfChan = abuffer.numberOfChannels;
  const sampleRate = sampleRateOverride ?? abuffer.sampleRate;
  const length = len * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels: Float32Array[] = [];

  let pos = 0;
  const setUint16 = (data: number) => {
    view.setUint16(pos, data, true);
    pos += 2;
  };
  const setUint32 = (data: number) => {
    view.setUint32(pos, data, true);
    pos += 4;
  };

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(sampleRate);
  setUint32(sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit
  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  for (let i = 0; i < abuffer.numberOfChannels; i++) {
    channels.push(abuffer.getChannelData(i));
  }

  let offset = 0;
  while (pos < length) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
