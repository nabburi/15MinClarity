"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ALLOWLIST } from "../allowlist";


type Step = "pre" | "session" | "post" | "done";
type Variant = "breath" | "sound";

function localDayKey(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getHashParam(name: string) {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(hash).get(name);
}

export default function TodaySession() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("pre");
  const [userId, setUserId] = useState("");
  const [variant, setVariant] = useState<Variant>("breath");

  const [pre, setPre] = useState<number | null>(null);
  const [post, setPost] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const blocks = useMemo(
    () => [
      {
        label: variant === "breath" ? "Downshift (Breath)" : "Downshift (Sound)",
        seconds: 4 * 60,
      },
      { label: "Attention Stabilization", seconds: 6 * 60 },
      { label: "Grounded Recall", seconds: 5 * 60 }, // total 15 min
    ],
    [variant]
  );

useEffect(() => {
  const init = async () => {
    setErr("");

    const { data } = await supabase.auth.getSession();
    const sess = data.session;

    if (!sess?.user?.id) {
      router.replace("/login");
      return;
    }

    // 🔒 INVITE-ONLY CHECK (ADD THIS BLOCK)
    const email = sess.user.email?.toLowerCase() ?? "";
    if (!ALLOWLIST.has(email)) {
      await supabase.auth.signOut();
      router.replace("/login");
      return;
    }
    // 🔒 END INVITE-ONLY CHECK

    setUserId(sess.user.id);

    const chosen = await chooseVariant(sess.user.id);
    setVariant(chosen);

    setLoading(false);
  };

  init();
}, [router]);

  async function chooseVariant(uid: string): Promise<Variant> {
    const { data } = await supabase
      .from("sessions")
      .select("pre_score, post_score, practice_variant, did_complete")
      .eq("user_id", uid)
      .eq("did_complete", true);

    const completed = data ?? [];
    if (completed.length < 3) {
      // Days 1–3 breath, Days 4–7 sound (simple for pilot)
      const dayNum = Math.min(completed.length + 1, 7);
      return dayNum <= 3 ? "breath" : "sound";
    }

    const deltas = completed
      .filter((r) => r.pre_score != null && r.post_score != null)
      .map((r) => ({
        v: r.practice_variant as Variant,
        d: (r.post_score as number) - (r.pre_score as number),
      }));

    const avg = (v: Variant) => {
      const arr = deltas.filter((x) => x.v === v).map((x) => x.d);
      if (arr.length === 0) return -999;
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    };

    return avg("sound") > avg("breath") ? "sound" : "breath";
  }

  async function upsertTodaySession(preScore: number) {
    setErr("");

    const { data: recent, error: e1 } = await supabase
      .from("sessions")
      .select("id, created_at, pre_score, did_complete")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (e1) throw e1;

    const today = localDayKey();
    const existingToday = (recent ?? []).find((r) => {
      const created = new Date(r.created_at as string);
      return localDayKey(created) === today;
    });

    // 🛑 ONE-SESSION-PER-DAY GUARD
    if (existingToday?.id && existingToday.did_complete) {
      throw new Error("You already completed today’s session. Come back tomorrow.");
    }

    if (existingToday?.id) {
      setSessionId(existingToday.id);

      // set pre_score if missing
      if (existingToday.pre_score == null) {
        const { error: e2 } = await supabase
          .from("sessions")
          .update({ pre_score: preScore })
          .eq("id", existingToday.id)
          .eq("user_id", userId);
        if (e2) throw e2;
      }

      return existingToday.id;
    }

    const { data, error } = await supabase
      .from("sessions")
      .insert({
        user_id: userId,
        practice_variant: variant,
        pre_score: preScore,
        did_complete: false,
      })
      .select("id")
      .single();

    if (error) throw error;
    setSessionId(data.id);
    return data.id;
  }

  async function finishSession(postScore: number) {
    setErr("");
    if (!sessionId) return;

    const { error } = await supabase
      .from("sessions")
      .update({
        post_score: postScore,
        did_complete: true,
      })
      .eq("id", sessionId)
      .eq("user_id", userId);

    if (error) throw error;
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;

  const delta = (post ?? 0) - (pre ?? 0);

  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Today’s Session</h1>
          <p style={{ marginTop: 6, opacity: 0.8 }}>Variant: {variant}</p>
        </div>
        <button onClick={signOut} style={{ height: 36 }}>
          Sign out
        </button>
      </div>

      {err && <p style={{ marginTop: 12, color: "crimson" }}>{err}</p>}

      {step === "pre" && (
        <>
          <h2>Check-in</h2>
          <p>How clear and steady do you feel right now?</p>
          <ScorePicker value={pre} onChange={setPre} />
          <button
            style={{ width: "100%", padding: 12, marginTop: 12 }}
            disabled={pre == null}
            onClick={async () => {
              try {
                await upsertTodaySession(pre!);
                setStep("session");
              } catch (e: any) {
                setErr(e?.message ?? "Something went wrong.");
              }
            }}
          >
            Start 15-minute session
          </button>
        </>
      )}

      {step === "session" && (
        <SessionTimer
          blocks={blocks}
          onDone={() => setStep("post")}
        />
      )}

      {step === "post" && (
        <>
          <h2>Check-out</h2>
          <p>How clear and steady do you feel now?</p>
          <ScorePicker value={post} onChange={setPost} />
          <button
            style={{ width: "100%", padding: 12, marginTop: 12 }}
            disabled={post == null}
            onClick={async () => {
              try {
                await finishSession(post!);
                setStep("done");
              } catch (e: any) {
                setErr(e?.message ?? "Something went wrong.");
              }
            }}
          >
            Finish
          </button>
        </>
      )}

      {step === "done" && (
        <>
          <h2>Done</h2>
          <p>
            You’re <b>{delta}</b> points clearer than before.
          </p>
          <p style={{ opacity: 0.8 }}>Come back tomorrow for the next session.</p>

          <button
            style={{ width: "100%", padding: 12, marginTop: 12 }}
            onClick={() => {
              setStep("pre");
              setPre(null);
              setPost(null);
            }}
          >
            Back to start
          </button>
        </>
      )}
    </main>
  );
}

function ScorePicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {Array.from({ length: 11 }, (_, i) => i).map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: value === n ? "#eee" : "white",
            minWidth: 44,
          }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

function SessionTimer({
  blocks,
  onDone,
}: {
  blocks: { label: string; seconds: number }[];
  onDone: () => void;
}) {
  const total = blocks.reduce((a, b) => a + b.seconds, 0);
  const [t, setT] = useState(total);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    if (t <= 0) return;
    const id = setInterval(() => setT((x) => x - 1), 1000);
    return () => clearInterval(id);
  }, [running, t]);

  useEffect(() => {
    if (t <= 0) onDone();
  }, [t, onDone]);

  const currentLabel = useMemo(() => {
    let elapsed = total - t;
    for (const b of blocks) {
      if (elapsed < b.seconds) return b.label;
      elapsed -= b.seconds;
    }
    return "Session";
  }, [blocks, t, total]);

  return (
    <div style={{ marginTop: 16 }}>
      <h2>{currentLabel}</h2>
      <p style={{ fontSize: 36, margin: "12px 0" }}>
        {Math.floor(t / 60)}:{String(t % 60).padStart(2, "0")}
      </p>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => setRunning((r) => !r)} style={{ padding: 10 }}>
          {running ? "Pause" : "Resume"}
        </button>
        <button
          onClick={() => {
            setT(total);
            setRunning(true);
          }}
          style={{ padding: 10 }}
        >
          Restart
        </button>
      </div>
    </div>
  );
}
