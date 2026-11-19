"use client";

import { useEffect, useState } from "react";

type Preferences = { classroom: boolean; routines: boolean; approvals: boolean };
const options: { key: keyof Preferences; title: string; description: string }[] = [
  { key: "classroom", title: "Coursework deadlines", description: "Due soon and overdue items synced from Google Classroom." },
  { key: "routines", title: "Scheduled agent checks", description: "Failures and updates from your background routines." },
  { key: "approvals", title: "Actions waiting for approval", description: "A reminder when an agent needs your review." },
];

export function NotificationPreferences() {
  const [preferences, setPreferences] = useState<Preferences>({ classroom: true, routines: true, approvals: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/profile/notifications", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? "Could not load notification settings.");
        if (active) setPreferences(data.preferences);
      })
      .catch(() => { if (active) setMessage("Could not load saved settings."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function change(key: keyof Preferences, checked: boolean) {
    const next = { ...preferences, [key]: checked };
    setPreferences(next);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/profile/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not save this preference.");
      setMessage("Settings saved.");
    } catch {
      setPreferences(preferences);
      setMessage("Could not save this preference. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="notification-preferences-title">
      <div className="panel-head">
        <div>
          <h2 id="notification-preferences-title">In-app notifications</h2>
          <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "4px 0 0" }}>Choose which new updates are added to your workspace inbox.</p>
        </div>
        {saving ? <span className="tag">Saving…</span> : message && <span role="status" className="tag">{message}</span>}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {options.map((option) => (
          <label key={option.key} className="notification-preference-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "12px 0", borderTop: "1px solid var(--color-line)", cursor: loading ? "wait" : "pointer" }}>
            <span>
              <strong style={{ display: "block", fontSize: 13 }}>{option.title}</strong>
              <span style={{ display: "block", color: "var(--color-muted)", fontSize: 12, marginTop: 3 }}>{option.description}</span>
            </span>
            <input
              type="checkbox"
              checked={preferences[option.key]}
              disabled={loading || saving}
              onChange={(event) => void change(option.key, event.target.checked)}
              aria-label={option.title}
            />
          </label>
        ))}
      </div>
      <p style={{ margin: "10px 0 0", color: "var(--color-muted)", fontSize: 11 }}>These controls affect the in-app inbox. Email and push notifications are not enabled.</p>
    </section>
  );
}
