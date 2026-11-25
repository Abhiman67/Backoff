"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ConfirmDialog, PromptDialog } from "@/components/Dialog";
import { DEFAULT_CONVERSATION_TITLE, MAX_CONVERSATION_TITLE_LENGTH } from "@/lib/conversation-title";
import { RunPanel } from "@/components/RunPanel";
import { ApprovalCard } from "@/components/ApprovalCard";
import {
  CLASSROOM_UPDATE_ROLE, STUDY_PLAN_ROLE, classroomUpdateSchema,
  readThreadData, studyCoachThreadId, studyPlanSchema, type ClassroomUpdate,
} from "@/lib/study-coach-thread";
import type { ReplySource } from "@/lib/reply-sources";
import { ChatMessage } from "@/components/ChatMessage";
import { z } from "zod";
import { MAX_CHAT_ATTACHMENTS, type ChatAttachment } from "@/lib/chat-attachments";

const fileHandoffSchema = z.object({ files: z.array(z.object({ id: z.string(), name: z.string() })).min(1).max(MAX_CHAT_ATTACHMENTS), prompt: z.string().min(1).max(500) });

type Agent = { id: string; name: string; role: string; description: string; category: string; template: string };
type Conversation = { id: string; title: string; projectId: string | null; updatedAt: string };
type Message = { id?: string; role: "user" | "assistant" | typeof CLASSROOM_UPDATE_ROLE | typeof STUDY_PLAN_ROLE; content: string; createdAt?: string; sources?: ReplySource[] };
type Approval = { id: string; status: string };
type Turn = { id: string; status: string };
type Thread = { conversation: Conversation & { agentId: string; messages: Message[] }; approvals: Approval[]; turn: Turn | null };
type TurnRequest =
  | { kind: "chat"; message: string; assignmentId?: string; attachmentIds?: string[]; turnId: string }
  | { kind: "study_plan"; assignmentId: string; turnId: string }
  | { kind: "retry"; turnId: string };

const CLASSROOM_CHANGE_LABELS = {
  new: "New assignment",
  deadline: "Deadline changed",
  due_soon: "Due soon",
  overdue: "Overdue",
  completed: "Marked complete in Classroom",
  updated: "Assignment updated",
} satisfies Record<NonNullable<ClassroomUpdate["change"]>, string>;
const META: Record<string, [string, string]> = { "study-coach": ["◒", "yellow"], "project-guide": ["⌘", "blue"], "career-scout": ["↗", "green"], "writing-buddy": ["✎", "lav"], "code-mentor": ["◉", "peach"], "interview-coach": ["☼", "peri"] };

const threadDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

