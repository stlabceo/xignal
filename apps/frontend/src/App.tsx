const workstreams = [
  "Webhook ingestion",
  "Execution orchestration",
  "Operations dashboard",
  "Migration readiness"
];

const nextTasks = [
  "Define admin routes and IA",
  "Connect health check and webhook test flow",
  "Design domain-level table schema",
  "Document legacy-to-new mappings"
];

export default function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Xignal rebuild scaffold</p>
        <h1>WinBot operations console is being rebuilt in parallel.</h1>
        <p className="lead">
          This screen is a placeholder for the new console, separated from the
          execution engine and aligned with the new multi-user architecture.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Planned Workstreams</h2>
          <ul>
            {workstreams.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h2>Immediate TODO</h2>
          <ul>
            {nextTasks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
