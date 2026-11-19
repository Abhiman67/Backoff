import Link from "next/link";
import PublicChrome from "@/components/PublicChrome";

const items: [string, string][] = [
  ["Human approval first", "Supported agent actions that affect external services require an approval. Pending approvals expire after 7 days. Google Classroom, Drive, and Calendar connections are read-only."],
  ["Integration controls", "Google requests the scopes shown on its consent screen. Disconnecting removes VidyaSarthi's saved token; it does not revoke Google consent."],
  ["Encrypted secrets", "OAuth tokens are encrypted at rest, never appear in URLs or client bundles, and never enter logs or analytics."],
  ["Data controls", "Export workspace data or delete your account from Settings → Privacy. Configured AI providers receive prompts and selected context; review their current data settings."],
  ["Untrusted inputs", "Uploaded files and web content are treated as reference data, never instructions. Agents cite sources and say when nothing relevant is found."],
  ["Audit trail", "The app records selected security and workspace events. Audit coverage and retention depend on the event and deployment configuration."],
  ["Academic integrity", "Study Coach prefers hints and practice for graded work and will not sit exams for you. Drafts are labeled as drafts."],
];

export default function SecurityPage() {
  return (
    <PublicChrome>
      <section className="wrap ref-section reveal in" style={{ maxWidth: 760 }}>
        <div className="kicker">Trust</div>
        <h1 data-split style={{ fontSize: "clamp(36px,5vw,58px)", letterSpacing: "-0.065em", margin: "0 0 12px" }}>Security at VidyaSarthi</h1>
        <p className="lead">How we protect student work. Found a vulnerability? Email <a href="mailto:security@backoff.ai">security@backoff.ai</a> — we respond within 2 business days.</p>
        <ul className="check-list" style={{ marginTop: 24 }}>
          {items.map(([t, d]) => (
            <li key={t}><b>{t}.</b> {d}</li>
          ))}
        </ul>
        <div className="actions" style={{ marginTop: 24 }}>
          <Link href="/signup" className="button primary-orange shine">Build your team ↗</Link>
        </div>
      </section>
    </PublicChrome>
  );
}
