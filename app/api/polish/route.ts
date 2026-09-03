import { NextResponse } from "next/server";
import { PROMPT_MAX_LENGTH } from "@/lib/minimax";
import { polishPrompt } from "@/lib/polish";
import { recordUsage } from "@/lib/usage";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const prompt = (body as { prompt?: unknown }).prompt;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return NextResponse.json({ error: "prompt 不能为空" }, { status: 400 });
  }
  if (prompt.length > PROMPT_MAX_LENGTH) {
    return NextResponse.json(
      { error: `prompt 最长 ${PROMPT_MAX_LENGTH} 字符，当前 ${prompt.length}` },
      { status: 400 },
    );
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 MINIMAX_API_KEY，请在 .env.local 中填写" },
      { status: 500 },
    );
  }

  try {
    const polished = await polishPrompt(prompt, apiKey);
    await recordUsage("polishes", 1);
    return NextResponse.json({ prompt: polished });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "调用 MiniMax 接口发生未知错误";
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    return NextResponse.json(
      { error: isTimeout ? "润色超时，请稍后重试" : message },
      { status: 502 },
    );
  }
}
