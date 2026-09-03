import { NextResponse } from "next/server";
import { deleteHistoryEntry } from "@/lib/storage";

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
