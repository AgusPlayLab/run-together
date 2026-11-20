// Valida la migración en un Postgres embebido (PGlite) con un stub mínimo de Supabase Auth.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = new URL("../supabase/migrations/", import.meta.url);
const A = "11111111-1111-1111-1111-111111111111"; // miembro
const B = "22222222-2222-2222-2222-222222222222"; // miembro
const C = "33333333-3333-3333-3333-333333333333"; // usuario autenticado ajeno (p. ej. de Maldives)

const db = new PGlite();
let sessionId, date, dow;

async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  return db.query(sql, params);
}
const rejects = (uid, sql, params, pattern) => assert.rejects(as(uid, sql, params), pattern);
const rpcResult = async (uid, sql, params) => (await as(uid, sql, params)).rows[0].r;

before(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    insert into auth.users values ('${A}', 'a@x.com'), ('${B}', 'b@x.com'), ('${C}', 'c@x.com');
  `);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(new URL(file, MIGRATIONS), "utf8");
    await db.exec(sql);
    await db.exec(sql); // idempotente
  }
  await db.exec(`insert into public.rt_profiles (user_id, display_name, email) values ('${A}', 'Jose', 'a@x.com'), ('${B}', 'Ella', 'b@x.com');`);
  const row = (await db.query(`select (current_date + 3)::text as d, extract(isodow from current_date + 3)::int as dow`)).rows[0];
  date = row.d; dow = row.dow;
});

test("salidas: cada uno publica las suyas y solo los miembros las ven", async () => {
  const r = await as(A, `insert into rt_sessions (owner_id, recurrence, day_of_week, start_time, title)
                         values ($1, 'weekly', $2, '07:00', 'Rodaje') returning id`, [A, dow]);
  sessionId = r.rows[0].id;
  await rejects(B, `insert into rt_sessions (owner_id, recurrence, day_of_week, start_time, title) values ($1, 'weekly', 1, '07:00', 'x')`, [A], /row-level security/);
  assert.equal((await as(B, `select * from rt_sessions`)).rows.length, 1);
  assert.equal((await as(C, `select * from rt_sessions`)).rows.length, 0);
  await rejects(null, `select * from rt_sessions`, [], /permission denied/);
});

test("solicitud, contrapropuesta y aceptación respetan los turnos", async () => {
  await rejects(A, `select rt_request_join($1, $2)`, [sessionId, date], /propia/);
  await rejects(B, `select rt_request_join($1, ($2::date + 1))`, [sessionId, date], /no coincide/);
  const { booking_id, notification_id } = await rpcResult(B, `select rt_request_join($1, $2, '¿Te acompaño?') as r`, [sessionId, date]);
  assert.ok(notification_id);
  await rejects(B, `select rt_request_join($1, $2)`, [sessionId, date], /Ya tienes/);
  await rejects(B, `select rt_respond($1, true)`, [booking_id], /otra persona/);
  await rejects(C, `select rt_respond($1, true)`, [booking_id], /No tienes acceso/);
  await as(A, `select rt_counter_propose($1, (($2::date + time '08:00') at time zone 'Europe/Madrid'), 60, 'Mejor a las 8')`, [booking_id, date]);
  await rejects(A, `select rt_respond($1, true)`, [booking_id], /otra persona/);
  await as(B, `select rt_respond($1, true, '¡Hecho!')`, [booking_id]);
  assert.equal((await as(B, `select status from rt_bookings where id = $1`, [booking_id])).rows[0].status, "accepted");
  assert.equal((await as(B, `select * from rt_booking_events where booking_id = $1`, [booking_id])).rows.length, 3);
  assert.equal((await as(C, `select * from rt_booking_events`)).rows.length, 0);

  const overlap = await rpcResult(B, `select rt_propose((($1::date + time '08:30') at time zone 'Europe/Madrid'), 45) as r`, [date]);
  await rejects(A, `select rt_respond($1, true)`, [overlap.booking_id], /solapa/);
  await rejects(A, `select rt_complete($1)`, [booking_id], /Todavía/);
  await as(A, `select rt_cancel($1, 'Me ha surgido algo')`, [booking_id]);
  await as(B, `select rt_request_join($1, $2)`, [sessionId, date]);
});

test("reservas y avisos no se pueden escribir saltándose las RPC", async () => {
  await rejects(B, `update rt_bookings set status = 'accepted'`, [], /permission denied/);
  await rejects(B, `insert into rt_bookings (kind, requester_id, recipient_id, scheduled_at, duration_minutes, occurrence_date)
                    values ('proposal', $1, $2, now() + interval '1 day', 45, current_date)`, [B, A], /permission denied/);
  await rejects(A, `update rt_notifications set email_status = 'sent'`, [], /permission denied/);
  await as(A, `update rt_notifications set read_at = now() where recipient_id = $1`, [A]);
  await rejects(A, `select rt_log_event($1, $2, $3, 'accepted', null)`, [A, A, B], /permission denied/);
  await rejects(B, `select rt_propose(now() - interval '1 hour', 45)`, [], /futuro/);
});

test("excepciones por fecha: cancelar y mover una ocurrencia", async () => {
  await as(A, `insert into rt_session_exceptions (session_id, owner_id, exception_date, kind) values ($1, $2, ($3::date + 7), 'cancelled')`, [sessionId, A, date]);
  await rejects(B, `select rt_request_join($1, ($2::date + 7))`, [sessionId, date], /cancelada/);
  await rejects(B, `insert into rt_session_exceptions (session_id, owner_id, exception_date, kind) values ($1, $2, ($3::date + 14), 'cancelled')`, [sessionId, B, date], /row-level security/);
  await as(A, `insert into rt_session_exceptions (session_id, owner_id, exception_date, kind, new_start_time) values ($1, $2, ($3::date + 14), 'moved', '09:15')`, [sessionId, A, date]);
  const { booking_id } = await rpcResult(B, `select rt_request_join($1, ($2::date + 14)) as r`, [sessionId, date]);
  const t = await as(B, `select to_char(scheduled_at at time zone 'Europe/Madrid', 'HH24:MI') as t from rt_bookings where id = $1`, [booking_id]);
  assert.equal(t.rows[0].t, "09:15");

  await as(A, `insert into rt_session_exceptions (session_id, owner_id, exception_date, kind, new_start_time, new_duration_minutes, new_title)
               values ($1, $2, ($3::date + 21), 'moved', '07:00', 90, 'Tirada larga')`, [sessionId, A, date]);
  const changed = await rpcResult(B, `select rt_request_join($1, ($2::date + 21)) as r`, [sessionId, date]);
  const b = (await as(B, `select duration_minutes, title from rt_bookings where id = $1`, [changed.booking_id])).rows[0];
  assert.deepEqual(b, { duration_minutes: 90, title: "Tirada larga" });
});

test("descansos fijos únicos por día", async () => {
  await as(A, `insert into rt_rest_days (owner_id, recurrence, day_of_week) values ($1, 'weekly', 3)`, [A]);
  await rejects(A, `insert into rt_rest_days (owner_id, recurrence, day_of_week) values ($1, 'weekly', 3)`, [A], /duplicate/);
});
