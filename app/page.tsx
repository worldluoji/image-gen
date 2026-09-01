"use client";

import { useState, type SubmitEvent } from "react";
import {
  ASPECT_RATIOS,
  MODELS,
  N_MAX,
  N_MIN,
  PROMPT_MAX_LENGTH,
  type AspectRatio,
  type Model,
} from "@/lib/minimax";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<Model>("image-01");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [n, setN] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    if (prompt.trim() === "") {
      setError("请输入图片描述");
      return;
    }
    setLoading(true);
    setImages([]);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model, aspectRatio, n }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `请求失败 (HTTP ${res.status})`);
      } else {
        setImages(data.images);
      }
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

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

      {images.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {images.map((url, i) => (
            <img
              key={`${url}-${i}`}
              src={url}
              alt={`生成图片 ${i + 1}`}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800"
            />
          ))}
        </div>
      )}
    </main>
  );
}
