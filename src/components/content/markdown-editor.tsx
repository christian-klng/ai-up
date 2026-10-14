"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extensions";
import { Bold, Heading2, Heading3, Italic, Link2, List, ListOrdered, Quote, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Slim WYSIWYG editor that reads and writes Markdown (Tiptap). Only what Markdown can express and the
 * sanitized renderer (`components/content/markdown.tsx`) shows: bold, italic, two heading levels,
 * lists, quotes, links. The value travels in a hidden input `name`, so it works inside plain forms.
 */
export function MarkdownEditor({ name, defaultValue, placeholder, maxLength, id }: { name: string; defaultValue?: string | null; placeholder?: string; maxLength?: number; id?: string }) {
  const [value, setValue] = useState(defaultValue ?? "");
  // Stable across renders: useEditor compares options on every render and would otherwise reapply
  // them on each keystroke (the value state above re-renders this component).
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // No Markdown counterpart (underline) or not wanted in a short description (code).
        underline: false,
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"], defaultProtocol: "https" },
      }),
      Markdown,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    [placeholder],
  );
  const editorProps = useMemo(
    () => ({
      attributes: {
        ...(id ? { id } : {}),
        class: "prose prose-sm prose-neutral max-w-none dark:prose-invert prose-headings:font-semibold prose-a:text-primary min-h-32 px-3 py-2 focus:outline-none",
      },
    }),
    [id],
  );
  const editor = useEditor({
    // Next renders on the server first; the editor must only mount in the browser.
    immediatelyRender: false,
    extensions,
    content: defaultValue ?? "",
    contentType: "markdown",
    editorProps,
    onUpdate: ({ editor: e }) => setValue(e.isEmpty ? "" : e.getMarkdown()),
  });
  const tooLong = maxLength !== undefined && value.length > maxLength;

  return (
    <div className={cn("rounded-md border bg-transparent shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50", tooLong && "border-destructive")}>
      <input type="hidden" name={name} value={value} />
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className="[&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-muted-foreground [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]" />
      {tooLong && <p className="px-3 pb-2 text-xs text-destructive">{value.length} / {maxLength}</p>}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const t = useTranslations("markdownEditor");
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
    }),
  });
  const setLink = () => {
    const current = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt(t("linkPrompt"), current ?? "https://");
    if (href === null) return;
    if (href.trim() === "" || href.trim() === "https://") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  };
  const buttons: { key: string; icon: LucideIcon; label: string; on: boolean; run: () => void }[] = [
    { key: "bold", icon: Bold, label: t("bold"), on: active.bold, run: () => editor.chain().focus().toggleBold().run() },
    { key: "italic", icon: Italic, label: t("italic"), on: active.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { key: "h2", icon: Heading2, label: t("heading2"), on: active.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { key: "h3", icon: Heading3, label: t("heading3"), on: active.h3, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { key: "bullet", icon: List, label: t("bulletList"), on: active.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { key: "ordered", icon: ListOrdered, label: t("orderedList"), on: active.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { key: "quote", icon: Quote, label: t("quote"), on: active.quote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { key: "link", icon: Link2, label: t("link"), on: active.link, run: setLink },
  ];
  return (
    <div className="flex flex-wrap gap-0.5 border-b p-1" role="toolbar" aria-label={t("toolbar")}>
      {buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          // Keep the focus (and selection) in the editor – otherwise text typed right after a click
          // lands wherever ProseMirror restores the selection to.
          onMouseDown={(e) => e.preventDefault()}
          onClick={b.run}
          aria-label={b.label}
          aria-pressed={b.on}
          title={b.label}
          className={cn("flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground", b.on && "bg-accent text-foreground")}
        >
          <b.icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}
