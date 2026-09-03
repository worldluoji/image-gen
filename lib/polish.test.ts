import { describe, expect, it } from "vitest";
import { PROMPT_MAX_LENGTH } from "./minimax";
import {
  POLISH_MAX_TOKENS,
  POLISH_MODEL,
  POLISH_SYSTEM_PROMPT,
  buildPolishRequest,
  parsePolishResponse,
} from "./polish";

describe("buildPolishRequest", () => {
  it("包含模型、system+user 消息与 max_tokens", () => {
    const body = buildPolishRequest("一只猫");
    expect(body.model).toBe(POLISH_MODEL);
    expect(body.max_tokens).toBe(POLISH_MAX_TOKENS);
    const messages = body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[0].content).toBe(POLISH_SYSTEM_PROMPT);
    expect(messages[1].content).toBe("一只猫");
  });
});

describe("parsePolishResponse", () => {
  const ok = (content: string) => ({
    choices: [{ message: { content } }],
    base_resp: { status_code: 0, status_msg: "" },
  });

  const cases: {
    name: string;
    json: unknown;
    want?: string;
    wantError?: string;
  }[] = [
    {
      name: "正常返回并去除首尾空格",
      json: ok("  扩写后的提示词  "),
      want: "扩写后的提示词",
    },
    {
      name: "剥离代码围栏",
      json: ok("```\n黄昏的江边码头\n```"),
      want: "黄昏的江边码头",
    },
    {
      name: "剥离带语言标注的代码围栏",
      json: ok("```markdown\n雨巷与灯笼\n```"),
      want: "雨巷与灯笼",
    },
    {
      name: "剥离首尾英文引号",
      json: ok('"雪后的红墙"'),
      want: "雪后的红墙",
    },
    {
      name: "剥离首尾中文引号",
      json: ok("“雪后的红墙”"),
      want: "雪后的红墙",
    },
    {
      name: "base_resp 错误码映射为中文信息",
      json: {
        base_resp: { status_code: 1008, status_msg: "insufficient balance" },
      },
      wantError: "账号余额不足",
    },
    {
      name: "content 为空白时抛错",
      json: ok("   \n  "),
      wantError: "未返回润色结果",
    },
    {
      name: "缺少 choices 时抛错",
      json: { base_resp: { status_code: 0 } },
      wantError: "未返回润色结果",
    },
    {
      name: "超长结果截断到 PROMPT_MAX_LENGTH",
      json: ok("长".repeat(PROMPT_MAX_LENGTH + 100)),
      want: "长".repeat(PROMPT_MAX_LENGTH),
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      if (c.wantError !== undefined) {
        expect(() => parsePolishResponse(c.json)).toThrow(c.wantError);
      } else {
        expect(parsePolishResponse(c.json)).toBe(c.want);
      }
    });
  }
});
