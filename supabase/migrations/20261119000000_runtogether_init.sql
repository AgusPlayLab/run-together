-- ============================================================
-- RunTogether · esquema inicial
-- Proyecto Supabase compartido con Maldives VIP Experience.
-- Todo lo de RunTogether usa el prefijo rt_ para no interferir.
-- Zona horaria de negocio: Europe/Madrid.
-- Ejecutar completo en SQL Editor (o con `supabase db push`).
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABLAS
-- ------------------------------------------------------------

-- Los dos miembros de la app. Solo quien tenga fila aquí puede usar RunTogether.
create table if not exists public.rt_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  email        text not null,
  emoji        text not null default '🏃' check (char_length(emoji) <= 8),
  notify_email boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Salidas publicadas: semanales (day_of_week ISO 1=lunes … 7=domingo) o puntuales (session_date).
create table if not exists public.rt_sessions (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.rt_profiles(user_id) on delete cascade,
  recurrence       text not null check (recurrence in ('weekly', 'once')),
  day_of_week      smallint check (day_of_week between 1 and 7),
  session_date     date,
  start_time       time not null,
  duration_minutes int  not null default 45 check (duration_minutes between 15 and 300),
  title            text not null check (char_length(title) between 1 and 70),
  category         text not null default 'easy'
                   check (category in ('easy', 'hard', 'long', 'recovery', 'walk', 'improvised', 'other')),
  description      text check (char_length(description) <= 240),
  meeting_point    text check (char_length(meeting_point) <= 120),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint rt_sessions_recurrence_chk check (
    (recurrence = 'weekly' and day_of_week is not null and session_date is null) or
    (recurrence = 'once'   and session_date is not null and day_of_week is null)
  )
);

-- Excepciones de una salida semanal en una fecha concreta ("este lunes no", "este lunes a las 8").
create table if not exists public.rt_session_exceptions (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.rt_sessions(id) on delete cascade,
  owner_id       uuid not null references public.rt_profiles(user_id) on delete cascade,
  exception_date date not null,
  kind           text not null check (kind in ('cancelled', 'moved')),
  new_start_time time,
  note           text check (char_length(note) <= 240),
  created_at     timestamptz not null default now(),
  constraint rt_session_exceptions_unique unique (session_id, exception_date),
  constraint rt_session_exceptions_kind_chk check ((kind = 'moved') = (new_start_time is not null))
);

-- Días de descanso: fijos por día de la semana o en una fecha concreta.
create table if not exists public.rt_rest_days (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.rt_profiles(user_id) on delete cascade,
  recurrence  text not null check (recurrence in ('weekly', 'once')),
  day_of_week smallint check (day_of_week between 1 and 7),
  rest_date   date,
  note        text check (char_length(note) <= 120),
  created_at  timestamptz not null default now(),
  constraint rt_rest_days_recurrence_chk check (
    (recurrence = 'weekly' and day_of_week is not null and rest_date is null) or
    (recurrence = 'once'   and rest_date is not null and day_of_week is null)
  )
);

-- Reservas: 'join' = apuntarse a una salida publicada; 'proposal' = propuesta libre.
-- Solo se modifican mediante las funciones rt_* (no hay políticas de escritura directa).
create table if not exists public.rt_bookings (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('join', 'proposal')),
  session_id       uuid references public.rt_sessions(id) on delete set null,
  occurrence_date  date,
  requester_id     uuid not null references public.rt_profiles(user_id) on delete cascade,
  recipient_id     uuid not null references public.rt_profiles(user_id) on delete cascade,
  awaiting_user_id uuid references public.rt_profiles(user_id) on delete set null,
  scheduled_at     timestamptz not null,
  duration_minutes int  not null check (duration_minutes between 15 and 300),
  title            text not null default 'Salida juntos' check (char_length(title) between 1 and 70),
  message          text check (char_length(message) <= 240),
  status           text not null default 'pending'
                   check (status in ('pending', 'counterproposed', 'accepted', 'declined', 'cancelled', 'completed')),
  responded_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint rt_bookings_two_people check (requester_id <> recipient_id),
  constraint rt_bookings_join_chk check (kind = 'proposal' or occurrence_date is not null)
);

