import { describe, expect, it } from "vitest";

import {
  THEME_STORAGE_KEY,
  isThemePreference,
  resolveTheme,
} from "./theme";

describe("theme preference contract", () => {
  it("uses the fixed preference storage key", () => {
    expect(THEME_STORAGE_KEY).toBe("xp-atendimento-theme");
  });

  it("accepts only supported persisted preferences", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it("resolves explicit preferences independently of the system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("resolves system preference from the media query result", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
