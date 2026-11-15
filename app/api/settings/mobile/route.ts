import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { hasExtensionToken, revokeExtensionToken } from "@/lib/extension-auth";
import { apiError } from "@/lib/http";
import { mobileHttpsStatus } from "@/lib/mobile-https";
import { createPairCode } from "@/lib/mobile-pair";

export const runtime = "nodejs";

function status(profileId: string) {
  const https = mobileHttpsStatus();
  const address = https.addresses[0] || "";
  return {
    connected: hasExtensionToken(profileId, "mobile"),
    https,
    appUrl: address ? `https://${address}:${https.port}/m/index.html` : "",
    certUrl: address ? `http://${address}:${process.env.PORT || 3000}/api/mobile/ca` : "",
  };
}

export async function GET() {
  try { const profile = await requireProfile(); return NextResponse.json(status(profile.id)); } catch (error) { return apiError(error); }
}

export async function POST() {
  try { const profile = await requireProfile(); return NextResponse.json({ ...status(profile.id), ...createPairCode(profile.id) }); } catch (error) { return apiError(error); }
}

export async function DELETE() {
  try { const profile = await requireProfile(); revokeExtensionToken(profile.id, "mobile"); return NextResponse.json(status(profile.id)); } catch (error) { return apiError(error); }
}
