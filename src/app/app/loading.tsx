export default function AppLoading() {
  return (
    <div className="route-loading" role="status" aria-label="Loading workspace page" aria-busy="true">
      <span className="sr-only">Loading your workspace…</span>
      <div className="route-loading-heading">
        <i />
        <i />
      </div>
      <div className="route-loading-actions">
        <i />
        <i />
        <i />
      </div>
      <div className="route-loading-columns">
        <section className="panel route-loading-panel">
          <i />
          <i />
          <i />
          <i />
        </section>
        <section className="panel route-loading-panel">
          <i />
          <i />
          <i />
        </section>
      </div>
      <section className="panel route-loading-panel route-loading-wide">
        <i />
        <i />
        <i />
      </section>
    </div>
  );
}
