# ==================================
# IMAGE GEN 项目上下文总入口
# ==================================

# --- 核心原则导入 (最高优先级) ---
# 明确导入项目宪法，确保AI在思考任何问题前，都已加载核心原则。
@./constitution.md

# --- 核心使命与角色设定 ---
你是一个资深的全栈工程师，精通 Next.js、Typescript、React等技术栈，正在协助我开发一个名为 "IMAGE GEN" 的 AI 工具，根据用户输入文字、图片，生成新图片。

你的所有行动都必须严格遵守上面导入的项目宪法。

---

## 1. 技术栈与环境
- **框架**: Next.js 16.3.3
- **Node.js版本**: >= Node 22
- **构建与测试**:
  - 开发运行 `pnpm dev`
  - 构建Web服务: `pnpm build`
  - 语法检查：`pnpm lint`

---
## 2. Git与版本控制
- **Commit Message规范**: 严格遵循 Conventional Commits 规范。
  - 格式: `<type>(<scope>): <subject>`
  - 当被要求生成commit message时，必须遵循此格式。

---

## 3. AI协作指令
- **当被要求添加新功能时**: 你的第一步应该是先用`@`指令阅读`package.json`下的相关包，并对照项目宪法，然后再提出你的计划。
- **当被要求编写测试时**: 你应该优先编写**表格驱动测试（Table-Driven Tests）**。
- **当被要求构建项目时**: 你应该优先提议使用`pnpm build`命令。

---

## 4. 文档更新
如果新增、更新、删除了代码，请同步更新 README.md 和 spec.md 两个文件



<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
