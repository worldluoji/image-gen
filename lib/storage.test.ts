import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GENERATED_MEDIA_FILE_RE,
  HISTORY_MAX_ENTRIES,
  MAX_PINNED_ENTRIES,
  appendHistory,
  attachVideoTaskToHistory,
  attachVideoToHistory,
  clearVideoTaskFromHistory,
  deleteHistoryEntry,
  isLocalGeneratedPath,
  localReferenceToDataUrl,
  makeContinuationEntry,
  parseImageDataUrl,
  readHistory,
  saveDataUrlImage,
  setHistoryPin,
  toLocalImageName,
  toLocalVideoName,
  type HistoryEntry,
} from "./storage";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

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

describe("GENERATED_MEDIA_FILE_RE", () => {
  const cases = [
    { name: "图片文件", path: "/generated/1700000000000-1.png", want: true },
    { name: "jpg/jpeg/webp", path: "/generated/1-1.jpeg", want: true },
    { name: "视频文件 mp4", path: "/generated/1700000000000-1.mp4", want: true },
    { name: "非规范命名", path: "/generated/1.png", want: false },
    { name: "路径穿越", path: "/generated/../secret.png", want: false },
    { name: "其他目录", path: "/other/1-1.mp4", want: false },
    { name: "远程 URL", path: "https://cdn.example.com/1-1.mp4", want: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(GENERATED_MEDIA_FILE_RE.test(c.path)).toBe(c.want);
    });
  }
});

describe("deleteHistoryEntry", () => {
  let dir: string;
  let file: string;
  let genDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-gen-del-"));
    file = join(dir, "history.json");
    genDir = join(dir, "generated");
    await mkdir(genDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("删除条目并清理其图片与视频文件，其余条目顺序不变", async () => {
    await appendHistory(
      makeEntry({
        id: "old",
        images: [
          { localUrl: "/generated/100-1.png", remoteUrl: "https://x/1.png" },
        ],
      }),
      file,
      50,
      genDir,
    );
    await appendHistory(
      makeEntry({
        id: "target",
        images: [
          {
            localUrl: "/generated/200-1.png",
            remoteUrl: "https://x/2.png",
            videoUrl: "/generated/201-1.mp4",
          },
        ],
      }),
      file,
      50,
      genDir,
    );
    await writeFile(join(genDir, "200-1.png"), "img");
    await writeFile(join(genDir, "201-1.mp4"), "vid");
    await writeFile(join(genDir, "100-1.png"), "keep");

    expect(await deleteHistoryEntry("target", file, genDir)).toBe(true);
    const history = await readHistory(file);
    expect(history.map((e) => e.id)).toEqual(["old"]);
    expect(await fileExists(join(genDir, "200-1.png"))).toBe(false);
    expect(await fileExists(join(genDir, "201-1.mp4"))).toBe(false);
    expect(await fileExists(join(genDir, "100-1.png"))).toBe(true);
  });

  it("文件缺失（ENOENT）时容忍，不抛错", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50, genDir);
    expect(
      await deleteHistoryEntry("h1", file, join(genDir, "not-exist")),
    ).toBe(true);
  });

  it("非规范命名的路径不触发删除", async () => {
    await appendHistory(
      makeEntry({
        id: "h1",
        images: [
          { localUrl: "/generated/1.png", remoteUrl: "https://x/1.png" },
        ],
      }),
      file,
      50,
      genDir,
    );
    await writeFile(join(genDir, "1.png"), "keep");
    expect(await deleteHistoryEntry("h1", file, genDir)).toBe(true);
    expect(await fileExists(join(genDir, "1.png"))).toBe(true);
  });

  it("id 不存在时返回 false，历史与文件均不动", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50, genDir);
    await writeFile(join(genDir, "200-1.png"), "keep");
    const before = await readHistory(file);
    expect(await deleteHistoryEntry("missing", file, genDir)).toBe(false);
    expect(await readHistory(file)).toEqual(before);
    expect(await fileExists(join(genDir, "200-1.png"))).toBe(true);
  });
});

