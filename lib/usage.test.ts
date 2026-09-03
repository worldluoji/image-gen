import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_IMAGES_PER_DAY,
  MAX_VIDEOS_PER_DAY,
  applyUsage,
  emptyDay,
  getToday,
  overQuota,
  readToday,
  recordUsage,
  type UsageDay,
} from "./usage";

describe("getToday", () => {
  const cases = [
    { name: "月/日补零", now: new Date(2026, 8, 3, 10, 0), want: "2026-09-03" },
    { name: "跨年", now: new Date(2025, 11, 31, 23, 59), want: "2025-12-31" },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(getToday(c.now)).toBe(c.want);
    });
  }
});

describe("applyUsage", () => {
  const cases: {
    name: string;
    json: unknown;
    date: string;
    kind: "images" | "videos" | "polishes";
    n: number;
    want: UsageDay;
  }[] = [
    {
      name: "null（文件缺失/损坏）当日归零后累加",
      json: null,
      date: "2026-09-03",
      kind: "images",
      n: 3,
      want: { date: "2026-09-03", images: 3, videos: 0, polishes: 0 },
    },
    {
      name: "非法 JSON 对象同样归零",
      json: { nonsense: true },
      date: "2026-09-03",
      kind: "polishes",
      n: 1,
      want: { date: "2026-09-03", images: 0, videos: 0, polishes: 1 },
    },
    {
      name: "翻篇：旧日期计数清零，只记新的一天",
      json: {
        date: "2026-09-02",
        images: 180,
        videos: 25,
        polishes: 9,
      },
      date: "2026-09-03",
      kind: "videos",
      n: 1,
      want: { date: "2026-09-03", images: 0, videos: 1, polishes: 0 },
    },
    {
      name: "同日累加且不影响其他项",
      json: {
        date: "2026-09-03",
        images: 10,
        videos: 2,
        polishes: 5,
      },
      date: "2026-09-03",
      kind: "images",
      n: 4,
      want: { date: "2026-09-03", images: 14, videos: 2, polishes: 5 },
    },
    {
      name: "计数含负数脏数据时按 0 起算",
      json: { date: "2026-09-03", images: -5, videos: 1, polishes: 0 },
      date: "2026-09-03",
      kind: "videos",
      n: 1,
      want: { date: "2026-09-03", images: 0, videos: 2, polishes: 0 },
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(applyUsage(c.json, c.date, c.kind, c.n)).toEqual(c.want);
    });
  }
});

describe("overQuota", () => {
  const cases = [
    { name: "未超", used: 10, add: 5, max: 200, want: false },
    { name: "恰好达到上限仍放行", used: 195, add: 5, max: 200, want: false },
    { name: "超出 1 即拒绝", used: 200, add: 1, max: 200, want: true },
    { name: "单请求超限量", used: 0, add: 31, max: MAX_VIDEOS_PER_DAY, want: true },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(overQuota(c.used, c.add, c.max)).toBe(c.want);
    });
  }
});

describe("限额常量", () => {
  it("均为正整数", () => {
    for (const v of [MAX_IMAGES_PER_DAY, MAX_VIDEOS_PER_DAY]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });
});

describe("recordUsage / readToday", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-gen-usage-"));
    file = join(dir, "usage.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("文件不存在时 readToday 返回当日全 0", async () => {
    expect(await readToday(file)).toEqual(emptyDay(getToday()));
  });

  it("recordUsage 多次调用同日累加并可读回", async () => {
    await recordUsage("images", 2, file);
    const day = await recordUsage("polishes", 1, file);
    expect(day.images).toBe(2);
    expect(day.polishes).toBe(1);
    expect(await readToday(file)).toEqual(day);
  });

  it("损坏文件静默重建归零（个人工具容忍）", async () => {
    await writeFile(file, "{ broken");
    const day = await recordUsage("videos", 1, file);
    expect(day).toEqual({ ...emptyDay(day.date), videos: 1 });
  });

  it("旧日期数据在 readToday 中显示为全 0", async () => {
    await writeFile(
      file,
      JSON.stringify({ date: "2000-01-01", images: 999, videos: 9, polishes: 9 }),
    );
    expect(await readToday(file)).toEqual(emptyDay(getToday()));
  });

  it("recordUsage 写入的是当日日期", async () => {
    const day = await recordUsage("images", 1, file);
    expect(day.date).toBe(getToday());
  });
});
