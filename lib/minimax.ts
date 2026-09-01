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

const STATUS_CODE_MESSAGES: Record<number, string> = {
  1002: "触发限流，请稍后再试",
  1004: "账号鉴权失败，请检查 API Key (MINIMAX_API_KEY) 是否正确",
  1008: "账号余额不足，请充值后重试",
  1026: "图片描述涉及敏感内容，请修改提示词",
  2013: "传入参数异常，请检查入参",
  2049: "无效的 API Key，请检查 MINIMAX_API_KEY 配置",
};

export interface TextToImageParams {
  model: Model;
  prompt: string;
  aspectRatio: AspectRatio;
  n: number;
}

export interface TextToImageResult {
  imageUrls: string[];
  successCount: number;
  failedCount: number;
}

interface MiniMaxBaseResp {
  status_code?: number;
  status_msg?: string;
}

export function validateParams(params: TextToImageParams): string | null {
  if (typeof params.prompt !== "string" || params.prompt.trim() === "") {
    return "prompt 不能为空";
  }
  if (params.prompt.length > PROMPT_MAX_LENGTH) {
    return `prompt 最长 ${PROMPT_MAX_LENGTH} 字符，当前 ${params.prompt.length}`;
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
  return null;
}

export function buildRequestBody(params: TextToImageParams): Record<string, unknown> {
  return {
    model: params.model,
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio,
    n: params.n,
    response_format: "url",
  };
}

export function parseResponse(json: unknown): TextToImageResult {
  const resp = json as {
    data?: { image_urls?: string[] };
    metadata?: {
      success_count?: number | string;
      failed_count?: number | string;
    };
    base_resp?: MiniMaxBaseResp;
  };
  const baseResp = resp.base_resp;
  if (baseResp && baseResp.status_code !== 0) {
    const code = baseResp.status_code;
    const mapped = STATUS_CODE_MESSAGES[code as number];
    throw new Error(
      mapped ?? `MiniMax 返回错误 (code=${code}): ${baseResp.status_msg ?? "未知错误"}`,
    );
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

export async function textToImage(
  params: TextToImageParams,
  apiKey: string,
): Promise<TextToImageResult> {
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
