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

export interface GeneratedImage {
  localUrl: string;
  remoteUrl: string;
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

export async function saveGeneratedImage(
  remoteUrl: string,
  fileName: string,
  generatedDir: string = GENERATED_DIR,
): Promise<boolean> {
  try {
    const response = await fetch(remoteUrl, { cache: "no-store" });
    if (!response.ok) {
      console.error(
        `下载生成图片失败 HTTP ${response.status}: ${remoteUrl}`,
      );
      return false;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await mkdir(generatedDir, { recursive: true });
    await writeFile(join(generatedDir, fileName), buffer);
    return true;
  } catch (err) {
    console.error(`下载生成图片异常: ${remoteUrl}`, err);
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
