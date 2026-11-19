// Acceso a datos de RunTogether. Lecturas/escrituras simples con RLS y
// toda la lógica de reservas mediante funciones RPC de la base de datos.
import { supabase } from "./supabase.js";
import { CONFIG } from "./config.js";
import { toISODate, addDays } from "./schedule.js";

function unwrap({ data, error }) {
  if (error) throw new Error(error.message || "Algo ha fallado");
  return data;
}

// Dispara el email de aviso. No bloquea: si falla, la reserva ya está guardada.
function notify(notificationId) {
  if (!notificationId) return;
  supabase.functions
    .invoke(CONFIG.NOTIFY_FUNCTION, { body: { notification_id: notificationId } })
    .then(({ error }) => { if (error) console.warn("Aviso por email no enviado:", error.message); })
    .catch((err) => console.warn("Aviso por email no enviado:", err));
}

async function rpc(name, args) {
  const data = unwrap(await supabase.rpc(name, args));
  notify(data?.notification_id);
  return data;
}

// ---------- Perfiles ----------
export async function loadProfiles() {
  return unwrap(await supabase.from("rt_profiles").select("*").order("created_at"));
}

export async function updateProfile(userId, patch) {
  return unwrap(await supabase.from("rt_profiles").update(patch).eq("user_id", userId).select().single());
}

// ---------- Planificación ----------
export async function loadWeekData(weekStart) {
  const from = toISODate(weekStart);
  const to = toISODate(addDays(weekStart, 6));
  const [sessions, exceptions, restDays, bookings] = await Promise.all([
    supabase.from("rt_sessions").select("*").eq("is_active", true)
      .or(`recurrence.eq.weekly,and(session_date.gte.${from},session_date.lte.${to})`),
    supabase.from("rt_session_exceptions").select("*").gte("exception_date", from).lte("exception_date", to),
    supabase.from("rt_rest_days").select("*")
      .or(`recurrence.eq.weekly,and(rest_date.gte.${from},rest_date.lte.${to})`),
    supabase.from("rt_bookings").select("*").gte("occurrence_date", from).lte("occurrence_date", to),
  ]);
  return {
    sessions: unwrap(sessions),
    exceptions: unwrap(exceptions),
    restDays: unwrap(restDays),
    bookings: unwrap(bookings),
  };
}

export async function loadMyPlan(userId) {
  const today = toISODate(new Date());
  const [sessions, exceptions, restDays] = await Promise.all([
    supabase.from("rt_sessions").select("*").eq("owner_id", userId)
      .or(`recurrence.eq.weekly,session_date.gte.${today}`).order("start_time"),
    supabase.from("rt_session_exceptions").select("*, session:rt_sessions(title, start_time)")
      .eq("owner_id", userId).gte("exception_date", today).order("exception_date"),
    supabase.from("rt_rest_days").select("*").eq("owner_id", userId)
      .or(`recurrence.eq.weekly,rest_date.gte.${today}`),
  ]);
  return { sessions: unwrap(sessions), exceptions: unwrap(exceptions), restDays: unwrap(restDays) };
}

export async function saveSession(session) {
  const { id, ...fields } = session;
  const query = id
    ? supabase.from("rt_sessions").update(fields).eq("id", id)
    : supabase.from("rt_sessions").insert(fields);
  return unwrap(await query.select().single());
}

export async function setSessionActive(id, isActive) {
  return unwrap(await supabase.from("rt_sessions").update({ is_active: isActive }).eq("id", id));
}

export async function deleteSession(id) {
  return unwrap(await supabase.from("rt_sessions").delete().eq("id", id));
}

export async function saveException(exception) {
  return unwrap(await supabase.from("rt_session_exceptions")
    .upsert(exception, { onConflict: "session_id,exception_date" }).select().single());
}

export async function deleteException(id) {
  return unwrap(await supabase.from("rt_session_exceptions").delete().eq("id", id));
}

export async function addRestDay(restDay) {
  return unwrap(await supabase.from("rt_rest_days").insert(restDay).select().single());
}

export async function deleteRestDay(id) {
  return unwrap(await supabase.from("rt_rest_days").delete().eq("id", id));
}

// ---------- Reservas ----------
export async function loadBookings() {
  const bookings = unwrap(await supabase.from("rt_bookings").select("*").order("scheduled_at", { ascending: true }));
  if (!bookings.length) return [];
  const events = unwrap(await supabase.from("rt_booking_events").select("*")
    .in("booking_id", bookings.map((b) => b.id)).order("created_at"));
  return bookings.map((b) => ({ ...b, events: events.filter((e) => e.booking_id === b.id) }));
}

export async function countAwaitingMe(userId) {
  const { count, error } = await supabase.from("rt_bookings").select("id", { count: "exact", head: true })
    .eq("awaiting_user_id", userId).in("status", ["pending", "counterproposed"])
    .gt("scheduled_at", new Date().toISOString());
  if (error) return 0;
  return count || 0;
}

export async function markNotificationsRead(userId) {
  await supabase.from("rt_notifications").update({ read_at: new Date().toISOString() })
    .eq("recipient_id", userId).is("read_at", null);
}

export const requestJoin = (sessionId, occurrenceDate, message) =>
  rpc("rt_request_join", { p_session_id: sessionId, p_occurrence_date: occurrenceDate, p_message: message || null });

export const propose = (scheduledAt, durationMinutes, title, message) =>
  rpc("rt_propose", { p_scheduled_at: scheduledAt.toISOString(), p_duration_minutes: durationMinutes, p_title: title || null, p_message: message || null });

export const respond = (bookingId, accept, message) =>
  rpc("rt_respond", { p_booking_id: bookingId, p_accept: accept, p_message: message || null });

export const counterPropose = (bookingId, scheduledAt, durationMinutes, message) =>
  rpc("rt_counter_propose", { p_booking_id: bookingId, p_scheduled_at: scheduledAt.toISOString(), p_duration_minutes: durationMinutes, p_message: message || null });

export const cancelBooking = (bookingId, message) =>
  rpc("rt_cancel", { p_booking_id: bookingId, p_message: message || null });

export const completeBooking = (bookingId, message) =>
  rpc("rt_complete", { p_booking_id: bookingId, p_message: message || null });

// ---------- Tiempo real ----------
export function onChanges(tables, callback) {
  let timer;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(callback, 400); };
  const channel = supabase.channel(`rt-${tables.join("-")}`);
  for (const table of tables) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, debounced);
  }
  channel.subscribe();
  return () => supabase.removeChannel(channel);
}
