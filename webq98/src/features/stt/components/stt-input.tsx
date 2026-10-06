import { Mic, MicOff } from 'lucide-react';
import { useState, useRef, useCallback } from 'react';
import { sttApi } from '@/lib/apiGateway';
import { bufferToWave } from '@/lib/audio';
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

  const processAndTranscribeAudio = useCallback(async () => {
    try {
      const webmBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
      if (webmBlob.size < 1000) {
        useUIStore.getState().addToast('Запись слишком короткая', 'error');
        return;
      }

      const arrayBuffer = await webmBlob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const wavBlob = bufferToWave(audioBuffer, audioBuffer.length);

      const result = await sttApi.transcribe(wavBlob);

      if (result && result.text && result.text.trim()) {
        onTranscribe(result.text.trim());
        useUIStore.getState().addToast('Текст добавлен в поле ввода', 'success');
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
