import { Mic, MicOff } from 'lucide-react';
import { useState, useRef } from 'react';

interface STTInputProps {
  onTranscribe: (text: string) => void;
  className?: string;
}

export function STTInput({ onTranscribe, className = '' }: STTInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        try {
          const formData = new FormData();
          formData.append('audio', blob, 'recording.webm');
          const response = await fetch('/api/stt/transcribe', {
            method: 'POST',
            body: formData,
          });
          const data = await response.json();
          if (data.text) {
            onTranscribe(data.text);
          }
        } catch (e) {
          setError('Transcription failed');
          console.error('Transcription failed:', e);
        }
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsListening(true);
      setError(null);
    } catch (e) {
      setError('Microphone access denied');
      console.error('Failed to start listening:', e);
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        onClick={isListening ? stopListening : startListening}
        className={`p-2 rounded-full transition-colors ${
          isListening
            ? 'bg-destructive text-destructive-foreground animate-pulse'
            : 'bg-secondary hover:bg-accent'
        }`}
        aria-label={isListening ? 'Stop recording' : 'Start recording'}
      >
        {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
