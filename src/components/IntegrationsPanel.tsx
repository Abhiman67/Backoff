"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { ConfirmDialog } from "@/components/Dialog";
import { CLASSROOM_MATERIALS_SCOPE } from "@/lib/integrations/scopes";

const google = [
  { id: "classroom", name: "Google Classroom", mark: "Cl", description: "Sync courses, assignments, and links to shared materials." },
  { id: "drive", name: "Google Drive", mark: "Dr", description: "Import supported Classroom attachments into Files & notes." },
  { id: "calendar", name: "Google Calendar", mark: "Ca", description: "Bring calendar events into your workspace." },
] as const;

const previews = [
  { id: "github", name: "GitHub" },
  { id: "notion", name: "Notion" },
  { id: "gmail", name: "Gmail" },
] as const;

type GoogleProvider = (typeof google)[number];
type Provider = GoogleProvider | (typeof previews)[number];
type Operation = { kind: "connect" | "disconnect" | "autoImport"; provider: Provider["id"] };

const accountsResponse = z.object({ accounts: z.array(z.object({ provider: z.string(), scopes: z.array(z.string()), autoImportAttachments: z.boolean() })) });
const oauthResponse = z.object({ authUrl: z.url() });
const errorResponse = z.object({ error: z.object({ message: z.string() }) });
type Accounts = z.infer<typeof accountsResponse>["accounts"];
type ConnectionList = { kind: "loading" } | { kind: "error" } | { kind: "ready"; accounts: Accounts };

