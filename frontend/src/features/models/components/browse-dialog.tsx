import { useState, useEffect, useCallback } from 'react';
import { Loader2, Search, FileCode2, FileText, Paperclip } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/stores/projectStore';
import { apiGateway } from '@/lib/apiGateway';
import type { ProjectFile } from '@/types';
import { cn } from '@/lib/utils';

// ТЗ Project mode A (§3.4, §10.6) + attach-files-for-project-mode §3.2:
// модалка browse файлов проекта. Фильтр — по подстроке пути (серверный),
// плашки верхнего уровня (dirs) — клиентский фильтр по папкам, persist
// выбора в localStorage (browse_dirs_<projectId>).

interface BrowseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttach: (relativePaths: string[]) => void;
}

function fileIcon(language: string) {
  return ['markdown', 'text'].includes(language)
    ? <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
    : <FileCode2 className="w-4 h-4 text-muted-foreground shrink-0" />;
}

export function BrowseDialog({ open, onOpenChange, onAttach }: BrowseDialogProps) {
  const browseFiles = useProjectStore((s) => s.browseFiles);
  const browseTotal = useProjectStore((s) => s.browseTotal);
  const browseTruncated = useProjectStore((s) => s.browseTruncated);
  const isLoading = useProjectStore((s) => s.isLoading);
  const loadBrowseFiles = useProjectStore((s) => s.loadBrowseFiles);
  const currentProjectId = useProjectStore((s) => s.currentProject?.id);

  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirs, setDirs] = useState<string[]>([]);
  const [selectedDirs, setSelectedDirs] = useState<Set<string>>(new Set());

  // Debounced search (паттерн LoadModal)
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadFiles = useCallback(async () => {
    await loadBrowseFiles(debouncedSearch);
  }, [loadBrowseFiles, debouncedSearch]);

  // При open: загрузить dirs + восстановить selectedDirs из localStorage
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    loadFiles();
    if (currentProjectId) {
      // Загрузить верхние директории
      apiGateway.projects
        .listTopLevelDirs(currentProjectId)
        .then((res) => setDirs(res?.dirs ?? []))
        .catch(() => setDirs([]));
      // Восстановить selectedDirs
      try {
        const saved = localStorage.getItem(`browse_dirs_${currentProjectId}`);
        if (saved) {
          const arr: string[] = JSON.parse(saved);
          setSelectedDirs(new Set(arr));
        } else {
          setSelectedDirs(new Set());
        }
      } catch {
        setSelectedDirs(new Set());
      }
    }
  }, [open, loadFiles, currentProjectId]);

  // Persist selectedDirs при изменении
  useEffect(() => {
    if (!currentProjectId) return;
    localStorage.setItem(`browse_dirs_${currentProjectId}`, JSON.stringify([...selectedDirs]));
  }, [selectedDirs, currentProjectId]);

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleDir = (dir: string) => {
    setSelectedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const selectAllDirs = () => setSelectedDirs(new Set());

  // Клиентский фильтр: по выбранным директориям (если есть)
  const visibleFiles = browseFiles.filter((f) => {
    if (selectedDirs.size > 0) {
      const topDir = f.path.split('/')[0];
      if (!selectedDirs.has(topDir)) return false;
    }
    return true;
  });

  const attachSelected = () => {
    onAttach([...selected]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Project files</DialogTitle>
        </DialogHeader>

        {/* Плашки верхнего уровня (ТЗ attach-files-for-project-mode §3.2) */}
        {dirs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            <button
              onClick={selectAllDirs}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                selectedDirs.size === 0
                  ? 'bg-primary/15 border-primary/40 text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              All
            </button>
            {dirs.map((d) => (
              <button
                key={d}
                onClick={() => toggleDir(d)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                  selectedDirs.has(d)
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                {d}
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter files..."
            className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {isLoading && browseFiles.length === 0 && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
          {!isLoading && visibleFiles.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No files match the filter
              {selectedDirs.size > 0 && (
                <p className="mt-1 text-xs">Try clearing directory filters</p>
              )}
            </div>
          )}
          {visibleFiles.map((f: ProjectFile) => (
            <label
              key={f.path}
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50',
                selected.has(f.path) && 'bg-muted/50',
              )}
            >
              <input
                type="checkbox"
                checked={selected.has(f.path)}
                onChange={() => toggle(f.path)}
                className="accent-primary shrink-0"
              />
              {fileIcon(f.language)}
              <span className="flex-1 truncate font-mono text-xs" title={f.path}>{f.path}</span>
              <span className="text-xs text-muted-foreground shrink-0">{f.language}</span>
            </label>
          ))}
        </div>

        {browseTruncated && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Показаны первые 500 из {browseTotal} — уточните фильтр
          </p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {visibleFiles.length} files{selected.size > 0 ? `, selected: ${selected.size}` : ''}
            {selectedDirs.size > 0 ? ` (в ${selectedDirs.size} папк${selectedDirs.size === 1 ? 'е' : 'ах'})` : ''}
          </span>
          <Button
            size="sm"
            onClick={attachSelected}
            disabled={selected.size === 0 || isLoading}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
            Attach selected
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
