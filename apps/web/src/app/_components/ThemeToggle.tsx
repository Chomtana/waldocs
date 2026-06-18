"use client";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  // The anti-FOUC script in layout.tsx already set data-theme before paint
  // (from localStorage, else the browser's prefers-color-scheme). Read it back.
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("waldocs-theme", next);
    } catch {
      /* ignore */
    }
  }

  return (
    <button className="theme-toggle" onClick={toggle} aria-label="Toggle color theme" title="Toggle light / dark">
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
