// Configuración pública de RunTogether.
// La URL y la anon/publishable key son públicas por diseño: los datos los protege RLS.
// NUNCA pongas aquí service_role, contraseñas ni RESEND_API_KEY (van como secretos de Supabase).
export const CONFIG = {
  // Mismo proyecto Supabase que Maldives VIP Experience
  SUPABASE_URL: "https://febogdjpoxbyfhetwgip.supabase.co",
  // Supabase → Project Settings → API Keys → anon / publishable
  SUPABASE_ANON_KEY: "sb_publishable_P3XuSq-r38FLRGx3qSh96g_zVboPf-0",
  // Edge Function que envía los avisos por Resend
  NOTIFY_FUNCTION: "rt-send-notification",
  TIMEZONE: "Europe/Madrid",
};
