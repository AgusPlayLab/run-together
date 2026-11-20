import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWeek, mondayOf, isoDow, toISODate, displayStatus } from "../js/schedule.js";

const ME = "me", HER = "her";
// Lunes 23/11/2026, consultado el martes 24 a mediodía.
const MONDAY = new Date(2026, 10, 23);
const NOW = new Date(2026, 10, 24, 12, 0);

const session = (over) => ({ id: "s1", owner_id: ME, recurrence: "weekly", day_of_week: 1, session_date: null,
  start_time: "07:00:00", duration_minutes: 45, title: "Rodaje", category: "easy", is_active: true, ...over });
const empty = { sessions: [], exceptions: [], restDays: [], bookings: [] };

test("mondayOf / isoDow usan semana ISO (domingo = 7)", () => {
  assert.equal(toISODate(mondayOf(new Date(2026, 10, 29))), "2026-11-23");
  assert.equal(isoDow(new Date(2026, 10, 29)), 7);
});

test("estados del día: correr, descanso y sin planificar", () => {
  const days = buildWeek(MONDAY, {
    ...empty,
    sessions: [session()],
    restDays: [{ owner_id: ME, recurrence: "weekly", day_of_week: 3, rest_date: null }],
  }, [ME, HER], NOW);
  assert.equal(days[0].people[ME].state, "run");
  assert.equal(days[2].people[ME].state, "rest");
  assert.equal(days[1].people[ME].state, "unplanned");
  assert.equal(days[0].isPast, true);
  assert.equal(days[1].isToday, true);
});

test("una excepción cancela o mueve solo esa fecha", () => {
  const data = { ...empty, sessions: [session(), session({ id: "s2", day_of_week: 4 })], exceptions: [
    { session_id: "s1", exception_date: "2026-11-23", kind: "cancelled", new_start_time: null },
    { session_id: "s2", exception_date: "2026-11-26", kind: "moved", new_start_time: "08:30:00" },
  ] };
  const days = buildWeek(MONDAY, data, [ME, HER], NOW);
  assert.equal(days[0].people[ME].occurrences[0].cancelled, true);
  assert.equal(days[0].people[ME].state, "unplanned");
  assert.equal(days[3].people[ME].occurrences[0].start, "08:30");
  assert.equal(days[3].people[ME].occurrences[0].moved, true);
  const next = buildWeek(new Date(2026, 10, 30), data, [ME, HER], NOW);
  assert.equal(next[0].people[ME].occurrences[0].cancelled, false);
});

test("un cambio puntual sustituye solo los campos indicados ese día", () => {
  const data = { ...empty, sessions: [session({ day_of_week: 4, meeting_point: "Parque" })], exceptions: [
    { session_id: "s1", exception_date: "2026-11-26", kind: "moved", new_start_time: "07:00:00",
      new_duration_minutes: 90, new_title: "Tirada larga", new_category: null, new_description: null, new_meeting_point: "" },
  ] };
  const [occ] = buildWeek(MONDAY, data, [ME, HER], NOW)[3].people[ME].occurrences;
  assert.equal(occ.moved, false);
  assert.equal(occ.modified, true);
  assert.equal(occ.session.id, "s1");
  assert.equal(occ.session.duration_minutes, 90);
  assert.equal(occ.session.title, "Tirada larga");
  assert.equal(occ.session.category, "easy");
  assert.equal(occ.session.meeting_point, "");
  const [nextWeek] = buildWeek(new Date(2026, 10, 30), data, [ME, HER], NOW)[3].people[ME].occurrences;
  assert.equal(nextWeek.session.title, "Rodaje");
});

test("salida puntual sustituye a un descanso fijo ese día", () => {
  const days = buildWeek(MONDAY, { ...empty,
    sessions: [session({ recurrence: "once", day_of_week: null, session_date: "2026-11-25" })],
    restDays: [{ owner_id: ME, recurrence: "weekly", day_of_week: 3, rest_date: null }],
  }, [ME, HER], NOW);
  assert.equal(days[2].people[ME].state, "run");
});

test("detecta coincidencias a menos de 60 minutos y enlaza la reserva viva", () => {
  const days = buildWeek(MONDAY, { ...empty,
    sessions: [session({ day_of_week: 5 }), session({ id: "s2", owner_id: HER, day_of_week: 5, start_time: "07:45:00" })],
    bookings: [{ id: "b1", kind: "join", session_id: "s2", occurrence_date: "2026-11-27", status: "pending", scheduled_at: "2026-11-27T06:45:00Z" }],
  }, [ME, HER], NOW);
  assert.ok(days[4].coincidence);
  assert.equal(days[4].people[HER].occurrences[0].booking.id, "b1");
  const far = buildWeek(MONDAY, { ...empty,
    sessions: [session({ day_of_week: 5 }), session({ id: "s2", owner_id: HER, day_of_week: 5, start_time: "19:00:00" })],
  }, [ME, HER], NOW);
  assert.equal(far[4].coincidence, null);
});

test("las pendientes pasadas se muestran como caducadas", () => {
  assert.equal(displayStatus({ status: "pending", scheduled_at: "2026-11-20T06:00:00Z" }, NOW), "expired");
  assert.equal(displayStatus({ status: "accepted", scheduled_at: "2026-11-20T06:00:00Z" }, NOW), "accepted");
});
