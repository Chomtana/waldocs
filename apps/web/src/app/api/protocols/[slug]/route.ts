import { NextResponse } from "next/server";
import { getProtocol } from "@/lib/queries";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const d = await getProtocol(slug);
  return d ? NextResponse.json(d) : NextResponse.json({ error: "not found" }, { status: 404 });
}
