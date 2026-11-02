import ReactMarkdown from 'react-markdown'

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown-body text-sm leading-relaxed break-words">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="text-base font-semibold mt-2 mb-1 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-medium mt-2 mb-1 first:mt-0">{children}</h3>
          ),
          p: ({ children }) => <p className="my-1.5 whitespace-pre-wrap">{children}</p>,
          ul: ({ children }) => <ul className="my-1.5 pl-4 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 pl-4 list-decimal space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          code: ({ className, children }) => {
            const block = Boolean(className)
            if (block) {
              return (
                <pre className="my-2 overflow-auto rounded-lg bg-slate-900/90 text-slate-100 dark:bg-black/50 px-3 py-2 text-[11px] font-mono">
                  <code>{children}</code>
                </pre>
              )
            }
            return (
              <code className="rounded bg-slate-200/80 dark:bg-slate-800 px-1 py-0.5 text-[12px] font-mono">
                {children}
              </code>
            )
          },
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-sky-700 dark:text-sky-400 underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-auto">
              <table className="min-w-full text-left text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-slate-200 dark:border-slate-700 px-2 py-1 font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-slate-200 dark:border-slate-700 px-2 py-1">{children}</td>
          ),
          hr: () => <hr className="my-2 border-slate-200 dark:border-slate-700" />,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-slate-300 dark:border-slate-600 pl-3 text-slate-600 dark:text-slate-300">
              {children}
            </blockquote>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
