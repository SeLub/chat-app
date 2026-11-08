import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'leteem' | 'besafe' | 'minimal';
export type Mode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  mode: Mode;
  setTheme: (theme: Theme) => void;
  setMode: (mode: Mode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const THEME_KEY = 'chat-app-theme';
const MODE_KEY = 'chat-app-mode';

function getSystemMode(): Mode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'leteem' || stored === 'besafe' || stored === 'minimal') {
      return stored;
    }
    return 'leteem';
  });

  const [mode, setModeState] = useState<Mode>(() => {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
    return 'system';
  });

  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-theme', theme);

    if (mode === 'system') {
      setIsDark(getSystemMode() === 'dark');
    } else {
      setIsDark(mode === 'dark');
    }
  }, [theme, mode]);

  useEffect(() => {
    const html = document.documentElement;
    if (isDark) {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }, [isDark]);

  useEffect(() => {
    if (mode === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        setIsDark(getSystemMode() === 'dark');
      };
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
  }, [mode]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    localStorage.setItem(MODE_KEY, m);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, mode, setTheme, setMode, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
