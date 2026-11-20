-- ============================================================
-- RunTogether · cambios puntuales completos en una salida habitual
-- Una excepción 'moved' ya no solo cambia la hora: también puede cambiar
-- duración, título, tipo, punto de encuentro y detalle para esa fecha.
-- Los campos nulos heredan el valor de la salida habitual.
-- Ejecutar después de 20261119000000_runtogether_init.sql.
-- ============================================================

alter table public.rt_session_exceptions
  add column if not exists new_duration_minutes int  check (new_duration_minutes between 15 and 300),
  add column if not exists new_title            text check (char_length(new_title) between 1 and 70),
  add column if not exists new_category         text
    check (new_category in ('easy', 'hard', 'long', 'recovery', 'walk', 'improvised', 'other')),
  add column if not exists new_description      text check (char_length(new_description) <= 240),
  add column if not exists new_meeting_point    text check (char_length(new_meeting_point) <= 120);

-- Al apuntarse se usan la hora, duración y título efectivos de ese día.
create or replace function public.rt_request_join(
  p_session_id uuid, p_occurrence_date date, p_message text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.rt_require_member();
  v_session public.rt_sessions;
  v_exception public.rt_session_exceptions;
  v_start time;
  v_duration int;
  v_title text;
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
  v_duration := v_session.duration_minutes;
  v_title := v_session.title;
  select * into v_exception from public.rt_session_exceptions
   where session_id = p_session_id and exception_date = p_occurrence_date;
  if found then
    if v_exception.kind = 'cancelled' then raise exception 'Esa salida está cancelada ese día'; end if;
    v_start := v_exception.new_start_time;
    v_duration := coalesce(v_exception.new_duration_minutes, v_duration);
    v_title := coalesce(v_exception.new_title, v_title);
  end if;

  v_at := (p_occurrence_date + v_start) at time zone 'Europe/Madrid';
  if v_at <= now() then raise exception 'Esa salida ya ha pasado'; end if;

  begin
    insert into public.rt_bookings (kind, session_id, occurrence_date, requester_id, recipient_id, awaiting_user_id,
                                    scheduled_at, duration_minutes, title, message, status)
    values ('join', p_session_id, p_occurrence_date, v_uid, v_session.owner_id, v_session.owner_id,
            v_at, v_duration, v_title, nullif(trim(p_message), ''), 'pending')
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya tienes una solicitud para esa salida';
  end;

  return jsonb_build_object('booking_id', v_id,
    'notification_id', public.rt_log_event(v_id, v_uid, v_session.owner_id, 'requested', p_message));
end $$;

revoke all on function public.rt_request_join(uuid, date, text) from public, anon;
grant execute on function public.rt_request_join(uuid, date, text) to authenticated;
