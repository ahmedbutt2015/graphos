import { NextResponse } from "next/server";
import { getTraceStore } from "@/lib/trace-store-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => {
  const sessions = getTraceStore().listSessions();
  return NextResponse.json({ sessions });
};
