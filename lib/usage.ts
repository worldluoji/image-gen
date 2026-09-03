import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const USAGE_FILE = join(process.cwd(), "data", "usage.json");

export type UsageKind = "images" | "videos" | "polishes";

export interface UsageDay {
  date: string;
  images: number;
  videos: number;
  polishes: number;
}

export const MAX_IMAGES_PER_DAY = 200;
export const MAX_VIDEOS_PER_DAY = 30;
// 同时打到上游的生成请求数上限，防误触连点（非鉴权，仅防滥用）
export const MAX_CONCURRENT_GENERATIONS = 2;

export function getToday(now: Date = new Date()): string {
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function emptyDay(date: string): UsageDay {
  return { date, images: 0, videos: 0, polishes: 0 };
}

/** 跨日翻篇归零、按 kind 累加；脏数据（缺失/负数/非数字）按 0 起算 */
export function applyUsage(
  json: unknown,
  dateStr: string,
  kind: UsageKind,
  n: number,
): UsageDay {
  const day = emptyDay(dateStr);
  const prev = json as Partial<UsageDay> | null;
  if (prev && prev.date === dateStr) {
    const safe = (v: unknown) =>
      Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0;
    day.images = safe(prev.images);
    day.videos = safe(prev.videos);
    day.polishes = safe(prev.polishes);
  }
  day[kind] += n;
  return day;
}

/** used + add 是否超过 max（恰好等于不算超） */
export function overQuota(used: number, add: number, max: number): boolean {
  return used + add > max;
}

async function readRaw(usageFile: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(usageFile, "utf-8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    // 损坏文件静默重建归零（同 appendHistory 对历史文件的容忍惯例）：
    // 用量仅作防误触限额，损坏重建的代价只是丢失当日计数
    return null;
  }
}

export async function readToday(usageFile: string = USAGE_FILE): Promise<UsageDay> {
  // 借 applyUsage 做翻篇与脏数据归一化，n=0 不产生累加
  const raw = await readRaw(usageFile);
  return applyUsage(raw, getToday(), "images", 0);
}

export async function recordUsage(
  kind: UsageKind,
  n: number,
  usageFile: string = USAGE_FILE,
): Promise<UsageDay> {
  const day = applyUsage(await readRaw(usageFile), getToday(), kind, n);
  await mkdir(join(usageFile, ".."), { recursive: true });
  await writeFile(usageFile, JSON.stringify(day, null, 2), "utf-8");
  return day;
}
