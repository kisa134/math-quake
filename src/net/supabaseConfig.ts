// Supabase project used ONLY for Realtime broadcast channels (multiplayer
// transport). No database tables, no auth, no data is touched — just ephemeral
// pub/sub namespaced as `mq-<room>`. The anon key is public by design (RLS
// gates any real API), but we still inject it at build time via Vite env so it
// isn't hard-committed. Local dev reads .env.local; CI reads GitHub secrets.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
export const SUPABASE_ANON = (import.meta.env.VITE_SUPABASE_ANON as string) || '';

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn('[net] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON — multiplayer disabled.');
}