-- Historial de cada reserva (solicitud, contrapropuestas, respuestas, mensajes).
create table if not exists public.rt_booking_events (
  id               bigint generated always as identity primary key,
  booking_id       uuid not null references public.rt_bookings(id) on delete cascade,
  actor_id         uuid not null references public.rt_profiles(user_id) on delete cascade,
  event_type       text not null
                   check (event_type in ('requested', 'proposed', 'counterproposed', 'accepted', 'declined', 'cancelled', 'completed')),
  scheduled_at     timestamptz,
  duration_minutes int,
  message          text check (char_length(message) <= 240),
  created_at       timestamptz not null default now()
);

-- Avisos para la otra persona. La Edge Function rt-send-notification los envía por Resend.
create table if not exists public.rt_notifications (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid references public.rt_bookings(id) on delete cascade,
  actor_id     uuid not null references public.rt_profiles(user_id) on delete cascade,
  recipient_id uuid not null references public.rt_profiles(user_id) on delete cascade,
  event_type   text not null,
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  email_error  text,
  sent_at      timestamptz,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. ÍNDICES
-- ------------------------------------------------------------
create index if not exists rt_sessions_owner_idx       on public.rt_sessions(owner_id, recurrence, day_of_week, session_date);
create index if not exists rt_session_exc_owner_idx    on public.rt_session_exceptions(owner_id, exception_date);
create unique index if not exists rt_rest_weekly_uidx  on public.rt_rest_days(owner_id, day_of_week) where recurrence = 'weekly';
create unique index if not exists rt_rest_once_uidx    on public.rt_rest_days(owner_id, rest_date)   where recurrence = 'once';
create index if not exists rt_bookings_requester_idx   on public.rt_bookings(requester_id, scheduled_at);
create index if not exists rt_bookings_recipient_idx   on public.rt_bookings(recipient_id, scheduled_at);
-- Evita pedir dos veces la misma salida mientras la solicitud siga viva.
create unique index if not exists rt_bookings_open_join_uidx
  on public.rt_bookings(session_id, occurrence_date, requester_id)
  where kind = 'join' and status in ('pending', 'counterproposed', 'accepted');
create index if not exists rt_booking_events_booking_idx on public.rt_booking_events(booking_id, created_at);
create index if not exists rt_notifications_recipient_idx on public.rt_notifications(recipient_id, created_at desc);

-- ------------------------------------------------------------
-- 3. updated_at automático
-- ------------------------------------------------------------
create or replace function public.rt_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists rt_profiles_touch on public.rt_profiles;
create trigger rt_profiles_touch before update on public.rt_profiles
  for each row execute function public.rt_touch_updated_at();
drop trigger if exists rt_sessions_touch on public.rt_sessions;
create trigger rt_sessions_touch before update on public.rt_sessions
  for each row execute function public.rt_touch_updated_at();
drop trigger if exists rt_bookings_touch on public.rt_bookings;
create trigger rt_bookings_touch before update on public.rt_bookings
  for each row execute function public.rt_touch_updated_at();

-- ------------------------------------------------------------
-- 4. FUNCIONES AUXILIARES
-- ------------------------------------------------------------
create or replace function public.rt_is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rt_profiles where user_id = auth.uid());
$$;

create or replace function public.rt_partner_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select user_id from public.rt_profiles
  where user_id <> auth.uid() and exists (select 1 from public.rt_profiles where user_id = auth.uid())
  order by created_at limit 1;
$$;

create or replace function public.rt_require_member()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.rt_profiles where user_id = v_uid) then
    raise exception 'No tienes acceso a RunTogether' using errcode = '42501';
  end if;
  return v_uid;
end $$;

