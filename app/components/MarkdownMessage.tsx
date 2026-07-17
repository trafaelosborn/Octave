import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
          code: ({ children, className }) => className
            ? <code className={className}>{children}</code>
            : <code className="inline-code">{children}</code>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
