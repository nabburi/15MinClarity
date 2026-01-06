"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function sendLink() {
    setStatus("sending");
    setMsg("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus("error");
      setMsg(error.message);
      return;
    }

    setStatus("sent");
    setMsg("Check your email for the sign-in link.");
  }

  return (
    <main style={{ maxWidth: 420, margin: "80px auto", padding: 16 }}>
      <h1>Sign in</h1>
      <p>We’ll email you a magic link.</p>

      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        type="email"
        autoComplete="email"
        style={{ width: "100%", padding: 12, marginTop: 12 }}
      />

      <button
        onClick={sendLink}
        disabled={!email || status === "sending"}
        style={{ width: "100%", padding: 12, marginTop: 12 }}
      >
        {status === "sending" ? "Sending..." : "Send magic link"}
      </button>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
    </main>
  );
}
