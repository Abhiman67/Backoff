import type { Metadata } from "next";
import PublicChrome from "@/components/PublicChrome";

export const metadata: Metadata = { title: "Status — VidyaSarthi", description: "VidyaSarthi system status and uptime." };

export default function StatusPage() {
  return (
    <PublicChrome>
      <section className="wrap ref-section reveal" style={{ maxWidth: 860 }}>
        <div className="kicker">Trust</div>
        <h1 data-split style={{ fontSize: "clamp(36px,5vw,58px)", letterSpacing: "-0.065em", margin: "0 0 12px" }}>Service status</h1>
        <p className="lead">Live status monitoring is unavailable.</p>
      </section>
    </PublicChrome>
  );
}
