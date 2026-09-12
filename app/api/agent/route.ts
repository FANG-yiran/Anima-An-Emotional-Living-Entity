import { NextResponse } from "next/server";
import type { AgentPayload, LLMResult } from "@/lib/llm";
import { generateWithLLM } from "@/lib/llm";

// 强制使用 Node.js 运行时，以便访问 process.env
export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: AgentPayload;
  try {
    payload = (await request.json()) as AgentPayload;
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const result: LLMResult | null = await generateWithLLM(payload);
  return NextResponse.json({ fallback: result === null, ...(result ?? {}) });
}
