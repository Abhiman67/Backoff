import { IntegrationsPanel } from "@/components/IntegrationsPanel";

export default function IntegrationsSettingsPage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", paddingBottom: 40 }}>
      <div className="page-head">
        <div>
          <h1>Connected integrations</h1>
          <p>Classroom reads your courses, assignments, and shared material links. Connect Drive separately to import supported attachment contents into Files &amp; notes. Calendar sync is read-only; agent tool actions for GitHub, Notion, and Gmail are previews.</p>
        </div>
      </div>
      <IntegrationsPanel />
    </div>
  );
}
