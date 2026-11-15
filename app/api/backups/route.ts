import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createBackup } from "@/lib/backup";
import { apiError } from "@/lib/http";

export async function POST() {
  try {
    await requireProfile();
    await createBackup();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

