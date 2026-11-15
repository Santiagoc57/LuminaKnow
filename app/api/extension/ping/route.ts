import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";

export const runtime = "nodejs";

export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function GET(request: Request) {
  try {
    const profile = requireExtensionProfile(request);
    return extensionJson(request, { ok: true, profile: { name: profile.name } });
  } catch (error) { return extensionError(request, error); }
}
