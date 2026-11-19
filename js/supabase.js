// Cliente Supabase único para toda la app.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "./config.js";

export const isConfigured = !CONFIG.SUPABASE_ANON_KEY.startsWith("PEGA_AQUI");

if (!isConfigured) {
  console.error("⚙️ RunTogether: completa SUPABASE_ANON_KEY en js/config.js");
}

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "runtogether-auth" },
});
