import type { Metadata } from "next";
import Link from "next/link";
import PublicChrome from "@/components/PublicChrome";

export const metadata: Metadata = {
  title: "Terms — Fair rules for students | VidyaSarthi",
  description: "Terms for using the VidyaSarthi student workspace, AI features, integrations, and account controls.",
};

const sections = [
  { h: "1. What VidyaSarthi is", p: "A personal AI team for studying, projects and careers. Agents explain, plan, draft and suggest — you own decisions and final work." },
  { h: "2. Academic integrity", p: "Coaching first: hints and explanations before solutions on graded work. No help with live exams. Generated content is marked as draft and needs your review. Don't submit AI output as your own where your institution forbids it." },
  { h: "3. Approvals & responsibility", p: "Supported agent actions that affect an external service require your approval before execution. Review the action before approving it. You remain responsible for decisions and work you submit." },
  { h: "4. No guarantees", p: "No guaranteed grades, interviews, jobs or outcomes. Marketing metrics are labeled illustrative until real analytics exist." },
  { h: "5. Accounts & acceptable use", p: "One account per student (Campus seats via your college). Don't abuse rate limits, upload malware, attempt prompt-injection via files, or access others' records. We may suspend accounts for abuse or safety violations." },
  { h: "6. Plans & billing", p: "Billing is not enabled in the current build. Pricing information does not activate a paid subscription or authorize a charge." },
  { h: "7. Termination & changes", p: "Delete your account anytime from Settings. We may update these terms with notice; continued use means acceptance. Questions: hello@backoff.ai." },
];

export default function Terms() {
  return (
    <PublicChrome>
      <section className="wrap ref-section reveal" style={{ maxWidth: 860 }}>
        <div className="kicker">Trust</div>
        <h1 data-split style={{ fontSize: "clamp(36px,5vw,58px)", letterSpacing: "-0.065em", lineHeight: 1, margin: "0 0 12px" }}>Fair rules, student-first.</h1>
        <p className="lead">Last updated: November 2026 · These terms describe the current preview product.</p>
        <div className="card" style={{ marginTop: 28, display: "grid", gap: 22 }}>
          {sections.map((s) => (
            <div key={s.h}><h3 style={{ margin: "0 0 8px", fontSize: 17 }}>{s.h}</h3><p style={{ margin: 0, color: "#4c555c", lineHeight: 1.7, fontSize: 14 }}>{s.p}</p></div>
          ))}
        </div>
        <p className="fineprint center" style={{ marginTop: 16 }}><Link href="/privacy">Read the Privacy summary →</Link></p>
      </section>
    </PublicChrome>
  );
}
