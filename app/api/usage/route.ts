import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getMonthlyUsage } from "@/lib/ai";
import { apiError } from "@/lib/http";

export async function GET() {
  try {
    await requireProfile();
    return NextResponse.json(getMonthlyUsage());
  } catch (error) {
    return apiError(error);
  }
}

