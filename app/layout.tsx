import type { Metadata } from "next";
import "./globals.css";
import "./dark.generated.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.LUMINA_BASE_URL || "http://localhost:3000"),
  title: "Lúmina — Tu biblioteca de conocimiento",
  description: "Guarda, comprende y conversa con videos y publicaciones que vale la pena recordar.",
  openGraph: {
    title: "Lúmina — Tu biblioteca de conocimiento",
    description: "Las ideas que sí importan.",
    images: [{ url: "/og.png", width: 1672, height: 941, alt: "Lúmina, las ideas que sí importan" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lúmina — Tu biblioteca de conocimiento",
    description: "Las ideas que sí importan.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Aplica el tema antes de pintar para que no parpadee: el elegido, o el del sistema. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("lumina-theme");if(!t||t==="auto")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
