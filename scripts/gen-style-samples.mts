// 一次性脚本：为每个 STYLE_PRESET 生成一张示例图，落盘 public/styles/ 供风格卡片展示。
// 用法：node --env-file=.env.local scripts/gen-style-samples.mts
// 注意：样图按 STYLE_PRESETS 索引命名（0.png…），改动预设顺序或内容后需重跑本脚本。
import { join } from "node:path";
import { STYLE_PRESETS, generateImages } from "../lib/minimax.ts";
import { saveGeneratedFile } from "../lib/storage.ts";

const SAMPLE_PROMPT = "一位戴红色围巾的雪人站在月光下的松林前";
const SAMPLE_DIR = join(process.cwd(), "public", "styles");

const apiKey = process.env.MINIMAX_API_KEY;
if (!apiKey) {
  console.error("缺少 MINIMAX_API_KEY，请通过 --env-file=.env.local 传入");
  process.exit(1);
}

for (let i = 0; i < STYLE_PRESETS.length; i++) {
  const style = STYLE_PRESETS[i];
  console.log(`[${i + 1}/${STYLE_PRESETS.length}] 生成「${style}」…`);
  try {
    const result = await generateImages(
      {
        model: "image-01",
        prompt: SAMPLE_PROMPT,
        aspectRatio: "1:1",
        n: 1,
        style,
      },
      apiKey,
    );
    const saved = await saveGeneratedFile(
      result.imageUrls[0],
      `${i}.png`,
      SAMPLE_DIR,
    );
    if (!saved) {
      console.error(`  「${style}」下载落盘失败`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`  「${style}」生成失败:`, err);
    process.exitCode = 1;
  }
}

console.log(
  process.exitCode
    ? "完成，但存在失败项，可重跑脚本仅补齐缺失样图"
    : `全部完成，样图位于 public/styles/`,
);
