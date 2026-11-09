import { MicVAD } from '@ricky0123/vad-web';
import type { RealTimeVADOptions } from '@ricky0123/vad-web';

export interface VadHandlers {
  onSpeechChunk: (role: 'user' | 'interlocutor', audio: Float32Array) => void;
  onError: (message: string) => void;
  onStateChange: (s: 'idle' | 'capturing') => void;
}

export interface VadController {
  stop(): void;
}

const vadOptions: Pick<
  RealTimeVADOptions,
  | 'baseAssetPath'
  | 'onnxWASMBasePath'
  | 'model'
  | 'positiveSpeechThreshold'
  | 'negativeSpeechThreshold'
  | 'redemptionMs'
  | 'preSpeechPadMs'
  | 'minSpeechMs'
  | 'ortConfig'
> = {
  baseAssetPath: '/vad-assets/',
  onnxWASMBasePath: '/vad-assets/',
  model: 'v5',
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  redemptionMs: 800,
  preSpeechPadMs: 300,
  minSpeechMs: 300,
  ortConfig: (ort) => {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
  },
};

export async function startDualVad(h: VadHandlers): Promise<VadController> {
  // TZ-A.8: все захваченные ресурсы объявляем заранее, чтобы при ЛЮБОЙ ошибке
  // (отказ в микрофоне, недоступность VAD, отсутствие аудиодорожки) освободить
  // уже полученное — иначе экран продолжает захватываться после отказа.
  let displayStream: MediaStream | null = null;
  let micVad: Awaited<ReturnType<typeof MicVAD.new>> | null = null;
  let systemVad: Awaited<ReturnType<typeof MicVAD.new>> | null = null;

  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const sysAudioTrack = displayStream.getAudioTracks()[0];

    if (!sysAudioTrack) {
      h.onError('Поставьте галочку «Поделиться звуком вкладки/системы»');
      throw new Error('No system audio track in display stream');
    }

    const sysOnlyStream = new MediaStream([sysAudioTrack]);

    micVad = await MicVAD.new({
      ...vadOptions,
      onSpeechEnd: (audio) => h.onSpeechChunk('user', audio),
      getStream: async () =>
        navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            autoGainControl: true,
            noiseSuppression: true,
          },
        }),
    });
    await micVad.start();

    systemVad = await MicVAD.new({
      ...vadOptions,
      onSpeechEnd: (audio) => h.onSpeechChunk('interlocutor', audio),
      getStream: async () => sysOnlyStream,
    });
    await systemVad.start();
  } catch (e) {
    // TZ-A.8: освобождаем всё, что успели получить, и пробрасываем ошибку дальше
    try {
      micVad?.pause();
      micVad?.destroy();
    } catch {
      // ignore
    }
    try {
      systemVad?.pause();
      systemVad?.destroy();
    } catch {
      // ignore
    }
    displayStream?.getTracks().forEach((t) => t.stop());
    throw e;
  }

  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      micVad.pause();
      micVad.destroy();
    } catch {
      // ignore
    }
    try {
      systemVad.pause();
      systemVad.destroy();
    } catch {
      // ignore
    }
    displayStream.getTracks().forEach((t) => t.stop());
    h.onStateChange('idle');
  };

  displayStream.getVideoTracks()[0].addEventListener('ended', stop);

  h.onStateChange('capturing');

  return { stop };
}
