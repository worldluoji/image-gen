import { NextResponse } from "next/server";
import {
  generateImages,
  validateParams,
  type GenerationParams,
} from "@/lib/minimax";
import {
  appendHistory,
  isLocalGeneratedPath,
  localReferenceToDataUrl,
  saveGeneratedFile,
  toLocalImageName,
  type GeneratedImage,
  type HistoryEntry,
} from "@/lib/storage";

async function resolveSubjectReferences(
  params: GenerationParams,
): Promise<GenerationParams> {
  if (!params.subjectReference) {
    return params;
  }
  const resolved = await Promise.all(
    params.subjectReference.map(async (ref) => {
      if (!isLocalGeneratedPath(ref.imageFile)) {
        return ref;
      }
      return { ...ref, imageFile: await localReferenceToDataUrl(ref.imageFile) };
    }),
  );
  return { ...params, subjectReference: resolved };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const rawParams = body as Partial<GenerationParams>;
  let params: GenerationParams;
  try {
    params = await resolveSubjectReferences(rawParams as GenerationParams);
  } catch (err) {
    const message = err instanceof Error ? err.message : "参考图解析失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const invalid = validateParams(params);
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
    const result = await generateImages(params, apiKey);

    // 上游 URL 仅 24h 有效，逐张落盘；单张失败回退远端 URL，不阻断整批
    const timestamp = Date.now();
    const images: GeneratedImage[] = await Promise.all(
      result.imageUrls.map(async (remoteUrl, i) => {
        const fileName = toLocalImageName(remoteUrl, i + 1, timestamp);
        const saved = await saveGeneratedFile(remoteUrl, fileName);
        return {
          localUrl: saved ? `/generated/${fileName}` : remoteUrl,
          remoteUrl,
        };
      }),
    );

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      createdAt: timestamp,
      prompt: params.prompt,
      ...(params.style ? { style: params.style } : {}),
      model: params.model,
      aspectRatio: params.aspectRatio,
      n: params.n,
      images,
      failedCount: result.failedCount,
    };
    await appendHistory(entry);

    return NextResponse.json({
      images,
      successCount: result.successCount,
      failedCount: result.failedCount,
      historyId: entry.id,
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
