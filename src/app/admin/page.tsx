"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import { ADMIN_ALLOWLIST } from "@/app/app/allowlist";

type Row = {
  email: string;
  sessions_completed: number;
  last_session_date: string | null;
  avg_delta: number | null;
  sessions_last_7d: number;
};

export default function AdminPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      setErr("");
      const { data } = await supabase.auth.getSession();
      const sess = data.session;

      if (!sess?.user?.email) {
        router.replace("/login");
        return;
      }

      const email = sess.user.email.toLowerCase();
      if (!ADMIN_ALLOWLIST.has(email)) {
        router.replace("/app/today");
        return;
      }

      const token = sess.access_token;

      const res = await fetch("/api/admin/stats", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const json = await res.json();
      if (!res.ok) {
        setErr(json?.error ?? "Failed to load stats.");
        setLoading(false);
        return;
      }

      setRows(json.rows ?? []);
      setLoading(false);
    };

    run();
  }, [router]);

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1>Admin</h1>

      {loading && <p>Loading…</p>}
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      {!loading && !err && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Email</th>
                <th style={th}>Completed</th>
                <th style={th}>Last session</th>
                <th style={th}>Avg delta</th>
                <th style={th}>Last 7d</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email}>
                  <td style={td}>{r.email}</td>
                  <td style={td}>{r.sessions_completed}</td>
                  <td style={td}>{r.last_session_date ? new Date(r.last_session_date).toLocaleString() : "-"}</td>
                  <td style={td}>{r.avg_delta == null ? "-" : r.avg_delta.toFixed(2)}</td>
                  <td style={td}>{r.sessions_last_7d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

const th: React.CSSProperties = { textAlign: "left", borderBottom: "1px solid #ddd", padding: 10 };
const td: React.CSSProperties = { borderBottom: "1px solid #f0f0f0", padding: 10 };
