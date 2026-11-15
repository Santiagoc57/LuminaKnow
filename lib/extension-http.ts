import { NextResponse } from "next/server";
import { apiError } from "./http";

function extensionOrigin(request: Request) {
  const origin = request.headers.get("origin") || "";
  return /^(chrome-extension|moz-extension):\/\//.test(origin) ? origin : "";
}

export function withExtensionCors(request: Request, response: NextResponse) {
  const origin = extensionOrigin(request);
  if (origin) response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Lumina-Token");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Max-Age", "86400");
  response.headers.set("Vary", "Origin");
  return response;
}

export function extensionJson(request: Request, body: unknown, init?: ResponseInit) {
  return withExtensionCors(request, NextResponse.json(body, init));
}

export function extensionError(request: Request, error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return withExtensionCors(request, NextResponse.json({ error: "Código de conexión inválido o revocado." }, { status: 401 }));
  }
  return withExtensionCors(request, apiError(error));
}

export function extensionOptions(request: Request) {
  return withExtensionCors(request, new NextResponse(null, { status: 204 }));
}
