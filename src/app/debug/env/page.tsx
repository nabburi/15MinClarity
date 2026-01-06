export default function EnvDebugPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(undefined)";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "(undefined)";

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Env Debug</h1>
      {/* <p><b>NEXT_PUBLIC_SUPABASE_URL</b>: {url}</p>
      <p><b>NEXT_PUBLIC_SUPABASE_ANON_KEY</b>: {key.slice(0, 20)}... (masked)</p> */}
    </main>
  );
}
