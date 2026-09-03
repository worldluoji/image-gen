"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type SubmitEvent,
} from "react";
import {
  VIDEO_POLL_INTERVAL_MS,
  VIDEO_POLL_TIMEOUT_MS,
} from "@/lib/video";
import { VideoDialog, type VideoSubmitRequest } from "./video-dialog";
import { Lightbox } from "./lightbox";
import {
  ASPECT_RATIOS,
  MODELS,
  N_MAX,
  N_MIN,
  PROMPT_MAX_LENGTH,
  REFERENCE_MAX_BYTES,
  STYLE_MAX_LENGTH,
  STYLE_PRESETS,
  STYLE_SAMPLE_IMAGES,
  type AspectRatio,
  type Model,
} from "@/lib/minimax";
import type { GeneratedImage, HistoryEntry } from "@/lib/storage";
import type { UsageDay } from "@/lib/usage";
import { PROMPT_TEMPLATES, recentPrompts } from "@/lib/prompt-templates";

const CUSTOM_STYLE = "自定义";

interface VideoTask {
  phase: "submitting" | "generating" | "done" | "error";
  historyId: string;
  imageIndex: number;
  taskId?: string;
  startedAt?: number;
  videoUrl?: string;
  error?: string;
  /** 提交时的弹窗参数，失败后就地重试复用 */
  req?: VideoSubmitRequest;
}

// 视频任务以「历史条目:图片序号」为键，刷新后可从历史播种恢复，多批次互不覆盖
function videoKey(historyId: string, imageIndex: number): string {
  return `${historyId}:${imageIndex}`;
}

