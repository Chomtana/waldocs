import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

// Server-rendered markdown with GitHub-flavored markdown + syntax highlighting.
// Token colors live in globals.css (.hljs-* rules) and adapt to the theme.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
