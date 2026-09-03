import { describe, expect, it } from "vitest";
import { PROMPT_MAX_LENGTH } from "./minimax";
import {
  PROMPT_TEMPLATES,
  RECENT_PROMPTS_MAX,
  recentPrompts,
} from "./prompt-templates";
import type { HistoryEntry } from "./storage";

function makeEntry(prompt: string): HistoryEntry {
  return {
    id: prompt,
    createdAt: 0,
    prompt,
    model: "image-01",
    aspectRatio: "1:1",
    n: 1,
    images: [],
    failedCount: 0,
  };
}

describe("recentPrompts", () => {
  const cases = [
    {
      name: "空历史返回空数组",
      history: [] as HistoryEntry[],
      limit: 5,
      want: [] as string[],
    },
    {
      name: "按出现顺序（最新在前）返回",
      history: [makeEntry("a"), makeEntry("b")],
      limit: 5,
      want: ["a", "b"],
    },
    {
      name: "重复描述只保留最先出现的",
      history: [makeEntry("a"), makeEntry("b"), makeEntry("a")],
      limit: 5,
      want: ["a", "b"],
    },
    {
      name: "过滤空白描述并去除首尾空格",
      history: [makeEntry("  a  "), makeEntry(""), makeEntry("   ")],
      limit: 5,
      want: ["a"],
    },
    {
      name: "limit 截断",
      history: [makeEntry("a"), makeEntry("b"), makeEntry("c")],
      limit: 2,
      want: ["a", "b"],
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(recentPrompts(c.history, c.limit)).toEqual(c.want);
    });
  }

  it("缺省 limit 使用 RECENT_PROMPTS_MAX", () => {
    const history = Array.from({ length: RECENT_PROMPTS_MAX + 3 }, (_, i) =>
      makeEntry(`p${i}`),
    );
    expect(recentPrompts(history)).toHaveLength(RECENT_PROMPTS_MAX);
  });
});

describe("PROMPT_TEMPLATES", () => {
  it("非空、label 唯一且 prompt 不超上游长度限制", () => {
    expect(PROMPT_TEMPLATES.length).toBeGreaterThan(0);
    const labels = new Set(PROMPT_TEMPLATES.map((t) => t.label));
    expect(labels.size).toBe(PROMPT_TEMPLATES.length);
    for (const t of PROMPT_TEMPLATES) {
      expect(t.label.trim()).not.toBe("");
      expect(t.prompt.trim().length).toBeGreaterThan(0);
      expect(t.prompt.length).toBeLessThanOrEqual(PROMPT_MAX_LENGTH);
    }
  });
});
