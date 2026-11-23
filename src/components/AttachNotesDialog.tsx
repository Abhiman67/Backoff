"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Dialog } from "@/components/Dialog";
import { MAX_CHAT_ATTACHMENTS, type ChatAttachment } from "@/lib/chat-attachments";

const filesResponse = z.object({
  files: z.array(z.object({ id: z.string(), name: z.string() })),
  nextCursor: z.string().nullable(),
});

async function loadReadyFiles(cursor?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ forChat: "1" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/files?${params}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Unable to load files");
  return filesResponse.parse(await response.json());
}

export function AttachNotesDialog({ selected, onClose, onApply }: {
  selected: ChatAttachment[];
  onClose: () => void;
  onApply: (files: ChatAttachment[]) => void;
}) {
  const [draft, setDraft] = useState(selected);
  const [items, setItems] = useState<ChatAttachment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void loadReadyFiles(undefined, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setItems(data.files);
      setCursor(data.nextCursor);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  async function loadMore() {
    setLoading(true);
    setError(false);
    try {
      const data = await loadReadyFiles(cursor ?? undefined);
      setItems((previous) => [...previous, ...data.files.filter((file) => !previous.some((item) => item.id === file.id))]);
      setCursor(data.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const visibleFiles = [...items, ...draft.filter((file) => !items.some((item) => item.id === file.id))];

  return (
    <Dialog isOpen onClose={onClose} title="Attach notes"
      description={`Choose up to ${MAX_CHAT_ATTACHMENTS} ready files or notes for this question.`}>
      <div className="attach-notes-list">
        {visibleFiles.map((file) => {
          const checked = draft.some((item) => item.id === file.id);
          return (
            <label className="attach-notes-option" key={file.id}>
              <input type="checkbox" checked={checked} disabled={!checked && draft.length >= MAX_CHAT_ATTACHMENTS}
                onChange={(event) => setDraft(event.target.checked ? [...draft, file] : draft.filter((item) => item.id !== file.id))} />
              <span>{file.name}</span>
            </label>
          );
        })}
        {loading && <p role="status">Loading notes…</p>}
        {error && <p role="alert">Could not load notes. <button type="button" className="file-action" onClick={() => void loadMore()}>Try again</button></p>}
        {!loading && !error && visibleFiles.length === 0 && <p>No ready files yet. <Link href="/app/files">Go to Files &amp; notes</Link>.</p>}
        {cursor && !loading && !error && <button type="button" className="file-action" onClick={() => void loadMore()}>Load more</button>}
      </div>
      <div className="dialog-actions">
        <button type="button" className="dialog-btn-cancel" onClick={onClose}>Cancel</button>
        <button type="button" className="recommendation-action recommendation-action-primary" onClick={() => onApply(draft)}>
          Apply selection{draft.length ? ` (${draft.length})` : ""}
        </button>
      </div>
    </Dialog>
  );
}
