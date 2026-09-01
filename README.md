# IMAGE GEN

核心功能：调用大模型生成图片，支持文生图、图生图。

一期仅支持 MiniMax H3。

## 功能

- **文生图**：输入文字描述，选择模型（`image-01` / `image-01-live`）、宽高比与生成数量（1-9），调用 MiniMax `image_generation` 接口生成图片。API Key 仅存于服务端，浏览器不直接接触密钥。
- **图生图**：在同一表单上传参考图（JPG / PNG，< 10MB，建议人物主体清晰），即以 `subject_reference` 调用同一接口进行人物主体参考生成；不传图则为文生图。

## 快速开始

1. 环境要求：Node.js >= 22，pnpm
2. 安装依赖：`pnpm install`
3. 配置密钥：复制 `.env.example` 为 `.env.local`，填入 `MINIMAX_API_KEY`
4. 开发运行：`pnpm dev`，打开 http://localhost:3000

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 开发服务器 |
| `pnpm build` | 生产构建 |
| `pnpm lint` | 语法检查 |
| `pnpm test` | 单元测试（Vitest，表格驱动） |

## 项目结构

- `app/page.tsx` — 文生图表单页面
- `app/api/generate/route.ts` — 生成接口 Route Handler（参数校验、密钥读取、错误映射）
- `lib/minimax.ts` — MiniMax 客户端（请求构造 / 响应解析 / fetch 封装）
- `lib/minimax.test.ts` — 单元测试

## 说明

- 接口返回的图片 URL 有效期为 24 小时。
- 生成超时时间为 120 秒。