-- Registra el evento y crea el aviso para la otra persona. Devuelve el id del aviso.
create or replace function public.rt_log_event(
  p_booking_id uuid, p_actor uuid, p_recipient uuid, p_event text, p_message text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.rt_bookings;
  v_notification uuid;
begin
  select * into v_booking from public.rt_bookings where id = p_booking_id;
  insert into public.rt_booking_events (booking_id, actor_id, event_type, scheduled_at, duration_minutes, message)
  values (p_booking_id, p_actor, p_event, v_booking.scheduled_at, v_booking.duration_minutes, nullif(trim(p_message), ''));
  insert into public.rt_notifications (booking_id, actor_id, recipient_id, event_type)
  values (p_booking_id, p_actor, p_recipient, p_event)
  returning id into v_notification;
  return v_notification;
end $$;

-- ------------------------------------------------------------
-- 5. FUNCIONES DE NEGOCIO (RPC)
--    Todas devuelven jsonb { booking_id, notification_id }.
-- ------------------------------------------------------------

-- Apuntarse a una salida publicada por la otra persona en una fecha concreta.
create or replace function public.rt_request_join(
  p_session_id uuid, p_occurrence_date date, p_message text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.rt_require_member();
  v_session public.rt_sessions;
  v_exception public.rt_session_exceptions;
  v_start time;
  v_at timestamptz;
  v_id uuid;
begin
  select * into v_session from public.rt_sessions where id = p_session_id and is_active;
  if not found then raise exception 'Esa salida ya no existe'; end if;
  if v_session.owner_id = v_uid then raise exception 'No puedes apuntarte a tu propia salida'; end if;

  if v_session.recurrence = 'weekly' and extract(isodow from p_occurrence_date) <> v_session.day_of_week then
    raise exception 'La fecha no coincide con el día de la salida';
  end if;
  if v_session.recurrence = 'once' and p_occurrence_date <> v_session.session_date then
    raise exception 'La fecha no coincide con la salida';
  end if;

  v_start := v_session.start_time;
  select * into v_exception from public.rt_session_exceptions
   where session_id = p_session_id and exception_date = p_occurrence_date;
  if found then
    if v_exception.kind = 'cancelled' then raise exception 'Esa salida está cancelada ese día'; end if;
    v_start := v_exception.new_start_time;
  end if;

  v_at := (p_occurrence_date + v_start) at time zone 'Europe/Madrid';
  if v_at <= now() then raise exception 'Esa salida ya ha pasado'; end if;

  begin
    insert into public.rt_bookings (kind, session_id, occurrence_date, requester_id, recipient_id, awaiting_user_id,
                                    scheduled_at, duration_minutes, title, message, status)
    values ('join', p_session_id, p_occurrence_date, v_uid, v_session.owner_id, v_session.owner_id,
            v_at, v_session.duration_minutes, v_session.title, nullif(trim(p_message), ''), 'pending')
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya tienes una solicitud para esa salida';
  end;

  return jsonb_build_object('booking_id', v_id,
    'notification_id', public.rt_log_event(v_id, v_uid, v_session.owner_id, 'requested', p_message));
end $$;

-- Proponer una salida en un momento libre.
create or replace function public.rt_propose(
  p_scheduled_at timestamptz, p_duration_minutes int, p_title text default null, p_message text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.rt_require_member();
  v_partner uuid := public.rt_partner_id();
  v_id uuid;
begin
  if v_partner is null then raise exception 'Todavía no hay otra persona en RunTogether'; end if;
  if p_scheduled_at <= now() then raise exception 'Propón un momento futuro'; end if;

  insert into public.rt_bookings (kind, requester_id, recipient_id, awaiting_user_id, scheduled_at,
                                  duration_minutes, title, message, status, occurrence_date)
  values ('proposal', v_uid, v_partner, v_partner, p_scheduled_at, p_duration_minutes,
          coalesce(nullif(trim(p_title), ''), 'Salida juntos'), nullif(trim(p_message), ''), 'pending',
          (p_scheduled_at at time zone 'Europe/Madrid')::date)
  returning id into v_id;

  return jsonb_build_object('booking_id', v_id,
    'notification_id', public.rt_log_event(v_id, v_uid, v_partner, 'proposed', p_message));
end $$;

-- Aceptar o rechazar. Solo puede hacerlo la persona a la que le toca responder.
create or replace function public.rt_respond(
  p_booking_id uuid, p_accept boolean, p_message text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.rt_require_member();
  v_b public.rt_bookings;
  v_other uuid;
begin
  select * into v_b from public.rt_bookings where id = p_booking_id for update;
  if not found or v_uid not in (v_b.requester_id, v_b.recipient_id) then raise exception 'Reserva no encontrada'; end if;
  if v_b.status not in ('pending', 'counterproposed') then raise exception 'Esta reserva ya no está pendiente'; end if;
  if v_b.awaiting_user_id is distinct from v_uid then raise exception 'Ahora le toca responder a la otra persona'; end if;
  if v_b.scheduled_at <= now() then raise exception 'Esta propuesta ya ha caducado'; end if;

  if p_accept then
    perform pg_advisory_xact_lock(hashtext('rt_accept'));
    if exists (
      select 1 from public.rt_bookings o
       where o.id <> v_b.id and o.status = 'accepted'
         and tstzrange(o.scheduled_at, o.scheduled_at + make_interval(mins => o.duration_minutes))
          && tstzrange(v_b.scheduled_at, v_b.scheduled_at + make_interval(mins => v_b.duration_minutes))
    ) then
      raise exception 'Ya tenéis otra salida aceptada que se solapa con esta';
    end if;
  end if;

  update public.rt_bookings
     set status = case when p_accept then 'accepted' else 'declined' end,
         awaiting_user_id = null, responded_at = now()
   where id = v_b.id;

  v_other := case when v_uid = v_b.requester_id then v_b.recipient_id else v_b.requester_id end;
  return jsonb_build_object('booking_id', v_b.id,
    'notification_id', public.rt_log_event(v_b.id, v_uid, v_other,
                                           case when p_accept then 'accepted' else 'declined' end, p_message));
end $$;

-- Contrapropuesta: cambia hora/duración y pasa el turno a la otra persona.
create or replace function public.rt_counter_propose(
  p_booking_id uuid, p_scheduled_at timestamptz, p_duration_minutes int, p_message text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.rt_require_member();
  v_b public.rt_bookings;
  v_other uuid;
begin
  select * into v_b from public.rt_bookings where id = p_booking_id for update;
  if not found or v_uid not in (v_b.requester_id, v_b.recipient_id) then raise exception 'Reserva no encontrada'; end if;
  if v_b.status not in ('pending', 'counterproposed') then raise exception 'Esta reserva ya no está pendiente'; end if;
  if v_b.awaiting_user_id is distinct from v_uid then raise exception 'Ahora le toca responder a la otra persona'; end if;
  if p_scheduled_at <= now() then raise exception 'Propón un momento futuro'; end if;

  v_other := case when v_uid = v_b.requester_id then v_b.recipient_id else v_b.requester_id end;
  update public.rt_bookings
     set scheduled_at = p_scheduled_at, duration_minutes = p_duration_minutes,
         occurrence_date = (p_scheduled_at at time zone 'Europe/Madrid')::date,
         status = 'counterproposed', awaiting_user_id = v_other
   where id = v_b.id;

  return jsonb_build_object('booking_id', v_b.id,
    'notification_id', public.rt_log_event(v_b.id, v_uid, v_other, 'counterproposed', p_message));
end $$;

-- Cancelar (retirar una solicitud o anular una salida aceptada que aún no ha empezado).
create or replace function public.rt_cancel(
  p_booking_id uuid, p_message text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.rt_require_member();
  v_b public.rt_bookings;
  v_other uuid;
begin
  select * into v_b from public.rt_bookings where id = p_booking_id for update;
  if not found or v_uid not in (v_b.requester_id, v_b.recipient_id) then raise exception 'Reserva no encontrada'; end if;
  if v_b.status not in ('pending', 'counterproposed', 'accepted') then raise exception 'Esta reserva ya está cerrada'; end if;
  if v_b.status = 'accepted' and v_b.scheduled_at <= now() then raise exception 'La salida ya ha empezado'; end if;

  update public.rt_bookings set status = 'cancelled', awaiting_user_id = null, responded_at = now() where id = v_b.id;

  v_other := case when v_uid = v_b.requester_id then v_b.recipient_id else v_b.requester_id end;
  return jsonb_build_object('booking_id', v_b.id,
    'notification_id', public.rt_log_event(v_b.id, v_uid, v_other, 'cancelled', p_message));
end $$;

-- Marcar como realizada una salida aceptada que ya ha empezado.
create or replace function public.rt_complete(
  p_booking_id uuid, p_message text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.rt_require_member();
  v_b public.rt_bookings;
  v_other uuid;
begin
  select * into v_b from public.rt_bookings where id = p_booking_id for update;
  if not found or v_uid not in (v_b.requester_id, v_b.recipient_id) then raise exception 'Reserva no encontrada'; end if;
  if v_b.status <> 'accepted' then raise exception 'Solo se pueden completar salidas aceptadas'; end if;
  if v_b.scheduled_at > now() then raise exception 'Todavía no ha llegado la hora'; end if;

  update public.rt_bookings set status = 'completed' where id = v_b.id;

  v_other := case when v_uid = v_b.requester_id then v_b.recipient_id else v_b.requester_id end;
  return jsonb_build_object('booking_id', v_b.id,
    'notification_id', public.rt_log_event(v_b.id, v_uid, v_other, 'completed', p_message));
end $$;

-- ------------------------------------------------------------
-- 6. PERMISOS DE EJECUCIÓN
-- ------------------------------------------------------------
revoke all on function public.rt_touch_updated_at()                          from public, anon, authenticated;
revoke all on function public.rt_require_member()                            from public, anon, authenticated;
revoke all on function public.rt_log_event(uuid, uuid, uuid, text, text)     from public, anon, authenticated;
revoke all on function public.rt_is_member()                                 from public, anon;
revoke all on function public.rt_partner_id()                                from public, anon;
revoke all on function public.rt_request_join(uuid, date, text)              from public, anon;
revoke all on function public.rt_propose(timestamptz, int, text, text)       from public, anon;
revoke all on function public.rt_respond(uuid, boolean, text)                from public, anon;
revoke all on function public.rt_counter_propose(uuid, timestamptz, int, text) from public, anon;
revoke all on function public.rt_cancel(uuid, text)                          from public, anon;
revoke all on function public.rt_complete(uuid, text)                        from public, anon;

grant execute on function public.rt_is_member()                                to authenticated;
grant execute on function public.rt_partner_id()                               to authenticated;
grant execute on function public.rt_request_join(uuid, date, text)             to authenticated;
grant execute on function public.rt_propose(timestamptz, int, text, text)      to authenticated;
grant execute on function public.rt_respond(uuid, boolean, text)               to authenticated;
grant execute on function public.rt_counter_propose(uuid, timestamptz, int, text) to authenticated;
grant execute on function public.rt_cancel(uuid, text)                         to authenticated;
grant execute on function public.rt_complete(uuid, text)                       to authenticated;

-- ------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table public.rt_profiles           enable row level security;
alter table public.rt_sessions           enable row level security;
alter table public.rt_session_exceptions enable row level security;
alter table public.rt_rest_days          enable row level security;
alter table public.rt_bookings           enable row level security;
alter table public.rt_booking_events     enable row level security;
alter table public.rt_notifications      enable row level security;

-- Sin acceso anónimo a nada de RunTogether.
revoke all on public.rt_profiles, public.rt_sessions, public.rt_session_exceptions, public.rt_rest_days,
              public.rt_bookings, public.rt_booking_events, public.rt_notifications from anon;
-- Reservas, eventos y avisos solo se escriben vía RPC.
revoke insert, update, delete on public.rt_bookings, public.rt_booking_events from authenticated;
revoke insert, update, delete on public.rt_notifications from authenticated;
grant update (read_at) on public.rt_notifications to authenticated;

-- Perfiles
drop policy if exists rt_profiles_select on public.rt_profiles;
create policy rt_profiles_select on public.rt_profiles
  for select to authenticated using (public.rt_is_member());
drop policy if exists rt_profiles_update on public.rt_profiles;
create policy rt_profiles_update on public.rt_profiles
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Salidas
drop policy if exists rt_sessions_select on public.rt_sessions;
create policy rt_sessions_select on public.rt_sessions
  for select to authenticated using (public.rt_is_member());
drop policy if exists rt_sessions_insert on public.rt_sessions;
create policy rt_sessions_insert on public.rt_sessions
  for insert to authenticated with check (owner_id = (select auth.uid()) and public.rt_is_member());
drop policy if exists rt_sessions_update on public.rt_sessions;
create policy rt_sessions_update on public.rt_sessions
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists rt_sessions_delete on public.rt_sessions;
create policy rt_sessions_delete on public.rt_sessions
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Excepciones (solo sobre salidas propias)
drop policy if exists rt_exceptions_select on public.rt_session_exceptions;
create policy rt_exceptions_select on public.rt_session_exceptions
  for select to authenticated using (public.rt_is_member());
drop policy if exists rt_exceptions_insert on public.rt_session_exceptions;
create policy rt_exceptions_insert on public.rt_session_exceptions
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.rt_sessions s where s.id = session_id and s.owner_id = (select auth.uid()))
  );
drop policy if exists rt_exceptions_update on public.rt_session_exceptions;
create policy rt_exceptions_update on public.rt_session_exceptions
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists rt_exceptions_delete on public.rt_session_exceptions;
create policy rt_exceptions_delete on public.rt_session_exceptions
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Descansos
drop policy if exists rt_rest_select on public.rt_rest_days;
create policy rt_rest_select on public.rt_rest_days
  for select to authenticated using (public.rt_is_member());
drop policy if exists rt_rest_insert on public.rt_rest_days;
create policy rt_rest_insert on public.rt_rest_days
  for insert to authenticated with check (owner_id = (select auth.uid()) and public.rt_is_member());
drop policy if exists rt_rest_delete on public.rt_rest_days;
create policy rt_rest_delete on public.rt_rest_days
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Reservas y eventos: lectura para los participantes
drop policy if exists rt_bookings_select on public.rt_bookings;
create policy rt_bookings_select on public.rt_bookings
  for select to authenticated using ((select auth.uid()) in (requester_id, recipient_id));
drop policy if exists rt_events_select on public.rt_booking_events;
create policy rt_events_select on public.rt_booking_events
  for select to authenticated using (exists (
    select 1 from public.rt_bookings b
     where b.id = booking_id and (select auth.uid()) in (b.requester_id, b.recipient_id)));

-- Avisos: los ve quien los recibe o quien los provoca; solo el destinatario marca leído.
drop policy if exists rt_notifications_select on public.rt_notifications;
create policy rt_notifications_select on public.rt_notifications
  for select to authenticated using ((select auth.uid()) in (recipient_id, actor_id));
drop policy if exists rt_notifications_update on public.rt_notifications;
create policy rt_notifications_update on public.rt_notifications
  for update to authenticated using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

-- ------------------------------------------------------------
-- 8. REALTIME (refresco en vivo de agenda y solicitudes)
-- ------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['rt_sessions', 'rt_session_exceptions', 'rt_rest_days', 'rt_bookings'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ------------------------------------------------------------
-- 9. ALTA DE LOS DOS MIEMBROS (ejecutar aparte, tras crear los usuarios en Authentication → Users)
-- ------------------------------------------------------------
-- insert into public.rt_profiles (user_id, display_name, email, emoji)
-- select id, 'Jose Vicente', email, '🏃‍♂️' from auth.users where email = 'TU_EMAIL'
-- union all
-- select id, 'Su nombre', email, '🏃‍♀️' from auth.users where email = 'SU_EMAIL';