async function fetchHistory(agentId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/agents/${agentId}/conversations`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Could not load conversations.");
  const data: { conversations: Conversation[] } = await response.json();
  return data.conversations;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [histories, setHistories] = useState<Partial<Record<string, Conversation[]>>>({});
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [showAssistants, setShowAssistants] = useState(false);
  const conversations = histories[agentId] ?? [];
  const [conversationId, setConversationId] = useState("");
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameError, setRenameError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasUnreadClassroomUpdate, setHasUnreadClassroomUpdate] = useState(false);
  const [assignment, setAssignment] = useState<ClassroomUpdate | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loadingThread, setLoadingThread] = useState(true);
  const [input, setInput] = useState("");
  const [handoffFiles, setHandoffFiles] = useState<ChatAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [turn, setTurn] = useState<Turn | null>(null);
  const pending = turn !== null && ["queued", "running", "retrying"].includes(turn.status);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const uncertainRequest = useRef<{ conversationId: string; request: TurnRequest } | null>(null);
  const agent = agents.find((item) => item.id === agentId);
  const activeConversation = conversations.find((item) => item.id === conversationId);
  const coach = agents.find((item) => item.template === "study-coach");
  const classroomThreadId = coach ? studyCoachThreadId(coach.id) : "";
  const latestVisibleClassroomUpdate = messages.reduce((latest, message) =>
    message.role === CLASSROOM_UPDATE_ROLE && message.createdAt && message.createdAt > latest
      ? message.createdAt : latest, "");
  const [icon, color] = META[agent?.template ?? ""] ?? ["✦", "yellow"];
  const query = search.trim().toLocaleLowerCase();
  const visibleAgents = agents.filter((item) => !query || item.name.toLocaleLowerCase().includes(query)
    || histories[item.id]?.some((thread) => thread.title.toLocaleLowerCase().includes(query)));

  const selection = useRef(0);

  const updateHistory = useCallback((id: string, update: (items: Conversation[]) => Conversation[]) => {
    setHistories((current) => ({ ...current, [id]: update(current[id] ?? []) }));
  }, []);

  const applyThread = useCallback((data: Thread) => {
    setMessages((current) => JSON.stringify(current) === JSON.stringify(data.conversation.messages) ? current : data.conversation.messages);
    setApprovals((current) => JSON.stringify(current) === JSON.stringify(data.approvals) ? current : data.approvals);
    setTurn(data.turn);
    updateHistory(data.conversation.agentId, (items) => items.map((item) => item.id === data.conversation.id
      ? { ...item, title: data.conversation.title, updatedAt: data.conversation.updatedAt }
      : item));
  }, [updateHistory]);

  const selectConversation = useCallback(async (id: string, version = ++selection.current) => {
    setConversationId(id);
    setMessages([]);
    setTurn(null);
    setAssignment(null);
    setApprovals([]);
    setInput("");
    setError("");
    setLoadingThread(true);
    try {
      const response = await fetch(`/api/conversations/${id}?latest=1&turn=1`);
      if (!response.ok) throw new Error();
      const data: Thread = await response.json();
      if (version !== selection.current) return;
      applyThread(data);
    } catch {
      if (version === selection.current) setError("Could not open this conversation.");
    } finally {
      if (version === selection.current) setLoadingThread(false);
    }
  }, [applyThread]);

  const loadConversations = useCallback(async (id: string, preferred?: string) => {
    const version = ++selection.current;
    setLoadingThread(true);
    setConversationId("");
    setMessages([]);
    setTurn(null);
    setAssignment(null);
    setApprovals([]);
    setInput("");
    setError("");
    try {
      const threads = await fetchHistory(id);
      if (version !== selection.current) return;
      updateHistory(id, () => threads);
      const chosen = threads.find((item) => item.id === preferred)
        ?? threads.find((item) => item.id === studyCoachThreadId(id)) ?? threads[0];
      if (chosen) await selectConversation(chosen.id, version);
    } catch {
      if (version === selection.current) setError("Could not load conversations.");
    } finally {
      if (version === selection.current) setLoadingThread(false);
    }
  }, [selectConversation, updateHistory]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      async function roster(): Promise<Agent[]> {
        const response = await fetch("/api/agents?view=roster", { signal: controller.signal });
        if (!response.ok) throw new Error("Could not load your agents.");
        return (await response.json()).agents;
      }
      let list = await roster();
      if (!list.length) {
        const setup = await fetch("/api/agents/ensure", { method: "POST", body: "{}", signal: controller.signal });
        if (!setup.ok) throw new Error("Could not prepare agents.");
        list = await roster();
      }
      if (controller.signal.aborted) return;
      setAgents(list);
      let previousAgent: string | null = null;
      let previousThread: string | null = null;
      try {
        previousAgent = sessionStorage.getItem("my-agents:agent");
        previousThread = sessionStorage.getItem("my-agents:thread");
      } catch {}
      const handoff = new URLSearchParams(window.location.search);
      const selected = list.find((item) => item.id === handoff.get("agent") || item.template === handoff.get("agent"))
        ?? list.find((item: Agent) => item.id === previousAgent)
        ?? list.find((item: Agent) => item.template === "study-coach") ?? list[0];
      if (selected) {
        setAgentId(selected.id);
        const requestedThread = handoff.get("agent") === selected.id ? handoff.get("conversation") : null;
        await loadConversations(selected.id, requestedThread ?? (selected.id === previousAgent ? previousThread ?? undefined : undefined));
        if (handoff.get("agent") === "study-coach" && selected.template === "study-coach") {
          try {
            const raw = sessionStorage.getItem("study-coach:file-handoff");
            if (raw) {
              const parsed = fileHandoffSchema.safeParse(JSON.parse(raw));
              if (parsed.success) { setHandoffFiles(parsed.data.files); setInput(parsed.data.prompt); }
              sessionStorage.removeItem("study-coach:file-handoff");
            }
          } catch { setError("Could not attach the Classroom files. Return to the course and try again."); }
        }
        if (requestedThread) {
          const url = new URL(window.location.href);
          url.searchParams.delete("conversation");
          url.searchParams.delete("agent");
          window.history.replaceState(null, "", url);
        }
      } else {
        setLoadingThread(false);
      }
    })().catch(() => {
      if (controller.signal.aborted) return;
      setError("Could not load your agents. Refresh to try again.");
      setLoadingThread(false);
    });
    return () => controller.abort();
  }, [loadConversations]);

  const searching = Boolean(query);
  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    for (const agent of agents) {
      void fetchHistory(agent.id, controller.signal).then(threads => {
        if (!controller.signal.aborted) updateHistory(agent.id, () => threads);
      }).catch(() => {});
    }
    return () => controller.abort();
  }, [agents, searching, updateHistory]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, pending]);

  useEffect(() => {
    if (!agentId || !conversationId) return;
    try {
      sessionStorage.setItem("my-agents:agent", agentId);
      sessionStorage.setItem("my-agents:thread", conversationId);
    } catch {}
  }, [agentId, conversationId]);

  useEffect(() => {
    if (!conversationId || busy || loadingThread) return;
    const controller = new AbortController();
    let refreshing = false;
    async function refreshThread() {
      if (refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const response = await fetch(`/api/conversations/${conversationId}?latest=1&turn=1`, { signal: controller.signal });
        if (!response.ok) return;
        const data: Thread = await response.json();
        if (!controller.signal.aborted) applyThread(data);
      } catch {
        // The next refresh picks up the saved state.
      } finally {
        refreshing = false;
      }
    }
    const timer = window.setInterval(() => void refreshThread(), pending ? 1_500 : 30_000);
    document.addEventListener("visibilitychange", refreshThread);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshThread);
    };
  }, [conversationId, busy, loadingThread, pending, applyThread]);

  useEffect(() => {
    if (!classroomThreadId) return;
    const controller = new AbortController();
    const storageKey = `classroom-seen:${classroomThreadId}`;
    let refreshing = false;
    async function refreshUnread() {
      if (document.visibilityState !== "visible" || refreshing) return;
      if (conversationId === classroomThreadId) {
        if (latestVisibleClassroomUpdate) {
          try {
            const seen = localStorage.getItem(storageKey) ?? "";
            if (latestVisibleClassroomUpdate > seen) localStorage.setItem(storageKey, latestVisibleClassroomUpdate);
          } catch {}
          setHasUnreadClassroomUpdate(false);
        }
        return;
      }
      refreshing = true;
      try {
        const response = await fetch(`/api/conversations/${classroomThreadId}?classroomActivity=1`, { signal: controller.signal });
        if (!response.ok) return;
        const data: { updatedAt: string | null } = await response.json();
        if (controller.signal.aborted) return;
        let seen = "";
        try { seen = localStorage.getItem(storageKey) ?? ""; } catch {}
        setHasUnreadClassroomUpdate(Boolean(data.updatedAt && data.updatedAt > seen));
      } catch {
        // Retry on the next refresh.
      } finally {
        refreshing = false;
      }
    }
    void refreshUnread();
    const timer = window.setInterval(() => void refreshUnread(), 30_000);
    document.addEventListener("visibilitychange", refreshUnread);
    window.addEventListener("storage", refreshUnread);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshUnread);
      window.removeEventListener("storage", refreshUnread);
    };
  }, [classroomThreadId, conversationId, latestVisibleClassroomUpdate]);

  async function chooseAgent(id: string) {
    if (id === agentId && !query) {
      setExpanded(!expanded);
      return;
    }
    setSearch("");
    setExpanded(true);
    if (id === agentId) return;
    setAgentId(id);
    await loadConversations(id);
  }

  function openConversation(id: string, threadId: string) {
    setExpanded(true);
    setAgentId(id);
    setShowAssistants(false);
    void selectConversation(threadId);
  }

  async function newConversation(id: string) {
    if (busy || loadingThread) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: id }),
      });
      if (!response.ok) throw new Error();
      const { conversation }: { conversation: Conversation } = await response.json();
      updateHistory(id, (items) => [conversation, ...items]);
      setAgentId(id);
      setExpanded(true);
      setShowAssistants(false);
      setSearch("");
      setConversationId(conversation.id);
      setMessages([]);
      setTurn(null);
      setAssignment(null);
      setApprovals([]);
      setInput("");
    } catch {
      setError("Could not start a new conversation.");
    } finally {
      setBusy(false);
    }
  }

  async function renameConversation(title: string) {
    if (!renameTarget || renaming) return;
    if (title === DEFAULT_CONVERSATION_TITLE) {
      setRenameError("Choose a title that describes this conversation.");
      return;
    }
    setRenaming(true);
    setRenameError("");
    try {
      const response = await fetch(`/api/conversations/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error();
      const { conversation }: { conversation: Conversation } = await response.json();
      updateHistory(agentId, (items) => items.map((item) => item.id === conversation.id ? conversation : item));
      setRenameTarget(null);
    } catch {
      setRenameError("Could not save the title. Try again.");
    } finally {
      setRenaming(false);
    }
  }

  async function deleteConversation() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/conversations/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      const remaining = conversations.filter((item) => item.id !== deleteTarget.id);
      updateHistory(agentId, () => remaining);
      setDeleteTarget(null);
      if (conversationId !== deleteTarget.id) return;
      const next = remaining.find((item) => item.id === studyCoachThreadId(agentId)) ?? remaining[0];
      if (next) {
        await selectConversation(next.id);
      } else {
        setConversationId("");
        setMessages([]);
        setTurn(null);
        setAssignment(null);
        setApprovals([]);
        setInput("");
        setError("");
      }
    } catch {
      setDeleteError("Could not delete this conversation. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  async function submitTurn(id: string, request: TurnRequest) {
    const { turnId: _turnId, ...intent } = request;
    const prior = uncertainRequest.current;
    if (prior?.conversationId === id && request.kind !== "retry") {
      const { turnId: _priorId, ...priorIntent } = prior.request;
      if (JSON.stringify(priorIntent) === JSON.stringify(intent)) request = prior.request;
    }
    uncertainRequest.current = { conversationId: id, request };
    const response = await fetch(`/api/conversations/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      if (response.status < 500) uncertainRequest.current = null;
      const data: { error?: { message?: string } } = await response.json().catch(() => ({}));
      throw new Error(data.error?.message ?? "Could not send your request. Try again.");
    }
    uncertainRequest.current = null;
    const data: { turn: Turn } = await response.json();
    setTurn(data.turn);
    await fetch(`/api/conversations/${id}?latest=1&turn=1`, { signal: AbortSignal.timeout(5_000) })
      .then(async (result) => { if (result.ok) applyThread(await result.json()); })
      .catch(() => undefined);
  }

  async function send(text?: string) {
    const prompt = (text ?? input).trim();
    if (!prompt || busy || pending || uploadingFile || sending.current || loadingThread || !agent) return;
    sending.current = true;
    setBusy(true);
    setError("");
    let id = conversationId;
    try {
      if (!id) {
        const response = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: agent.id }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error("Could not start a conversation.");
        const { conversation }: { conversation: Conversation } = await response.json();
        id = conversation.id;
        setConversationId(id);
        updateHistory(agent.id, (items) => [conversation, ...items]);
      }
      await submitTurn(id, { kind: "chat", message: prompt, assignmentId: assignment?.assignmentId, attachmentIds: handoffFiles.map((file) => file.id), turnId: crypto.randomUUID() });
      if (text === undefined) setInput((draft) => draft.trim() === prompt ? "" : draft);
      setHandoffFiles([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send your message.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function uploadChatFile(file: File | undefined) {
    if (!file || uploadingFile || handoffFiles.length >= MAX_CHAT_ATTACHMENTS) return;
    setUploadingFile(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/files", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Could not upload this file.");
      const parsed = z.object({ file: z.object({ id: z.string(), name: z.string(), status: z.string() }) }).parse(payload);
      let status = parsed.file.status;
      for (let attempt = 0; attempt < 15 && status !== "ready" && status !== "failed"; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const check = await fetch(`/api/files/${parsed.file.id}/status`, { cache: "no-store" });
        if (check.ok) status = (await check.json()).status;
      }
      if (status !== "ready") throw new Error(status === "failed" ? "This file could not be processed. Try another file." : "The file is still processing. Find it in Files & notes and attach it when ready.");
      setHandoffFiles((current) => [...current, { id: parsed.file.id, name: parsed.file.name }].slice(0, MAX_CHAT_ATTACHMENTS));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload this file.");
    } finally {
      setUploadingFile(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function runThreadAction(request: TurnRequest) {
    if (!conversationId || busy || pending || sending.current || loadingThread) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      await submitTurn(conversationId, request);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finish your request.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function renderMessage(message: Message, index: number) {
    const key = message.id ?? `${conversationId}-${index}`;
    if (message.role === CLASSROOM_UPDATE_ROLE) {
      const update = readThreadData(classroomUpdateSchema, message.content);
      if (!update) return null;
      const due = update.dueDate ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(update.dueDate)) : "No due date";
      return (
        <article className="study-thread-card" key={key}>
          <small>{update.change ? `Study Coach · ${CLASSROOM_CHANGE_LABELS[update.change]}` : "Google Classroom"} · {due}</small>
          <strong>{update.title}</strong>
          {update.lastQuestion && <p className="study-thread-follow-up">You last asked about this assignment: “{update.lastQuestion}”</p>}
          <div className="study-thread-actions">
            {update.status !== "completed" && (
              <button type="button" className="file-action" disabled={busy || loadingThread}
                aria-pressed={assignment?.assignmentId === update.assignmentId}
                onClick={() => {
                  setAssignment(update);
                  if (update.lastQuestion) setInput((draft) => draft || `Help me pick up where I left off on this assignment. I last asked: ${update.lastQuestion}`);
                }}>{update.lastQuestion ? "Continue studying" : "Study this assignment"}</button>
            )}
            <Link href={`/app/assignments/${update.assignmentId}`}>View assignment and sources ↗</Link>
          </div>
        </article>
      );
    }
    if (message.role === STUDY_PLAN_ROLE) {
      const plan = readThreadData(studyPlanSchema, message.content);
      if (!plan) return null;
      const approval = approvals.find((item) => item.id === plan.approvalId);
      return (
        <article className="study-thread-card" key={key}>
          <strong>Study plan for {plan.title}</strong>
          <ol>{plan.sessions.map((session) => <li key={session}>{session}</li>)}</ol>
          {approval && <ApprovalCard id={approval.id} title="Add these sessions to your planner"
            description="Approval creates the three tasks shown above."
            initialStatus={approval.status}
            onDecided={(status) => setApprovals((items) => items.map((item) => item.id === approval.id ? { ...item, status } : item))} />}
        </article>
      );
    }
    if (!message.content) return null;
    return <ChatMessage key={key} role={message.role} content={message.content} agentName={agent?.name}
      agentIcon={icon} agentColor={color} sources={message.sources} />;
  }

  const prompts = agent?.template === "study-coach"
    ? ["Explain a concept from my course materials.", "Quiz me on my coursework, one question at a time.", "Make a study plan using my upcoming deadlines."]
    : agent?.template === "project-guide"
      ? ["Help me choose the next project milestone.", "Review my project scope and flag risks."]
      : ["Help me decide what to focus on next.", "Pick up where we left off."];

  return <section className="agent-messenger" aria-label="Agent workspace" data-show-assistants={showAssistants}>
    <aside className="agent-messenger-sidebar" id="agent-assistants">
      <div className="agent-messenger-tools">
        <Link href="/app" className="agent-messenger-back">← Overview</Link>
        <button className="agent-messenger-mobile-toggle file-action" type="button" onClick={() => setShowAssistants(false)}>Close</button>
      </div>
      <label className="agent-messenger-search">
        <span aria-hidden="true">⌕</span>
        <input type="search" aria-label="Search assistants and recent conversations" placeholder="Search conversations"
          value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <h2 className="agent-messenger-section-label">Assistants</h2>
      <nav className="agent-messenger-roster" aria-label="Assistants and conversations">
        {visibleAgents.map((item) => {
          const [itemIcon, itemColor] = META[item.template] ?? ["✦", "yellow"];
          const active = item.id === agentId;
          const open = query ? true : active && expanded;
          const unread = item.id === coach?.id && hasUnreadClassroomUpdate;
          const threads = (histories[item.id] ?? []).filter((thread) =>
            !query || item.name.toLocaleLowerCase().includes(query) || thread.title.toLocaleLowerCase().includes(query));
          return (
            <div key={item.id}>
              <div className={`agent-messenger-agent-row${active ? " active" : ""}`}>
                <button type="button" disabled={busy || renaming || deleting}
                  aria-label={unread ? `${item.name}, new Classroom update` : item.name}
                  aria-expanded={open} aria-controls={open ? `history-${item.id}` : undefined}
                  onClick={() => void chooseAgent(item.id)} className="agent-messenger-agent">
                  <span className={`agent-icon ${itemColor}`} aria-hidden="true">{itemIcon}</span>
                  <span className="agent-messenger-agent-copy"><b>{item.name}</b><small>{item.role}</small></span>
                  {unread && <span className="agent-messenger-unread" aria-hidden="true" />}
                  <span className="agent-messenger-chevron" aria-hidden="true">{open ? "⌄" : "›"}</span>
                </button>
                <button className="agent-messenger-new" type="button" disabled={busy || loadingThread || renaming || deleting}
                  aria-label={`New conversation with ${item.name}`} title={`New conversation with ${item.name}`}
                  onClick={() => void newConversation(item.id)}>+</button>
              </div>
              {open && (
                <div id={`history-${item.id}`} className="agent-messenger-conversations">
                  {threads.map((thread) => (
                    <button type="button" key={thread.id} disabled={busy || renaming || deleting}
                      aria-current={thread.id === conversationId ? "true" : undefined}
                      onClick={() => openConversation(item.id, thread.id)}
                      className={`agent-messenger-conversation${thread.id === conversationId ? " active" : ""}`}>
                      <b title={thread.title}>{thread.title}</b>
                      <small>{thread.id === classroomThreadId && unread ? "New update" : threadDate.format(new Date(thread.updatedAt))}</small>
                    </button>
                  ))}
                  {threads.length === 0 && <p className="agent-messenger-empty">
                    {query ? "No matching conversations" : loadingThread ? "Loading conversations…" : "No conversations yet"}
                  </p>}
                </div>
              )}
            </div>
          );
        })}
        {query && visibleAgents.length === 0 && <p className="agent-messenger-empty" role="status">No matches found.</p>}
      </nav>
    </aside>
    <main className="agent-messenger-main">
      <header className="agent-messenger-header">
        <button className="agent-messenger-mobile-toggle file-action" type="button"
          aria-expanded={showAssistants} aria-controls="agent-assistants"
          onClick={() => setShowAssistants(true)}>Assistants</button>
        <div className="agent-messenger-header-copy">
          <b>{agent?.name ?? "My agents"}</b>
          {activeConversation && <small title={activeConversation.title}>{activeConversation.title}</small>}
        </div>
        {activeConversation && (
          <div className="agent-messenger-chat-actions">
            <button type="button" className="file-action" disabled={busy || loadingThread || deleting}
              aria-label="Rename conversation" onClick={() => {
                setRenameError("");
                setRenameTarget(activeConversation);
              }}>Rename</button>
            {activeConversation.id !== studyCoachThreadId(agentId) && (
              <button type="button" className="file-action file-action-danger" disabled={busy || loadingThread || deleting}
                aria-label="Delete conversation" onClick={() => {
                  setDeleteError("");
                  setDeleteTarget(activeConversation);
                }}>Delete</button>
            )}
          </div>
        )}
      </header>
      {agent && (
        <details key={`${agent.id}:${conversationId}`} className="agent-messenger-run">
          <summary>Run a workspace check</summary>
          <RunPanel agentId={agent.id} conversationId={conversationId} projectId={activeConversation?.projectId ?? ""} />
        </details>
      )}
      <div className="agent-messenger-thread" role="log" aria-live="polite">
        {loadingThread && <p className="agent-messenger-thinking" role="status">Loading conversation…</p>}
        {!loadingThread && !messages.length && !pending && agent && (
          <div className="agent-messenger-welcome">
            <div className={`agent-icon ${color}`} aria-hidden="true">{icon}</div>
            <h1>{agent.name}</h1>
            <p>{agent.description}</p>
            <div className="agent-messenger-prompts">
              {prompts.map((prompt) => <button key={prompt} type="button" disabled={busy}
                onClick={() => void send(prompt)}>{prompt}</button>)}
            </div>
          </div>
        )}
        {messages.length > 0 && <div className="agent-messenger-messages">{messages.map(renderMessage)}<div ref={bottom} /></div>}
      </div>
      {pending && <p className="agent-messenger-thinking" role="status">
        {turn?.status === "queued" ? "Queued" : `${agent?.name ?? "Your agent"} is working…`}
      </p>}
      {turn?.status === "dead_letter" && (
        <div className="study-thread-context">
          <span role="status">This request could not finish.</span>
          <button className="file-action" type="button" disabled={busy || loadingThread}
            onClick={() => void runThreadAction({ kind: "retry", turnId: turn.id })}>Retry</button>
        </div>
      )}
      {assignment && (
        <div className="study-thread-context">
          <span>Using <strong>{assignment.title}</strong></span>
          <div className="study-thread-actions">
            <button type="button" className="file-action" disabled={busy || pending || loadingThread}
              onClick={() => void runThreadAction({ kind: "study_plan", assignmentId: assignment.assignmentId, turnId: crypto.randomUUID() })}>Draft study plan</button>
            <button type="button" className="file-action" disabled={busy} onClick={() => { setAssignment(null); }}>Clear context</button>
          </div>
        </div>
      )}
      {handoffFiles.length > 0 && <div className="study-thread-context"><span>Attached for this question: <strong>{handoffFiles.map((file) => file.name).join(", ")}</strong></span><button type="button" className="file-action" onClick={() => setHandoffFiles([])}>Remove files</button></div>}
      {error && <p className="agent-messenger-error" role="alert">{error}</p>}
      <form className="agent-messenger-composer" onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}>
        <input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md" hidden aria-label="Choose a file for chat" onChange={(event) => void uploadChatFile(event.target.files?.[0])} />
        <button className="file-action" type="button" aria-label="Attach file to chat" title="Attach PDF, DOCX, TXT or MD" disabled={uploadingFile || handoffFiles.length >= MAX_CHAT_ATTACHMENTS || busy || pending} onClick={() => fileInput.current?.click()}>{uploadingFile ? "Preparing…" : "+ File"}</button>
        <textarea
          aria-label={`Message ${agent?.name ?? "agent"}`}
          placeholder={`Message ${agent?.name ?? "your companion"}…`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          rows={1}
          maxLength={4000}
          title="Shift + Enter for a new line"
          disabled={loadingThread || !agent}
        />
        <button
          className="agent-messenger-send"
          type="submit"
          disabled={busy || pending || uploadingFile || loadingThread || !agent || !input.trim()}
          aria-label="Send message"
        >↑</button>
      </form>
    </main>
    {deleteTarget && (
      <ConfirmDialog
        isOpen
        title="Delete conversation?"
        description={`“${deleteTarget.title}” and its messages will be permanently deleted.`}
        confirmText="Delete conversation"
        error={deleteError}
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteConversation}
      />
    )}
    {renameTarget && (
      <PromptDialog
        isOpen
        title="Rename conversation"
        defaultValue={renameTarget.title === DEFAULT_CONVERSATION_TITLE ? "" : renameTarget.title}
        placeholder="Conversation title"
        maxLength={MAX_CONVERSATION_TITLE_LENGTH}
        loading={renaming}
        error={renameError}
        onClose={() => setRenameTarget(null)}
        onSubmit={renameConversation}
      />
    )}
  </section>;
}
