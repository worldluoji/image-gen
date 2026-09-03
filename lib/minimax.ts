export const MINIMAX_BASE_URL = "https://api.minimaxi.com";
export const IMAGE_GENERATION_PATH = "/v1/image_generation";

export const MODELS = ["image-01", "image-01-live"] as const;
export type Model = (typeof MODELS)[number];

export const ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "4:3",
  "3:2",
  "2:3",
  "3:4",
  "9:16",
] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const PROMPT_MAX_LENGTH = 1500;
export const N_MIN = 1;
export const N_MAX = 9;
export const REQUEST_TIMEOUT_MS = 120_000;

export const STYLE_PRESETS = [
  "电影",
  "写实",
  "日漫",
  "国风动漫",
  "3D 卡通",
  "水彩",
  "油画",
  "素描",
  "中国水墨",
  "像素艺术",
  "赛博朋克",
  "复古胶片",
  "扁平插画",
  "儿童绘本",
  "浮世绘",
  "概念艺术",
] as const;
export type StylePreset = (typeof STYLE_PRESETS)[number];
// 与 STYLE_PRESETS 按索引一一对应的示例图（由 scripts/gen-style-samples.ts 预生成入库）；
// 改动 STYLE_PRESETS 顺序或内容后需重跑该脚本
export const STYLE_SAMPLE_IMAGES = STYLE_PRESETS.map(
  (_, i) => `/styles/${i}.png`,
);
export const STYLE_MAX_LENGTH = 100;
const STYLE_PROMPT_PREFIX = "。画面风格：";

export const REFERENCE_SUBJECT_TYPES = ["character"] as const;
export type SubjectType = (typeof REFERENCE_SUBJECT_TYPES)[number];

export const REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
const REFERENCE_FILE_RE = /^(https?:\/\/.+|data:image\/(jpeg|png);base64,.+)$/;

const STATUS_CODE_MESSAGES: Record<number, string> = {
  1002: "触发限流，请稍后再试",
  1004: "账号鉴权失败，请检查 API Key (MINIMAX_API_KEY) 是否正确",
  1008: "账号余额不足，请充值后重试",
  1026: "图片描述涉及敏感内容，请修改提示词",
  1027: "生成内容涉及敏感信息，请调整描述后重试",
  2013: "传入参数异常，请检查入参",
  2049: "无效的 API Key，请检查 MINIMAX_API_KEY 配置",
};

export interface SubjectReference {
  type: SubjectType;
  imageFile: string;
}

export interface GenerationParams {
  model: Model;
  prompt: string;
  aspectRatio: AspectRatio;
  n: number;
  style?: string;
  subjectReference?: SubjectReference[];
}

export function composePrompt(prompt: string, style?: string): string {
  const trimmed = style?.trim();
  return trimmed ? `${prompt}${STYLE_PROMPT_PREFIX}${trimmed}` : prompt;
}

export interface GenerationResult {
  imageUrls: string[];
  successCount: number;
  failedCount: number;
}

export interface MiniMaxBaseResp {
  status_code?: number;
  status_msg?: string;
}

/** base_resp.status_code 非 0 时返回映射为中文信息的 Error，正常时返回 null */
export function baseRespError(baseResp: MiniMaxBaseResp | undefined): Error | null {
  if (!baseResp || baseResp.status_code === 0) {
    return null;
  }
  const code = baseResp.status_code as number;
  const mapped = STATUS_CODE_MESSAGES[code];
  return new Error(
    mapped ?? `MiniMax 返回错误 (code=${code}): ${baseResp.status_msg ?? "未知错误"}`,
  );
}