export function IntegrationsPanel() {
  const [connections, setConnections] = useState<ConnectionList>({ kind: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [target, setTarget] = useState<Provider | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/integrations", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not load integrations");
        const { accounts } = accountsResponse.parse(await response.json());
        if (!controller.signal.aborted) setConnections({ kind: "ready", accounts });
      } catch {
        if (!controller.signal.aborted) setConnections({ kind: "error" });
      }
    }
    void load();
    return () => controller.abort();
  }, [loadAttempt]);

  async function connect(provider: GoogleProvider) {
    setOperation({ kind: "connect", provider: provider.id });
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/integrations/${provider.id}/connect`, { cache: "no-store" });
      const data: unknown = await response.json();
      if (!response.ok) {
        const failure = errorResponse.safeParse(data);
        throw new Error(failure.success ? failure.data.error.message : `Could not connect ${provider.name}.`);
      }
      window.location.assign(oauthResponse.parse(data).authUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not start sign-in for ${provider.name}.`);
      setOperation(null);
    }
  }

  async function disconnect() {
    if (!target || operation) return;
    setOperation({ kind: "disconnect", provider: target.id });
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/integrations/${target.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Disconnect failed");
      setConnections((current) => current.kind === "ready"
        ? { kind: "ready", accounts: current.accounts.filter((account) => account.provider !== target.id) }
        : current);
      setNotice(`Saved access removed for ${target.name}.`);
      setTarget(null);
    } catch {
      setError(`Couldn’t remove access for ${target.name}. Try again.`);
    } finally {
      setOperation(null);
    }
  }

  async function updateAutoImport(enabled: boolean) {
    setOperation({ kind: "autoImport", provider: "classroom" });
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/integrations/classroom", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoImportAttachments: enabled }),
      });
      if (!response.ok) throw new Error("Setting could not be saved");
      setConnections((current) => current.kind === "ready"
        ? { kind: "ready", accounts: current.accounts.map((account) => account.provider === "classroom" ? { ...account, autoImportAttachments: enabled } : account) }
        : current);
      setNotice(enabled ? "The next Classroom sync will start importing assignment attachments." : "Automatic attachment import is off.");
    } catch {
      setError("Couldn’t save the automatic import setting. Try again.");
    } finally {
      setOperation(null);
    }
  }

  function confirmRemoval(provider: Provider) {
    setError("");
    setNotice("");
    setTarget(provider);
  }

  if (connections.kind === "loading") return <p role="status" className="integration-notice">Loading integrations…</p>;
  if (connections.kind === "error") return (
    <div className="integration-load-error">
      <p role="alert" className="integration-notice">Couldn’t load your connections.</p>
      <button type="button" className="file-action" onClick={() => {
        setConnections({ kind: "loading" });
        setLoadAttempt((attempt) => attempt + 1);
      }}>Try again</button>
    </div>
  );

  const { accounts } = connections;
  const classroom = accounts.find((account) => account.provider === "classroom");
  const driveConnected = accounts.some((account) => account.provider === "drive");
  return (
    <>
      {!target && error && <p role="alert" className="integration-notice integration-error">{error}</p>}
      {notice && <p role="status" className="integration-notice">{notice}</p>}

      <section className="integration-section" aria-labelledby="google-connections">
        <h2 id="google-connections">Google connections</h2>
        <ul className="panel integration-list">
          {google.map((provider) => {
            const account = accounts.find((item) => item.provider === provider.id);
            const needsMaterials = provider.id === "classroom" && account && !account.scopes.includes(CLASSROOM_MATERIALS_SCOPE);
            const connecting = operation?.kind === "connect" && operation.provider === provider.id;
            return (
              <li key={provider.id} className="integration-row">
                <span className="integration-icon" data-provider={provider.id} aria-hidden="true">{provider.mark}</span>
                <div className="integration-copy">
                  <div className="integration-title">
                    <h3>{provider.name}</h3>
                    <span className="integration-status" data-status={account ? "connected" : "disconnected"}>
                      {account ? "Connected · Read-only" : "Not connected"}
                    </span>
                  </div>
                  <p>{provider.description}</p>
                  {needsMaterials && <p className="integration-scope">Reconnect to enable access to course materials.</p>}
                </div>
                <div className="integration-actions">
                  {(!account || needsMaterials) && (
                    <button className="recommendation-action recommendation-action-primary" type="button" disabled={Boolean(operation)}
                      aria-label={account ? `Reconnect ${provider.name} for materials` : `Connect ${provider.name}`}
                      onClick={() => void connect(provider)}>
                      {connecting ? "Opening Google…" : account ? "Reconnect" : "Connect"}
                    </button>
                  )}
                  {account && <button type="button" className="file-action" aria-label={`Disconnect ${provider.name}`}
                    disabled={Boolean(operation)} onClick={() => confirmRemoval(provider)}>Disconnect</button>}
                </div>
              </li>
            );
          })}
        </ul>
        {classroom && (
          <div className="panel integration-auto-import">
            <label>
              <input type="checkbox" checked={classroom.autoImportAttachments}
                disabled={Boolean(operation) || (!driveConnected && !classroom.autoImportAttachments)}
                onChange={(event) => void updateAutoImport(event.target.checked)} />
              <strong>Auto-import assignment attachments</strong>
            </label>
            <p>{driveConnected
              ? "Import eligible Drive files when Classroom syncs. Ready files appear under the corresponding assignment."
              : "Connect Google Drive to download assignment attachments."}</p>
          </div>
        )}
      </section>

      <section className="integration-section" aria-labelledby="preview-integrations">
        <h2 id="preview-integrations">Agent tool previews</h2>
        <p>Preview how these tools would work inside VidyaSarthi.</p>
        <ul className="integration-preview-list">
          {previews.map((provider) => (
            <li key={provider.id}>
              <strong>{provider.name}</strong>
              {accounts.some((account) => account.provider === provider.id) && (
                <button type="button" className="file-action" aria-label={`Remove saved token for ${provider.name}`}
                  disabled={Boolean(operation)} onClick={() => confirmRemoval(provider)}>Remove saved token</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {target && (
        <ConfirmDialog isOpen title={`Remove saved access for ${target.name}?`}
          description="You can connect again from this page."
          confirmText="Remove access" loading={operation?.kind === "disconnect"} error={error}
          onClose={() => { setTarget(null); setError(""); }} onConfirm={() => void disconnect()} />
      )}
    </>
  );
}
