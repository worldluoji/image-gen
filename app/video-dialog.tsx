"use client";

import { useState } from "react";
import {
  DEFAULT_VIDEO_DURATION,
  DEFAULT_VIDEO_RESOLUTION,
  RESOLUTIONS_BY_DURATION,
  VIDEO_DURATIONS,
  VIDEO_PROMPT_MAX_LENGTH,
  VIDEO_RESOLUTIONS,
  type VideoDuration,
  type VideoResolution,
} from "@/lib/video";

export interface VideoSubmitRequest {
  prompt: string;
  duration: VideoDuration;
  resolution: VideoResolution;
}

interface VideoDialogProps {
  initialPrompt: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (req: VideoSubmitRequest) => void;
}

export function VideoDialog({
  initialPrompt,
  submitting,
  error,
  onClose,
  onSubmit,
}: VideoDialogProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [duration, setDuration] = useState<VideoDuration>(DEFAULT_VIDEO_DURATION);
  const [resolution, setResolution] = useState<VideoResolution>(DEFAULT_VIDEO_RESOLUTION);

  const allowedResolutions = RESOLUTIONS_BY_DURATION[duration];

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
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900"
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
            onClick={() => onSubmit({ prompt, duration, resolution })}
            className="rounded-full bg-black px-5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-300"
          >
            {submitting ? "提交中…" : "开始生成"}
          </button>
        </div>
      </div>
    </div>
  );
}
