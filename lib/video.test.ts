import { describe, expect, it } from "vitest";
import {
  RESOLUTIONS_BY_DURATION,
  VIDEO_MODEL,
  VIDEO_PROMPT_MAX_LENGTH,
  buildVideoRequestBody,
  parseCreateVideoResponse,
  parseQueryVideoResponse,
  parseRetrieveResponse,
  validateVideoParams,
  type VideoTaskParams,
} from "./video";

function makeParams(overrides: Partial<VideoTaskParams> = {}): VideoTaskParams {
  return {
    prompt: "镜头缓缓推近，猫眨了眨眼",
    duration: 6,
    resolution: "768P",
    firstFrameImage: "https://example.com/a.jpeg",
    ...overrides,
  };
}

describe("buildVideoRequestBody", () => {
  const cases: { name: string; params: VideoTaskParams; want: Record<string, unknown> }[] =
    [
      {
        name: "完整参数映射为 MiniMax 请求体",
        params: makeParams(),
        want: {
          model: VIDEO_MODEL,
          prompt: "镜头缓缓推近，猫眨了眨眼",
          duration: 6,
          resolution: "768P",
          first_frame_image: "https://example.com/a.jpeg",
        },
      },
      {
        name: "data URL 首帧透传",
        params: makeParams({
          firstFrameImage: "data:image/jpeg;base64,QUJDRA==",
          resolution: "1080P",
        }),
        want: {
          model: VIDEO_MODEL,
          prompt: "镜头缓缓推近，猫眨了眨眼",
          duration: 6,
          resolution: "1080P",
          first_frame_image: "data:image/jpeg;base64,QUJDRA==",
        },
      },
      {
        name: "空 prompt 时省略该字段",
        params: makeParams({ prompt: "" }),
        want: {
          model: VIDEO_MODEL,
          duration: 6,
          resolution: "768P",
          first_frame_image: "https://example.com/a.jpeg",
        },
      },
      {
        name: "纯空白 prompt 时省略该字段",
        params: makeParams({ prompt: "   " }),
        want: {
          model: VIDEO_MODEL,
          duration: 6,
          resolution: "768P",
          first_frame_image: "https://example.com/a.jpeg",
        },
      },
      {
        name: "10 秒 768P 正确透传",
        params: makeParams({ duration: 10 }),
        want: {
          model: VIDEO_MODEL,
          prompt: "镜头缓缓推近，猫眨了眨眼",
          duration: 10,
          resolution: "768P",
          first_frame_image: "https://example.com/a.jpeg",
        },
      },
    ];

  for (const c of cases) {
    it(c.name, () => {
      expect(buildVideoRequestBody(c.params)).toEqual(c.want);
    });
  }
});

describe("validateVideoParams", () => {
  const cases: {
    name: string;
    params: VideoTaskParams;
    wantNull: boolean;
    wantIncludes?: string;
  }[] = [
    { name: "6s + 768P 通过", params: makeParams(), wantNull: true },
    { name: "6s + 1080P 通过", params: makeParams({ resolution: "1080P" }), wantNull: true },
    { name: "10s + 768P 通过", params: makeParams({ duration: 10 }), wantNull: true },
    { name: "空 prompt 通过（上游为可选字段）", params: makeParams({ prompt: "" }), wantNull: true },
    {
      name: "10s + 1080P 组合被拒且提示 768P",
      params: makeParams({ duration: 10, resolution: "1080P" }),
      wantNull: false,
      wantIncludes: "768P",
    },
    {
      name: "超长 prompt 被拒",
      params: makeParams({ prompt: "a".repeat(VIDEO_PROMPT_MAX_LENGTH + 1) }),
      wantNull: false,
      wantIncludes: String(VIDEO_PROMPT_MAX_LENGTH),
    },
    {
      name: "非法时长被拒",
      params: makeParams({ duration: 7 as 6 }),
      wantNull: false,
      wantIncludes: "duration",
    },
    {
      name: "非法分辨率被拒",
      params: makeParams({ resolution: "480P" as "768P" }),
      wantNull: false,
      wantIncludes: "resolution",
    },
    {
      name: "首帧为本地路径（未转换）被拒",
      params: makeParams({ firstFrameImage: "/generated/123-1.jpeg" }),
      wantNull: false,
      wantIncludes: "first_frame_image",
    },
    {
      name: "首帧为非图片 data URL 被拒",
      params: makeParams({ firstFrameImage: "data:video/mp4;base64,AAAA" }),
      wantNull: false,
      wantIncludes: "first_frame_image",
    },
    {
      name: "webp data URL 首帧通过",
      params: makeParams({ firstFrameImage: "data:image/webp;base64,QUJD" }),
      wantNull: true,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const err = validateVideoParams(c.params);
      if (c.wantNull) {
        expect(err).toBeNull();
      } else {
        expect(err).not.toBeNull();
        expect(err).toContain(c.wantIncludes);
      }
    });
  }

  it("RESOLUTIONS_BY_DURATION 与上游约束一致：10s 仅 768P", () => {
    expect(RESOLUTIONS_BY_DURATION[10]).toEqual(["768P"]);
    expect(RESOLUTIONS_BY_DURATION[6]).toContain("1080P");
  });
});

