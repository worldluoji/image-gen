import { NextResponse } from "next/server";
import { readHistory } from "@/lib/storage";

export async function GET() {
  try {
    return NextResponse.json({ history: await readHistory() });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "读取历史记录失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
