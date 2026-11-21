// Hall route: /hall/<id>. Server wrapper that validates the hall id
// and hands off to the interactive client component.

import { notFound } from "next/navigation"; // 404 helper
import HallView from "@/components/HallView"; // the interactive hall
import { HALLS, hallById, MAIN_HALL } from "@/lib/halls"; // hall catalogue

// Pre-render one page per known hall at build time.
export function generateStaticParams() {
  return HALLS.map((h) => ({ id: h.id })); // e.g. { id: "main-reading" }
}

// In Next 15+/16, route params arrive as a Promise.
export default async function HallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // unwrap the hall id
  const hall = hallById(id); // look it up
  if (!hall) notFound(); // unknown hall = 404
  if (hall.comingSoon) return ( // locked for now
    <div className="card narrow">
      <h1>{hall.name}</h1>
      <p className="muted">🔒 Coming soon. We’re gathering everyone in the Main Reading Hall first, so every desk you look at has company.</p>
      <div className="actions"><a className="btn sage" href={`/hall/${MAIN_HALL}`}>Go to the Main Reading Hall</a><a className="btn ghost" href="/lobby">Back to the lobby</a></div>
    </div>
  );
  return <HallView hallId={id} />; // render the hall
}
