"use client";

import { useEffect } from "react";
import type { GeneratedImage } from "@/lib/storage";

interface LightboxProps {
  images: GeneratedImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onUseAsReference: (url: string) => void;
}

export function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
  onUseAsReference,
}: LightboxProps) {
  const total = images.length;

  function prev() {
    onIndexChange((index - 1 + total) % total);
  }

  function next() {
    onIndexChange((index + 1) % total);
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        prev();
      } else if (e.key === "ArrowRight") {
        next();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  const image = images[index];
  const fileName = image.localUrl.split("/").pop();

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80dvh] max-w-full items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {total > 1 && (
          <button
            type="button"
            onClick={prev}
            aria-label="上一张"
            className="mx-1 shrink-0 rounded-full bg-white/10 px-3 py-2 text-white transition-colors hover:bg-white/25"
          >
            ‹
          </button>
        )}
        <img
          src={image.localUrl}
          alt={`预览 ${index + 1}`}
          className="max-h-[80dvh] max-w-[90vw] rounded-lg object-contain"
        />
        {total > 1 && (
          <button
            type="button"
            onClick={next}
            aria-label="下一张"
            className="mx-1 shrink-0 rounded-full bg-white/10 px-3 py-2 text-white transition-colors hover:bg-white/25"
          >
            ›
          </button>
        )}
      </div>

      <div
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-zinc-400">
          {index + 1} / {total}
        </span>
        <button
          type="button"
          onClick={() => onUseAsReference(image.localUrl)}
          className="text-white underline hover:text-zinc-300"
        >
          作为参考图
        </button>
        <a
          href={image.localUrl}
          download={fileName}
          className="text-white underline hover:text-zinc-300"
        >
          下载
        </a>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 underline hover:text-white"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