describe("appendHistory 截断文件清理", () => {
  let dir: string;
  let file: string;
  let genDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-gen-trunc-"));
    file = join(dir, "history.json");
    genDir = join(dir, "generated");
    await mkdir(genDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("被淘汰条目的落盘文件被删除，保留条目文件完好", async () => {
    await writeFile(join(genDir, "100-1.png"), "oldest");
    await writeFile(join(genDir, "101-1.mp4"), "oldest-video");
    await writeFile(join(genDir, "200-1.png"), "kept");
    await appendHistory(
      makeEntry({
        id: "e1",
        images: [
          {
            localUrl: "/generated/100-1.png",
            remoteUrl: "https://x/1.png",
            videoUrl: "/generated/101-1.mp4",
          },
        ],
      }),
      file,
      2,
      genDir,
    );
    await appendHistory(makeEntry({ id: "e2" }), file, 2, genDir);
    await appendHistory(
      makeEntry({
        id: "e3",
        images: [
          { localUrl: "/generated/200-1.png", remoteUrl: "https://x/2.png" },
        ],
      }),
      file,
      2,
      genDir,
    );
    const history = await readHistory(file);
    expect(history.map((e) => e.id)).toEqual(["e3", "e2"]);
    expect(await fileExists(join(genDir, "100-1.png"))).toBe(false);
    expect(await fileExists(join(genDir, "101-1.mp4"))).toBe(false);
    expect(await fileExists(join(genDir, "200-1.png"))).toBe(true);
  });

  it("清理目录不存在时不抛错，不影响写入", async () => {
    await appendHistory(makeEntry({ id: "a" }), file, 1, genDir);
    await appendHistory(
      makeEntry({ id: "b" }),
      file,
      1,
      join(genDir, "not-exist"),
    );
    const history = await readHistory(file);
    expect(history.map((e) => e.id)).toEqual(["b"]);
  });
});

const SAMPLE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const SAMPLE_BASE64 = SAMPLE_BYTES.toString("base64");

describe("parseImageDataUrl", () => {
  const validCases = [
    { name: "png", mime: "image/png", ext: "png" },
    { name: "jpeg 归一为 jpg", mime: "image/jpeg", ext: "jpg" },
    { name: "webp", mime: "image/webp", ext: "webp" },
  ];
  for (const c of validCases) {
    it(c.name, () => {
      const { extension, bytes } = parseImageDataUrl(
        `data:${c.mime};base64,${SAMPLE_BASE64}`,
      );
      expect(extension).toBe(c.ext);
      expect(bytes.equals(SAMPLE_BYTES)).toBe(true);
    });
  }

  const invalidCases = [
    { name: "http URL", dataUrl: "https://example.com/a.png" },
    { name: "gif", dataUrl: `data:image/gif;base64,${SAMPLE_BASE64}` },
    { name: "svg", dataUrl: `data:image/svg+xml;base64,${SAMPLE_BASE64}` },
    { name: "视频", dataUrl: `data:video/mp4;base64,${SAMPLE_BASE64}` },
    { name: "缺 base64 前缀", dataUrl: "data:image/png;charset=utf-8,abc" },
    { name: "空载荷", dataUrl: "data:image/png;base64," },
    { name: "非法 base64 字符", dataUrl: "data:image/png;base64,a!b*" },
    { name: "空字符串", dataUrl: "" },
  ];
  for (const c of invalidCases) {
    it(`拒绝：${c.name}`, () => {
      expect(() => parseImageDataUrl(c.dataUrl)).toThrow(/Base64/);
    });
  }
});

describe("saveDataUrlImage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-gen-dataurl-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("写入规范命名文件并返回本地路径", async () => {
    const localUrl = await saveDataUrlImage(
      `data:image/jpeg;base64,${SAMPLE_BASE64}`,
      TIMESTAMP,
      dir,
    );
    expect(localUrl).toBe(`/generated/${TIMESTAMP}-1.jpg`);
    expect((await readFile(join(dir, `${TIMESTAMP}-1.jpg`))).equals(SAMPLE_BYTES)).toBe(true);
  });

  it("超出 maxBytes 时抛错且不留文件", async () => {
    await expect(
      saveDataUrlImage(
        `data:image/png;base64,${SAMPLE_BASE64}`,
        TIMESTAMP,
        dir,
        SAMPLE_BYTES.length - 1,
      ),
    ).rejects.toThrow(/超出/);
    expect(await fileExists(join(dir, `${TIMESTAMP}-1.png`))).toBe(false);
  });

  it("非法 Data URL 抛错", async () => {
    await expect(
      saveDataUrlImage("data:image/gif;base64," + SAMPLE_BASE64, TIMESTAMP, dir),
    ).rejects.toThrow(/Base64/);
  });
});

