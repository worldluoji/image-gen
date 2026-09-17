import {
  ASPECT_RATIOS,
  CUSTOM_STYLE,
  MODELS,
  N_MAX,
  N_MIN,
  PROMPT_MAX_LENGTH,
  STYLE_MAX_LENGTH,
  STYLE_PRESETS,
  type AspectRatio,
  type Model,
} from "./minimax";
import {
  DEFAULT_VIDEO_DURATION,
  DEFAULT_VIDEO_RESOLUTION,
  RESOLUTIONS_BY_DURATION,
  VIDEO_DURATIONS,
  type VideoDuration,
  type VideoResolution,
} from "./video";

export const IMAGE_PREFS_KEY = "image-gen:image-prefs";
export const VIDEO_PREFS_KEY = "image-gen:video-prefs";
export const DRAFT_KEY = "image-gen:prompt-draft";

export interface ImageFormPrefs {
  model: Model;
  aspectRatio: AspectRatio;
  n: number;
  styleChoice: string;
  customStyle: string;
}

export interface VideoFormPrefs {
  duration: VideoDuration;
  resolution: VideoResolution;
}

export const DEFAULT_IMAGE_PREFS: ImageFormPrefs = {
  model: "image-01",
  aspectRatio: "1:1",
  n: 1,
  styleChoice: "",
  customStyle: "",
};

export const DEFAULT_VIDEO_PREFS: VideoFormPrefs = {
  duration: DEFAULT_VIDEO_DURATION,
  resolution: DEFAULT_VIDEO_RESOLUTION,
};

function readObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseImagePrefs(raw: string | null): ImageFormPrefs {
  const obj = readObject(raw);
  if (!obj) {
    return DEFAULT_IMAGE_PREFS;
  }
  const { model, aspectRatio, n, styleChoice, customStyle } = obj;
  return {
    model: (MODELS as readonly string[]).includes(model as string)
      ? (model as Model)
      : DEFAULT_IMAGE_PREFS.model,
    aspectRatio: (ASPECT_RATIOS as readonly string[]).includes(aspectRatio as string)
      ? (aspectRatio as AspectRatio)
      : DEFAULT_IMAGE_PREFS.aspectRatio,
    n:
      typeof n === "number" && Number.isInteger(n) && n >= N_MIN && n <= N_MAX
        ? n
        : DEFAULT_IMAGE_PREFS.n,
    styleChoice:
      styleChoice === "" ||
      styleChoice === CUSTOM_STYLE ||
      (STYLE_PRESETS as readonly string[]).includes(styleChoice as string)
        ? (styleChoice as string)
        : DEFAULT_IMAGE_PREFS.styleChoice,
    customStyle:
      typeof customStyle === "string"
        ? customStyle.slice(0, STYLE_MAX_LENGTH)
        : DEFAULT_IMAGE_PREFS.customStyle,
  };
}

export function parseVideoPrefs(raw: string | null): VideoFormPrefs {
  const obj = readObject(raw);
  if (!obj) {
    return DEFAULT_VIDEO_PREFS;
  }
  const duration: VideoDuration = (VIDEO_DURATIONS as readonly number[]).includes(
    obj.duration as number,
  )
    ? (obj.duration as VideoDuration)
    : DEFAULT_VIDEO_PREFS.duration;
  const allowed = RESOLUTIONS_BY_DURATION[duration];
  const stored = obj.resolution;
  const resolution: VideoResolution =
    typeof stored === "string" && (allowed as readonly string[]).includes(stored)
      ? (stored as VideoResolution)
      : allowed.includes(DEFAULT_VIDEO_PREFS.resolution)
        ? DEFAULT_VIDEO_PREFS.resolution
        : allowed[0];
  return { duration, resolution };
}

export function parsePromptDraft(raw: string | null): string {
  if (raw === null) {
    return "";
  }
  return raw.slice(0, PROMPT_MAX_LENGTH);
}

// localStorage 在隐私模式等场景可能抛异常或不可用；读写失败一律静默，绝不影响主流程
export function storageGet(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存储不可用或已满时放弃持久化
  }
}
