import type { Metadata } from "next";
import Link from "next/link";
import PublicChrome from "@/components/PublicChrome";

export const metadata: Metadata = {
  title: "Privacy — Your data, your control | VidyaSarthi",
  description: "What VidyaSarthi stores, how it uses your workspace data, and how you can export or delete your account.",
};

const sections = [
  { h: "1. Data we store", p: "The app stores account and profile details, workspace content, notes, uploaded files and extracted text, agent conversations, approvals, and usage records. If you connect Google Classroom, Drive, or Calendar, the app also stores the data needed for the enabled integration features." },
  { h: "2. How we use it", p: "The app uses workspace data to show your courses, organize study materials, answer questions using selected context, plan tasks, and run the features you request." },
  { h: "3. AI providers", p: "When you use an AI feature, the app sends your prompt and selected context, such as relevant notes or coursework, to the configured AI provider. VidyaSarthi does not control that provider's retention or training settings. Review the provider's current terms and configuration." },
  { h: "4. Files & memory", p: "The app extracts text from supported PDF, TXT, Markdown, and DOCX files so you can search and study them. Agents use context selected for the request. You can manage notes, files, and agent memory from the workspace." },
  { h: "5. Integrations", p: "Google Classroom, Drive, and Calendar connections use read-only access. Drive attachment contents are imported only when you choose to import a supported file. GitHub, Notion, and Gmail actions are previews and do not call those providers. Integration tokens are encrypted at rest." },
  { h: "6. Retention & deletion", p: "Pending approvals expire after 7 days. You can export your workspace or delete your account from Settings → Privacy. Deleting a file removes its content and chunks, then keeps a deleted metadata row. Account deletion removes user-owned records; some audit events may remain without an account link. Backup retention depends on the hosting configuration." },
  { h: "7. Security", p: "The app encrypts integration tokens at rest and checks account ownership in API routes. No internet service can guarantee that every system is free of risk. Report a security issue using the contact address below." },
  { h: "8. Your rights & contact", p: "Use Settings to export workspace data or delete your account. Questions: hello@backoff.ai. This summary describes the current product and may change as the service develops." },
];

export default function Privacy() {
  return (
    <PublicChrome>
      <section className="wrap ref-section reveal" style={{ maxWidth: 860 }}>
        <div className="kicker">Trust</div>
        <h1 data-split style={{ fontSize: "clamp(36px,5vw,58px)", letterSpacing: "-0.065em", lineHeight: 1, margin: "0 0 12px" }}>Privacy, in plain language.</h1>
        <p className="lead">Last updated: November 2026 · You can export workspace data or delete your account from Settings.</p>
        <div className="card" style={{ marginTop: 28, display: "grid", gap: 22 }}>
          {sections.map((s) => (
            <div key={s.h}><h3 style={{ margin: "0 0 8px", fontSize: 17 }}>{s.h}</h3><p style={{ margin: 0, color: "#4c555c", lineHeight: 1.7, fontSize: 14 }}>{s.p}</p></div>
          ))}
        </div>
        <div className="cta" style={{ marginTop: 36 }}>
          <h2>Questions about your data?</h2>
          <p>Write to us — a human replies.</p>
          <a className="button cta-btn" href="mailto:hello@backoff.ai?subject=Privacy%20question">hello@backoff.ai</a>
        </div>
        <p className="fineprint center" style={{ marginTop: 16 }}><Link href="/terms">Read the Terms →</Link></p>
      </section>
    </PublicChrome>
  );
}
