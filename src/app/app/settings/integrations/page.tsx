import { IntegrationsPanel } from "@/components/IntegrationsPanel";

export default function IntegrationsSettingsPage() {
  return (
    <main className="integrations-settings" id="main">
      <header className="integration-heading">
        <h1>Integrations</h1>
        <p>Connect Google apps to bring your coursework and schedule into VidyaSarthi.</p>
      </header>
      <IntegrationsPanel />
    </main>
  );
}
