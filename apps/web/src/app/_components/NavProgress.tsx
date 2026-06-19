"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type State = "idle" | "loading" | "done";

// A global top-of-page progress bar. App Router page transitions block on the
// server render (every page is `force-dynamic`), so without this the UI gives
// no feedback between a click and the new page. We start the bar on any
// internal link click and finish it once the pathname actually changes.
export function NavProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<State>("idle");
  const doneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Start when an in-app navigation link is clicked.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest("a");
      if (!a) return;
      if (a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Same page (e.g. in-page anchor) — nothing to wait for.
      if (url.pathname === window.location.pathname) return;
      setState("loading");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Finish once the route has changed.
  useEffect(() => {
    setState((s) => (s === "loading" ? "done" : s));
  }, [pathname]);

  useEffect(() => {
    if (state !== "done") return;
    doneTimer.current = setTimeout(() => setState("idle"), 400);
    return () => clearTimeout(doneTimer.current);
  }, [state]);

  return <div className="nav-progress" data-state={state} aria-hidden />;
}
