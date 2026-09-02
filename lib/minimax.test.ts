import { describe, expect, it } from "vitest";
import {
  ASPECT_RATIOS,
  MODELS,
  PROMPT_MAX_LENGTH,
  REFERENCE_MAX_BYTES,
  STYLE_MAX_LENGTH,
  buildRequestBody,
  parseResponse,
  validateParams,
  type GenerationParams,
} from "./minimax";

function makeParams(overrides: Partial<GenerationParams> = {}): GenerationParams {
  return {
    model: "image-01",
    prompt: "一只戴帽子的猫",
    aspectRatio: "1:1",
    n: 1,
    ...overrides,
  };
}

describe("buildRequestBody", () => {
  const cases = [
    {
      name: "最小参数映射为 MiniMax 请求体",
      params: makeParams(),
      want: {
        model: "image-01",
        prompt: "一只戴帽子的猫",
        aspect_ratio: "1:1",
        n: 1,
        response_format: "url",
      },
    },
    {
      name: "image-01-live 与 16:9 正确透传",
      params: makeParams({ model: "image-01-live", aspectRatio: "16:9", n: 4 }),
      want: {
        model: "image-01-live",
        prompt: "一只戴帽子的猫",
        aspect_ratio: "16:9",
        n: 4,
        response_format: "url",
      },
    },
    {
      name: "带风格时将风格注入 prompt",
      params: makeParams({ style: "电影" }),
      want: {
        model: "image-01",
        prompt: "一只戴帽子的猫。画面风格：电影",
        aspect_ratio: "1:1",
        n: 1,
        response_format: "url",
      },
    },
    {
      name: "空字符串风格不注入",
      params: makeParams({ style: "  " }),
      want: {
        model: "image-01",
        prompt: "一只戴帽子的猫",
        aspect_ratio: "1:1",
        n: 1,
        response_format: "url",
      },
    },
    {
      name: "带参考图时映射为 subject_reference",
      params: makeParams({
        subjectReference: [
          { type: "character", imageFile: "https://example.com/a.jpg" },
        ],
      }),
      want: {
        model: "image-01",
        prompt: "一只戴帽子的猫",
        aspect_ratio: "1:1",
        n: 1,
        response_format: "url",
        subject_reference: [
          { type: "character", image_file: "https://example.com/a.jpg" },
        ],
      },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(buildRequestBody(c.params)).toEqual(c.want);
    });
  }
});

describe("parseResponse", () => {
  it("成功时返回图片 URL 与统计", () => {
    const json = {
      id: "task-1",
      data: { image_urls: ["https://a.com/1.png", "https://a.com/2.png"] },
      metadata: { success_count: 2, failed_count: 0 },
      base_resp: { status_code: 0, status_msg: "success" },
    };
    expect(parseResponse(json)).toEqual({
      imageUrls: ["https://a.com/1.png", "https://a.com/2.png"],
      successCount: 2,
      failedCount: 0,
    });
  });

  const errorCases: { name: string; statusCode: number; wantMessageIncludes: string }[] =
    [
      { name: "1002 限流", statusCode: 1002, wantMessageIncludes: "限流" },
      { name: "1004 鉴权失败", statusCode: 1004, wantMessageIncludes: "API Key" },
      { name: "1008 余额不足", statusCode: 1008, wantMessageIncludes: "余额" },
      { name: "1026 敏感内容", statusCode: 1026, wantMessageIncludes: "敏感" },
      { name: "1027 输出敏感内容", statusCode: 1027, wantMessageIncludes: "敏感" },
      { name: "2013 参数异常", statusCode: 2013, wantMessageIncludes: "参数" },
      { name: "2049 无效 key", statusCode: 2049, wantMessageIncludes: "API Key" },
    ];

  for (const c of errorCases) {
    it(`status_code=${c.statusCode} 抛出含「${c.wantMessageIncludes}」的错误`, () => {
      const json = { base_resp: { status_code: c.statusCode, status_msg: "raw msg" } };
      expect(() => parseResponse(json)).toThrow(c.wantMessageIncludes);
    });
  }

  it("未知错误码兜底使用 status_msg", () => {
    const json = { base_resp: { status_code: 9999, status_msg: "未知错误详情" } };
    expect(() => parseResponse(json)).toThrow("未知错误详情");
  });

  it("metadata 计数为字符串时归一化为 number", () => {
    const json = {
      data: { image_urls: ["https://a.com/1.png"] },
      metadata: { success_count: "1", failed_count: "0" },
      base_resp: { status_code: 0, status_msg: "success" },
    };
    expect(parseResponse(json)).toEqual({
      imageUrls: ["https://a.com/1.png"],
      successCount: 1,
      failedCount: 0,
    });
  });

  it("status_code=0 但缺少 image_urls 时抛错", () => {
    const json = {
      data: {},
      base_resp: { status_code: 0, status_msg: "success" },
    };
    expect(() => parseResponse(json)).toThrow();
  });
});

