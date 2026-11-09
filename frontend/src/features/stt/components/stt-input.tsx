import { Mic, MicOff } from 'lucide-react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { sttApi } from '@/lib/apiGateway';
import { bufferToWave, normalizeTranscript } from '@/lib/audio';
import { useUIStore } from '@/stores/uiStore';

interface STTInputProps {
  onTranscribe: (text: string) => void;
  className?: string;
}

export function STTInput({ onTranscribe, className = '' }: STTInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  // TZ-A.6: AudioContext кэшируется в ref — WebAudio имеет лимит ~6 активных
  // контекстов в Chrome, создание на каждую транскрипцию рано или поздно падает
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);

  const processAndTranscribeAudio = useCallback(async () => {
    try {
      const webmBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
      if (webmBlob.size < 1000) {
        useUIStore.getState().addToast('Запись слишком короткая', 'error');
        return;
      }

      const arrayBuffer = await webmBlob.arrayBuffer();
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      }
      const audioContext = audioContextRef.current;
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      // TZ-A.6: страховка — whisper.cpp ждёт ровно WAV PCM 16 kHz
      const wavBlob = bufferToWave(audioBuffer, audioBuffer.length, 16000);

      const result = await sttApi.transcribe(wavBlob);

      if (result && result.text) {
        // TZ-A.5: чистим переносы — в поле ввода должна попасть одна строка
        const cleaned = normalizeTranscript(result.text);
        if (cleaned) {
          onTranscribe(cleaned);
          useUIStore.getState().addToast('Текст добавлен в поле ввода', 'success');
        } else {
          useUIStore.getState().addToast('Не удалось распознать речь', 'error');
        }
      } else {
        useUIStore.getState().addToast('Не удалось распознать речь', 'error');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Неизвестная ошибка';
      useUIStore.getState().addToast(`Ошибка распознавания: ${msg}`, 'error');
    } finally {
      setIsProcessing(false);
      setIsRecording(false);
    }
  }, [onTranscribe]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        await processAndTranscribeAudio();
      };

      mediaRecorder.start(100);
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone access denied', err);
      useUIStore.getState().addToast('Доступ к микрофону запрещен. Проверьте настройки браузера.', 'error');
    }
  }, [processAndTranscribeAudio]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsProcessing(true);
    }
  }, []);

  const handleClick = () => {
    if (isRecording) {
      stopRecording();
    } else if (!isProcessing) {
      void startRecording();
    }
  };

  const title = isProcessing
    ? 'Обработка аудио...'
    : isRecording
      ? 'Идет запись... Нажмите для остановки'
      : 'Голосовой ввод (нажмите для старта/стопа)';

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <button
        onClick={handleClick}
        disabled={isProcessing}
        title={title}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        className={`p-2.5 rounded-lg border border-border hover:bg-accent transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
          isRecording ? 'recording bg-destructive text-destructive-foreground' : ''
        } ${className}`}
      >
        {isProcessing ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
      </button>
      {isRecording && (
        <span className="text-xs text-destructive animate-in fade-in duration-300">recording…</span>
      )}
    </div>
  );
}
