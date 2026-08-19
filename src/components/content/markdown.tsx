import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "@/lib/utils";

/** Sanitized Markdown renderer (GFM). Allows our own /api/files images; strips raw HTML/scripts. */
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), ["target", "_blank"], ["rel", "noopener noreferrer"]],
    img: [...(defaultSchema.attributes?.img ?? []), "loading"],
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-./]],
  },
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose prose-neutral max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-primary prose-img:rounded-md prose-pre:rounded-md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
          a: ({ href, children: c, ...rest }) => (
            <a href={href} target={href?.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" {...rest}>
              {c}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
