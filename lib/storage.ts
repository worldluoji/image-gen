import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AspectRatio, Model } from "./minimax";

export const GENERATED_DIR = join(process.cwd(), "public", "generated");
export const HISTORY_FILE = join(process.cwd(), "data", "history.json");
export const HISTORY_MAX_ENTRIES = 50;
// 收藏位刻意少留一格：保证 appendHistory 截断时总有至少一个 unpinned 槽位，
// 新批次不会因收藏占满而被立即丢弃
export const MAX_PINNED_ENTRIES = HISTORY_MAX_ENTRIES - 1;

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

// 媒体版含 mp4，仅用于文件清理；参考图转换绝不能接受视频，故与上面分开
export const GENERATED_MEDIA_FILE_RE =
  /^\/generated\/(\d+-\d+\.(?:png|jpe?g|webp|mp4))$/;

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
  /** 收藏置顶：不参与截断，渲染时排最前 */
  pinned?: boolean;
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

const IMAGE_DATA_URL_RE =
  /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export function parseImageDataUrl(
  dataUrl: string,
): { extension: ImageExtension; bytes: Buffer } {
  const match = IMAGE_DATA_URL_RE.exec(dataUrl);
  if (!match) {
    throw new Error("仅支持 jpeg / png / webp 的 Base64 Data URL");
  }
  const extension: ImageExtension = match[1] === "jpeg" ? "jpg" : (match[1] as ImageExtension);
  return { extension, bytes: Buffer.from(match[2], "base64") };
}

/** 将图片 Data URL 落盘为规范命名文件，返回 /generated/ 本地路径 */
export async function saveDataUrlImage(
  dataUrl: string,
  timestamp: number = Date.now(),
  generatedDir: string = GENERATED_DIR,
  maxBytes: number = Number.POSITIVE_INFINITY,
): Promise<string> {
  const { extension, bytes } = parseImageDataUrl(dataUrl);
  if (bytes.length > maxBytes) {
    throw new Error(`图片体积超出上限 ${maxBytes} 字节`);
  }
  const fileName = `${timestamp}-1.${extension}`;
  await mkdir(generatedDir, { recursive: true });
  await writeFile(join(generatedDir, fileName), bytes);
  return `/generated/${fileName}`;
}

/** 续生记录：单图批次，图片即上一段视频的尾帧，模型/宽高比/风格继承来源 */
export function makeContinuationEntry(args: {
  id: string;
  createdAt: number;
  prompt: string;
  frameLocalUrl: string;
  task: PendingVideoTask;
  source: Pick<HistoryEntry, "model" | "aspectRatio" | "style">;
}): HistoryEntry {
  return {
    id: args.id,
    createdAt: args.createdAt,
    prompt: args.prompt,
    ...(args.source.style ? { style: args.source.style } : {}),
    model: args.source.model,
    aspectRatio: args.source.aspectRatio,
    n: 1,
    images: [
      {
        localUrl: args.frameLocalUrl,
        remoteUrl: "",
        pendingVideo: args.task,
      },
    ],
    failedCount: 0,
  };
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

function collectEntryFileNames(entry: HistoryEntry): string[] {
  const names: string[] = [];
  for (const img of entry.images) {
    for (const path of [img.localUrl, img.videoUrl]) {
      const match = path ? GENERATED_MEDIA_FILE_RE.exec(path) : null;
      if (match) {
        names.push(match[1]);
      }
    }
  }
  return names;
}

/** 删除落盘媒体文件：缺失容忍，失败仅告警——清理绝不能反噬已完成的历史写入 */
async function removeGeneratedFiles(
  fileNames: string[],
  generatedDir: string,
  context: string,
): Promise<void> {
  for (const name of fileNames) {
    try {
      await unlink(join(generatedDir, name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`${context}：文件 ${name} 清理失败`, err);
      }
    }
  }
}

export async function appendHistory(
  entry: HistoryEntry,
  historyFile: string = HISTORY_FILE,
  maxEntries: number = HISTORY_MAX_ENTRIES,
  generatedDir: string = GENERATED_DIR,
): Promise<HistoryEntry[]> {
  let existing: HistoryEntry[] = [];
  try {
    existing = await readHistory(historyFile);
  } catch {
    // 损坏文件不阻断新记录，直接重建
  }
  const combined = [entry, ...existing];
  // 保留 = 全部 pinned + 最新 unpinned 补至 maxEntries；按遍历分池，存储数组维持时间倒序
  const unpinnedKeep = Math.max(maxEntries - combined.filter((e) => e.pinned).length, 0);
  const next: HistoryEntry[] = [];
  const truncated: HistoryEntry[] = [];
  let keptUnpinned = 0;
  for (const e of combined) {
    if (e.pinned || keptUnpinned < unpinnedKeep) {
      if (!e.pinned) keptUnpinned++;
      next.push(e);
    } else {
      truncated.push(e);
    }
  }
  await mkdir(join(historyFile, ".."), { recursive: true });
  await writeFile(historyFile, JSON.stringify(next, null, 2), "utf-8");
  // 先写历史后删文件：崩溃最坏留孤儿文件，反序则留下引用碎图的记录
  if (truncated.length > 0) {
    await removeGeneratedFiles(
      truncated.flatMap(collectEntryFileNames),
      generatedDir,
      "历史截断",
    );
  }
  return next;
}

/**
 * 切换历史条目收藏态。返回 false 表示条目不存在或收藏位已满；
 * 历史文件损坏时向上抛错（由路由转 500），不做静默重建。
 */
export async function setHistoryPin(
  id: string,
  pinned: boolean,
  historyFile: string = HISTORY_FILE,
): Promise<boolean> {
  const history = await readHistory(historyFile);
  const entry = history.find((e) => e.id === id);
  if (!entry) {
    return false;
  }
  if (pinned) {
    const pinnedCount = history.filter((e) => e.pinned).length;
    if (!entry.pinned && pinnedCount >= MAX_PINNED_ENTRIES) {
      return false;
    }
    entry.pinned = true;
  } else {
    delete entry.pinned;
  }
  await writeFile(historyFile, JSON.stringify(history, null, 2), "utf-8");
  return true;
}

/** 删除指定历史条目并清理其落盘图片/视频；条目不存在返回 false */
export async function deleteHistoryEntry(
  historyId: string,
  historyFile: string = HISTORY_FILE,
  generatedDir: string = GENERATED_DIR,
): Promise<boolean> {
  const history = await readHistory(historyFile);
  const index = history.findIndex((e) => e.id === historyId);
  if (index < 0) {
    return false;
  }
  const [removed] = history.splice(index, 1);
  await writeFile(historyFile, JSON.stringify(history, null, 2), "utf-8");
  await removeGeneratedFiles(
    collectEntryFileNames(removed),
    generatedDir,
    "历史删除",
  );
  return true;
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
