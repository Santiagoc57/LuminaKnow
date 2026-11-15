import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { semanticSearch } from "@/lib/semantic-search";

export async function GET(request: Request) {
  try {
    await requireProfile();
    const query = new URL(request.url).searchParams.get("q") || "";
    return NextResponse.json({ query, hits: await semanticSearch(query) });
  } catch (error) {
    return apiError(error);
  }
}
