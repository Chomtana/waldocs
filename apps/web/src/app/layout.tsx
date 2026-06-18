import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { ThemeToggle } from "@/app/_components/ThemeToggle";

export const metadata = {
  title: "waldocs",
  description: "Unified developer docs on Walrus Memory.",
};

// Set the theme before first paint to avoid a flash: stored choice, else the
// browser's prefers-color-scheme.
const themeScript = `(function(){try{var t=localStorage.getItem('waldocs-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <nav className="nav">
          <Link href="/" className="brand">
            wal<span className="dot">docs</span>
          </Link>
          <span className="spacer" />
          <ThemeToggle />
        </nav>
        {children}
      </body>
    </html>
  );
}
