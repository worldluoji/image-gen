import { NextResponse } from "next/server";
import {
  PENDING_VIDEO_STATUSES,
  VIDEO_FRAME_MAX_BYTES,
  VIDEO_FRAME_MAX_MB,
  createVideoTask,
  queryVideoTask,
  retrieveVideoDownloadUrl,
  validateVideoParams,
  type VideoDuration,
  type VideoResolution,
  type VideoTaskParams,
} from "@/lib/video";
import {
  appendHistory,
  attachVideoTaskToHistory,
  attachVideoToHistory,
  clearVideoTaskFromHistory,
  isLocalGeneratedPath,
  localReferenceToDataUrl,
  makeContinuationEntry,
  parseImageDataUrl,
  readHistory,
  saveDataUrlImage,
  saveGeneratedFile,
  toLocalVideoName,
  type HistoryEntry,
} from "@/lib/storage";
import {
  MAX_CONCURRENT_GENERATIONS,
  MAX_VIDEOS_PER_DAY,
  overQuota,
  readToday,
  recordUsage,
} from "@/lib/usage";

// 模块级并发计数（仅创建任务这一步）：防误触连点而非刻意限流
let inflight = 0;

interface VideoRequestBody {
  imageFile?: string;
  lastFrameImage?: string;
  prompt: string;
  duration: VideoDuration;
  resolution: VideoResolution;
  historyId?: string;
  imageIndex?: number;
  /** 续生模式：首帧为上一段视频的尾帧截图（Data URL），服务端新建历史记录承接视频 */
  continuation?: { frameImage: string; sourceHistoryId: string };
}

function upstreamError(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "调用 MiniMax 视频接口发生未知错误";
  const isTimeout =
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError");
  return NextResponse.json(
    { error: isTimeout ? "请求 MiniMax 超时，请稍后重试" : message },
    { status: 502 },
  );
}

async function acquireQuota(): Promise<
  { ok: true; apiKey: string } | { ok: false; response: NextResponse }
> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "服务端未配置 MINIMAX_API_KEY，请在 .env.local 中填写" },
        { status: 500 },
      ),
    };
  }
  if (inflight >= MAX_CONCURRENT_GENERATIONS) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "当前使用人数较多，请稍后再试" },
        { status: 429 },
      ),
    };
  }
  const usage = await readToday();
  if (overQuota(usage.videos, 1, MAX_VIDEOS_PER_DAY)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `今日视频额度已用完（${MAX_VIDEOS_PER_DAY} 个），明天再来吧` },
        { status: 429 },
      ),
    };
  }
  return { ok: true, apiKey };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const raw = body as Partial<VideoRequestBody>;
  const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
  let params: VideoTaskParams;
  let continuationSource: HistoryEntry | null = null;

  if (raw.continuation) {
    const { frameImage, sourceHistoryId } = raw.continuation;
    // 续生也允许指定新尾帧（本地上传为 Data URL，同批图为 /generated/ 路径）
    let lastFrameImage = raw.lastFrameImage ?? "";
    if (isLocalGeneratedPath(lastFrameImage)) {
      try {
        lastFrameImage = await localReferenceToDataUrl(lastFrameImage);
      } catch (err) {
        const message = err instanceof Error ? err.message : "尾帧图片解析失败";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }
    params = {
      prompt,
      duration: raw.duration as VideoDuration,
      resolution: raw.resolution as VideoResolution,
      firstFrameImage: frameImage ?? "",
      lastFrameImage,
    };
    const invalid = validateVideoParams(params);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }
    let frameBytes: Buffer;
    try {
      frameBytes = parseImageDataUrl(frameImage).bytes;
    } catch (err) {
      const message = err instanceof Error ? err.message : "尾帧图片解析失败";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (frameBytes.length > VIDEO_FRAME_MAX_BYTES) {
      return NextResponse.json(
        { error: `尾帧图片不能超过 ${VIDEO_FRAME_MAX_MB}MB` },
        { status: 400 },
      );
    }
    const history = await readHistory();
    continuationSource =
      history.find((e) => e.id === sourceHistoryId) ?? null;
    if (!continuationSource) {
      return NextResponse.json(
        { error: "续生源历史记录不存在或已被删除" },
        { status: 400 },
      );
    }
  } else {
    let firstFrameImage = raw.imageFile ?? "";
    if (isLocalGeneratedPath(firstFrameImage)) {
      try {
        firstFrameImage = await localReferenceToDataUrl(firstFrameImage);
      } catch (err) {
        const message = err instanceof Error ? err.message : "首帧图片解析失败";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    // 尾帧可来自同批历史图（本地路径）或本地上传（已是 Data URL），仅转换本地路径
    let lastFrameImage = raw.lastFrameImage ?? "";
    if (isLocalGeneratedPath(lastFrameImage)) {
      try {
        lastFrameImage = await localReferenceToDataUrl(lastFrameImage);
      } catch (err) {
        const message = err instanceof Error ? err.message : "尾帧图片解析失败";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    params = {
      prompt,
      duration: raw.duration as VideoDuration,
      resolution: raw.resolution as VideoResolution,
      firstFrameImage,
      lastFrameImage,
    };
    const invalid = validateVideoParams(params);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }
    if (!raw.historyId) {
      return NextResponse.json({ error: "缺少 historyId 参数" }, { status: 400 });
    }
    if (!Number.isInteger(raw.imageIndex) || (raw.imageIndex ?? -1) < 0) {
      return NextResponse.json(
        { error: "imageIndex 必须是非负整数" },
        { status: 400 },
      );
    }
  }

  const quota = await acquireQuota();
  if (!quota.ok) {
    return quota.response;
  }
  const { apiKey } = quota;

  inflight++;
  try {
    const taskId = await createVideoTask(params, apiKey);
    if (raw.continuation) {
      const startedAt = Date.now();
      const frameUrl = await saveDataUrlImage(
        raw.continuation.frameImage,
        startedAt,
      );
      const entry = makeContinuationEntry({
        id: crypto.randomUUID(),
        createdAt: startedAt,
        prompt,
        frameLocalUrl: frameUrl,
        task: { taskId, startedAt },
        source: continuationSource!,
      });
      // 历史写入失败只影响刷新恢复，不推翻已创建的任务（与图生视频同策略）
      try {
        await appendHistory(entry);
      } catch (err) {
        console.warn(`续生视频任务已创建但写入历史失败: ${entry.id}`, err);
      }
      return NextResponse.json({
        taskId,
        historyId: entry.id,
        imageIndex: 0,
        frameUrl,
      });
    }
    // 持久化进行中任务供刷新恢复；挂载失败（如条目被截断）不影响本次任务创建
    const attached = await attachVideoTaskToHistory(raw.historyId!, raw.imageIndex!, {
      taskId,
      startedAt: Date.now(),
    });
    if (!attached) {
      console.warn("视频任务已创建但未能挂载到历史，刷新后将无法恢复轮询");
    }
    return NextResponse.json({ taskId });
  } catch (err) {
    return upstreamError(err);
  } finally {
    inflight--;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");
  const historyId = searchParams.get("historyId");
  const imageIndexRaw = searchParams.get("imageIndex");
  const imageIndex = Number(imageIndexRaw);
  if (!taskId || !historyId) {
    return NextResponse.json(
      { error: "缺少 taskId 或 historyId 参数" },
      { status: 400 },
    );
  }
  if (!Number.isInteger(imageIndex) || imageIndex < 0) {
    return NextResponse.json(
      { error: "imageIndex 必须是非负整数" },
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
    const result = await queryVideoTask(taskId, apiKey);
    if (PENDING_VIDEO_STATUSES.includes(result.status)) {
      return NextResponse.json({ status: result.status });
    }
    if (result.status === "Fail") {
      await clearVideoTaskFromHistory(historyId, imageIndex);
      return NextResponse.json({
        status: "Fail",
        error: "视频生成失败，请调整描述后重试",
      });
    }

    // Success：download_url 仅 1 小时有效，立即下载落盘并写回历史
    const downloadUrl = await retrieveVideoDownloadUrl(result.fileId!, apiKey);
    const fileName = toLocalVideoName(imageIndex + 1, Date.now());
    const saved = await saveGeneratedFile(downloadUrl, fileName);
    if (!saved) {
      return NextResponse.json(
        { error: "视频下载失败，请重试" },
        { status: 502 },
      );
    }
    const videoUrl = `/generated/${fileName}`;
    try {
      // 只在成功挂载历史时计一次数：避免下载/写入重试导致重复计数
      const attached = await attachVideoToHistory(historyId, imageIndex, videoUrl);
      if (attached) {
        await recordUsage("videos", 1);
      }
    } catch {
      // 历史写入失败不影响本次视频返回
      console.warn(`视频已保存但写入历史失败: ${videoUrl}`);
    }
    return NextResponse.json({ status: "Success", videoUrl });
  } catch (err) {
    return upstreamError(err);
  }
}
