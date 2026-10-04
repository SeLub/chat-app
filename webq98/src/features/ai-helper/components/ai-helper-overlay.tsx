import { useState, useRef, useEffect, useCallback } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { Mic, MicOff, X, Minimize2, Maximize2 } from 'lucide-react';
import type { AITranscript } from '@/types';

interface AIHelperOverlayProps {
  onTranscribe?: (text: string) => void;
}

export function AiHelperOverlay({ onTranscribe }: AIHelperOverlayProps) {
  const aiHelperOpen = useUIStore((s) => s.aiHelperOpen);
  const toggleAiHelper = useUIStore((s) => s.toggleAiHelper);

  const [isListening, setIsListening] = useState(false);
  const [transcripts, setTranscripts] = useState<AITranscript[]>([]);
  const [isVadActive, setIsVadActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!aiHelperOpen) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const ws = new WebSocket(`ws://${window.location.host}/ws/ai-helper`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('AI Helper WebSocket connected');
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'transcript' && data.text) {
          const newTranscript: AITranscript = {
            role: 'user',
            text: data.text,
            timestamp: Date.now(),
          };
          setTranscripts((prev) => [...prev, newTranscript]);
          onTranscribe?.(data.text);
        }
      } catch {
        // ignore non-JSON
      }
    };

    ws.onerror = () => {
      setError('WebSocket connection failed');
    };

    ws.onclose = () => {
      if (isListening) {
        setTimeout(() => {
          if (isListening) {
            const newWs = new WebSocket(`ws://${window.location.host}/ws/ai-helper`);
            wsRef.current = newWs;
          }
        }, 2000);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [aiHelperOpen, onTranscribe, isListening]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const startListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let vadActive = false;
      const checkVad = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength;

        if (average > 30 && !vadActive) {
          vadActive = true;
          setIsVadActive(true);
          const mediaRecorder = new MediaRecorder(stream);
          const chunks: BlobPart[] = [];

          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };

          mediaRecorder.onstop = async () => {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            try {
              const formData = new FormData();
              formData.append('audio', blob, 'recording.webm');
              const response = await fetch('/api/stt/transcribe', {
                method: 'POST',
                body: formData,
              });
              const data = await response.json();
              if (data.text) {
                const newTranscript: AITranscript = {
                  role: 'user',
                  text: data.text,
                  timestamp: Date.now(),
                };
                setTranscripts((prev) => [...prev, newTranscript]);
                onTranscribe?.(data.text);
              }
            } catch (e) {
              console.error('Transcription failed:', e);
            }
          };

          mediaRecorder.start();

          const stopCheck = () => {
            analyser.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b, 0) / bufferLength;
            if (avg < 10) {
              mediaRecorder.stop();
              vadActive = false;
              setIsVadActive(false);
            } else {
              requestAnimationFrame(stopCheck);
            }
          };
          requestAnimationFrame(stopCheck);
        }

        if (vadActive) {
          requestAnimationFrame(checkVad);
        }
      };
      requestAnimationFrame(checkVad);

      setIsListening(true);
    } catch (e) {
      setError('Microphone access denied');
      console.error('Failed to start listening:', e);
    }
  }, [onTranscribe]);

  const stopListening = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsListening(false);
    setIsVadActive(false);
  }, []);

  if (!aiHelperOpen) return null;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 100,
      }}
      className="w-80 bg-card border border-border rounded-lg shadow-xl overflow-hidden"
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-primary/10 cursor-move select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">AI Helper</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized(!minimized)}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            {minimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
          </button>
          <button
            onClick={toggleAiHelper}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="p-3">
          {error && (
            <div className="mb-3 p-2 bg-destructive/10 text-destructive text-xs rounded-md">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-muted-foreground">
              {isListening ? 'Listening...' : 'Click to start listening'}
            </span>
            <button
              onClick={isListening ? stopListening : startListening}
              className={`p-2 rounded-full transition-colors ${
                isListening
                  ? 'bg-destructive text-destructive-foreground hover:opacity-90'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}
            >
              {isVadActive ? (
                <Mic className="w-4 h-4 animate-pulse" />
              ) : isListening ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="h-48 overflow-y-auto space-y-2">
            {transcripts.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                No transcripts yet
              </div>
            ) : (
              transcripts.map((t, idx) => (
                <div key={idx} className="p-2 bg-muted/50 rounded-md text-xs">
                  {t.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Sparkles(props: { className?: string }) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}
