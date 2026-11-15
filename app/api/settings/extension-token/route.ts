import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createExtensionToken, hasExtensionToken, revokeExtensionToken } from "@/lib/extension-auth";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const profile = await requireProfile();
    return NextResponse.json({ connected: hasExtensionToken(profile.id) });
  } catch (error) { return apiError(error); }
}

export async function POST() {
  try {
    const profile = await requireProfile();
    return NextResponse.json({ token: createExtensionToken(profile.id), connected: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE() {
  try {
    const profile = await requireProfile();
    revokeExtensionToken(profile.id);
    return NextResponse.json({ connected: false });
  } catch (error) { return apiError(error); }
}