describe("validateParams", () => {
  const cases: { name: string; params: GenerationParams; wantNull: boolean; wantIncludes?: string }[] =
    [
      { name: "合法参数通过", params: makeParams(), wantNull: true },
      {
        name: "空 prompt 被拒",
        params: makeParams({ prompt: "   " }),
        wantNull: false,
        wantIncludes: "prompt",
      },
      {
        name: "超长 prompt 被拒",
        params: makeParams({ prompt: "a".repeat(PROMPT_MAX_LENGTH + 1) }),
        wantNull: false,
        wantIncludes: "1500",
      },
      {
        name: "非法模型被拒",
        params: makeParams({ model: "gpt-image" as (typeof MODELS)[number] }),
        wantNull: false,
        wantIncludes: "model",
      },
      {
        name: "非法宽高比被拒",
        params: makeParams({
          aspectRatio: "5:4" as (typeof ASPECT_RATIOS)[number],
        }),
        wantNull: false,
        wantIncludes: "aspect_ratio",
      },
      {
        name: "n=0 被拒",
        params: makeParams({ n: 0 }),
        wantNull: false,
        wantIncludes: "n",
      },
      {
        name: "n=10 被拒",
        params: makeParams({ n: 10 }),
        wantNull: false,
        wantIncludes: "n",
      },
      {
        name: "n 非整数被拒",
        params: makeParams({ n: 1.5 }),
        wantNull: false,
        wantIncludes: "n",
      },
      {
        name: "风格超长被拒",
        params: makeParams({ style: "幻".repeat(STYLE_MAX_LENGTH + 1) }),
        wantNull: false,
        wantIncludes: "风格",
      },
      {
        name: "风格+prompt 组合后超过 1500 被拒",
        params: makeParams({
          prompt: "a".repeat(PROMPT_MAX_LENGTH - 3),
          style: "电影",
        }),
        wantNull: false,
        wantIncludes: "1500",
      },
      {
        name: "合法风格描述通过",
        params: makeParams({ style: "国风动漫" }),
        wantNull: true,
      },
      {
        name: "合法 https 参考图 URL 通过",
        params: makeParams({
          subjectReference: [
            { type: "character", imageFile: "https://example.com/a.jpg" },
          ],
        }),
        wantNull: true,
      },
      {
        name: "合法 jpeg data URL 参考图通过",
        params: makeParams({
          subjectReference: [
            { type: "character", imageFile: "data:image/jpeg;base64,QUJDRA==" },
          ],
        }),
        wantNull: true,
      },
      {
        name: "非法主体类型被拒",
        params: makeParams({
          subjectReference: [
            { type: "object" as "character", imageFile: "https://example.com/a.jpg" },
          ],
        }),
        wantNull: false,
        wantIncludes: "subject_reference",
      },
      {
        name: "非图片 data URL 被拒",
        params: makeParams({
          subjectReference: [
            { type: "character", imageFile: "data:text/html;base64,PGgxPjE8L2gxPg==" },
          ],
        }),
        wantNull: false,
        wantIncludes: "subject_reference",
      },
      {
        name: "参考图超过 10MB 被拒",
        params: makeParams({
          subjectReference: [
            {
              type: "character",
              imageFile:
                "data:image/png;base64," +
                "A".repeat(Math.ceil((REFERENCE_MAX_BYTES * 4) / 3) + 4),
            },
          ],
        }),
        wantNull: false,
        wantIncludes: "10MB",
      },
    ];

  for (const c of cases) {
    it(c.name, () => {
      const err = validateParams(c.params);
      if (c.wantNull) {
        expect(err).toBeNull();
      } else {
        expect(err).not.toBeNull();
        expect(err).toContain(c.wantIncludes);
      }
    });
  }
});
