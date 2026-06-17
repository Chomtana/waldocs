import { NextResponse } from "next/server";
import { listProtocols } from "@/lib/queries";
export async function GET() { return NextResponse.json(await listProtocols()); }
