import { NextResponse } from "next/server";
import { getApplication } from "@/lib/queries";
export async function GET(_req: Request, ctx: { params: Promise<{ author: string; repo: string }> }) {
  const { author, repo } = await ctx.params;
  const d = await getApplication(author, repo);
  return d ? NextResponse.json(d) : NextResponse.json({ error: "not found" }, { status: 404 });
}
