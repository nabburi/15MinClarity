"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function getHashParam(name: string) {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  return params.get(name);
}

export default function AuthCallback() {
  const router = useRouter();
  const [debug, setDebug] = useState("Signing you in…");

  useEffect(() => {
    const run = async () => {
      const access_token = getHashParam("access_token");
      const refresh_token = getHashParam("refresh_token");

      if (!access_token || !refresh_token) {
        setDebug("Missing tokens in callback URL. Sending you to /login");
        router.replace("/login");
        return;
      }

      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      if (error) {
        setDebug(`setSession error: ${error.message}\nRedirecting to /login…`);
        setTimeout(() => router.replace("/login"), 1500);
        return;
      }

      router.replace("/app/today");
    };

    run();
  }, [router]);

  return <pre style={{ padding: 16, whiteSpace: "pre-wrap" }}>{debug}</pre>;
}
