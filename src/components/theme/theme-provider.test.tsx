import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY } from "@/lib/theme";

import {
  ThemeProvider,
  themeBootstrapScript,
  useTheme,
} from "./theme-provider";

type MediaListener = (event: MediaQueryListEvent) => void;

const listeners = new Set<MediaListener>();
const mediaQuery = {
  matches: false,
  addEventListener: vi.fn((_type: string, listener: MediaListener) => {
    listeners.add(listener);
  }),
  removeEventListener: vi.fn((_type: string, listener: MediaListener) => {
    listeners.delete(listener);
  }),
};

function ThemeProbe() {
  const { preference, resolvedTheme, setPreference } = useTheme();

  return (
    <div>
      <output>{`${preference}:${resolvedTheme}`}</output>
      <button onClick={() => setPreference("dark")}>Dark</button>
      <button onClick={() => setPreference("system")}>System</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    listeners.clear();
    mediaQuery.matches = false;
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mediaQuery));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to the system preference when storage is invalid", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByText("system:light")).toBeInTheDocument());
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("persists explicit preferences and applies their resolved theme", async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByText("system:light")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByText("dark:dark")).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("updates the active theme-color meta tag when an explicit preference changes", async () => {
    const themeColor = document.createElement("meta");
    themeColor.name = "theme-color";
    themeColor.content = "#eef2f6";
    document.head.append(themeColor);

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByText("system:light")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(themeColor.content).toBe("#050505");
    themeColor.remove();
  });

  it("reacts to system changes only while the system preference is selected", async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByText("system:light")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    act(() => {
      for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent);
    });
    expect(screen.getByText("dark:dark")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "System" }));
    act(() => {
      for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent);
    });
    expect(screen.getByText("system:dark")).toBeInTheDocument();
  });

  it("ships a self-contained bootstrap script without user data or remote URLs", () => {
    expect(themeBootstrapScript).toContain(THEME_STORAGE_KEY);
    expect(themeBootstrapScript).not.toMatch(/https?:\/\//i);
    expect(themeBootstrapScript).not.toContain("user");
  });

  it("wires Geist and the pre-paint theme before application children", () => {
    const layoutSource = readFileSync(
      join(process.cwd(), "src", "app", "layout.tsx"),
      "utf8",
    );

    expect(layoutSource).toContain('import { Geist } from "next/font/google";');
    expect(layoutSource).toContain("suppressHydrationWarning");
    expect(layoutSource).toContain("themeBootstrapScript");
    expect(layoutSource).toContain("dangerouslySetInnerHTML");
    expect(layoutSource).toContain("<ThemeProvider>{children}</ThemeProvider>");
    expect(layoutSource).not.toContain("http");
  });

  it("defines the independent XP theme tokens and global accessibility guardrails", () => {
    const styles = readFileSync(
      join(process.cwd(), "src", "app", "globals.css"),
      "utf8",
    );

    for (const token of [
      "--xp-black: #050505;",
      "--xp-cyan: #00d7e8;",
      "--xp-orange: #ffad00;",
      "--xp-violet: #7238ff;",
      "--xp-magenta: #ff009f;",
      "--xp-blue: #087dff;",
      "--canvas: #eef2f6;",
      "--canvas: #0b0d10;",
      "--surface-elevated: #1e232b;",
      "--focus: #75c8ff;",
      "overflow-wrap: anywhere;",
      "max-width: 100%;",
      ":focus-visible",
      "scrollbar-gutter: stable both-edges;",
      "::selection",
      "prefers-reduced-motion: reduce",
    ]) {
      expect(styles).toContain(token);
    }
  });
});
