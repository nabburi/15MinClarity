import { supabase } from "@/lib/supabaseClient";

export async function logEvent(event_name: string, user_id?: string, meta?: any) {
  try {
    await supabase.from("events").insert({
      event_name,
      user_id: user_id ?? null,
      meta: meta ?? null,
    });
  } catch {
    // never block UX for logging
  }
}
