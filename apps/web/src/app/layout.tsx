import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { ThemeToggle } from "@/app/_components/ThemeToggle";
import { NavProgress } from "@/app/_components/NavProgress";

export const metadata = {
  title: "waldocs",
  description: "Unified developer docs on Walrus Memory.",
};

// Default to dark; only honor an explicit stored choice. Runs before first
// paint so there's no flash. (<html> is pre-set to dark for no-JS / pre-script.)
const themeScript = `(function(){try{var t=localStorage.getItem('waldocs-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <NavProgress />
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
