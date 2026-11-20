// Lógica de calendario pura (sin DOM ni Supabase) para poder probarla aislada.
// Días de la semana en formato ISO: 1 = lunes … 7 = domingo.

export const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const DAY_SHORT = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
export const OPEN_STATUSES = ["pending", "counterproposed"];
export const LIVE_STATUSES = ["pending", "counterproposed", "accepted"];
// Margen para considerar que dos salidas "coinciden" el mismo día.
export const COINCIDENCE_MINUTES = 60;

export function pad(n) { return String(n).padStart(2, "0"); }

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function isoDow(d) { return ((d.getDay() + 6) % 7) + 1; }

export function mondayOf(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(r, 1 - isoDow(r));
}

export function timeToMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}

export function shortTime(t) { return String(t).slice(0, 5); }

// Campos que una excepción 'moved' puede sobrescribir para una fecha concreta.
const OVERRIDES = {
  duration_minutes: "new_duration_minutes", title: "new_title", category: "new_category",
  description: "new_description", meeting_point: "new_meeting_point",
};

// Salida tal y como queda ese día: la habitual con los cambios puntuales aplicados.
export function applyException(session, exception) {
  if (exception?.kind !== "moved") return session;
  const effective = { ...session };
  for (const [field, override] of Object.entries(OVERRIDES)) {
    if (exception[override] != null) effective[field] = exception[override];
  }
  return effective;
}

// Combina fecha local (YYYY-MM-DD) y hora (HH:MM) en un Date local.
export function combine(isoDate, time) {
  const d = parseISODate(isoDate);
  const [h, m] = String(time).split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Construye las ocurrencias de una semana para cada persona.
 * @param {Date} weekStart lunes de la semana
 * @param {{sessions:any[], exceptions:any[], restDays:any[], bookings:any[]}} data
 * @param {string[]} userIds ids de los miembros [yo, pareja]
 * @param {Date} now
 */
export function buildWeek(weekStart, data, userIds, now = new Date()) {
  const todayIso = toISODate(now);
  const days = [];

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const iso = toISODate(date);
    const dow = isoDow(date);
    const people = {};

    for (const uid of userIds) {
      const occurrences = data.sessions
        .filter((s) => s.owner_id === uid && s.is_active &&
          ((s.recurrence === "weekly" && s.day_of_week === dow) || (s.recurrence === "once" && s.session_date === iso)))
        .map((s) => {
          const exception = data.exceptions.find((e) => e.session_id === s.id && e.exception_date === iso) || null;
          const start = shortTime(exception?.kind === "moved" ? exception.new_start_time : s.start_time);
          const startsAt = combine(iso, start);
          const booking = data.bookings.find((b) =>
            b.session_id === s.id && b.occurrence_date === iso && LIVE_STATUSES.includes(b.status)) || null;
          return {
            session: applyException(s, exception),
            date: iso,
            start,
            startsAt,
            cancelled: exception?.kind === "cancelled",
            moved: exception?.kind === "moved" && start !== shortTime(s.start_time),
            modified: exception?.kind === "moved",
            exception,
            booking,
            isPast: startsAt <= now,
          };
        })
        .sort((a, b) => a.start.localeCompare(b.start));

      const active = occurrences.filter((o) => !o.cancelled);
      const rest = data.restDays.find((r) => r.owner_id === uid &&
        ((r.recurrence === "weekly" && r.day_of_week === dow) || (r.recurrence === "once" && r.rest_date === iso))) || null;

      people[uid] = {
        occurrences,
        rest,
        state: active.length ? "run" : rest ? "rest" : "unplanned",
      };
    }

    const proposals = data.bookings
      .filter((b) => b.kind === "proposal" && b.occurrence_date === iso && LIVE_STATUSES.includes(b.status))
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

    days.push({
      date,
      iso,
      dow,
      isToday: iso === todayIso,
      isPast: iso < todayIso,
      people,
      proposals,
      coincidence: findCoincidence(userIds.map((u) => people[u])),
    });
  }
  return days;
}

// Devuelve el primer par de salidas (una de cada persona) separadas como mucho COINCIDENCE_MINUTES.
export function findCoincidence(peopleDays) {
  if (peopleDays.length < 2 || peopleDays.some((p) => !p)) return null;
  const [a, b] = peopleDays.map((p) => p.occurrences.filter((o) => !o.cancelled));
  for (const x of a) {
    for (const y of b) {
      if (Math.abs(timeToMinutes(x.start) - timeToMinutes(y.start)) <= COINCIDENCE_MINUTES) return { a: x, b: y };
    }
  }
  return null;
}

// Estado visible de una reserva: las pendientes que ya han pasado se muestran como caducadas.
export function displayStatus(booking, now = new Date()) {
  if (OPEN_STATUSES.includes(booking.status) && new Date(booking.scheduled_at) <= now) return "expired";
  return booking.status;
}
