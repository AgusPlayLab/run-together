// RunTogether · Envío de avisos por email (Resend)
// El navegador llama a esta función con el JWT del usuario y el id de un aviso
// creado por las funciones rt_* de la base de datos. La clave de Resend y la
// service_role solo existen aquí (secretos de Supabase), nunca en el navegador.
//
// Secretos:
//   RESEND_API_KEY  (obligatorio para enviar; sin él el aviso queda como 'skipped')
//   RT_EMAIL_FROM   (opcional, por defecto "RunTogether <onboarding@resend.dev>")
//   RT_APP_URL      (opcional, URL pública de la app para el botón del correo)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente.

import { createClient } from "npm:@supabase/supabase-js@2";

const TIMEZONE = "Europe/Madrid";

type EventType = "requested" | "proposed" | "counterproposed" | "accepted" | "declined" | "cancelled" | "completed";

const COPY: Record<EventType, { subject: (a: string, w: string) => string; intro: (a: string) => string; cta: string }> = {
  requested: {
    subject: (a, w) => `👟 ${a} quiere correr contigo ${w}`,
    intro: (a) => `${a} se quiere apuntar a tu salida. ¿Le guardas sitio?`,
    cta: "Responder",
  },
  proposed: {
    subject: (a, w) => `💌 ${a} te propone salir a correr ${w}`,
    intro: (a) => `${a} ha encontrado un hueco y piensa en ti.`,
    cta: "Ver propuesta",
  },
  counterproposed: {
    subject: (a, w) => `🔁 ${a} propone otro momento: ${w}`,
    intro: (a) => `${a} no quiere perderse la salida, pero mejor a otra hora.`,
    cta: "Ver contrapropuesta",
  },
  accepted: {
    subject: (a, w) => `🎉 ¡Hecho! ${a} corre contigo ${w}`,
    intro: (a) => `${a} ha dicho que sí. Prepara las zapatillas 😉`,
    cta: "Ver la salida",
  },
  declined: {
    subject: (a, w) => `🙈 ${a} no puede ${w}`,
    intro: (a) => `Esta vez ${a} no llega, pero seguro que hay otra ocasión.`,
    cta: "Buscar otro momento",
  },
  cancelled: {
    subject: (a, w) => `😔 ${a} ha cancelado la salida de ${w}`,
    intro: (a) => `A ${a} le ha surgido algo. Queda pendiente la revancha.`,
    cta: "Abrir RunTogether",
  },
  completed: {
    subject: (_a, w) => `🏅 Salida completada (${w})`,
    intro: (a) => `${a} ha marcado la salida como realizada. ¡Kilómetros compartidos!`,
    cta: "Ver historial",
  },
};

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("es-ES", { timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long" }).format(date);
  const time = new Intl.DateTimeFormat("es-ES", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(date);
  return `el ${day} a las ${time}`;
}

function renderEmail(opts: { intro: string; title: string; when: string; duration: number; message: string | null; cta: string; appUrl: string | null }) {
  const message = opts.message
    ? `<p style="margin:18px 0;padding:14px 16px;background:#f7f4ef;border-radius:10px;font-style:italic">“${escapeHtml(opts.message)}”</p>`
    : "";
  const button = opts.appUrl
    ? `<p style="margin:26px 0 0"><a href="${escapeHtml(opts.appUrl)}" style="background:#315b49;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:700">${escapeHtml(opts.cta)} ↗</a></p>`
    : "";
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f7f4ef;font-family:Arial,sans-serif;color:#252a27">
  <div style="max-width:480px;margin:0 auto;padding:28px 18px">
    <div style="font-weight:800;font-size:18px;margin-bottom:18px">↗ run<span style="color:#315b49;font-weight:500">together</span></div>
    <div style="background:#fffefa;border:1px solid #e9e4dc;border-radius:14px;padding:24px">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.6">${escapeHtml(opts.intro)}</p>
      <p style="margin:0;font-size:18px;font-weight:700">${escapeHtml(opts.title)}</p>
      <p style="margin:6px 0 0;color:#315b49;font-weight:700">${escapeHtml(opts.when)} · ${opts.duration} min</p>
      ${message}${button}
    </div>
    <p style="text-align:center;color:#9b9c95;font-size:11px;margin-top:22px">Hecho para sumar kilómetros, no complicaciones ♥</p>
  </div></body></html>`;
}

Deno.serve(async (req: Request) => {
  const rawOrigin = req.headers.get("origin");
  const allowedOrigin = (!rawOrigin || rawOrigin === "null") ? "*" : rawOrigin;
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
    "Access-Control-Max-Age": "600",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, corsHeaders);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Missing Supabase environment variables" }, 500, corsHeaders);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401, corsHeaders);

  let payload: { notification_id?: string };
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, corsHeaders); }
  if (!payload.notification_id) return json({ error: "Missing notification_id" }, 400, corsHeaders);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Unauthorized" }, 401, corsHeaders);

  const { data: notification, error: nError } = await admin
    .from("rt_notifications")
    .select("id, actor_id, recipient_id, event_type, email_status, booking:rt_bookings(id, title, scheduled_at, duration_minutes)")
    .eq("id", payload.notification_id)
    .maybeSingle();
  if (nError || !notification) return json({ error: "Notification not found" }, 404, corsHeaders);
  // Solo quien provocó el aviso puede dispararlo.
  if (notification.actor_id !== userData.user.id) return json({ error: "Forbidden" }, 403, corsHeaders);
  if (notification.email_status !== "pending") return json({ ok: true, status: notification.email_status }, 200, corsHeaders);

  const markStatus = (email_status: string, email_error: string | null = null) =>
    admin.from("rt_notifications")
      .update({ email_status, email_error, sent_at: email_status === "sent" ? new Date().toISOString() : null })
      .eq("id", notification.id);

  const { data: people } = await admin
    .from("rt_profiles")
    .select("user_id, display_name, email, notify_email")
    .in("user_id", [notification.actor_id, notification.recipient_id]);
  const actor = people?.find((p) => p.user_id === notification.actor_id);
  const recipient = people?.find((p) => p.user_id === notification.recipient_id);
  const booking = Array.isArray(notification.booking) ? notification.booking[0] : notification.booking;
  const copy = COPY[notification.event_type as EventType];

  if (!actor || !recipient || !booking || !copy) {
    await markStatus("failed", "Datos incompletos del aviso");
    return json({ error: "Incomplete notification data" }, 422, corsHeaders);
  }
  if (!recipient.notify_email) {
    await markStatus("skipped", "Avisos por email desactivados");
    return json({ ok: true, status: "skipped" }, 200, corsHeaders);
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    await markStatus("skipped", "RESEND_API_KEY no configurada");
    return json({ ok: true, status: "skipped" }, 200, corsHeaders);
  }

  const { data: lastEvent } = await admin
    .from("rt_booking_events")
    .select("message")
    .eq("booking_id", booking.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const when = formatWhen(booking.scheduled_at);
  const appUrl = Deno.env.get("RT_APP_URL") ?? null;
  const html = renderEmail({
    intro: copy.intro(actor.display_name),
    title: booking.title,
    when: when.charAt(0).toUpperCase() + when.slice(1),
    duration: booking.duration_minutes,
    message: lastEvent?.message ?? null,
    cta: copy.cta,
    appUrl: appUrl ? `${appUrl.replace(/\/$/, "")}/pages/solicitudes.html` : null,
  });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: Deno.env.get("RT_EMAIL_FROM") ?? "RunTogether <onboarding@resend.dev>",
        to: [recipient.email],
        subject: copy.subject(actor.display_name, when),
        html,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("Resend error", res.status, detail);
      await markStatus("failed", `Resend ${res.status}: ${detail.slice(0, 300)}`);
      return json({ ok: false, status: "failed" }, 502, corsHeaders);
    }
    await markStatus("sent");
    return json({ ok: true, status: "sent" }, 200, corsHeaders);
  } catch (err) {
    console.error("Email sending failed", err);
    await markStatus("failed", String(err).slice(0, 300));
    return json({ ok: false, status: "failed" }, 502, corsHeaders);
  }
});
