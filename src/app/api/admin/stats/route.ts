import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ADMIN_ALLOWLIST, COHORT_ALLOWLIST } from "@/app/app/allowlist";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(supabaseUrl, serviceKey);

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";

    if (!token) {
      return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
    }

    // Verify the caller
    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const callerEmail = userRes.user.email.toLowerCase();
    if (!ADMIN_ALLOWLIST.has(callerEmail)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get all users (small scale, OK for pilot)
    const { data: usersRes, error: usersErr } = await admin.auth.admin.listUsers({
      perPage: 1000,
      page: 1,
    });

    if (usersErr) throw usersErr;

    const cohortUsers = (usersRes?.users ?? [])
      .filter((u) => u.email && COHORT_ALLOWLIST.has(u.email.toLowerCase()))
      .map((u) => ({ id: u.id, email: u.email!.toLowerCase() }));

    const ids = cohortUsers.map((u) => u.id);
    if (ids.length === 0) {
      return NextResponse.json({ rows: [] });
    }

    const { data: sessions, error: sessErr } = await admin
      .from("sessions")
      .select("user_id, did_complete, delta, created_at")
      .in("user_id", ids);

    if (sessErr) throw sessErr;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;

    const byUser = new Map<string, any>();
    for (const u of cohortUsers) {
      byUser.set(u.id, {
        email: u.email,
        sessions_completed: 0,
        last_session_date: null as string | null,
        avg_delta: null as number | null,
        sessions_last_7d: 0,
        _deltas: [] as number[],
      });
    }

    for (const s of sessions ?? []) {
      const row = byUser.get(s.user_id);
      if (!row) continue;

      const created = new Date(s.created_at as string).getTime();

      if (s.did_complete) {
        row.sessions_completed += 1;
        if (!row.last_session_date || created > new Date(row.last_session_date).getTime()) {
          row.last_session_date = s.created_at as string;
        }
        if (typeof s.delta === "number") row._deltas.push(s.delta);
        if (created >= sevenDaysAgo) row.sessions_last_7d += 1;
      }
    }

    const rows = Array.from(byUser.values()).map((r) => {
      const avg =
        r._deltas.length > 0 ? r._deltas.reduce((a: number, b: number) => a + b, 0) / r._deltas.length : null;
      return {
        email: r.email,
        sessions_completed: r.sessions_completed,
        last_session_date: r.last_session_date,
        avg_delta: avg,
        sessions_last_7d: r.sessions_last_7d,
      };
    });

    // Sort by sessions completed desc
    rows.sort((a, b) => b.sessions_completed - a.sessions_completed);

    return NextResponse.json({ rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
