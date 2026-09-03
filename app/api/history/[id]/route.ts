import { NextResponse } from "next/server";
import {
  deleteHistoryEntry,
  readHistory,
  setHistoryPin,
} from "@/lib/storage";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少历史记录 id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const pinned = (body as { pinned?: unknown }).pinned;
  if (typeof pinned !== "boolean") {
    return NextResponse.json(
      { error: "pinned 必须是 boolean" },
      { status: 400 },
    );
  }

  try {
    const ok = await setHistoryPin(id, pinned);
    if (!ok) {
      // setHistoryPin 对"条目不存在"与"收藏已满"都返回 false，此处读历史区分二者
      const exists = (await readHistory()).some((e) => e.id === id);
      if (!exists) {
        return NextResponse.json(
          { error: "历史记录不存在或已被删除" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: "收藏已满，请先取消部分收藏" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, pinned });
  } catch (err) {
    const message = err instanceof Error ? err.message : "更新收藏状态失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "缺少历史记录 id" }, { status: 400 });
  }

  try {
    const deleted = await deleteHistoryEntry(id);
    if (!deleted) {
      return NextResponse.json(
        { error: "历史记录不存在或已被删除" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除历史记录失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
