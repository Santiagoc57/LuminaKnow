import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getGeminiKey, getOpenAIKey, setGeminiKey, setOpenAIKey } from "@/lib/secrets";
import { getAIProvider, getMonthlyUsage, hasAIKey } from "@/lib/ai";
import { apiError } from "@/lib/http";
import { hasExtensionToken } from "@/lib/extension-auth";

export async function GET() {
  try {
    const profile = await requireProfile();
    return NextResponse.json({ hasAiKey: hasAIKey(), aiProvider: getAIProvider(), hasGeminiKey: Boolean(getGeminiKey()), hasOpenAIKey: Boolean(getOpenAIKey()), extensionConnected: hasExtensionToken(profile.id), usage: getMonthlyUsage() });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireProfile();
    const data = z.object({
      geminiApiKey: z.string().trim().optional(),
      openaiApiKey: z.string().trim().optional(),
      monthlyBudget: z.number().min(1).max(100).optional(),
    }).parse(await request.json());
    if (data.geminiApiKey !== undefined) setGeminiKey(data.geminiApiKey);
    if (data.openaiApiKey !== undefined) setOpenAIKey(data.openaiApiKey);
    if (data.monthlyBudget !== undefined) {
      getDb().prepare("INSERT INTO settings(key, value) VALUES('monthly_budget_usd', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(data.monthlyBudget));
    }
    return NextResponse.json({ hasAiKey: hasAIKey(), aiProvider: getAIProvider(), hasGeminiKey: Boolean(getGeminiKey()), hasOpenAIKey: Boolean(getOpenAIKey()), usage: getMonthlyUsage() });
  } catch (error) {
    return apiError(error);
  }
}
