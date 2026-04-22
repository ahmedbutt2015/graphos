import { NextResponse } from "next/server";
import { getTraceStore } from "@/lib/trace-store-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const events = getTraceStore().sessionEvents(id);
  if (events.length === 0) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  return NextResponse.json({ sessionId: id, events });
};