describe("parseCreateVideoResponse", () => {
  it("成功时提取 task_id", () => {
    const json = {
      task_id: "106916112212032",
      base_resp: { status_code: 0, status_msg: "success" },
    };
    expect(parseCreateVideoResponse(json)).toBe("106916112212032");
  });

  const errorCases = [
    { name: "1002 限流", statusCode: 1002, wantIncludes: "限流" },
    { name: "1004 鉴权失败", statusCode: 1004, wantIncludes: "API Key" },
    { name: "1008 余额不足", statusCode: 1008, wantIncludes: "余额" },
    { name: "1026 输入敏感", statusCode: 1026, wantIncludes: "敏感" },
    { name: "1027 输出敏感", statusCode: 1027, wantIncludes: "敏感" },
    { name: "2013 参数异常", statusCode: 2013, wantIncludes: "参数" },
    { name: "2049 无效 key", statusCode: 2049, wantIncludes: "API Key" },
  ];

  for (const c of errorCases) {
    it(`status_code=${c.statusCode} 抛出含「${c.wantIncludes}」的错误`, () => {
      const json = {
        base_resp: { status_code: c.statusCode, status_msg: "raw" },
      };
      expect(() => parseCreateVideoResponse(json)).toThrow(c.wantIncludes);
    });
  }

  it("status_code=0 但缺 task_id 抛错", () => {
    const json = { base_resp: { status_code: 0, status_msg: "success" } };
    expect(() => parseCreateVideoResponse(json)).toThrow();
  });
});

describe("parseQueryVideoResponse", () => {
  it("Success 时返回 status 与 fileId", () => {
    const json = {
      task_id: "176843862716480",
      status: "Success",
      file_id: "176844028768320",
      video_width: 1920,
      video_height: 1080,
      base_resp: { status_code: 0, status_msg: "success" },
    };
    expect(parseQueryVideoResponse(json)).toEqual({
      status: "Success",
      fileId: "176844028768320",
    });
  });

  const pendingCases = ["Preparing", "Queueing", "Processing"];
  for (const status of pendingCases) {
    it(`${status} 无 file_id 也合法`, () => {
      const json = {
        task_id: "1",
        status,
        base_resp: { status_code: 0, status_msg: "success" },
      };
      expect(parseQueryVideoResponse(json)).toEqual({ status });
    });
  }

  it("Fail 返回 status=Fail", () => {
    const json = {
      task_id: "1",
      status: "Fail",
      base_resp: { status_code: 0, status_msg: "success" },
    };
    expect(parseQueryVideoResponse(json)).toEqual({ status: "Fail" });
  });

  it("未知 status 抛错", () => {
    const json = {
      task_id: "1",
      status: "Exploded",
      base_resp: { status_code: 0, status_msg: "success" },
    };
    expect(() => parseQueryVideoResponse(json)).toThrow("Exploded");
  });

  it("Success 但缺 file_id 抛错", () => {
    const json = {
      task_id: "1",
      status: "Success",
      base_resp: { status_code: 0, status_msg: "success" },
    };
    expect(() => parseQueryVideoResponse(json)).toThrow();
  });

  it("base_resp 错误码抛错", () => {
    const json = { base_resp: { status_code: 1002, status_msg: "slow down" } };
    expect(() => parseQueryVideoResponse(json)).toThrow("限流");
  });
});

describe("parseRetrieveResponse", () => {
  it("成功时提取 download_url", () => {
    const json = {
      file: {
        file_id: 123,
        filename: "output_aigc.mp4",
        download_url: "https://download.example.com/v.mp4",
      },
      base_resp: { status_code: 0, status_msg: "success" },
    };
    expect(parseRetrieveResponse(json)).toBe(
      "https://download.example.com/v.mp4",
    );
  });

  it("缺 download_url 抛错", () => {
    const json = {
      file: { file_id: 123 },
      base_resp: { status_code: 0, status_msg: "success" },
    };
    expect(() => parseRetrieveResponse(json)).toThrow();
  });

  it("base_resp 错误码抛错", () => {
    const json = { base_resp: { status_code: 1004, status_msg: "auth" } };
    expect(() => parseRetrieveResponse(json)).toThrow("API Key");
  });
});
