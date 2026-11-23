"use client";

import type { Task } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type FocusTaskProps = Pick<Task, "id" | "title" | "priority" | "status"> & { dueLabel: string | null };

export function FocusTask({ id, title, priority, status, dueLabel }: FocusTaskProps) {
  const router = useRouter();
  const [completion, setCompletion] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  async function complete() {
    setCompletion("saving");
    try {
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "completed" }),
      });
      if (!response.ok) throw new Error("Task update failed");
    } catch {
      setCompletion("failed");
      return;
    }
    setCompletion("saved");
    router.refresh();
  }

  return (
    <div className="focus">
      <input
        type="checkbox"
        className="focus-task-check"
        aria-label={`Mark ${title} complete`}
        checked={completion === "saved"}
        disabled={completion === "saving" || completion === "saved"}
        onChange={complete}
      />
      <div className="focus-body">
        <b>{title}</b>
        <p>{priority} priority{dueLabel ? ` · Due ${dueLabel}` : ""}</p>
        {completion === "failed" && <p className="focus-task-error" role="alert">Couldn’t complete this task. Try again.</p>}
      </div>
      <div className="focus-time">{completion === "saving" ? "Saving…" : completion === "saved" ? "completed" : status}</div>
    </div>
  );
}
