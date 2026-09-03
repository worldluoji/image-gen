import {
  PROMPT_MAX_LENGTH,
  baseRespError,
  requestMiniMax,
} from "./minimax";

export const POLISH_PATH = "/v1/chat/completions";
export const POLISH_MODEL = "MiniMax-Text-01";
export const POLISH_TIMEOUT_MS = 30_000;
export const POLISH_MAX_TOKENS = 1024;

export const POLISH_SYSTEM_PROMPT =
  "你是文生图提示词扩写助手。用户会给出一个画面的大白话描述，" +
  "请把它扩写成一段更具体的绘图提示词：保留用户的意图与画面主体，" +
  "补充细节、构图、光线与氛围。用中文描述，只输出提示词本身，不要解释、不要加引号。";

const FENCE_RE = /^```[^\n]*\n?([\s\S]*?)\n?```$/;

export function buildPolishRequest(prompt: string): Record<string, unknown> {
  return {
    model: POLISH_MODEL,
    messages: [
      { role: "system", content: POLISH_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    max_tokens: POLISH_MAX_TOKENS,
  };
}

/** 解析文本补全响应：校验 base_resp → 取 content → 剥代码围栏与首尾引号 → 空则抛错 → 超长截断 */
export function parsePolishResponse(json: unknown): string {
  const resp = json as {
    choices?: { message?: { content?: string } }[];
    base_resp?: { status_code?: number; status_msg?: string };
  };
  const baseError = baseRespError(resp.base_resp);
  if (baseError) {
    throw baseError;
  }
  const raw = resp.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("MiniMax 未返回润色结果");
  }
  let text = raw.trim();
  const fenced = FENCE_RE.exec(text);
  if (fenced) {
    text = fenced[1].trim();
  }
  text = text
    .replace(/^["“「]/, "")
    .replace(/["”」]$/, "")
    .trim();
  if (text === "") {
    throw new Error("MiniMax 未返回润色结果");
  }
  return text.length > PROMPT_MAX_LENGTH
    ? text.slice(0, PROMPT_MAX_LENGTH)
    : text;
}

export async function polishPrompt(
  prompt: string,
  apiKey: string,
): Promise<string> {
  const json = await requestMiniMax(
    POLISH_PATH,
    { method: "POST", body: JSON.stringify(buildPolishRequest(prompt)) },
    apiKey,
    POLISH_TIMEOUT_MS,
  );
  return parsePolishResponse(json);
}
