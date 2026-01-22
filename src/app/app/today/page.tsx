"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { COHORT_ALLOWLIST } from "../allowlist";
import { laLocalDayString } from "../lib/time";


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
  const [doneToday, setDoneToday] = useState<{ delta: number | null } | null>(null);
  const [dayIndex, setDayIndex] = useState<number>(1);
  const [completedCount, setCompletedCount] = useState<number>(0);
  const [reflectionDone, setReflectionDone] = useState<boolean>(false);

  const [rCompared, setRCompared] = useState<"more" | "same" | "less" | "">("");
  const [rContinue, setRContinue] = useState<"yes" | "maybe" | "no" | "">("");
  const [savingReflection, setSavingReflection] = useState(false);

  const blocks = useMemo(
    () => [
      {
        label: variant === "breath" ? "Downshift (Breath)" : "Downshift (Sound)",
        seconds: 4 * 60,
        prompt:
          variant === "breath"
            ? "Breathe slowly through your nose. Slightly longer exhale than inhale. Keep attention on the breath."
            : "Let sounds come to you. Don't label them. Don't follow them. Just notice sound as sound.",
      },
      {
        label: "Steady Attention",
        seconds: 6 * 60,
        // 🔒 FIXED ANCHOR — DO NOT CHANGE
        prompt: "Keep attention on the breath. When attention drifts, gently return.",
      },
      {
        label: "Grounded Recall",
        seconds: 5 * 60,
        prompt:
          "Recall a moment when you felt steady or clear. Not intense. Stay with the feeling, not the story.",
      },
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
      if (!COHORT_ALLOWLIST.has(email)) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }
      // 🔒 END INVITE-ONLY CHECK

      setUserId(sess.user.id);

      // Count completed sessions (used for day index)
      const { data: compRows } = await supabase
        .from("sessions")
        .select("id")
        .eq("user_id", sess.user.id)
        .eq("did_complete", true);

      const count = (compRows ?? []).length;
      setCompletedCount(count);

      // If they are at/after Day 7, check if reflection already submitted today
      if (count >= 7) {
        const today = localDayKey();
        const { data: ref } = await supabase
          .from("reflections")
          .select("id")
          .eq("user_id", sess.user.id)
          .eq("local_day", today)
          .maybeSingle();

        if (ref?.id) setReflectionDone(true);
      }

      // Check if today's session is already completed
      const today = localDayKey();
      const { data: completedToday, error: eToday } = await supabase
        .from("sessions")
        .select("id, pre_score, post_score, delta, did_complete, created_at")
        .eq("user_id", sess.user.id)
        .eq("did_complete", true)
        .order("created_at", { ascending: false })
        .limit(20);

      if (eToday) {
        setErr(eToday.message);
      } else {
        const todaysCompleted = (completedToday ?? []).find((r) => {
          const created = new Date(r.created_at as string);
          return localDayKey(created) === today;
        });

        if (todaysCompleted?.id) {
          setDoneToday({ delta: (todaysCompleted.delta as number) ?? null });
          setStep("done");
          setLoading(false);
          return;
        }
      }

      const chosen = await chooseVariant(sess.user.id);
      setVariant(chosen);

      // Compute day index from completed sessions
      const { data: completed, error: eComp } = await supabase
        .from("sessions")
        .select("id")
        .eq("user_id", sess.user.id)
        .eq("did_complete", true);

      if (!eComp) {
        const count = (completed ?? []).length;
        setDayIndex(Math.min(count + 1, 7));
      }

      setLoading(false);
    };

    init();
  }, [router]);

  async function chooseVariant(uid: string): Promise<Variant> {
    // Get profile start day
    const { data: prof } = await supabase
      .from("profiles")
      .select("first_completed_local_day")
      .eq("user_id", uid)
      .maybeSingle();

    const today = laLocalDayString();

    // If no start day yet, treat today as day 1 (they haven't completed anything)
    const start = prof?.first_completed_local_day ?? today;

    const dayIndex =
      Math.floor((new Date(today).getTime() - new Date(start).getTime()) / (24 * 3600 * 1000)) + 1;

    if (dayIndex <= 3) return "breath";
    if (dayIndex <= 5) return "sound";

    // Day 6+: choose best avg delta, requires >=3 completed sessions
    const { data: completed } = await supabase
      .from("sessions")
      .select("practice_variant, delta")
      .eq("user_id", uid)
      .eq("did_complete", true);

    const rows = completed ?? [];
    if (rows.length < 3) return "breath";

    const avg = (v: Variant) => {
      const ds = rows.filter(r => r.practice_variant === v && r.delta != null).map(r => r.delta as number);
      if (ds.length === 0) return -999;
      return ds.reduce((a, b) => a + b, 0) / ds.length;
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
        local_day: laLocalDayString(),
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
    const delta = postScore - (pre ?? 0);
    const { error } = await supabase
      .from("sessions")
      .update({
        post_score: postScore,
        delta,
        did_complete: true,
      })
      .eq("id", sessionId)
      .eq("user_id", userId);
    // After marking did_complete true:
    const today = laLocalDayString();

    await supabase.from("profiles").upsert({
      user_id: userId,
      // only set if null later via a separate fetch; simplest approach below:
    }, { onConflict: "user_id" });

    // Fetch profile to see if first day exists
    const { data: prof } = await supabase
      .from("profiles")
      .select("first_completed_local_day")
      .eq("user_id", userId)
      .single();

    if (!prof?.first_completed_local_day) {
      await supabase.from("profiles").update({
        first_completed_local_day: today,
      }).eq("user_id", userId);
    }

    setCompletedCount((c) => c + 1);

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
          <h1 style={{ margin: 0 }}>Today's Session</h1>
          <p style={{ marginTop: 6, opacity: 0.8 }}>Variant: {variant}</p>
        </div>
        <button onClick={signOut} style={{ height: 36 }}>
          Sign out
        </button>
      </div>

      {err && <p style={{ marginTop: 12, color: "crimson" }}>{err}</p>}

      {dayMessage(dayIndex) && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
          <b>Day {dayIndex}</b>
          <div style={{ marginTop: 6, opacity: 0.85 }}>{dayMessage(dayIndex)}</div>
        </div>
      )}

      {step === "pre" && (
        <>
          <h2>Check-in</h2>
          <p>How clear and steady do you feel right now?</p>
          <ScorePicker value={pre} onChange={setPre} />
          <button
            style={{ width: "100%", padding: 12, marginTop: 12 }}
            disabled={pre == null}
            onClick={async () => {
              if (doneToday) {
                setStep("done");
                return;
              }
              try {
                // unlock audio + confirm start
                playTransitionTone().then(() => {
                  setStep("session");
                });
                await upsertTodaySession(pre!);
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
          <h2>Done for today</h2>

          {typeof delta === "number" && pre != null && post != null ? (
            delta > 0 ? (
              <p><b>You're {delta} points clearer than before.</b></p>
            ) : (
              <p><b>Not every day feels different. Showing up still counts.</b></p>
            )
          ) : doneToday?.delta != null ? (
            doneToday.delta > 0 ? (
              <p><b>You're {doneToday.delta} points clearer than before.</b></p>
            ) : (
              <p><b>Not every day feels different. Showing up still counts.</b></p>
            )
          ) : (
            <p><b>Come back tomorrow for your next session.</b></p>
          )}

          <button
            style={{ width: "100%", padding: 12, marginTop: 12 }}
            onClick={() => router.replace("/app/today")}
          >
            Done
          </button>

          {(completedCount >= 7 && !reflectionDone) && (
            <div style={{ marginTop: 18, padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
              <h3 style={{ marginTop: 0 }}>Quick reflection</h3>

              <div style={{ marginTop: 10 }}>
                <div><b>1) Compared to Day 1:</b></div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {[
                    { v: "more", label: "More clear" },
                    { v: "same", label: "Same" },
                    { v: "less", label: "Less clear" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      onClick={() => setRCompared(opt.v as any)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #ccc",
                        background: rCompared === opt.v ? "#eee" : "white",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div><b>2) Would you continue if it stayed this simple?</b></div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {[
                    { v: "yes", label: "Yes" },
                    { v: "maybe", label: "Maybe" },
                    { v: "no", label: "No" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      onClick={() => setRContinue(opt.v as any)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #ccc",
                        background: rContinue === opt.v ? "#eee" : "white",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                style={{ width: "100%", padding: 12, marginTop: 14 }}
                disabled={!rCompared || !rContinue || savingReflection}
                onClick={async () => {
                  try {
                    setSavingReflection(true);
                    setErr("");

                    const today = localDayKey();

                    const { error } = await supabase.from("reflections").insert({
                      user_id: userId,
                      local_day: today,
                      compared_to_day1: rCompared,
                      continue_simple: rContinue,
                    });

                    if (error) throw error;

                    setReflectionDone(true);
                  } catch (e: any) {
                    setErr(e?.message ?? "Failed to save reflection.");
                  } finally {
                    setSavingReflection(false);
                  }
                }}
              >
                {savingReflection ? "Saving…" : "Submit reflection"}
              </button>
            </div>
          )}
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

function dayMessage(dayIndex: number) {
  if (dayIndex <= 1) return "Your 15-minute clarity reset starts now.";
  if (dayIndex <= 3) return "Repetition > improvement. Just run the session again.";
  if (dayIndex <= 5) return "Same structure. Slightly different input.";
  return "";
}

function playTransitionTone(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = 528; // neutral, not musical

      // start silent
      gain.gain.value = 0.0001;

      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;

      // fade in (first 0.3s)
      gain.gain.exponentialRampToValueAtTime(0.15, now + 0.3);

      // sustain
      gain.gain.setValueAtTime(0.15, now + 2.6);

      // fade out (last 0.4s)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.0);

      osc.start(now);
      osc.stop(now + 3.05);

      osc.onended = () => {
        ctx.close();
        resolve();
      };
    } catch {
      resolve(); // never block UX
    }
  });
}

function SessionTimer({
  blocks,
  onDone,
}: {
  blocks: { label: string; seconds: number; prompt?: string }[];
  onDone: () => void;
}) {
  const total = blocks.reduce((a, b) => a + b.seconds, 0);
  const [t, setT] = useState(total);
  const [running, setRunning] = useState(true);
  const [pausedForTransition, setPausedForTransition] = useState(false);

  // Track current block index and beep only on transitions
  const prevBlockIndexRef = useRef<number>(0);

  useEffect(() => {
    if (!running || pausedForTransition) return;
    if (t <= 0) return;

    const id = setInterval(() => {
      setT((x) => x - 1);
    }, 1000);

    return () => clearInterval(id);
  }, [running, pausedForTransition, t]);

  useEffect(() => {
    if (t <= 0) onDone();
  }, [t, onDone]);

  const elapsed = total - t;

  // Determine current block index by elapsed time
  const blockIndex = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < blocks.length; i++) {
      acc += blocks[i].seconds;
      if (elapsed < acc) return i;
    }
    return blocks.length - 1;
  }, [blocks, elapsed]);

  const current = blocks[blockIndex] ?? { label: "Session", seconds: total };

  // Beep when block changes (but not at start)
  useEffect(() => {
    const prev = prevBlockIndexRef.current;
    if (blockIndex !== prev) {
      prevBlockIndexRef.current = blockIndex;

      // pause timer
      setPausedForTransition(true);

      // play tone, then resume
      playTransitionTone().then(() => {
        setPausedForTransition(false);
      });
    }
  }, [blockIndex]);

  return (
    <div style={{ marginTop: 16 }}>
      <h2>{current.label}</h2>

      {current.prompt && (
        <p style={{ opacity: 0.85, lineHeight: 1.5, marginTop: 8 }}>
          {current.prompt}
        </p>
      )}

      {pausedForTransition && (
        <p style={{ marginTop: 8, opacity: 0.6 }}>
          Transitioning…
        </p>
      )}

      <p style={{ fontSize: 32, margin: "12px 0" }}>
        {Math.floor(t / 60)}:{String(t % 60).padStart(2, "0")}
      </p>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => setRunning(!running)} style={{ padding: 10 }}>
          {running ? "Pause" : "Resume"}
        </button>

        <button
          onClick={() => {
            prevBlockIndexRef.current = 0;
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
