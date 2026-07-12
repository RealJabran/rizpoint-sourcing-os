import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>RizPoint Sourcing OS</h1>
      <p>
        Phase 0 foundation: durable mock scan processing with auditable
        persisted status.
      </p>
      <Link href="/mock-scans">Run the mock scan vertical slice</Link>
    </main>
  );
}
