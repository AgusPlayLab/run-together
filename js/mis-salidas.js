// Gestión de la planificación propia: semana tipo, descansos, salidas puntuales, excepciones y perfil.
import { requireMember, renderHeader, toast, escapeHtml, wireDialogs, withBusy, CATEGORY,
  formatDay, capitalize } from "./shared.js";
import { loadMyPlan, saveSession, setSessionActive, deleteSession, saveException, deleteException,
  addRestDay, deleteRestDay, updateProfile } from "./api.js";
import { DAY_NAMES, toISODate, parseISODate, addDays, isoDow, shortTime } from "./schedule.js";

const $ = (id) => document.getElementById(id);
const UPCOMING_WEEKS = 8;

function init(ctx) {
  const { me } = ctx;
  let plan = { sessions: [], exceptions: [], restDays: [] };

  renderHeader("mis-salidas", ctx);
  wireDialogs();
  fillProfile();
  document.body.classList.remove("booting");

  // ---------- Diálogo de salida ----------
  const recurrenceInputs = document.querySelectorAll('input[name="recurrence"]');
  const syncRecurrence = () => {
    const once = document.querySelector('input[name="recurrence"]:checked').value === "once";
    $("session-day-field").classList.toggle("hidden", once);
    $("session-date-field").classList.toggle("hidden", !once);
    $("session-date").required = once;
  };
  recurrenceInputs.forEach((r) => r.addEventListener("change", syncRecurrence));

  function openSession({ session = null, recurrence = "weekly", day = 1, date = null } = {}) {
    $("session-form").reset();
    $("session-id").value = session?.id || "";
    const rec = session?.recurrence || recurrence;
    document.querySelector(`input[name="recurrence"][value="${rec}"]`).checked = true;
    $("session-day").value = String(session?.day_of_week || day);
    $("session-date").value = session?.session_date || date || toISODate(new Date());
    $("session-date").min = toISODate(new Date());
    if (session) {
      $("session-time").value = shortTime(session.start_time);
      $("session-duration").value = session.duration_minutes;
      $("session-category").value = session.category;
      $("session-title").value = session.title;
      $("session-meeting").value = session.meeting_point || "";
      $("session-description").value = session.description || "";
    }
    $("session-eyebrow").textContent = session ? "EDITAR SALIDA" : "NUEVA SALIDA";
    $("session-heading").textContent = session ? "Ajustamos el plan" : "Una salida más";
    syncRecurrence();
    $("session-dialog").showModal();
  }

  $("session-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const recurrence = document.querySelector('input[name="recurrence"]:checked').value;
    const payload = {
      owner_id: me.user_id,
      recurrence,
      day_of_week: recurrence === "weekly" ? Number($("session-day").value) : null,
      session_date: recurrence === "once" ? $("session-date").value : null,
      start_time: $("session-time").value,
      duration_minutes: Number($("session-duration").value),
      category: $("session-category").value,
      title: $("session-title").value.trim(),
      meeting_point: $("session-meeting").value.trim() || null,
      description: $("session-description").value.trim() || null,
    };
    if ($("session-id").value) payload.id = $("session-id").value;
    else payload.is_active = true;
    const saved = await withBusy(e.submitter, () => saveSession(payload));
    if (saved) { $("session-dialog").close(); toast(payload.id ? "Salida actualizada ✨" : "Salida publicada. ¡Planazo! 🏃"); load(); }
  });

  // ---------- Diálogo de descanso puntual ----------
  $("rest-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const saved = await withBusy(e.submitter, () => addRestDay({
      owner_id: me.user_id, recurrence: "once", rest_date: $("rest-date").value, note: $("rest-note").value.trim() || null,
    }));
    if (saved) { $("rest-dialog").close(); toast("Descanso anotado 😴"); load(); }
  });

  // ---------- Diálogo de excepción ----------
  const kindInputs = document.querySelectorAll('input[name="exception-kind"]');
  const syncKind = () => {
    const moved = document.querySelector('input[name="exception-kind"]:checked').value === "moved";
    $("exception-time-field").classList.toggle("hidden", !moved);
    $("exception-time").required = moved;
  };
  kindInputs.forEach((r) => r.addEventListener("change", syncKind));

  const fillExceptionDates = () => {
    const session = plan.sessions.find((s) => s.id === $("exception-session").value);
    if (!session) { $("exception-date").innerHTML = ""; return; }
    const today = new Date();
    let first = addDays(today, (session.day_of_week - isoDow(today) + 7) % 7);
    $("exception-date").innerHTML = Array.from({ length: UPCOMING_WEEKS }, (_, i) => {
      const iso = toISODate(addDays(first, i * 7));
      return `<option value="${iso}">${escapeHtml(capitalize(formatDay(parseISODate(iso))))}</option>`;
    }).join("");
    $("exception-time").value = shortTime(session.start_time);
  };
  $("exception-session").addEventListener("change", fillExceptionDates);

  function openException(sessionId = null) {
    const weekly = plan.sessions.filter((s) => s.recurrence === "weekly" && s.is_active);
    if (!weekly.length) { toast("Primero añade alguna salida habitual 🙂"); return; }
    $("exception-form").reset();
    $("exception-session").innerHTML = weekly.map((s) =>
      `<option value="${s.id}">${DAY_NAMES[s.day_of_week - 1]} ${shortTime(s.start_time)} · ${escapeHtml(s.title)}</option>`).join("");
    if (sessionId) $("exception-session").value = sessionId;
    fillExceptionDates();
    syncKind();
    $("exception-dialog").showModal();
  }

  $("exception-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const kind = document.querySelector('input[name="exception-kind"]:checked').value;
    const saved = await withBusy(e.submitter, () => saveException({
      session_id: $("exception-session").value,
      owner_id: me.user_id,
      exception_date: $("exception-date").value,
      kind,
      new_start_time: kind === "moved" ? $("exception-time").value : null,
      note: $("exception-note").value.trim() || null,
    }));
    if (saved) { $("exception-dialog").close(); toast(kind === "cancelled" ? "Anotado: ese día no sales 👌" : "Hora cambiada 🔁"); load(); }
  });

  // ---------- Botones ----------
  $("add-weekly-button").addEventListener("click", () => openSession({ recurrence: "weekly", day: isoDow(new Date()) }));
  $("add-once-button").addEventListener("click", () => openSession({ recurrence: "once" }));
  $("add-rest-button").addEventListener("click", () => {
    $("rest-form").reset();
    $("rest-date").min = $("rest-date").value = toISODate(new Date());
    $("rest-dialog").showModal();
  });
  $("add-exception-button").addEventListener("click", () => openException());

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-op]");
    if (!btn) return;
    const { op, id, day } = btn.dataset;
    const session = plan.sessions.find((s) => s.id === id);
    const ops = {
      "add-day": () => openSession({ recurrence: "weekly", day: Number(day) }),
      edit: () => openSession({ session }),
      exception: () => openException(id),
      toggle: () => withBusy(btn, async () => { await setSessionActive(id, !session.is_active); toast(session.is_active ? "Salida en pausa ⏸" : "Salida reactivada ▶"); }),
      delete: () => confirm("¿Borrar esta salida? Las solicitudes ya hechas se conservan.") &&
        withBusy(btn, async () => { await deleteSession(id); toast("Salida borrada"); }),
      "rest-weekly": () => withBusy(btn, async () => {
        const rest = plan.restDays.find((r) => r.recurrence === "weekly" && r.day_of_week === Number(day));
        if (rest) await deleteRestDay(rest.id);
        else await addRestDay({ owner_id: me.user_id, recurrence: "weekly", day_of_week: Number(day) });
      }),
      "delete-rest": () => withBusy(btn, () => deleteRestDay(id)),
      "delete-exception": () => withBusy(btn, () => deleteException(id)),
    };
    if (ops[op]) { await ops[op](); if (!["add-day", "edit", "exception"].includes(op)) load(); }
  });

  // ---------- Perfil ----------
  function fillProfile() {
    $("profile-name").value = me.display_name;
    $("profile-emoji").value = me.emoji;
    $("profile-notify").checked = me.notify_email;
  }
  $("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const saved = await withBusy(e.submitter, () => updateProfile(me.user_id, {
      display_name: $("profile-name").value.trim(),
      emoji: $("profile-emoji").value.trim() || "🏃",
      notify_email: $("profile-notify").checked,
    }));
    if (saved) { Object.assign(me, saved); renderHeader("mis-salidas", ctx); toast("Perfil guardado ✨"); }
  });

  load();

  async function load() {
    try {
      plan = await loadMyPlan(me.user_id);
      renderWeekly();
      renderDated();
    } catch (err) {
      $("weekly-list").innerHTML = `<div class="empty-state">No se pudo cargar tu plan: ${escapeHtml(err.message)}</div>`;
    }
  }

  function sessionRow(s, { weekly }) {
    const meta = [CATEGORY[s.category], `${s.duration_minutes} min`, s.meeting_point].filter(Boolean).map(escapeHtml).join(" · ");
    return `<div class="session-card ${s.is_active ? "" : "paused"}">
      <div class="session-time">${shortTime(s.start_time)}</div>
      <div class="session-info"><strong>${escapeHtml(s.title)}</strong><small>${meta}</small>
        ${s.is_active ? "" : `<span class="chip muted-chip">En pausa</span>`}</div>
      <div class="row-actions">
        <button class="icon-button small" type="button" data-op="edit" data-id="${s.id}" title="Editar" aria-label="Editar">✎</button>
        ${weekly ? `<button class="icon-button small" type="button" data-op="exception" data-id="${s.id}" title="Cambiar un día concreto" aria-label="Cambiar un día concreto">🔁</button>
        <button class="icon-button small" type="button" data-op="toggle" data-id="${s.id}" title="${s.is_active ? "Pausar" : "Reactivar"}" aria-label="${s.is_active ? "Pausar" : "Reactivar"}">${s.is_active ? "⏸" : "▶"}</button>` : ""}
        <button class="icon-button small danger" type="button" data-op="delete" data-id="${s.id}" title="Borrar" aria-label="Borrar">🗑</button>
      </div></div>`;
  }

  function renderWeekly() {
    $("weekly-list").innerHTML = DAY_NAMES.map((name, i) => {
      const day = i + 1;
      const sessions = plan.sessions.filter((s) => s.recurrence === "weekly" && s.day_of_week === day)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      const rest = plan.restDays.some((r) => r.recurrence === "weekly" && r.day_of_week === day);
      return `<article class="plan-day">
        <div class="day-head">
          <div><strong>${name}</strong></div>
          <div class="row-actions">
            <button class="chip-button ${rest ? "on" : ""}" type="button" data-op="rest-weekly" data-day="${day}" aria-pressed="${rest}">😴 Descanso fijo</button>
            <button class="icon-button small" type="button" data-op="add-day" data-day="${day}" title="Añadir salida el ${name.toLowerCase()}" aria-label="Añadir salida">＋</button>
          </div>
        </div>
        ${sessions.length ? sessions.map((s) => sessionRow(s, { weekly: true })).join("")
          : `<p class="empty-day">${rest ? "Día de descanso 😴" : "❔ Sin planificar"}</p>`}
      </article>`;
    }).join("");
  }

  function renderDated() {
    const items = [
      ...plan.sessions.filter((s) => s.recurrence === "once").map((s) => ({ date: s.session_date, html: `
        <div class="dated-kind">🏃 Salida puntual</div>${sessionRow(s, { weekly: false })}` })),
      ...plan.restDays.filter((r) => r.recurrence === "once").map((r) => ({ date: r.rest_date, html: `
        <div class="dated-kind">😴 Descanso${r.note ? ` · ${escapeHtml(r.note)}` : ""}</div>
        <button class="icon-button small danger" type="button" data-op="delete-rest" data-id="${r.id}" aria-label="Quitar descanso">🗑</button>` })),
      ...plan.exceptions.map((x) => ({ date: x.exception_date, html: `
        <div class="dated-kind">${x.kind === "cancelled" ? "🚫 No sales" : `🔁 Cambia a las ${shortTime(x.new_start_time)}`} ·
          ${escapeHtml(x.session?.title || "")} (${shortTime(x.session?.start_time || "")})${x.note ? ` · ${escapeHtml(x.note)}` : ""}</div>
        <button class="icon-button small danger" type="button" data-op="delete-exception" data-id="${x.id}" aria-label="Quitar excepción">🗑</button>` })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    $("dated-list").innerHTML = items.length
      ? items.map((it) => `<article class="dated-item"><div class="booking-date"><strong>${escapeHtml(capitalize(formatDay(parseISODate(it.date))))}</strong></div><div class="dated-body">${it.html}</div></article>`).join("")
      : `<div class="empty-state">Sin cambios a la vista. Todo según lo habitual 👌</div>`;
  }
}

const ctx = await requireMember();
if (ctx) init(ctx);