interface GenerateRequest {
  prompt: string;
  model: Model;
  aspectRatio: AspectRatio;
  n: number;
  style: string;
  subjectReference?: { type: "character"; imageFile: string }[];
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<Model>("image-01");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [n, setN] = useState(1);
  const [styleChoice, setStyleChoice] = useState("");
  const [customStyle, setCustomStyle] = useState("");
  const [refImage, setRefImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [polishLoading, setPolishLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [failedCount, setFailedCount] = useState(0);
  const [lastRequest, setLastRequest] = useState<GenerateRequest | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lastHistoryId, setLastHistoryId] = useState<string | null>(null);
  const [dialogTarget, setDialogTarget] = useState<{
    historyId: string;
    imageIndex: number;
    imageFile: string;
    prompt: string;
  } | null>(null);
  const [lightbox, setLightbox] = useState<{
    images: GeneratedImage[];
    index: number;
  } | null>(null);
  const [videoTasks, setVideoTasks] = useState<Record<string, VideoTask>>({});
  const [usage, setUsage] = useState<UsageDay | null>(null);

  const refreshUsage = useCallback(() => {
    fetch("/api/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setUsage(data);
        }
      })
      .catch(() => {
        // 用量加载失败不影响主流程，静默处理
      });
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      if (res.ok) {
        setHistory(data.history);
      }
    } catch {
      // 历史加载失败不影响主流程，静默处理
    }
  }, []);

  useEffect(() => {
    fetch("/api/history")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.history) {
          setHistory(data.history);
        }
      })
      .catch(() => {
        // 历史加载失败不影响主流程，静默处理
      });
    void refreshUsage();
  }, [refreshUsage]);

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setRefImage(null);
      return;
    }
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setRefImage(null);
      setError("参考图仅支持 JPG / PNG 格式");
      return;
    }
    if (file.size > REFERENCE_MAX_BYTES) {
      setRefImage(null);
      setError("参考图不能超过 10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setRefImage(reader.result as string);
    reader.onerror = () => setError("读取参考图失败，请重试");
    reader.readAsDataURL(file);
  }

  async function runGeneration(request: GenerateRequest) {
    setError(null);
    setLoading(true);
    setImages([]);
    setFailedCount(0);
    setLastRequest(request);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `请求失败 (HTTP ${res.status})`);
      } else {
        setImages(data.images);
        setFailedCount(data.failedCount ?? 0);
        setLastHistoryId(data.historyId ?? null);
        void refreshHistory();
        void refreshUsage();
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (prompt.trim() === "") {
      setError("请输入图片描述");
      return;
    }
    void runGeneration({
      prompt,
      model,
      aspectRatio,
      n,
      style:
        styleChoice === CUSTOM_STYLE ? customStyle.trim() : styleChoice,
      ...(refImage
        ? { subjectReference: [{ type: "character" as const, imageFile: refImage }] }
        : {}),
    });
  }

  function handleRegenerate() {
    if (lastRequest) {
      void runGeneration(lastRequest);
    }
  }

  async function handlePolish() {
    setError(null);
    setPolishLoading(true);
    try {
      const res = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `请求失败 (HTTP ${res.status})`);
      } else {
        setPrompt(data.prompt);
        void refreshUsage();
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setPolishLoading(false);
    }
  }

  function handleUseAsReference(imageUrl: string) {
    setError(null);
    setRefImage(imageUrl);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleLoadEntry(entry: HistoryEntry) {
    setError(null);
    setPrompt(entry.prompt);
    setModel(entry.model);
    setAspectRatio(entry.aspectRatio);
    setN(entry.n);
    if (entry.style && (STYLE_PRESETS as readonly string[]).includes(entry.style)) {
      setStyleChoice(entry.style);
    } else if (entry.style) {
      setStyleChoice(CUSTOM_STYLE);
      setCustomStyle(entry.style);
    } else {
      setStyleChoice("");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDeleteEntry(entry: HistoryEntry) {
    if (!window.confirm("删除这批生成记录及其文件？不可恢复。")) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/history/${entry.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `删除失败 (HTTP ${res.status})`);
        return;
      }
      const prefix = `${entry.id}:`;
      setVideoTasks((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(prefix)) {
            delete next[key];
          }
        }
        return next;
      });
      // 删掉的正是当前批次：撤下结果区，保持记录与展示一致
      if (entry.id === lastHistoryId) {
        setLastHistoryId(null);
        setImages([]);
        setFailedCount(0);
        setDialogTarget(null);
      }
      void refreshHistory();
    } catch {
      setError("网络错误，请稍后重试");
    }
  }

  async function handleTogglePin(entry: HistoryEntry) {
    const nextPinned = !entry.pinned;
    setError(null);
    // 乐观更新，失败时以服务端为准回滚
    setHistory((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, pinned: nextPinned } : e)),
    );
    try {
      const res = await fetch(`/api/history/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? `更新收藏失败 (HTTP ${res.status})`);
        void refreshHistory();
      }
    } catch {
      setError("网络错误，请稍后重试");
      void refreshHistory();
    }
  }

  function updateVideoTask(key: string, patch: VideoTask) {
    setVideoTasks((prev) => ({ ...prev, [key]: patch }));
  }

  // 进行中的视频任务 = 历史里的 pendingVideo ∪ 本机交互状态；本机状态优先，
  // 因此刷新后能恢复轮询，而本机已有的 done/error 不被覆盖
  const activeVideoTasks = useMemo(() => {
    const derived: Record<string, VideoTask> = {};
    for (const entry of history) {
      entry.images.forEach((img, i) => {
        if (img.pendingVideo && !img.videoUrl) {
          derived[videoKey(entry.id, i)] = {
            phase: "generating",
            historyId: entry.id,
            imageIndex: i,
            taskId: img.pendingVideo.taskId,
            startedAt: img.pendingVideo.startedAt,
          };
        }
      });
    }
    return { ...derived, ...videoTasks };
  }, [history, videoTasks]);

  function submitVideoTask(
    historyId: string,
    imageIndex: number,
    req: VideoSubmitRequest,
    imageFile: string,
  ) {
    const key = videoKey(historyId, imageIndex);
    updateVideoTask(key, { phase: "submitting", historyId, imageIndex, req });
    void (async () => {
      try {
        const res = await fetch("/api/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageFile, historyId, imageIndex, ...req }),
        });
        const data = await res.json();
        if (!res.ok) {
          updateVideoTask(key, {
            phase: "error",
            historyId,
            imageIndex,
            req,
            error: data.error ?? `请求失败 (HTTP ${res.status})`,
          });
        } else {
          updateVideoTask(key, {
            phase: "generating",
            historyId,
            imageIndex,
            req,
            taskId: data.taskId,
            startedAt: Date.now(),
          });
          setDialogTarget(null);
        }
      } catch {
        updateVideoTask(key, {
          phase: "error",
          historyId,
          imageIndex,
          req,
          error: "网络错误，请稍后重试",
        });
      }
    })();
  }

  function handleVideoSubmit(req: VideoSubmitRequest) {
    if (!dialogTarget) {
      return;
    }
    submitVideoTask(
      dialogTarget.historyId,
      dialogTarget.imageIndex,
      req,
      dialogTarget.imageFile,
    );
  }

  const inflightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const generating = Object.values(activeVideoTasks).some((t) => t.phase === "generating");
    if (!generating) {
      return;
    }
    const timer = setInterval(() => {
      void (async () => {
        for (const [key, task] of Object.entries(activeVideoTasks)) {
          if (task.phase !== "generating" || !task.taskId) {
            continue;
          }
          if (inflightRef.current.has(key)) {
            continue;
          }
          if (task.startedAt && Date.now() - task.startedAt > VIDEO_POLL_TIMEOUT_MS) {
            updateVideoTask(key, { ...task, phase: "error", error: "视频生成超时，请重试" });
            continue;
          }
          inflightRef.current.add(key);
          try {
            const params = new URLSearchParams({
              taskId: task.taskId,
              historyId: task.historyId,
              imageIndex: String(task.imageIndex),
            });
            const res = await fetch(`/api/video?${params}`);
            const data = await res.json();
            if (!res.ok) {
              updateVideoTask(key, {
                ...task,
                phase: "error",
                error: data.error ?? `查询失败 (HTTP ${res.status})`,
              });
            } else if (data.status === "Success") {
              updateVideoTask(key, { ...task, phase: "done", videoUrl: data.videoUrl });
              void refreshHistory();
              void refreshUsage();
            } else if (data.status === "Fail") {
              updateVideoTask(key, {
                ...task,
                phase: "error",
                error: data.error ?? "视频生成失败",
              });
            }
          } catch {
            // 单次轮询网络异常忽略，由超时窗口兜底
          } finally {
            inflightRef.current.delete(key);
          }
        }
      })();
    }, VIDEO_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeVideoTasks, refreshHistory, refreshUsage]);

  const recent = recentPrompts(history);
  // 收藏排最前；稳定排序，仅影响展示，recentPrompts / 视频任务派生仍吃原始时间倒序
  const displayHistory = useMemo(
    () =>
      [...history].sort(
        (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)),
      ),
    [history],
  );
  const skeletonRatio = aspectRatio.replace(":", " / ");
  const dialogTask = dialogTarget
    ? activeVideoTasks[videoKey(dialogTarget.historyId, dialogTarget.imageIndex)]
    : undefined;
  // 同批次其他图片可选作尾帧；结果区批次生成后即入历史，故统一从 history 取
  const dialogOtherImages = useMemo(() => {
    if (!dialogTarget) {
      return [];
    }
    const entry = history.find((e) => e.id === dialogTarget.historyId);
    if (!entry) {
      return [];
    }
    return entry.images
      .filter((_, i) => i !== dialogTarget.imageIndex)
      .map((img) => img.localUrl);
  }, [history, dialogTarget]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        AI 文生图 <span className="text-base font-normal text-zinc-500">MiniMax</span>
      </h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={PROMPT_MAX_LENGTH}
          rows={4}
          placeholder="描述你想生成的图片，例如：一只戴帽子的猫走在东京街头，赛博朋克风格"
          className="rounded-lg border border-zinc-300 bg-white p-3 text-sm text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        />

        <div className="-mt-2 flex justify-end">
          <button
            type="button"
            disabled={!prompt.trim() || loading || polishLoading}
            onClick={() => void handlePolish()}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {polishLoading ? "润色中…" : "AI 润色"}
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500">示例</span>
            {PROMPT_TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                disabled={loading}
                onClick={() => setPrompt(t.prompt)}
                className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                {t.label}
              </button>
            ))}
          </div>
          {recent.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">最近</span>
              {recent.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={loading}
                  title={p}
                  onClick={() => setPrompt(p)}
                  className="max-w-56 truncate rounded-full border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            模型
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as Model)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            宽高比
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            >
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            数量
            <input
              type="number"
              min={N_MIN}
              max={N_MAX}
              value={n}
              onChange={(e) => setN(Number(e.target.value))}
              className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            />
          </label>

        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-zinc-700 dark:text-zinc-300">风格</span>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {STYLE_PRESETS.map((s, i) => {
              const selected = styleChoice === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStyleChoice(selected ? "" : s)}
                  aria-pressed={selected}
                  className={`flex flex-col gap-1 rounded-lg border p-1 transition-colors ${
                    selected
                      ? "border-black dark:border-white"
                      : "border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  <img
                    src={STYLE_SAMPLE_IMAGES[i]}
                    alt={`${s}风格示例`}
                    loading="lazy"
                    className="aspect-square w-full rounded-md object-cover"
                  />
                  <span
                    className={`truncate text-center text-xs ${
                      selected
                        ? "font-medium text-black dark:text-white"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {s}
                  </span>
                </button>
              );
            })}
            {(
              [
                { value: "", label: "无" },
                { value: CUSTOM_STYLE, label: CUSTOM_STYLE },
              ] as const
            ).map((chip) => {
              const selected = styleChoice === chip.value;
              return (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() =>
                    setStyleChoice(selected ? "" : chip.value)
                  }
                  aria-pressed={selected}
                  className={`flex flex-col gap-1 rounded-lg border p-1 transition-colors ${
                    selected
                      ? "border-black dark:border-white"
                      : "border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span
                    className={`flex aspect-square w-full items-center justify-center rounded-md border border-dashed text-sm ${
                      selected
                        ? "border-black bg-zinc-100 dark:border-white dark:bg-zinc-800"
                        : "border-zinc-300 dark:border-zinc-700"
                    }`}
                  >
                    {chip.label === CUSTOM_STYLE ? "✎" : "—"}
                  </span>
                  <span
                    className={`truncate text-center text-xs ${
                      selected
                        ? "font-medium text-black dark:text-white"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {chip.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {styleChoice === CUSTOM_STYLE && (
          <input
            type="text"
            value={customStyle}
            maxLength={STYLE_MAX_LENGTH}
            onChange={(e) => setCustomStyle(e.target.value)}
            placeholder="输入自定义风格，例如：复古胶片、水彩插画、3D 皮克斯"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        )}

        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            参考图（可选，上传后即为图生图）
            <input
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleFileSelect}
              className="text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-sm dark:text-zinc-400 dark:file:bg-zinc-800 dark:file:text-white"
            />
            <span className="text-xs text-zinc-500">
              支持 JPG / PNG，小于 10MB；建议上传人物主体清晰的照片，以获得最佳效果
            </span>
          </label>
          {refImage && (
            <div className="flex items-center gap-3">
              <img
                src={refImage}
                alt="参考图预览"
                className="h-20 w-20 rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
              />
              <button
                type="button"
                onClick={() => setRefImage(null)}
                className="text-sm text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                移除参考图
              </button>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="h-11 rounded-full bg-black px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-300"
        >
          {loading ? "生成中，请稍候…" : "生成图片"}
        </button>
      </form>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: n }, (_, i) => (
            <div
              key={i}
              style={{ aspectRatio: skeletonRatio }}
              className="animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800"
            >
              <div className="flex h-full items-center justify-center text-sm text-zinc-400 dark:text-zinc-600">
                第 {i + 1} 张生成中…
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && images.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {failedCount > 0
                ? `成功生成 ${images.length} 张，${failedCount} 张失败`
                : `已生成 ${images.length} 张`}
            </p>
            <div className="flex gap-2">
              {failedCount > 0 && lastRequest && (
                <button
                  type="button"
                  onClick={() =>
                    void runGeneration({ ...lastRequest, n: failedCount })
                  }
                  className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  重试失败的 {failedCount} 张
                </button>
              )}
              <button
                type="button"
                onClick={handleRegenerate}
                className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                再创作一批
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {images.map((img, i) => {
              const task = lastHistoryId
                ? activeVideoTasks[videoKey(lastHistoryId, i)]
                : undefined;
              const videoReq = task?.phase === "error" ? task.req : undefined;
              return (
              <figure key={`${img.localUrl}-${i}`} className="flex flex-col gap-2">
                <img
                  src={img.localUrl}
                  alt={`生成图片 ${i + 1}`}
                  onClick={() => setLightbox({ images, index: i })}
                  className="w-full cursor-zoom-in rounded-lg border border-zinc-200 dark:border-zinc-800"
                />
                <figcaption className="flex flex-col gap-2 text-sm">
                  <div className="flex gap-4">
                    <a
                      href={img.localUrl}
                      download={img.localUrl.split("/").pop()}
                      className="text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      下载
                    </a>
                    <button
                      type="button"
                      onClick={() => handleUseAsReference(img.localUrl)}
                      className="text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      作为参考图
                    </button>
                    <button
                      type="button"
                      disabled={
                        task?.phase === "submitting" ||
                        task?.phase === "generating"
                      }
                      onClick={() => {
                        if (!lastHistoryId) {
                          setError("该图片尚未入库，无法生成视频");
                          return;
                        }
                        setError(null);
                        setDialogTarget({
                          historyId: lastHistoryId,
                          imageIndex: i,
                          imageFile: img.localUrl,
                          prompt: lastRequest?.prompt ?? prompt,
                        });
                      }}
                      className="text-zinc-600 underline hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      生成视频
                    </button>
                  </div>
                  {task?.phase === "submitting" && (
                    <span className="text-zinc-500">提交中…</span>
                  )}
                  {task?.phase === "generating" && (
                    <span className="text-zinc-500">视频生成中，约需几分钟…</span>
                  )}
                  {task?.phase === "error" && (
                    <span className="flex items-center gap-2 text-red-600 dark:text-red-400">
                      {task.error}
                      {videoReq && (
                        <button
                          type="button"
                          onClick={() =>
                            submitVideoTask(
                              task.historyId,
                              task.imageIndex,
                              videoReq,
                              img.localUrl,
                            )
                          }
                          className="underline hover:text-red-800 dark:hover:text-red-200"
                        >
                          重试
                        </button>
                      )}
                    </span>
                  )}
                  {task?.phase === "done" && task.videoUrl && (
                    <div className="flex flex-col gap-1">
                      <video
                        src={task.videoUrl}
                        controls
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800"
                      />
                      <a
                        href={task.videoUrl}
                        download={task.videoUrl.split("/").pop()}
                        className="text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                      >
                        下载视频
                      </a>
                    </div>
                  )}
                </figcaption>
              </figure>
              );
            })}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
            历史生成
          </h2>
          {displayHistory.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm text-zinc-800 dark:text-zinc-200">
                    {entry.prompt}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {new Date(entry.createdAt).toLocaleString()} ·{" "}
                    {entry.aspectRatio} · {entry.images.length} 张
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTogglePin(entry)}
                    title={entry.pinned ? "取消收藏" : "收藏置顶"}
                    className={
                      entry.pinned
                        ? "rounded-md border border-amber-400 bg-amber-50 px-3 py-1 text-xs text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
                        : "rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    }
                  >
                    {entry.pinned ? "★ 已收藏" : "☆ 收藏"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadEntry(entry)}
                    className="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    载入参数
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteEntry(entry)}
                    className="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-900 dark:hover:bg-red-950 dark:hover:text-red-300"
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {entry.images.map((img, i) => {
                  const task = activeVideoTasks[videoKey(entry.id, i)];
                  const videoReq = task?.phase === "error" ? task.req : undefined;
                  const busy =
                    task?.phase === "submitting" || task?.phase === "generating";
                  return (
                  <div key={`${entry.id}-${img.localUrl}-${i}`} className="flex gap-2">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setLightbox({ images: entry.images, index: i })
                        }
                        title="点击放大"
                        className="group relative"
                      >
                        <img
                          src={img.localUrl}
                          alt={`历史图片 ${i + 1}`}
                          className="h-20 w-20 cursor-zoom-in rounded-md border border-zinc-200 object-cover transition-opacity group-hover:opacity-80 dark:border-zinc-800"
                        />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setError(null);
                          setDialogTarget({
                            historyId: entry.id,
                            imageIndex: i,
                            imageFile: img.localUrl,
                            prompt: entry.prompt,
                          });
                        }}
                        className="text-xs text-zinc-600 underline hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-100"
                      >
                        生成视频
                      </button>
                    </div>
                    {img.videoUrl && (
                      <video
                        src={img.videoUrl}
                        controls
                        preload="none"
                        title="生成的视频"
                        className="h-20 w-20 rounded-md border border-zinc-200 object-cover dark:border-zinc-800"
                      />
                    )}
                    {!img.videoUrl && (busy || img.pendingVideo) && (
                      <span className="flex h-20 w-20 animate-pulse items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 p-1 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                        {task?.phase === "submitting" ? "提交中…" : "视频生成中…"}
                      </span>
                    )}
                    {task?.phase === "error" && (
                      <div className="flex h-20 flex-col justify-center gap-1 text-xs text-red-600 dark:text-red-400">
                        <span className="max-w-32">{task.error}</span>
                        {videoReq && (
                          <button
                            type="button"
                            onClick={() =>
                              submitVideoTask(entry.id, i, videoReq, img.localUrl)
                            }
                            className="self-start underline hover:text-red-800 dark:hover:text-red-200"
                          >
                            重试
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      {usage && (
        <footer className="text-center text-xs text-zinc-500">
          今日：图片 {usage.images} · 视频 {usage.videos} · 润色 {usage.polishes}
        </footer>
      )}

      {lightbox && (
        <Lightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox({ ...lightbox, index })}
          onClose={() => setLightbox(null)}
          onUseAsReference={(url) => {
            handleUseAsReference(url);
            setLightbox(null);
          }}
        />
      )}

      {dialogTarget && (
        <VideoDialog
          initialPrompt={dialogTarget.prompt}
          submitting={dialogTask?.phase === "submitting"}
          error={dialogTask?.phase === "error" ? dialogTask.error ?? null : null}
          otherImages={dialogOtherImages}
          onClose={() => setDialogTarget(null)}
          onSubmit={handleVideoSubmit}
        />
      )}
    </main>
  );
}
