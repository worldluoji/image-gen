import { NextResponse } from "next/server";
import { readToday } from "@/lib/usage";

export async function GET() {
  try {
    return NextResponse.json(await readToday());
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取用量失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
