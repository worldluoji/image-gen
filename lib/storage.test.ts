import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HISTORY_MAX_ENTRIES,
  appendHistory,
  attachVideoTaskToHistory,
  attachVideoToHistory,
  clearVideoTaskFromHistory,
  isLocalGeneratedPath,
  localReferenceToDataUrl,
  readHistory,
  toLocalImageName,
  toLocalVideoName,
  type HistoryEntry,
} from "./storage";

const TIMESTAMP = 1700000000000;

describe("toLocalImageName", () => {
  const cases = [
    {
      name: "标准 png URL",
      url: "https://cdn.example.com/a/b/img.png",
      index: 1,
      want: "1700000000000-1.png",
    },
    {
      name: "带 query string 的 URL 仍取到扩展名",
      url: "https://cdn.example.com/img.jpg?token=abc&x=1",
      index: 2,
      want: "1700000000000-2.jpg",
    },
    {
      name: "大写扩展名归一为小写",
      url: "https://cdn.example.com/img.PNG",
      index: 3,
      want: "1700000000000-3.png",
    },
    {
      name: "无扩展名默认 png",
      url: "https://cdn.example.com/download",
      index: 1,
      want: "1700000000000-1.png",
    },
    {
      name: "非白名单扩展名回退 png",
      url: "https://cdn.example.com/img.gif",
      index: 1,
      want: "1700000000000-1.png",
    },
    {
      name: "webp 保留",
      url: "https://cdn.example.com/img.webp",
      index: 9,
      want: "1700000000000-9.webp",
    },
    {
      name: "非法 URL 输入不抛错，回退 png",
      url: "not a url !!!",
      index: 1,
      want: "1700000000000-1.png",
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(toLocalImageName(c.url, c.index, TIMESTAMP)).toBe(c.want);
    });
  }
});

describe("isLocalGeneratedPath", () => {
  const cases = [
    { name: "合法路径", path: "/generated/1700000000000-1.png", want: true },
    { name: "webp 扩展名", path: "/generated/1700000000000-2.webp", want: true },
    { name: "非 generated 前缀", path: "/other/x.png", want: false },
    { name: "相对路径穿越", path: "../etc/passwd", want: false },
    { name: "generated 内穿越", path: "/generated/../secret.png", want: false },
    { name: "文件名非法", path: "/generated/evil name.png", want: false },
    { name: "非图片扩展名", path: "/generated/1-1.sh", want: false },
    { name: "空字符串", path: "", want: false },
    { name: "http URL 不算本地路径", path: "http://localhost:3001/generated/1-1.png", want: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(isLocalGeneratedPath(c.path)).toBe(c.want);
    });
  }
});

describe("localReferenceToDataUrl", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-gen-storage-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("合法 png 文件转为 data URL", async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(join(dir, "1700000000000-1.png"), pngBytes);
    const dataUrl = await localReferenceToDataUrl(
      "/generated/1700000000000-1.png",
      dir,
    );
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(dataUrl).toBe(
      `data:image/png;base64,${pngBytes.toString("base64")}`,
    );
  });

  it("webp 映射正确的 MIME", async () => {
    await writeFile(join(dir, "1700000000000-1.webp"), Buffer.from("RIFF"));
    const dataUrl = await localReferenceToDataUrl(
      "/generated/1700000000000-1.webp",
      dir,
    );
    expect(dataUrl.startsWith("data:image/webp;base64,")).toBe(true);
  });

  it("文件不存在时抛出显式错误", async () => {
    await expect(
      localReferenceToDataUrl("/generated/0-1.png", dir),
    ).rejects.toThrow(/不存在/);
  });

  const badPaths = [
    "/etc/passwd",
    "/generated/../outside.png",
    "/generated/evil name.png",
    "http://localhost/x.png",
  ];
  for (const p of badPaths) {
    it(`非法路径 ${p} 被拒绝`, async () => {
      await expect(localReferenceToDataUrl(p, dir)).rejects.toThrow(/参考图路径不合法/);
    });
  }
});

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "entry-1",
    createdAt: 1700000000000,
    prompt: "一只猫",
    model: "image-01",
    aspectRatio: "1:1",
    n: 1,
    images: [{ localUrl: "/generated/1.png", remoteUrl: "https://x/1.png" }],
    failedCount: 0,
    ...overrides,
  };
}

