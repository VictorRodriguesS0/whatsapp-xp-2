"use client";

import { Paperclip, Send, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

type MessageComposerProps = {
  disabled?: boolean;
  onSendText: (body: string) => Promise<unknown>;
  onSendMedia: (file: File, caption: string) => Promise<unknown>;
};

export function MessageComposer({ disabled, onSendText, onSendMedia }: MessageComposerProps) {
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (file) {
      const selectedFile = file;
      setFile(null);
      setBody("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      void onSendMedia(selectedFile, text);
      return;
    }
    if (!text) return;
    setBody("");
    void onSendText(text);
  }

  return (
    <form className="border-t border-[var(--border)] bg-[var(--panel)] p-3" onSubmit={submit}>
      {file ? (
        <div className="mb-2 flex min-h-11 items-center justify-between gap-3 rounded-md bg-[var(--canvas)] px-3">
          <span className="min-w-0 truncate text-sm text-[var(--text)]">{file.name}</span>
          <Button aria-label="Remover anexo" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} size="icon" variant="ghost"><X aria-hidden="true" className="size-4" /></Button>
        </div>
      ) : null}
      <label className="sr-only" htmlFor="message-body">Mensagem</label>
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          accept="image/jpeg,image/png,audio/*,video/mp4,video/3gpp,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          className="sr-only"
          disabled={disabled}
          id="message-file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          type="file"
        />
        <Button aria-label="Anexar arquivo" disabled={disabled} onClick={() => fileInputRef.current?.click()} size="icon" variant="ghost"><Paperclip aria-hidden="true" className="size-5" /></Button>
        <textarea
          className="min-h-11 max-h-36 flex-1 resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2.5 text-base text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
          disabled={disabled}
          id="message-body"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={file ? "Legenda (opcional)" : "Escreva uma mensagem"}
          rows={1}
          value={body}
        />
        <Button aria-label="Enviar mensagem" disabled={disabled || (!body.trim() && !file)} size="icon" type="submit"><Send aria-hidden="true" className="size-4" /></Button>
      </div>
    </form>
  );
}
