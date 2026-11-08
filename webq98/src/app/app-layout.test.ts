import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Фаза C (ТЗ «Миграция на React», C.1–C.2): правая панель SettingsPanel
// демонтируется из лейаута; settings-panel.tsx остаётся в репозитории
// как скелет будущего Project-режима, но не монтируется нигде.
// Guard-тесты защищают инварианты от регрессии (red-first, без новых зависимостей).

const SRC = join(process.cwd(), 'src');

function allTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return allTsFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('Фаза C: демонтаж правой панели', () => {
  const appSource = readFileSync(join(SRC, 'app', 'App.tsx'), 'utf8');

  it('C.1: App.tsx не импортирует и не монтирует SettingsPanel', () => {
    expect(appSource).not.toContain('SettingsPanel');
    expect(appSource).not.toContain('settings-panel');
  });

  it('C.1: ChatArea расширен до w-4/5 (приёмка Фазы C)', () => {
    expect(appSource).toContain('w-4/5');
    expect(appSource).not.toContain('w-3/5');
  });

  it('C.2: settings-panel не упоминается нигде, кроме самого скелета и тестов', () => {
    const offenders = allTsFiles(SRC)
      .filter((f) => !f.endsWith('settings-panel.tsx'))
      .filter((f) => !f.endsWith('app-layout.test.ts'))
      .filter((f) => /settings-panel|SettingsPanel/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