describe("makeContinuationEntry", () => {
  it("以尾帧为新图创建单图记录，模型/宽高比/风格继承来源", () => {
    const entry = makeContinuationEntry({
      id: "new-1",
      createdAt: TIMESTAMP,
      prompt: "镜头缓缓拉远",
      frameLocalUrl: `/generated/${TIMESTAMP}-1.jpg`,
      task: { taskId: "t1", startedAt: TIMESTAMP },
      source: makeEntry({ id: "src", model: "image-01", aspectRatio: "16:9", style: "水彩" }),
    });
    expect(entry).toEqual({
      id: "new-1",
      createdAt: TIMESTAMP,
      prompt: "镜头缓缓拉远",
      style: "水彩",
      model: "image-01",
      aspectRatio: "16:9",
      n: 1,
      images: [
        {
          localUrl: `/generated/${TIMESTAMP}-1.jpg`,
          remoteUrl: "",
          pendingVideo: { taskId: "t1", startedAt: TIMESTAMP },
        },
      ],
      failedCount: 0,
    });
  });

  it("来源无风格时新记录不带 style 字段", () => {
    const entry = makeContinuationEntry({
      id: "new-2",
      createdAt: TIMESTAMP,
      prompt: "",
      frameLocalUrl: `/generated/${TIMESTAMP}-1.jpg`,
      task: { taskId: "t2", startedAt: TIMESTAMP },
      source: makeEntry({ id: "src" }),
    });
    expect(entry.style).toBeUndefined();
    expect("style" in entry).toBe(false);
  });
});

describe("MAX_PINNED_ENTRIES", () => {
  it("恒小于 HISTORY_MAX_ENTRIES，为最新 unpinned 条目至少留一个槽位", () => {
    expect(MAX_PINNED_ENTRIES).toBe(HISTORY_MAX_ENTRIES - 1);
  });
});

describe("setHistoryPin", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-gen-pin-"));
    file = join(dir, "history.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("pin 与 unpin 正常切换并可读回", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50);
    expect(await setHistoryPin("h1", true, file)).toBe(true);
    expect((await readHistory(file))[0].pinned).toBe(true);

    expect(await setHistoryPin("h1", false, file)).toBe(true);
    expect((await readHistory(file))[0].pinned).toBeUndefined();
  });

  it("id 不存在时返回 false 且不改写文件", async () => {
    await appendHistory(makeEntry({ id: "h1" }), file, 50);
    const before = await readHistory(file);
    expect(await setHistoryPin("missing", true, file)).toBe(false);
    expect(await readHistory(file)).toEqual(before);
  });

  it("收藏已满时再 pin 返回 false 且不改写文件", async () => {
    const entries = Array.from({ length: MAX_PINNED_ENTRIES }, (_, i) =>
      makeEntry({ id: `p${i}`, pinned: true }),
    );
    entries.push(makeEntry({ id: "free" }));
    await writeFile(file, JSON.stringify(entries));

    expect(await setHistoryPin("free", true, file)).toBe(false);
    const after = await readHistory(file);
    expect(after.find((e) => e.id === "free")?.pinned).toBeUndefined();
  });

  it("unpin 不受收藏上限限制", async () => {
    const entries = Array.from({ length: MAX_PINNED_ENTRIES }, (_, i) =>
      makeEntry({ id: `p${i}`, pinned: true }),
    );
    await writeFile(file, JSON.stringify(entries));
    expect(await setHistoryPin("p0", false, file)).toBe(true);
    expect((await readHistory(file))[0].pinned).toBeUndefined();
  });

  it("损坏文件向上抛错（不静默重建）", async () => {
    await writeFile(file, "{ not json");
    await expect(setHistoryPin("h1", true, file)).rejects.toThrow(/历史/);
  });
});

