import { useRef, useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useAiHelperStore } from '@/stores/aiHelperStore';
import { Mic, MicOff, X, Minimize2, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function AiHelperOverlay() {
  const aiHelperOpen = useUIStore((s) => s.aiHelperOpen);
  const toggleAiHelper = useUIStore((s) => s.toggleAiHelper);

  const status = useAiHelperStore((s) => s.status);
  const isCapturing = useAiHelperStore((s) => s.isCapturing);
  const transcripts = useAiHelperStore((s) => s.transcripts);
  const isSendingLocal = useAiHelperStore((s) => s.isSendingLocal);
  const error = useAiHelperStore((s) => s.error);

  const startCapture = useAiHelperStore((s) => s.startCapture);
  const stopCapture = useAiHelperStore((s) => s.stopCapture);
  const sendTranscriptsToChat = useAiHelperStore((s) => s.sendTranscriptsToChat);

  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [minimized, setMinimized] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  if (!aiHelperOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 100,
      }}
      className="w-80 glass-strong border border-border rounded-xl shadow-xl overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-primary/10 cursor-move select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-black tracking-tighter italic">AI Helper</span>
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
              {status === 'connected' ? 'Connected' : 'Disconnected'}
              {isCapturing ? ' • Capturing' : ''}
            </span>
            <button
              onClick={isCapturing ? stopCapture : startCapture}
              className={`p-2 rounded-full transition-colors ${
                isCapturing
                  ? 'bg-destructive text-destructive-foreground hover:opacity-90'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}
            >
              {isCapturing ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <Button
              onClick={() => {
                void sendTranscriptsToChat();
              }}
              disabled={isSendingLocal}
              size="sm"
            >
              {isSendingLocal ? 'Sending…' : '💬 Send to chat'}
            </Button>
          </div>

          <div className="h-48 overflow-y-auto space-y-2">
            {transcripts.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                No transcripts yet
              </div>
            ) : (
              transcripts.map((t, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border border-border text-xs animate-in fade-in slide-in-from-bottom-2 duration-300 ${
                    t.role === 'interlocutor' ? 'bg-muted/40' : 'bg-muted/50'
                  }`}
                >
                  <span
                    className={
                      t.role === 'user' ? 'text-primary font-semibold' : 'text-success font-semibold'
                    }
                  >
                    [{t.role === 'user' ? 'Я' : 'Собеседник'}]
                  </span>{' '}
                  <span>{t.text}</span>
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
