import { NextResponse } from "next/server";
import {
  textToImage,
  validateParams,
  type TextToImageParams,
} from "@/lib/minimax";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const params = body as Partial<TextToImageParams>;
  const invalid = validateParams(params as TextToImageParams);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 MINIMAX_API_KEY，请在 .env.local 中填写" },
      { status: 500 },
    );
  }

  try {
    const result = await textToImage(params as TextToImageParams, apiKey);
    return NextResponse.json({
      images: result.imageUrls,
      successCount: result.successCount,
      failedCount: result.failedCount,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "调用 MiniMax 接口发生未知错误";
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    return NextResponse.json(
      { error: isTimeout ? "生成超时，请稍后重试" : message },
      { status: 502 },
    );
  }
}
