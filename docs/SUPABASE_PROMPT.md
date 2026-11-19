# Prompt para el asistente de IA de Supabase

Copia el bloque de abajo en **Supabase → SQL Editor → Assistant**. Está pensado para que el asistente revise primero el proyecto compartido con Maldives VIP Experience y después genere el esquema de RunTogether.

> El SQL de referencia, ya probado (11 tests), está en [`supabase/migrations/20261119000000_runtogether_init.sql`](../supabase/migrations/20261119000000_runtogether_init.sql). El frontend espera **exactamente** los nombres de tablas, columnas y funciones que se describen aquí. Si el asistente propone cambios de nombres, recházalos o ejecuta directamente ese archivo.

---

```text
Actúa como experto en PostgreSQL y Supabase. Trabajamos sobre un proyecto Supabase EXISTENTE
que ya usa la app "Maldives VIP Experience" (tablas maldives_experience_feedback,
feedback_audit_log, contact_messages y vistas asociadas). NO modifiques ni borres nada que no
empiece por rt_.

PASO 1 – Revisión previa (solo lectura, enséñame el resultado antes de crear nada):
a) Lista las tablas, vistas y funciones de public que ya existan con prefijo rt_.
b) Lista las políticas RLS de las tablas que NO son rt_ que permitan acceso al rol
   "authenticated" o a "public" con USING (true). Vamos a crear usuarios autenticados para
   RunTogether y no deben poder leer datos de Maldives.
c) Confirma que existe la publicación supabase_realtime.

PASO 2 – Genera UNA migración SQL idempotente (create ... if not exists, drop policy if exists,
create or replace) para la app privada "RunTogether": dos personas publican sus salidas a correr
y se apuntan a las del otro, al estilo Microsoft Bookings. Zona horaria de negocio:
Europe/Madrid. Días de la semana en ISO (1=lunes … 7=domingo). Textos de error en castellano.

TABLAS (todas en public, con RLS activado):

1. rt_profiles: user_id uuid PK → auth.users(id) on delete cascade; display_name text not null
   (1-40); email text not null; emoji text not null default '🏃' (≤8); notify_email boolean
   not null default true; created_at, updated_at timestamptz default now().
   Solo quien tenga fila aquí es miembro de la app (sin registro público).

2. rt_sessions (salidas publicadas): id uuid PK default gen_random_uuid(); owner_id uuid →
   rt_profiles on delete cascade; recurrence text check in ('weekly','once'); day_of_week
   smallint 1-7; session_date date; start_time time not null; duration_minutes int default 45
   check 15-300; title text not null (1-70); category text default 'easy' check in
   ('easy','hard','long','recovery','walk','improvised','other'); description text (≤240);
   meeting_point text (≤120); is_active boolean default true; created_at, updated_at.
   CHECK: weekly ⇒ day_of_week not null y session_date null; once ⇒ al revés.
   Un usuario puede tener varias salidas el mismo día.

3. rt_session_exceptions (cambiar una salida semanal en una fecha concreta): id uuid PK;
   session_id → rt_sessions on delete cascade; owner_id → rt_profiles; exception_date date;
   kind text check in ('cancelled','moved'); new_start_time time; note text (≤240);
   created_at. UNIQUE (session_id, exception_date). CHECK (kind='moved') = (new_start_time
   is not null).

4. rt_rest_days (descansos): id uuid PK; owner_id → rt_profiles; recurrence 'weekly'|'once';
   day_of_week smallint 1-7; rest_date date; note (≤120); created_at. Mismo CHECK que
   rt_sessions. Índices únicos parciales (owner_id, day_of_week) where weekly y
   (owner_id, rest_date) where once.

5. rt_bookings (reservas): id uuid PK; kind text check in ('join','proposal'); session_id →
   rt_sessions on delete set null; occurrence_date date; requester_id, recipient_id →
   rt_profiles; awaiting_user_id → rt_profiles on delete set null (a quién le toca
   responder); scheduled_at timestamptz not null; duration_minutes int 15-300; title text
   default 'Salida juntos' (1-70); message text (≤240); status text default 'pending' check
   in ('pending','counterproposed','accepted','declined','cancelled','completed');
   responded_at timestamptz; created_at, updated_at.
   CHECK requester_id <> recipient_id. CHECK kind='proposal' or occurrence_date is not null.
   Índice único parcial (session_id, occurrence_date, requester_id) where kind='join' and
   status in ('pending','counterproposed','accepted').

6. rt_booking_events (historial): id bigint identity PK; booking_id → rt_bookings on delete
   cascade; actor_id → rt_profiles; event_type text check in ('requested','proposed',
   'counterproposed','accepted','declined','cancelled','completed'); scheduled_at
   timestamptz; duration_minutes int; message text (≤240); created_at.

7. rt_notifications (avisos que enviará una Edge Function con Resend): id uuid PK; booking_id
   → rt_bookings on delete cascade; actor_id, recipient_id → rt_profiles; event_type text;
   email_status text default 'pending' check in ('pending','sent','failed','skipped');
   email_error text; sent_at, read_at timestamptz; created_at.

Triggers updated_at en rt_profiles, rt_sessions y rt_bookings. Índices por owner/fechas.

FUNCIONES (todas SECURITY DEFINER con set search_path = ''):
- rt_is_member() returns boolean: existe rt_profiles para auth.uid().
- rt_partner_id() returns uuid: el otro miembro.
- rt_require_member() returns uuid: lanza 'No tienes acceso a RunTogether' si no es miembro.
- rt_log_event(p_booking_id, p_actor, p_recipient, p_event, p_message) returns uuid: inserta
  en rt_booking_events y en rt_notifications y devuelve el id del aviso. NO expuesta.
- RPC expuestas a authenticated, todas devuelven jsonb {booking_id, notification_id}:
  · rt_request_join(p_session_id uuid, p_occurrence_date date, p_message text default null):
    la salida debe estar activa, no ser propia, la fecha debe coincidir con day_of_week (o
    session_date). Si hay excepción 'cancelled' error; si 'moved' usa new_start_time.
    scheduled_at = (fecha + hora) at time zone 'Europe/Madrid' y debe ser futuro. Crea
    reserva 'join' pendiente con awaiting_user_id = dueño. Duplicado → 'Ya tienes una
    solicitud para esa salida'. Evento 'requested'.
  · rt_propose(p_scheduled_at timestamptz, p_duration_minutes int, p_title text default null,
    p_message text default null): propuesta libre al otro miembro, futura. Evento 'proposed'.
  · rt_respond(p_booking_id uuid, p_accept boolean, p_message text default null): solo
    awaiting_user_id, estado pending/counterproposed, no caducada. Al aceptar, bloqueo con
    pg_advisory_xact_lock y error si se solapa (tstzrange) con otra reserva 'accepted'.
    Eventos 'accepted'/'declined'.
  · rt_counter_propose(p_booking_id uuid, p_scheduled_at timestamptz, p_duration_minutes int,
    p_message text default null): solo awaiting_user_id; cambia hora, status
    'counterproposed' y pasa el turno al otro. Evento 'counterproposed'.
  · rt_cancel(p_booking_id uuid, p_message text default null): cualquier participante si
    está pending/counterproposed/accepted y (si aceptada) aún no ha empezado.
  · rt_complete(p_booking_id uuid, p_message text default null): participante, solo
    'accepted' y ya empezada.
Revoca EXECUTE a public y anon en todas; grant a authenticated solo en las RPC y en
rt_is_member / rt_partner_id.

RLS:
- Revoca todo a anon en las tablas rt_.
- rt_profiles: select si rt_is_member(); update solo la propia fila.
- rt_sessions, rt_rest_days: select miembros; insert/update/delete solo owner_id = auth.uid().
- rt_session_exceptions: igual, y en insert la salida debe ser del usuario.
- rt_bookings: select solo participantes; SIN insert/update/delete para authenticated
  (revoke), todo pasa por las RPC.
- rt_booking_events: select si participa en la reserva.
- rt_notifications: select si es recipient o actor; update solo la columna read_at
  (grant update(read_at)) y solo el destinatario.
Usa (select auth.uid()) en las políticas por rendimiento.

REALTIME: añade rt_sessions, rt_session_exceptions, rt_rest_days y rt_bookings a
supabase_realtime si no están ya.

PASO 3 – Al final, deja comentado el alta de los dos perfiles:
insert into public.rt_profiles (user_id, display_name, email, emoji)
select id, 'NOMBRE', email, '🏃' from auth.users where email = 'EMAIL';

Explícame cualquier riesgo que detectes antes de ejecutar.
```
