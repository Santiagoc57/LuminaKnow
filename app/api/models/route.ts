import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { listAvailableModels } from "@/lib/ai";
import { apiError } from "@/lib/http";

export async function GET() {
  try {
    await requireProfile();
    return NextResponse.json({ models: listAvailableModels() });
  } catch (error) {
    return apiError(error);
  }
}
