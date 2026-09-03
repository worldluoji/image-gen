import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AspectRatio, Model } from "./minimax";

export const GENERATED_DIR = join(process.cwd(), "public", "generated");
export const HISTORY_FILE = join(process.cwd(), "data", "history.json");
export const HISTORY_MAX_ENTRIES = 50;

const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;
type ImageExtension = (typeof ALLOWED_EXTENSIONS)[number];
const DEFAULT_EXTENSION: ImageExtension = "png";

const EXTENSION_MIME: Record<ImageExtension, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// 严格匹配 <时间戳>-<序号>.<扩展名>，天然排除路径穿越与非法字符
const GENERATED_FILE_RE = /^\/generated\/(\d+-\d+\.(?:png|jpe?g|webp))$/;

export const GENERATED_VIDEO_EXTENSION = "mp4";

export interface PendingVideoTask {
  taskId: string;
  startedAt: number;
}

export interface GeneratedImage {
  localUrl: string;
  remoteUrl: string;
  /** 由本图生成的视频（本地落盘路径），重复生成则覆盖 */
  videoUrl?: string;
  /** 进行中的视频任务，成功后被清除；用于刷新页面后恢复轮询 */
  pendingVideo?: PendingVideoTask;
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  prompt: string;
  style?: string;
  model: Model;
  aspectRatio: AspectRatio;
  n: number;
  images: GeneratedImage[];
  failedCount: number;
}

function extensionFromUrl(url: string): ImageExtension {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return DEFAULT_EXTENSION;
  }
  const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
  const ext = match?.[1]?.toLowerCase();
  if (ext && (ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return ext as ImageExtension;
  }
  return DEFAULT_EXTENSION;
}

export function toLocalImageName(
  remoteUrl: string,
  index: number,
  timestamp: number,
): string {
  return `${timestamp}-${index}.${extensionFromUrl(remoteUrl)}`;
}

export function toLocalVideoName(index: number, timestamp: number): string {
  return `${timestamp}-${index}.${GENERATED_VIDEO_EXTENSION}`;
}

export async function saveGeneratedFile(
  remoteUrl: string,
  fileName: string,
  generatedDir: string = GENERATED_DIR,
): Promise<boolean> {
  try {
    const response = await fetch(remoteUrl, { cache: "no-store" });
    if (!response.ok) {
      console.error(
        `下载生成文件失败 HTTP ${response.status}: ${remoteUrl}`,
      );
      return false;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await mkdir(generatedDir, { recursive: true });
    await writeFile(join(generatedDir, fileName), buffer);
    return true;
  } catch (err) {
    console.error(`下载生成文件异常: ${remoteUrl}`, err);
    return false;
  }
}

export function isLocalGeneratedPath(path: string): boolean {
  return GENERATED_FILE_RE.test(path);
}

export async function localReferenceToDataUrl(
  path: string,
  generatedDir: string = GENERATED_DIR,
): Promise<string> {
  const match = GENERATED_FILE_RE.exec(path);
  if (!match) {
    throw new Error("参考图路径不合法，仅允许本系统生成的图片");
  }
  const fileName = match[1];
  let buffer: Buffer;
  try {
    buffer = await readFile(join(generatedDir, fileName));
  } catch {
    throw new Error(`参考图文件不存在或已被清理: ${fileName}`);
  }
  const ext = (fileName.match(/\.([a-zA-Z0-9]+)$/)?.[1] ??
    DEFAULT_EXTENSION) as ImageExtension;
  return `data:${EXTENSION_MIME[ext]};base64,${buffer.toString("base64")}`;
}

export async function readHistory(historyFile: string = HISTORY_FILE): Promise<HistoryEntry[]> {
  let raw: string;
  try {
    raw = await readFile(historyFile, "utf-8");
  } catch {
    return [];
  }
  try {
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    throw new Error("历史记录文件已损坏，请删除 data/history.json 后重试");
  }
}

export async function appendHistory(
  entry: HistoryEntry,
  historyFile: string = HISTORY_FILE,
  maxEntries: number = HISTORY_MAX_ENTRIES,
): Promise<HistoryEntry[]> {
  let existing: HistoryEntry[] = [];
  try {
    existing = await readHistory(historyFile);
  } catch {
    // 损坏文件不阻断新记录，直接重建
  }
  const next = [entry, ...existing].slice(0, maxEntries);
  await mkdir(join(historyFile, ".."), { recursive: true });
  await writeFile(historyFile, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

/** 找到指定历史条目的指定图片并修改，命中才写回文件；找不到或序号非法时返回 false，不抛错 */
async function mutateHistoryImage(
  historyId: string,
  imageIndex: number,
  historyFile: string,
  mutate: (image: GeneratedImage) => void,
  warnOnMiss: string,
): Promise<boolean> {
  const history = await readHistory(historyFile);
  const entry = history.find((e) => e.id === historyId);
  const image =
    Number.isInteger(imageIndex) && imageIndex >= 0
      ? entry?.images?.[imageIndex]
      : undefined;
  if (!image) {
    console.warn(`${warnOnMiss}：条目 ${historyId} 或图片序号 ${imageIndex} 不存在（可能已被截断）`);
    return false;
  }
  mutate(image);
  await writeFile(historyFile, JSON.stringify(history, null, 2), "utf-8");
  return true;
}

/** 将视频 localUrl 挂到指定历史条目的指定图片上，并清除其 pendingVideo */
export async function attachVideoToHistory(
  historyId: string,
  imageIndex: number,
  videoLocalUrl: string,
  historyFile: string = HISTORY_FILE,
): Promise<boolean> {
  return mutateHistoryImage(
    historyId,
    imageIndex,
    historyFile,
    (image) => {
      image.videoUrl = videoLocalUrl;
      delete image.pendingVideo;
    },
    "挂载视频到历史失败",
  );
}

/** 将进行中的视频任务挂到指定历史条目的指定图片上，供前端刷新后恢复轮询 */
export async function attachVideoTaskToHistory(
  historyId: string,
  imageIndex: number,
  task: PendingVideoTask,
  historyFile: string = HISTORY_FILE,
): Promise<boolean> {
  return mutateHistoryImage(
    historyId,
    imageIndex,
    historyFile,
    (image) => {
      image.pendingVideo = task;
    },
    "挂载视频任务到历史失败",
  );
}

/** 清除指定历史条目图片上的 pendingVideo（任务失败时调用） */
export async function clearVideoTaskFromHistory(
  historyId: string,
  imageIndex: number,
  historyFile: string = HISTORY_FILE,
): Promise<boolean> {
  return mutateHistoryImage(
    historyId,
    imageIndex,
    historyFile,
    (image) => {
      delete image.pendingVideo;
    },
    "清除历史视频任务失败",
  );
}
