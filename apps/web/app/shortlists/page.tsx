"use client";
import { useEffect, useState } from "react";

type Shortlist = {
  id: string;
  name: string;
  status: string;
  _count: { items: number };
};
export default function ShortlistsPage() {
  const [lists, setLists] = useState<Shortlist[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    const response = await fetch("/api/shortlists");
    if (response.ok) setLists((await response.json()) as Shortlist[]);
    else setError("Could not load shortlists.");
  };
  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/shortlists");
      if (response.ok) setLists((await response.json()) as Shortlist[]);
      else setError("Could not load shortlists.");
    })();
  }, []);
  const create = async () => {
    setError("");
    const response = await fetch("/api/shortlists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, idempotencyKey: crypto.randomUUID() }),
    });
    if (!response.ok) {
      setError("Could not create shortlist.");
      return;
    }
    setName("");
    await load();
  };
  return (
    <main>
      <h1>Shortlists</h1>
      <p>
        Research, review, and prepare eligible products for a purchase order.
      </p>
      <label>
        Name{" "}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
        />
      </label>
      <button
        type="button"
        onClick={() => void create()}
        disabled={!name.trim()}
      >
        Create shortlist
      </button>
      {error ? <p role="alert">{error}</p> : null}
      <section aria-live="polite">
        {lists.length ? (
          <ul>
            {lists.map((list) => (
              <li key={list.id}>
                <a href={`/shortlists/${list.id}`}>{list.name}</a> —{" "}
                {list.status}, {list._count.items} items
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No shortlists yet. Select analysis results and add them to a new
            shortlist.
          </p>
        )}
      </section>
    </main>
  );
}