describe("readHistory / appendHistory", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-gen-history-"));
    file = join(dir, "history.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("文件不存在时返回空数组", async () => {
    expect(await readHistory(file)).toEqual([]);
  });

  it("追加后按最新在前返回，并能持久化读回", async () => {
    await appendHistory(makeEntry({ id: "a" }), file, 50);
    await appendHistory(makeEntry({ id: "b" }), file, 50);
    const history = await readHistory(file);
    expect(history.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("超过 maxEntries 时截断最旧记录", async () => {
    const max = 3;
    for (let i = 0; i < max + 2; i++) {
      await appendHistory(makeEntry({ id: `e${i}` }), file, max);
    }
    const history = await readHistory(file);
    expect(history).toHaveLength(max);
    expect(history[0].id).toBe(`e${max + 1}`);
    expect(history.map((e) => e.id)).toEqual(["e4", "e3", "e2"]);
  });

  it("损坏的 history 文件读取时抛出显式错误", async () => {
    await writeFile(file, "{ not json");
    await expect(readHistory(file)).rejects.toThrow(/历史/);
  });

  it("HISTORY_MAX_ENTRIES 为正整数常量", () => {
    expect(Number.isInteger(HISTORY_MAX_ENTRIES)).toBe(true);
    expect(HISTORY_MAX_ENTRIES).toBeGreaterThan(0);
  });
});

describe("toLocalVideoName", () => {
  const cases = [
    { index: 1, want: "1700000000000-1.mp4" },
    { index: 2, want: "1700000000000-2.mp4" },
    { index: 9, want: "1700000000000-9.mp4" },
  ];
  for (const c of cases) {
    it(`序号 ${c.index} 生成 ${c.want}`, () => {
      expect(toLocalVideoName(c.index, TIMESTAMP)).toBe(c.want);
    });
  }
});

describe("attachVideoToHistory", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-gen-attach-"));
    file = join(dir, "history.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("成功挂载 videoUrl 并可读回", async () => {
    await appendHistory(
      makeEntry({
        id: "h1",
        images: [
          { localUrl: "/generated/1-1.png", remoteUrl: "https://x/1.png" },
          { localUrl: "/generated/1-2.png", remoteUrl: "https://x/2.png" },
        ],
      }),
      file,
      50,
    );
    const ok = await attachVideoToHistory(
      "h1",
      1,
      "/generated/2-1.mp4",
      file,
    );
    expect(ok).toBe(true);
    const history = await readHistory(file);
    expect(history[0].images[1].videoUrl).toBe("/generated/2-1.mp4");
    expect(history[0].images[0].videoUrl).toBeUndefined();
  });

  it("同图二次挂载覆盖旧 videoUrl", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50);
    await attachVideoToHistory("h1", 0, "/generated/2-1.mp4", file);
    await attachVideoToHistory("h1", 0, "/generated/3-1.mp4", file);
    const history = await readHistory(file);
    expect(history[0].images[0].videoUrl).toBe("/generated/3-1.mp4");
  });

  it("historyId 不存在时返回 false 且不改写文件", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50);
    const before = await readHistory(file);
    const ok = await attachVideoToHistory("missing", 0, "/generated/2-1.mp4", file);
    expect(ok).toBe(false);
    expect(await readHistory(file)).toEqual(before);
  });

  it("imageIndex 越界时返回 false", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50);
    const ok = await attachVideoToHistory("h1", 5, "/generated/2-1.mp4", file);
    expect(ok).toBe(false);
  });

  it("imageIndex 非法（负数/非整数）时返回 false", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50);
    expect(await attachVideoToHistory("h1", -1, "/generated/2-1.mp4", file)).toBe(false);
    expect(await attachVideoToHistory("h1", 0.5, "/generated/2-1.mp4", file)).toBe(false);
  });

  it("兼容无 videoUrl 字段的旧格式条目，其他字段原样保留", async () => {
    const legacy = [
      {
        id: "old",
        createdAt: 1,
        prompt: "旧记录",
        model: "image-01",
        aspectRatio: "1:1",
        n: 1,
        images: [{ localUrl: "/generated/1-1.png", remoteUrl: "https://x/1.png" }],
        failedCount: 0,
      },
    ];
    await writeFile(file, JSON.stringify(legacy));
    const ok = await attachVideoToHistory("old", 0, "/generated/2-1.mp4", file);
    expect(ok).toBe(true);
    const history = await readHistory(file);
    expect(history[0].prompt).toBe("旧记录");
    expect(history[0].images[0]).toEqual({
      localUrl: "/generated/1-1.png",
      remoteUrl: "https://x/1.png",
      videoUrl: "/generated/2-1.mp4",
    });
  });

  it("挂载成功视频时清除 pendingVideo", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50);
    await attachVideoTaskToHistory(
      "h1",
      0,
      { taskId: "t1", startedAt: 1 },
      file,
    );
    const ok = await attachVideoToHistory("h1", 0, "/generated/2-1.mp4", file);
    expect(ok).toBe(true);
    const history = await readHistory(file);
    expect(history[0].images[0].videoUrl).toBe("/generated/2-1.mp4");
    expect(history[0].images[0].pendingVideo).toBeUndefined();
  });
});

