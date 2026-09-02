import {
  MINIMAX_BASE_URL,
  REQUEST_TIMEOUT_MS,
  baseRespError,
} from "./minimax";

export const VIDEO_GENERATION_PATH = "/v1/video_generation";
export const VIDEO_QUERY_PATH = "/v1/query/video_generation";
export const FILE_RETRIEVE_PATH = "/v1/files/retrieve";

export const VIDEO_MODEL = "MiniMax-Hailuo-2.3";

export const VIDEO_DURATIONS = [6, 10] as const;
export type VideoDuration = (typeof VIDEO_DURATIONS)[number];

export const VIDEO_RESOLUTIONS = ["768P", "1080P"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export const DEFAULT_VIDEO_DURATION: VideoDuration = 6;
export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = "768P";

// 单一事实来源：服务端校验与前端 UI 可选项均由此派生
export const RESOLUTIONS_BY_DURATION: Record<
  VideoDuration,
  readonly VideoResolution[]
> = {
  6: ["768P", "1080P"],
  10: ["768P"],
};

export const VIDEO_PROMPT_MAX_LENGTH = 2000;

export const VIDEO_STATUSES = [
  "Preparing",
  "Queueing",
  "Processing",
  "Success",
  "Fail",
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const PENDING_VIDEO_STATUSES: readonly VideoStatus[] = [
  "Preparing",
  "Queueing",
  "Processing",
];

export const VIDEO_POLL_INTERVAL_MS = 5_000;
export const VIDEO_POLL_TIMEOUT_MS = 900_000;

const FIRST_FRAME_RE =
  /^(https?:\/\/.+|data:image\/(jpeg|png|webp);base64,.+)$/;

export interface VideoTaskParams {
  prompt: string;
  duration: VideoDuration;
  resolution: VideoResolution;
  firstFrameImage: string;
}

export function validateVideoParams(params: VideoTaskParams): string | null {
  if (params.prompt.length > VIDEO_PROMPT_MAX_LENGTH) {
    return `视频描述最长 ${VIDEO_PROMPT_MAX_LENGTH} 字符，当前 ${params.prompt.length}`;
  }
  if (!(VIDEO_DURATIONS as readonly number[]).includes(params.duration)) {
    return `duration 必须是 ${VIDEO_DURATIONS.join(" / ")} 秒之一`;
  }
  if (!(VIDEO_RESOLUTIONS as readonly string[]).includes(params.resolution)) {
    return `resolution 必须是 ${VIDEO_RESOLUTIONS.join(" / ")} 之一`;
  }
  const allowedResolutions = RESOLUTIONS_BY_DURATION[params.duration];
  if (!allowedResolutions.includes(params.resolution)) {
    return `${params.duration} 秒视频仅支持 ${allowedResolutions.join(" / ")} 分辨率`;
  }
  if (
    typeof params.firstFrameImage !== "string" ||
    !FIRST_FRAME_RE.test(params.firstFrameImage)
  ) {
    return "first_frame_image 必须是 http(s) URL 或 jpeg、png、webp 的 Base64 Data URL";
  }
  return null;
}

export function buildVideoRequestBody(
  params: VideoTaskParams,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: VIDEO_MODEL,
    first_frame_image: params.firstFrameImage,
    duration: params.duration,
    resolution: params.resolution,
  };
  if (params.prompt.trim() !== "") {
    body.prompt = params.prompt;
  }
  return body;
}

export function parseCreateVideoResponse(json: unknown): string {
  const resp = json as { task_id?: string; base_resp?: { status_code?: number; status_msg?: string } };
  const baseError = baseRespError(resp.base_resp);
  if (baseError) {
    throw baseError;
  }
  if (!resp.task_id) {
    throw new Error("MiniMax 未返回 task_id");
  }
  return resp.task_id;
}

export interface VideoQueryResult {
  status: VideoStatus;
  fileId?: string;
}

export function parseQueryVideoResponse(json: unknown): VideoQueryResult {
  const resp = json as {
    status?: string;
    file_id?: string;
    base_resp?: { status_code?: number; status_msg?: string };
  };
  const baseError = baseRespError(resp.base_resp);
  if (baseError) {
    throw baseError;
  }
  const status = resp.status;
  if (!status || !(VIDEO_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`未知的视频任务状态: ${status ?? "空"}`);
  }
  const typed = status as VideoStatus;
  if (typed === "Success") {
    if (!resp.file_id) {
      throw new Error("视频任务已成功但未返回 file_id");
    }
    return { status: typed, fileId: resp.file_id };
  }
  return { status: typed };
}

export function parseRetrieveResponse(json: unknown): string {
  const resp = json as {
    file?: { download_url?: string };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  const baseError = baseRespError(resp.base_resp);
  if (baseError) {
    throw baseError;
  }
  const url = resp.file?.download_url;
  if (!url) {
    throw new Error("MiniMax 未返回视频下载地址");
  }
  return url;
}

async function requestMiniMax(
  path: string,
  init: RequestInit,
  apiKey: string,
): Promise<unknown> {
  const response = await fetch(`${MINIMAX_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`MiniMax 接口 HTTP ${response.status}`);
  }
  return response.json();
}

export async function createVideoTask(
  params: VideoTaskParams,
  apiKey: string,
): Promise<string> {
  const json = await requestMiniMax(
    VIDEO_GENERATION_PATH,
    { method: "POST", body: JSON.stringify(buildVideoRequestBody(params)) },
    apiKey,
  );
  return parseCreateVideoResponse(json);
}

export async function queryVideoTask(
  taskId: string,
  apiKey: string,
): Promise<VideoQueryResult> {
  const json = await requestMiniMax(
    `${VIDEO_QUERY_PATH}?task_id=${encodeURIComponent(taskId)}`,
    { method: "GET" },
    apiKey,
  );
  return parseQueryVideoResponse(json);
}

export async function retrieveVideoDownloadUrl(
  fileId: string,
  apiKey: string,
): Promise<string> {
  const json = await requestMiniMax(
    `${FILE_RETRIEVE_PATH}?file_id=${encodeURIComponent(fileId)}`,
    { method: "GET" },
    apiKey,
  );
  return parseRetrieveResponse(json);
}
