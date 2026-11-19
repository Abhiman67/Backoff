"use client";
import { useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ConfirmDialog } from "@/components/Dialog";

export default function PrivacySettings() {
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [exportError, setExportError] = useState("");

  async function exportData() {
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch("/api/privacy/export", { cache: "no-store" });
      if (!response.ok) throw new Error("Your export could not be prepared. Please try again.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vidyasarthi-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError("Your data export could not be prepared. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/profile", { method: "DELETE" });
      if (res.ok) {
        await signOut({ callbackUrl: "/" });
      } else {
        setDeleteError("Failed to delete account. Please try again.");
      }
    } finally {
      setDeleting(false);
      setShowConfirmModal(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", paddingBottom: 40 }}>
      {/* Settings Breadcrumb */}
      <div style={{ marginBottom: 18 }}>
        <Link href="/app/settings" className="button secondary sm">
          Settings
        </Link>
      </div>

      {/* Page Header with VidyaSarthi Icon System */}
      <div className="page-head" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="agent-icon green" style={{ width: 44, height: 44, fontSize: 20 }}>
            ⚿
          </div>
          <div>
            <h1>Privacy, security and data</h1>
            <p>You own your notes and data. Export or erase your information anytime.</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Export Data Panel */}
        <section className="panel" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div className="agent-icon blue" style={{ width: 38, height: 38, fontSize: 17 }}>
              ⎘
            </div>
            <div>
              <h2 style={{ fontSize: 16, margin: 0 }}>Export workspace data</h2>
              <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Portable JSON archive</span>
            </div>
          </div>

          <p style={{ fontSize: 13, color: "var(--color-muted)", lineHeight: 1.6, margin: "0 0 14px" }}>
            Download your workspace archive with note content, courses and mastery, tasks, projects, conversations, files, and account activity. Password hashes and integration tokens are excluded.
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
            <span className="tag">Profile and courses</span>
            <span className="tag">Milestones and tasks</span>
            <span className="tag">Notes and revisions</span>
            <span className="tag">Learning history</span>
          </div>

          <button
            onClick={exportData}
            disabled={exporting}
            className="button primary sm"
          >
            {exporting ? "Compiling export…" : "Download all data (JSON)"}
          </button>
          {exportError && <p role="alert" style={{ color: "#a23627", fontSize: 12, margin: "10px 0 0" }}>{exportError}</p>}
        </section>

        {/* Danger Zone Panel */}
        <section className="panel" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div className="dialog-icon danger" style={{ width: 38, height: 38, fontSize: 16, margin: 0 }}>
              ⚿
            </div>
            <div>
              <h2 style={{ fontSize: 16, margin: 0 }}>Danger zone</h2>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Permanent and irreversible</span>
            </div>
          </div>

          <p style={{ fontSize: 13, color: "var(--color-muted)", lineHeight: 1.6, margin: "0 0 16px" }}>
            Permanently delete your account and wipe all stored files, milestones, messages, and configurations. Active sessions will be terminated immediately.
          </p>

          {deleteError && (
            <div className="panel" style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 12.5, fontWeight: 700, margin: 0 }}>{deleteError}</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowConfirmModal(true)}
            disabled={deleting}
            className="link-danger"
          >
            Delete account and all data
          </button>
        </section>
      </div>

      <ConfirmDialog
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={deleteAccount}
        title="Permanently Delete Account?"
        description="Are you completely sure? This will immediately wipe your account, projects, uploaded notes, milestones, and conversation memory. This action cannot be undone."
        confirmText="Yes, Delete My Account"
        cancelText="Keep Account"
        variant="danger"
        icon="⚿"
        loading={deleting}
      />
    </main>
  );
}
