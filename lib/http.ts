import { NextResponse } from "next/server";

export function apiError(error: unknown, fallback = "No se pudo completar la operación.") {
  const message = error instanceof Error ? error.message : fallback;
  const status = message === "UNAUTHORIZED" ? 401 : 400;
  return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Sesión requerida." : message }, { status });
}

