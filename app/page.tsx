"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type SubmitEvent,
} from "react";
import {
  ASPECT_RATIOS,
  MODELS,
  N_MAX,
  N_MIN,
  PROMPT_MAX_LENGTH,
  REFERENCE_MAX_BYTES,
  STYLE_MAX_LENGTH,
  STYLE_PRESETS,
  type AspectRatio,
  type Model,
} from "@/lib/minimax";
import type { GeneratedImage, HistoryEntry } from "@/lib/storage";

const CUSTOM_STYLE = "自定义";

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
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [failedCount, setFailedCount] = useState(0);
  const [lastRequest, setLastRequest] = useState<GenerateRequest | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

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
  }, []);

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
        void refreshHistory();
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

  const skeletonRatio = aspectRatio.replace(":", " / ");

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

          <label className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
            风格
            <select
              value={styleChoice}
              onChange={(e) => setStyleChoice(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            >
              <option value="">无</option>
              {STYLE_PRESETS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value={CUSTOM_STYLE}>{CUSTOM_STYLE}</option>
            </select>
          </label>
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
            <button
              type="button"
              onClick={handleRegenerate}
              className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              再创作一批
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {images.map((img, i) => (
              <figure key={`${img.localUrl}-${i}`} className="flex flex-col gap-2">
                <img
                  src={img.localUrl}
                  alt={`生成图片 ${i + 1}`}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800"
                />
                <figcaption className="flex gap-4 text-sm">
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
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
            历史生成
          </h2>
          {history.map((entry) => (
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
                <button
                  type="button"
                  onClick={() => handleLoadEntry(entry)}
                  className="shrink-0 rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  载入参数
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {entry.images.map((img, i) => (
                  <button
                    key={`${entry.id}-${img.localUrl}-${i}`}
                    type="button"
                    onClick={() => handleUseAsReference(img.localUrl)}
                    title="作为参考图"
                    className="group relative"
                  >
                    <img
                      src={img.localUrl}
                      alt={`历史图片 ${i + 1}`}
                      className="h-20 w-20 rounded-md border border-zinc-200 object-cover transition-opacity group-hover:opacity-80 dark:border-zinc-800"
                    />
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-black/0 text-xs text-transparent transition-colors group-hover:bg-black/40 group-hover:text-white">
                      作参考
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
