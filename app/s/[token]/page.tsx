import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sharedSpace } from "@/lib/space-share";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPE_LABEL: Record<string, string> = { youtube: "Video", x: "Publicación de X", reddit: "Reddit", web: "Web", image: "Imagen", pdf: "PDF", audio: "Audio", note: "Nota", palette: "Paleta" };

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const space = sharedSpace((await params).token);
  return { title: space ? `${space.name} · LUMINA` : "LUMINA", robots: { index: false, follow: false } };
}

// Espacio compartido, solo lectura: lo que alguien ve cuando le mandas el enlace.
export default async function SharedSpacePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const space = sharedSpace(token);
  if (!space) notFound();
  return <main className="share-page">
    <header className="share-head">
      <span className="share-brand"><i style={{ background: space.color }} />Espacio compartido desde LUMINA</span>
      <h1>{space.name}</h1>
      <p>{space.items.length} {space.items.length === 1 ? "cosa guardada" : "cosas guardadas"} · solo lectura</p>
    </header>
    <section className="share-grid">
      {space.items.map((item) => {
        const body = <>
          {item.hasImage && <img src={`/api/share/${token}/thumb/${item.id}`} alt="" loading="lazy" />}
          <div className="share-copy">
            <small>{TYPE_LABEL[item.type] || "Fuente"}{item.author ? ` · ${item.author}` : ""}</small>
            <strong>{item.title}</strong>
            {item.gist && <p>{item.gist}</p>}
          </div>
        </>;
        return item.url
          ? <a key={item.id} className="share-card" href={item.url} target="_blank" rel="noreferrer noopener">{body}</a>
          : <article key={item.id} className="share-card">{body}</article>;
      })}
    </section>
    <footer className="share-foot">Hecho con LUMINA · una biblioteca personal y privada</footer>
  </main>;
}
