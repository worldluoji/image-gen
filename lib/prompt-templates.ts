import type { HistoryEntry } from "./storage";

export interface PromptTemplate {
  label: string;
  prompt: string;
}

// 各风格的通用示例，供用户点选快速起步；描述保持日常口语，不套用术语
export const PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  {
    label: "人像",
    prompt: "一个扎马尾的女孩站在雨后的街道上回头微笑，晚风吹起发丝，暖色路灯在背景晕开光斑",
  },
  {
    label: "风景",
    prompt: "清晨的高山湖泊，水面如镜倒映雪峰，湖边有一条蜿蜒的木栈道通向画面深处，薄雾未散",
  },
  {
    label: "城市夜景",
    prompt: "从高层天台俯瞰的城市夜景，街道车灯拉出光轨，远处楼宇灯火密集，天空有淡淡的云",
  },
  {
    label: "产品海报",
    prompt: "一瓶香水放在浅灰色石台上，柔和的顶光，背景有植物叶片的投影，画面留白充足",
  },
  {
    label: "绘本场景",
    prompt: "森林里的小木屋前，一只兔子和一只狐狸围着篝火烤棉花糖，头顶是密集的星星",
  },
  {
    label: "桌面壁纸",
    prompt: "巨大的行星悬在荒凉沙漠的地平线上方，沙丘呈柔和的曲线，画面色彩以紫橙渐变为主，氛围安静",
  },
];

export const RECENT_PROMPTS_MAX = 5;

/** 从历史中提取最近用过的描述：去除首尾空格、过滤空白、按最新在前去重 */
export function recentPrompts(
  history: HistoryEntry[],
  limit: number = RECENT_PROMPTS_MAX,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of history) {
    const trimmed = entry.prompt.trim();
    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}
