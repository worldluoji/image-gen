export const FRAME_SEEK_BACKFILL_SEC = 0.1;
export const FRAME_JPEG_QUALITY = 0.92;

// mp4 的 duration 在个别浏览器有微小误差，贴边 seek 可能落在最后一个不可解码帧上，
// 故统一向前留一段安全余量
export function frameSeekTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.max(duration - FRAME_SEEK_BACKFILL_SEC, 0);
}

export function extractLastFrame(videoUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");

    function cleanup() {
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    }

    function fail(message: string) {
      cleanup();
      reject(new Error(message));
    }

    video.muted = true;
    video.preload = "auto";
    video.onerror = () => fail("视频加载失败，无法截取尾帧");
    video.onloadedmetadata = () => {
      video.currentTime = frameSeekTime(video.duration);
    };
    video.onseeked = () => {
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        fail("视频尺寸无效，无法截取尾帧");
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        fail("浏览器不支持 Canvas，无法截取尾帧");
        return;
      }
      ctx.drawImage(video, 0, 0);
      cleanup();
      resolve(canvas.toDataURL("image/jpeg", FRAME_JPEG_QUALITY));
    };
    video.src = videoUrl;
  });
}
