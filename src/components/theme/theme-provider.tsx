"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference(preference: ThemePreference): void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const systemThemeQuery = "(prefers-color-scheme: dark)";

function readStoredPreference(): ThemePreference {
  try {
    const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedPreference) ? storedPreference : "system";
  } catch {
    return "system";
  }
}

function applyDocumentTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export const themeBootstrapScript = `(()=>{let p="system";try{const s=localStorage.getItem("${THEME_STORAGE_KEY}");p=s==="light"||s==="dark"||s==="system"?s:"system"}catch{}let d=false;try{d=window.matchMedia("${systemThemeQuery}").matches}catch{}const t=p==="system"?(d?"dark":"light"):p;const r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  const applyTheme = useCallback((nextPreference: ThemePreference, systemDark: boolean) => {
    const nextResolvedTheme = resolveTheme(nextPreference, systemDark);
    setResolvedTheme(nextResolvedTheme);
    applyDocumentTheme(nextResolvedTheme);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(systemThemeQuery);
    const storedPreference = readStoredPreference();

    setPreferenceState(storedPreference);
    applyTheme(storedPreference, mediaQuery.matches);
  }, [applyTheme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(systemThemeQuery);
    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      if (preference === "system") applyTheme("system", event.matches);
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, [applyTheme, preference]);

  const setPreference = useCallback(
    (nextPreference: ThemePreference) => {
      const systemDark = window.matchMedia(systemThemeQuery).matches;

      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
      } catch {
        // Retain the in-memory preference when browser storage is unavailable.
      }

      setPreferenceState(nextPreference);
      applyTheme(nextPreference, systemDark);
    },
    [applyTheme],
  );

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}
