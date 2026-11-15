import { useEffect, useRef, useState } from 'react';
import {
  Folder,
  FolderOpen,
  Paperclip,
  ListTree,
  X,
  Loader2,
  TriangleAlert,
  Clock,
  FileWarning,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/stores/projectStore';
import { useSessionStore } from '@/stores/sessionStore';
import { apiGateway } from '@/lib/apiGateway';
import { BrowseDialog } from './browse-dialog';
import type { SessionReferenceAttachment } from '@/types';
import { cn } from '@/lib/utils';

// ТЗ Project mode A (§4): ProjectPanel — тело правой панели в режиме Project.
// Баннер CONTEXT_BASE_DIR (§5.1), CurrentProject (§5.2 шаг 8), AttachList с
// бейджами missing / too large / stale (§3.7 + приёмка PR #17 3.1/3.4),
// [📎 Attach file(s)] и [📂 Browse project files].

/** Attach file(s): обычный file picker — относительный путь внутри проекта
 * принимается равным имени файла (файл в корне проекта); сервер вернёт
 * ошибку «File not found», если путь не совпал (§3.5). */
export function ProjectPanel() {
  const config = useProjectStore((s) => s.config);
  const currentProject = useProjectStore((s) => s.currentProject);
  const attachments = useProjectStore((s) => s.attachments);
  const isLoading = useProjectStore((s) => s.isLoading);
  const init = useProjectStore((s) => s.init);
  const loadAttachments = useProjectStore((s) => s.loadAttachments);
  const createProject = useProjectStore((s) => s.createProject);
  const unlinkProject = useProjectStore((s) => s.unlinkProject);
  const attach = useProjectStore((s) => s.attach);
  const detach = useProjectStore((s) => s.detach);

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const mode = useSessionStore((s) => s.mode);

  const dirInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  const baseDirOk = config?.contextBaseDir.ok ?? false;
  const baseDirError = config?.contextBaseDir.error ?? 'CONTEXT_BASE_DIR is not configured';

  // Приёмка PR #17 (3.4): сводка «сколько файлов реально попадёт в [Материалы]».
  // missing и tooLarge — блокирующие (файл в контекст не попадёт); mtimeStale —
  // нет (stale-файл перечитывается при сборке и попадает актуальной версией).
  const inContextCount = attachments.filter((a) => !a.missing && !a.tooLarge).length;

  // ТЗ attached-files-split: ID файлов, которые были в пуле на момент последнего
  // отправленного запроса (из last_prompt.meta.currentAttachments).
  const [lastPromptAttachmentIds, setLastPromptAttachmentIds] = useState<Set<string>>(new Set());

  // Смена активной сессии → перезагрузить пул reference и восстановить проект
  useEffect(() => {
    if (mode !== 'project') return;
    if (activeSessionId) loadAttachments(activeSessionId);
    // восстановление currentProject при смене сессии
    if (activeSessionId) init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, mode]);

  // ТЗ attached-files-split: загрузить last_prompt для определения «previous» файлов.
  // Перезапрос при: смене сессии, завершении стрима (true→false), изменении attachments.
  const streamingActive = useSessionStore((s) => s.streaming.active);
  const lastPrompt404Ref = useRef(false);
  useEffect(() => {
    if (mode !== 'project' || !activeSessionId || streamingActive) return;
    // 404 cache: don't re-request if we already know there's no last_prompt
    if (lastPrompt404Ref.current) return;
    let cancelled = false;
    apiGateway.sessions
      .getLastPrompt(activeSessionId)
      .then((lp) => {
        if (cancelled) return;
        lastPrompt404Ref.current = false;
        const ids = new Set(
          (lp?.meta?.currentAttachments || []).map((a) => a.fileId).filter(Boolean),
        );
        setLastPromptAttachmentIds(ids);
      })
      .catch((err) => {
        if (cancelled) return;
        // 404 = no last_prompt yet — cache to avoid console spam
        const status = (err as { status?: number })?.status;
        if (status === 404) {
          lastPrompt404Ref.current = true;
        }
        setLastPromptAttachmentIds(new Set());
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, mode, streamingActive, attachments]);

  // Reset 404 cache when a new stream starts (a new last_prompt will exist after)
  useEffect(() => {
    if (streamingActive) lastPrompt404Ref.current = false;
  }, [streamingActive]);

  const newFiles = attachments.filter((a) => !lastPromptAttachmentIds.has(a.fileId));
  const previousFiles = attachments.filter((a) => lastPromptAttachmentIds.has(a.fileId));

  const onDirectoryPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const first = files?.[0] as (File & { webkitRelativePath?: string }) | undefined;
    e.target.value = '';
    if (!first) return;
    const segments = (first.webkitRelativePath || first.name).split('/');
    if (segments.length < 2) {
      toast.error('Выберите папку внутри CONTEXT_BASE_DIR (папка целиком)');
      return;
    }
    await createProject(segments[0]);
  };

  const onFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;
    await attach(picked.map((f) => f.name));
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-3 gap-3">
      {/* §5.1: красный баннер, если CONTEXT_BASE_DIR не настроен */}
      {!baseDirOk && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          <div className="flex items-start gap-2">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">CONTEXT_BASE_DIR не настроен</p>
              <p className="mt-0.5 opacity-80">
                {baseDirError}. Установите переменную в <code>server/.env</code> и перезапустите сервер.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* CurrentProject / Open Folder (§5.2 шаги 7-8) */}
      <section aria-label="Current project">
        {currentProject ? (
          <div className="rounded-md border border-border px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Folder className="w-4 h-4 text-primary shrink-0" />
              <span className="truncate">{currentProject.name}</span>
            </div>
            <p className="mt-1 pl-6 text-xs text-muted-foreground truncate" title={currentProject.path}>
              {currentProject.path}
            </p>
            <div className="mt-2 pl-6 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!baseDirOk || isLoading}
                onClick={() => dirInputRef.current?.click()}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Change Folder
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isLoading}
                onClick={() => unlinkProject()}
              >
                <X className="w-3.5 h-3.5" />
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-3 text-center">
            <p className="text-xs text-muted-foreground mb-2">Current project: (none)</p>
            <Button
              size="sm"
              disabled={!baseDirOk || isLoading || !activeSessionId}
              onClick={() => dirInputRef.current?.click()}
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
              Open Folder
            </Button>
          </div>
        )}
      </section>

      {/* AttachList (§3.7 + attached-files-split): New / From previous answer */}
      <section aria-label="Attached project files" className="flex-1 min-h-0 flex flex-col">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
          Attached files
          {attachments.length > 0 && (
            <span
              className="ml-1.5 font-normal normal-case tracking-normal"
              title={`В пуле: ${attachments.length}; попадёт в [Материалы] при следующем вопросе: ${inContextCount}`}
            >
              · {inContextCount}/{attachments.length} in context
            </span>
          )}
        </h3>
        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-2">No files attached</p>
        ) : (
          <>
            {newFiles.length > 0 && (
              <>
                <h4 className="text-xs font-semibold text-primary mb-1">
                  New for this question ({newFiles.length})
                </h4>
                <ul className="space-y-1">
                  {newFiles.map((a) => (
                    <FileRow key={a.fileId} a={a} isLoading={isLoading} onDetach={() => detach(a.fileId)} />
                  ))}
                </ul>
              </>
            )}
            {previousFiles.length > 0 && (
              <>
                <h4 className="text-xs font-semibold text-muted-foreground mt-3 mb-1">
                  From previous answer ({previousFiles.length})
                </h4>
                <ul className="space-y-1">
                  {previousFiles.map((a) => (
                    <FileRow key={a.fileId} a={a} isLoading={isLoading} onDetach={() => detach(a.fileId)} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      {/* Кнопки attach/browse (§4) */}
      <div className="flex flex-col gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={!baseDirOk || !currentProject || isLoading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="w-4 h-4" />
          Attach file(s)
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!baseDirOk || !currentProject || isLoading}
          onClick={() => setBrowseOpen(true)}
        >
          <ListTree className="w-4 h-4" />
          Browse project files
        </Button>
      </div>

      {/* FolderPlus резервируется для будущего; скрытые input'ы — средство выбора */}
      <input
        ref={dirInputRef}
        type="file"
        hidden
        {...{ webkitdirectory: '', directory: '' }}
        onChange={onDirectoryPicked}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={onFilesPicked}
      />

      <BrowseDialog
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        onAttach={(paths) => attach(paths)}
      />
    </div>
  );
}

/** ТЗ attached-files-split: строка файла с бейджами missing/too large/stale + detach. */
function FileRow({
  a,
  isLoading,
  onDetach,
}: {
  a: SessionReferenceAttachment;
  isLoading: boolean;
  onDetach: () => void;
}) {
  return (
    <li
      className={cn(
        'group flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs',
        a.missing && 'border-red-500/40 bg-red-500/10',
      )}
    >
      <span className="flex-1 truncate font-mono" title={a.filePath}>{a.name}</span>
      {a.missing && (
        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 shrink-0">
          <TriangleAlert className="w-3 h-3" /> missing
        </span>
      )}
      {!a.missing && a.tooLarge && (
        <span
          className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 shrink-0"
          title="Файл разросся сверх MAX_REFERENCE_FILE_SIZE после attach — в [Материалы] не попадёт (TOO LARGE)"
        >
          <FileWarning className="w-3 h-3" /> too large
        </span>
      )}
      {!a.missing && !a.tooLarge && a.mtimeStale && (
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 shrink-0">
          <Clock className="w-3 h-3" /> stale
        </span>
      )}
      <button
        type="button"
        aria-label={`Detach ${a.name}`}
        className="opacity-50 hover:opacity-100 shrink-0"
        disabled={isLoading}
        onClick={onDetach}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}
