"use client";

import { useState, type ChangeEvent } from "react";
import {
  DEFAULT_VIDEO_DURATION,
  DEFAULT_VIDEO_RESOLUTION,
  RESOLUTIONS_BY_DURATION,
  VIDEO_DURATIONS,
  VIDEO_FRAME_MAX_BYTES,
  VIDEO_FRAME_TYPES,
  VIDEO_PROMPT_MAX_LENGTH,
  VIDEO_RESOLUTIONS,
  type VideoDuration,
  type VideoResolution,
} from "@/lib/video";

export interface VideoSubmitRequest {
  prompt: string;
  duration: VideoDuration;
  resolution: VideoResolution;
  /** 空字符串表示不提供尾帧；本地上传为 Data URL，同批图为 /generated/ 路径 */
  lastFrameImage: string;
}

interface VideoDialogProps {
  initialPrompt: string;
  submitting: boolean;
  error: string | null;
  /** 同批次其他图片的本地路径，可选作尾帧 */
  otherImages: string[];
  onClose: () => void;
  onSubmit: (req: VideoSubmitRequest) => void;
}

export function VideoDialog({
  initialPrompt,
  submitting,
  error,
  otherImages,
  onClose,
  onSubmit,
}: VideoDialogProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [duration, setDuration] = useState<VideoDuration>(DEFAULT_VIDEO_DURATION);
  const [resolution, setResolution] = useState<VideoResolution>(DEFAULT_VIDEO_RESOLUTION);
  const [lastFrameImage, setLastFrameImage] = useState("");
  const [lastFrameError, setLastFrameError] = useState<string | null>(null);

  const allowedResolutions = RESOLUTIONS_BY_DURATION[duration];

  function handleLastFrameFile(e: ChangeEvent<HTMLInputElement>) {
    setLastFrameError(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      return;
    }
    if (!VIDEO_FRAME_TYPES.includes(file.type)) {
      setLastFrameError("尾帧仅支持 JPG / PNG / WebP 格式");
      return;
    }
    if (file.size > VIDEO_FRAME_MAX_BYTES) {
      setLastFrameError("尾帧图片不能超过 20MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLastFrameImage(reader.result as string);
    reader.onerror = () => setLastFrameError("读取尾帧图片失败，请重试");
    reader.readAsDataURL(file);
  }

  function handleDurationChange(next: VideoDuration) {
    setDuration(next);
    if (!RESOLUTIONS_BY_DURATION[next].includes(resolution)) {
      setResolution(RESOLUTIONS_BY_DURATION[next][0]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
            生成视频
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={VIDEO_PROMPT_MAX_LENGTH}
          rows={4}
          placeholder="描述画面如何运动，例如：镜头缓缓推近，猫眨了眨眼，雨丝飘落"
          className="rounded-lg border border-zinc-300 bg-white p-3 text-sm text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
        />

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            时长
            <select
              value={duration}
              onChange={(e) => handleDurationChange(Number(e.target.value) as VideoDuration)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            >
              {VIDEO_DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} 秒
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            分辨率
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as VideoResolution)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            >
              {VIDEO_RESOLUTIONS.map((r) => (
                <option
                  key={r}
                  value={r}
                  disabled={!allowedResolutions.includes(r)}
                >
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            尾帧（可选，视频将从首帧渐变到尾帧）
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {lastFrameImage ? (
              <div className="relative">
                {/* 同批图为本地路径，上传图为 Data URL，统一用 img 预览 */}
                <img
                  src={lastFrameImage}
                  alt="已选尾帧"
                  className="h-16 w-16 rounded-md border border-zinc-400 object-cover dark:border-zinc-500"
                />
                <button
                  type="button"
                  onClick={() => setLastFrameImage("")}
                  aria-label="清除尾帧"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs text-white hover:bg-zinc-600"
                >
                  ✕
                </button>
              </div>
            ) : (
              <>
                {otherImages.map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setLastFrameImage(src)}
                    className="rounded-md border border-zinc-200 transition-opacity hover:opacity-80 dark:border-zinc-700"
                    aria-label="选用该图作尾帧"
                  >
                    <img src={src} alt="" className="h-16 w-16 rounded-md object-cover" />
                  </button>
                ))}
                <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-zinc-300 text-xs text-zinc-500 hover:border-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
                  上传
                  <input
                    type="file"
                    accept={VIDEO_FRAME_TYPES.join(",")}
                    onChange={handleLastFrameFile}
                    className="hidden"
                  />
                </label>
              </>
            )}
          </div>
          {lastFrameError && (
            <p className="text-xs text-red-600 dark:text-red-400">{lastFrameError}</p>
          )}
        </div>

        <p className="text-xs text-zinc-500">
          {allowedResolutions.length < VIDEO_RESOLUTIONS.length
            ? `${duration} 秒视频仅支持 ${allowedResolutions.join(" / ")}`
            : `时长 ${VIDEO_DURATIONS.join(" / ")} 秒；生成约需几分钟`}
        </p>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onSubmit({ prompt, duration, resolution, lastFrameImage })}
            className="rounded-full bg-black px-5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-300"
          >
            {submitting ? "提交中…" : "开始生成"}
          </button>
        </div>
      </div>
    </div>
  );
}