describe("appendHistory 置顶截断", () => {
  let dir: string;
  let file: string;
  let genDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "image-gen-pin-trunc-"));
    file = join(dir, "history.json");
    genDir = join(dir, "generated");
    await mkdir(genDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function entryWithFile(id: string, name: string): Promise<HistoryEntry> {
    await writeFile(join(genDir, name), id);
    return makeEntry({
      id,
      images: [{ localUrl: `/generated/${name}`, remoteUrl: `https://x/${name}` }],
    });
  }

  it("pinned 最旧条目不参与截断，文件保留；被剔的 unpinned 文件删除", async () => {
    const pinned = await entryWithFile("p0", "100-1.png");
    await appendHistory(pinned, file, 50, genDir);
    await setHistoryPin("p0", true, file);
    await appendHistory(await entryWithFile("u1", "200-1.png"), file, 3, genDir);
    await appendHistory(await entryWithFile("u2", "300-1.png"), file, 3, genDir);
    // combined = [u2, u1, p0] 已满 3 条，追加新条挤掉最旧 unpinned
    await appendHistory(await entryWithFile("u3", "400-1.png"), file, 3, genDir);

    const history = await readHistory(file);
    expect(history.map((e) => e.id)).toEqual(["u3", "u2", "p0"]);
    expect(await fileExists(join(genDir, "100-1.png"))).toBe(true);
    expect(await fileExists(join(genDir, "200-1.png"))).toBe(false);
    expect(await fileExists(join(genDir, "300-1.png"))).toBe(true);
    expect(await fileExists(join(genDir, "400-1.png"))).toBe(true);
  });

  it("清理只删除被淘汰条目的文件，保留条目文件逐一完好", async () => {
    await appendHistory(await entryWithFile("a", "10-1.png"), file, 50, genDir);
    await appendHistory(await entryWithFile("b", "20-1.png"), file, 50, genDir);
    await appendHistory(await entryWithFile("c", "30-1.png"), file, 2, genDir);
    expect(await fileExists(join(genDir, "10-1.png"))).toBe(false);
    expect(await fileExists(join(genDir, "20-1.png"))).toBe(true);
    expect(await fileExists(join(genDir, "30-1.png"))).toBe(true);
  });

  it("无 pinned 时截断行为与原逻辑一致（回归）", async () => {
    for (const id of ["e0", "e1", "e2", "e3"]) {
      await appendHistory(makeEntry({ id }), file, 3, genDir);
    }
    const history = await readHistory(file);
    expect(history.map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
  });

  it("pinned 数量逼近上限时新 unpinned 挤掉最旧 unpinned", async () => {
    const max = 4;
    // 3 个 pinned + 1 个 unpinned，槽位仅剩 1 个给 unpinned
    const pinnedNames: Record<string, string> = {
      p0: "501-1.png",
      p1: "502-1.png",
      p2: "503-1.png",
    };
    for (const id of ["p2", "p1", "p0"]) {
      await appendHistory(await entryWithFile(id, pinnedNames[id]), file, 50, genDir);
      await setHistoryPin(id, true, file);
    }
    await appendHistory(await entryWithFile("u-old", "599-1.png"), file, 50, genDir);
    await appendHistory(await entryWithFile("u-new", "600-1.png"), file, max, genDir);

    const history = await readHistory(file);
    // p0 最后追加，时间倒序下排在 pinned 最前
    expect(history.map((e) => e.id)).toEqual(["u-new", "p0", "p1", "p2"]);
    expect(await fileExists(join(genDir, "599-1.png"))).toBe(false);
    expect(await fileExists(join(genDir, "600-1.png"))).toBe(true);
  });
});
