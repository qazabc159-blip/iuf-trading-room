import Link from "next/link";

import { AppShell } from "@/components/app-shell";

export default function HomePage() {
  return (
    <AppShell eyebrow="Wave 0" title="Research Control Tower">
      <section className="dashboard-grid">
        <article className="panel hero-card" style={{ gridColumn: "1 / -1" }}>
          <p className="eyebrow">Operating Model</p>
          <h3>IUF research brain, structured workflow, execution discipline.</h3>
          <p>
            This scaffold gives us the first website-grade layer of the trading room: Theme
            Board, Company Board, shared contracts, API routes, and a schema ready for the full
            cloud control plane.
          </p>
          <div className="action-row">
            <Link href="/themes" className="hero-link primary">
              Open Theme Board
            </Link>
            <Link href="/companies" className="hero-link">
              Open Company Board
            </Link>
          </div>
        </article>

        <article className="panel">
          <p className="eyebrow">Next Layer</p>
          <h3>Signal Board</h3>
          <p>Queue up macro, industry, company, and price signals into one validation stream.</p>
        </article>

        <article className="panel">
          <p className="eyebrow">Execution</p>
          <h3>Plan Discipline</h3>
          <p>Create trade plans only after chain position, catalyst, and invalidation are defined.</p>
        </article>

        <article className="panel">
          <p className="eyebrow">Automation</p>
          <h3>OpenAlice Bridge</h3>
          <p>
            Later waves will let the local agent draft briefs, signal clusters, and trade plan
            proposals back into this control tower.
          </p>
        </article>
      </section>
    </AppShell>
  );
}
