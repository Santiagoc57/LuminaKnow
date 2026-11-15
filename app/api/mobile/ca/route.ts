import fs from "node:fs";
import { NextResponse } from "next/server";
import { caCertPath } from "@/lib/mobile-https";

export const runtime = "nodejs";

// El certificado público de LUMINA para instalar en el celular. No contiene nada secreto.
export function GET() {
  if (!fs.existsSync(caCertPath)) return NextResponse.json({ error: "El certificado aún no existe. Reinicia LUMINA." }, { status: 404 });
  return new NextResponse(fs.readFileSync(caCertPath), { headers: { "Content-Type": "application/x-x509-ca-cert", "Content-Disposition": "attachment; filename=\"lumina-casa.crt\"" } });
}
