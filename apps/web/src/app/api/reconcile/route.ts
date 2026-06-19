import { NextResponse } from "next/server";
import { repo } from "@/lib/repo";
import { getMemwal } from "@/lib/memwal";

export const maxDuration = 300;

// Background reconcile: resolve enqueued memory writes (jobId) to their certified
// Walrus blob id. Idempotent; safe to call repeatedly (cron / external ping).
async function run() {
  const memwal = getMemwal();
  const pending = await repo.pendingUnits(20);
  let resolved = 0;
  for (const u of pending) {
    const r = await memwal.resolveJob(u.jobId);
    if (r) {
      await repo.setUnitBlobId(u.id, r.blobId);
      resolved++;
    }
  }
  return { pending: pending.length, resolved };
}

export async function POST() {
  return NextResponse.json(await run());
}

export async function GET() {
  return NextResponse.json(await run());
}
