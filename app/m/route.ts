// La app del celular vive en /m/index.html; /m y /m/ llevan ahí (con ruta relativa, para servir igual por https desde el celular).
export function GET() {
  return new Response(null, { status: 307, headers: { Location: "/m/index.html" } });
}
