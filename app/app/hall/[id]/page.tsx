// Hall route: /hall/<id>. Server wrapper that validates the hall id
// and hands off to the interactive client component.

import { notFound } from "next/navigation"; // 404 helper
import HallView from "@/components/HallView"; // the interactive hall
import { HALLS, hallById } from "@/lib/halls"; // hall catalogue

// Pre-render one page per known hall at build time.
export function generateStaticParams() {
  return HALLS.map((h) => ({ id: h.id })); // e.g. { id: "main-reading" }
}

// In Next 15+/16, route params arrive as a Promise.
export default async function HallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // unwrap the hall id
  if (!hallById(id)) notFound(); // unknown hall = 404
  return <HallView hallId={id} />; // render the hall
}
