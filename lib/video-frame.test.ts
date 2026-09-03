import { describe, expect, it } from "vitest";
import {
  FRAME_JPEG_QUALITY,
  FRAME_SEEK_BACKFILL_SEC,
  frameSeekTime,
} from "./video-frame";

describe("frameSeekTime", () => {
  const cases: { name: string; duration: number; want: number }[] = [
    { name: "常规 10 秒视频回退安全余量", duration: 10, want: 9.9 },
    { name: "常规 6 秒视频回退安全余量", duration: 6, want: 5.9 },
    { name: "时长恰好等于余量时钳到 0", duration: FRAME_SEEK_BACKFILL_SEC, want: 0 },
    { name: "时长小于余量时钳到 0", duration: 0.05, want: 0 },
    { name: "时长为 0 返回 0", duration: 0, want: 0 },
    { name: "负时长返回 0", duration: -3, want: 0 },
    { name: "NaN 返回 0", duration: NaN, want: 0 },
    { name: "Infinity 返回 0", duration: Infinity, want: 0 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(frameSeekTime(c.duration)).toBeCloseTo(c.want, 10);
    });
  }
});

describe("常量", () => {
  it("JPEG 质量在 (0, 1] 区间", () => {
    expect(FRAME_JPEG_QUALITY).toBeGreaterThan(0);
    expect(FRAME_JPEG_QUALITY).toBeLessThanOrEqual(1);
  });
});
