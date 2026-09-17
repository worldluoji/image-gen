import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_PREFS,
  DEFAULT_VIDEO_PREFS,
  DRAFT_KEY,
  IMAGE_PREFS_KEY,
  VIDEO_PREFS_KEY,
  parseImagePrefs,
  parsePromptDraft,
  parseVideoPrefs,
} from "./prefs";

describe("parseImagePrefs", () => {
  const cases: { name: string; raw: string | null; want: typeof DEFAULT_IMAGE_PREFS }[] =
    [
      {
        name: "null 返回默认值",
        raw: null,
        want: DEFAULT_IMAGE_PREFS,
      },
      {
        name: "合法 JSON 完整回读",
        raw: JSON.stringify({
          model: "image-01-live",
          aspectRatio: "16:9",
          n: 4,
          styleChoice: "赛博朋克",
          customStyle: "",
        }),
        want: {
          model: "image-01-live",
          aspectRatio: "16:9",
          n: 4,
          styleChoice: "赛博朋克",
          customStyle: "",
        },
      },
      {
        name: "损坏 JSON 返回默认值",
        raw: "{not json",
        want: DEFAULT_IMAGE_PREFS,
      },
      {
        name: "非对象 JSON 返回默认值",
        raw: "[1,2]",
        want: DEFAULT_IMAGE_PREFS,
      },
      {
        name: "非法 model 回退默认，其余字段保留",
        raw: JSON.stringify({ model: "gpt-5", aspectRatio: "3:2", n: 2 }),
        want: {
          ...DEFAULT_IMAGE_PREFS,
          model: DEFAULT_IMAGE_PREFS.model,
          aspectRatio: "3:2",
          n: 2,
        },
      },
      {
        name: "n 越界回退默认",
        raw: JSON.stringify({ n: 100 }),
        want: DEFAULT_IMAGE_PREFS,
      },
      {
        name: "n 非整数回退默认",
        raw: JSON.stringify({ n: 2.5 }),
        want: DEFAULT_IMAGE_PREFS,
      },
      {
        name: "styleChoice 非预设且非自定义哨兵时回退空",
        raw: JSON.stringify({ styleChoice: "不存在的风格" }),
        want: { ...DEFAULT_IMAGE_PREFS, styleChoice: "" },
      },
      {
        name: "自定义风格文本超长截断",
        raw: JSON.stringify({ styleChoice: "自定义", customStyle: "长".repeat(200) }),
        want: {
          ...DEFAULT_IMAGE_PREFS,
          styleChoice: "自定义",
          customStyle: "长".repeat(100),
        },
      },
    ];

  cases.forEach(({ name, raw, want }) => {
    it(name, () => {
      expect(parseImagePrefs(raw)).toEqual(want);
    });
  });
});

describe("parseVideoPrefs", () => {
  const cases: { name: string; raw: string | null; want: typeof DEFAULT_VIDEO_PREFS }[] =
    [
      {
        name: "null 返回默认值",
        raw: null,
        want: DEFAULT_VIDEO_PREFS,
      },
      {
        name: "合法 JSON 完整回读",
        raw: JSON.stringify({ duration: 6, resolution: "1080P" }),
        want: { duration: 6, resolution: "1080P" },
      },
      {
        name: "损坏 JSON 返回默认值",
        raw: "{{{",
        want: DEFAULT_VIDEO_PREFS,
      },
      {
        name: "非法时长回退默认",
        raw: JSON.stringify({ duration: 7 }),
        want: DEFAULT_VIDEO_PREFS,
      },
      {
        name: "分辨率不被该时长支持时回退默认分辨率",
        raw: JSON.stringify({ duration: 10, resolution: "1080P" }),
        want: { duration: 10, resolution: "768P" },
      },
      {
        name: "非法分辨率回退默认",
        raw: JSON.stringify({ duration: 6, resolution: "4K" }),
        want: DEFAULT_VIDEO_PREFS,
      },
    ];

  cases.forEach(({ name, raw, want }) => {
    it(name, () => {
      expect(parseVideoPrefs(raw)).toEqual(want);
    });
  });
});

describe("parsePromptDraft", () => {
  const cases: { name: string; raw: string | null; want: string }[] = [
    { name: "null 返回空串", raw: null, want: "" },
    { name: "正常草稿原样返回", raw: "一只戴帽子的猫", want: "一只戴帽子的猫" },
    { name: "空串返回空串", raw: "", want: "" },
    { name: "超出 prompt 上限截断", raw: "猫".repeat(2000), want: "猫".repeat(1500) },
  ];

  cases.forEach(({ name, raw, want }) => {
    it(name, () => {
      expect(parsePromptDraft(raw)).toBe(want);
    });
  });
});

describe("存储键命名", () => {
  it("各键都以 image-gen: 前缀且互不相同", () => {
    const keys = [IMAGE_PREFS_KEY, VIDEO_PREFS_KEY, DRAFT_KEY];
    keys.forEach((k) => expect(k.startsWith("image-gen:")).toBe(true));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