describe("attachVideoTaskToHistory", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-gen-task-"));
    file = join(dir, "history.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const cases: {
    name: string;
    entry: HistoryEntry;
    historyId: string;
    imageIndex: number;
    want: boolean;
    before?: () => Promise<unknown>;
    check?: () => Promise<void>;
  }[] = [
    {
      name: "正常写入 pendingVideo 并可读回",
      entry: makeEntry({
        id: "h1",
        images: [
          { localUrl: "/generated/1-1.png", remoteUrl: "https://x/1.png" },
          { localUrl: "/generated/1-2.png", remoteUrl: "https://x/2.png" },
        ],
      }),
      historyId: "h1",
      imageIndex: 1,
      want: true,
      check: async () => {
        const history = await readHistory(file);
        expect(history[0].images[1].pendingVideo).toEqual({
          taskId: "task-1",
          startedAt: 12345,
        });
        expect(history[0].images[0].pendingVideo).toBeUndefined();
      },
    },
    {
      name: "同图二次挂载覆盖旧 pendingVideo",
      entry: makeEntry({ id: "h1" }),
      historyId: "h1",
      imageIndex: 0,
      want: true,
      before: () =>
        attachVideoTaskToHistory("h1", 0, { taskId: "old", startedAt: 1 }, file),
      check: async () => {
        const history = await readHistory(file);
        expect(history[0].images[0].pendingVideo).toEqual({
          taskId: "task-1",
          startedAt: 12345,
        });
      },
    },
    {
      name: "historyId 不存在时返回 false",
      entry: makeEntry({ id: "h1" }),
      historyId: "missing",
      imageIndex: 0,
      want: false,
      check: async () => {
        const history = await readHistory(file);
        expect(history[0].images[0].pendingVideo).toBeUndefined();
      },
    },
    {
      name: "imageIndex 越界时返回 false",
      entry: makeEntry({ id: "h1" }),
      historyId: "h1",
      imageIndex: 5,
      want: false,
    },
    {
      name: "imageIndex 非法（负数/非整数）时返回 false",
      entry: makeEntry({ id: "h1" }),
      historyId: "h1",
      imageIndex: -1,
      want: false,
    },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      await appendHistory(c.entry, file, 50);
      if (c.before) {
        await c.before();
      }
      const ok = await attachVideoTaskToHistory(
        c.historyId,
        c.imageIndex,
        { taskId: "task-1", startedAt: 12345 },
        file,
      );
      expect(ok).toBe(c.want);
      if (c.check) {
        await c.check();
      }
    });
  }
});

describe("clearVideoTaskFromHistory", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-gen-clear-"));
    file = join(dir, "history.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("清除指定图片的 pendingVideo，保留其他字段", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50);
    await attachVideoTaskToHistory("h1", 0, { taskId: "t1", startedAt: 1 }, file);
    const ok = await clearVideoTaskFromHistory("h1", 0, file);
    expect(ok).toBe(true);
    const history = await readHistory(file);
    expect(history[0].images[0].pendingVideo).toBeUndefined();
    expect(history[0].images[0].localUrl).toBe("/generated/1.png");
  });

  it("无 pendingVideo 时调用不报错且幂等", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50);
    const before = await readHistory(file);
    expect(await clearVideoTaskFromHistory("h1", 0, file)).toBe(true);
    expect(await readHistory(file)).toEqual(before);
  });

  it("historyId 不存在时返回 false", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50);
    expect(await clearVideoTaskFromHistory("missing", 0, file)).toBe(false);
  });

  it("imageIndex 越界时返回 false", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50);
    expect(await clearVideoTaskFromHistory("h1", 3, file)).toBe(false);
  });
});