function validateSubjectReference(
  refs: SubjectReference[] | undefined,
): string | null {
  if (!refs || refs.length === 0) {
    return null;
  }
  for (const ref of refs) {
    if (!REFERENCE_SUBJECT_TYPES.includes(ref.type)) {
      return `subject_reference type 必须是 ${REFERENCE_SUBJECT_TYPES.join(" / ")} 之一`;
    }
    if (typeof ref.imageFile !== "string" || !REFERENCE_FILE_RE.test(ref.imageFile)) {
      return "subject_reference image_file 必须是 http(s) URL 或 image/jpeg、image/png 的 Base64 Data URL";
    }
    const base64Start = ref.imageFile.indexOf("base64,");
    if (base64Start >= 0) {
      const base64Length = ref.imageFile.length - base64Start - "base64,".length;
      const approxBytes = (base64Length * 3) / 4;
      if (approxBytes > REFERENCE_MAX_BYTES) {
        return `参考图不能超过 10MB，当前约 ${(approxBytes / 1024 / 1024).toFixed(1)}MB`;
      }
    }
  }
  return null;
}

export function validateParams(params: GenerationParams): string | null {
  if (typeof params.prompt !== "string" || params.prompt.trim() === "") {
    return "prompt 不能为空";
  }
  if (params.prompt.length > PROMPT_MAX_LENGTH) {
    return `prompt 最长 ${PROMPT_MAX_LENGTH} 字符，当前 ${params.prompt.length}`;
  }
  const trimmedStyle = params.style?.trim();
  if (trimmedStyle && trimmedStyle.length > STYLE_MAX_LENGTH) {
    return `风格描述不能超过 ${STYLE_MAX_LENGTH} 字符，当前 ${trimmedStyle.length}`;
  }
  const composed = composePrompt(params.prompt, params.style);
  if (composed.length > PROMPT_MAX_LENGTH) {
    return `描述+风格合计最长 ${PROMPT_MAX_LENGTH} 字符，当前 ${composed.length}`;
  }
  if (!MODELS.includes(params.model)) {
    return `model 必须是 ${MODELS.join(" / ")} 之一`;
  }
  if (!ASPECT_RATIOS.includes(params.aspectRatio)) {
    return `aspect_ratio 必须是 ${ASPECT_RATIOS.join(" / ")} 之一`;
  }
  if (
    !Number.isInteger(params.n) ||
    params.n < N_MIN ||
    params.n > N_MAX
  ) {
    return `n 必须是 ${N_MIN}-${N_MAX} 之间的整数`;
  }
  return validateSubjectReference(params.subjectReference);
}

export function buildRequestBody(params: GenerationParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: composePrompt(params.prompt, params.style),
    aspect_ratio: params.aspectRatio,
    n: params.n,
    response_format: "url",
  };
  if (params.subjectReference && params.subjectReference.length > 0) {
    body.subject_reference = params.subjectReference.map((ref) => ({
      type: ref.type,
      image_file: ref.imageFile,
    }));
  }
  return body;
}

export function parseResponse(json: unknown): GenerationResult {
  const resp = json as {
    data?: { image_urls?: string[] };
    metadata?: {
      success_count?: number | string;
      failed_count?: number | string;
    };
    base_resp?: MiniMaxBaseResp;
  };
  const baseError = baseRespError(resp.base_resp);
  if (baseError) {
    throw baseError;
  }
  const imageUrls = resp.data?.image_urls;
  if (!imageUrls || imageUrls.length === 0) {
    throw new Error("MiniMax 未返回任何图片");
  }
  // 实际接口返回的 count 为字符串（如 "1"），统一归一化为 number
  const toCount = (v: unknown, fallback: number) => {
    const num = Number(v);
    return Number.isFinite(num) ? num : fallback;
  };
  return {
    imageUrls,
    successCount: toCount(resp.metadata?.success_count, imageUrls.length),
    failedCount: toCount(resp.metadata?.failed_count, 0),
  };
}

export async function generateImages(
  params: GenerationParams,
  apiKey: string,
): Promise<GenerationResult> {
  const response = await fetch(`${MINIMAX_BASE_URL}${IMAGE_GENERATION_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildRequestBody(params)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`MiniMax 接口 HTTP ${response.status}`);
  }
  return parseResponse(await response.json());
}
