// Bandeja de solicitudes: responder, contraproponer, cancelar y completar.
import { requireMember, renderHeader, refreshBadge, toast, escapeHtml, wireDialogs, renderIdeas, withBusy,
  STATUS, formatShortDay, formatTime, formatDay, capitalize } from "./shared.js";
import { loadBookings, respond, counterPropose, cancelBooking, completeBooking, markNotificationsRead, onChanges } from "./api.js";
import { displayStatus, combine, toISODate, OPEN_STATUSES } from "./schedule.js";

const $ = (id) => document.getElementById(id);

const ACTIONS = {
  accept: { eyebrow: "ACEPTAR", title: "¡Vamos! 🎉", submit: "Aceptar", ideas: "accept", ok: "¡Hecho! Ya tenéis plan 🎉", run: (b, m) => respond(b.id, true, m) },
  decline: { eyebrow: "RECHAZAR", title: "Esta vez no…", submit: "No puedo", ideas: "decline", ok: "Respuesta enviada 🙈", run: (b, m) => respond(b.id, false, m) },
  cancel: { eyebrow: "CANCELAR", title: "¿Lo dejamos?", submit: "Cancelar salida", ideas: "cancel", ok: "Salida cancelada 😔", run: (b, m) => cancelBooking(b.id, m) },
  withdraw: { eyebrow: "RETIRAR", title: "¿Retiras la solicitud?", submit: "Retirar", ideas: "cancel", ok: "Solicitud retirada", run: (b, m) => cancelBooking(b.id, m) },
  complete: { eyebrow: "REALIZADA", title: "¡La hicisteis! 🏅", submit: "Marcar como realizada", ideas: "complete", ok: "¡Kilómetros compartidos! 🏅", run: (b, m) => completeBooking(b.id, m) },
};

const EVENT_LABEL = {
  requested: "se apuntó", proposed: "propuso", counterproposed: "propuso otro momento",
  accepted: "aceptó", declined: "no podía", cancelled: "canceló", completed: "la marcó como realizada",
};
const EVENT_LABEL_ME = {
  requested: "te apuntaste", proposed: "propusiste", counterproposed: "propusiste otro momento",
  accepted: "aceptaste", declined: "no podías", cancelled: "cancelaste", completed: "la marcaste como realizada",
};

function init(ctx) {
  const { me, partner } = ctx;
  const nameOf = (uid) => (uid === me.user_id ? "Tú" : partner?.display_name || "La otra persona");
  let bookings = [];
  let current = null;

  renderHeader("solicitudes", ctx);
  wireDialogs();
  renderIdeas($("counter-ideas"), "counter", $("counter-message"));
  document.body.classList.remove("booting");
  markNotificationsRead(me.user_id);

  $("sections").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const booking = bookings.find((b) => b.id === btn.dataset.id);
    if (!booking) return;
    if (btn.dataset.action === "counter") openCounter(booking);
    else openAction(btn.dataset.action, booking);
  });

  $("action-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const action = ACTIONS[current?.action];
    if (!action) return;
    const result = await withBusy(e.submitter, () => action.run(current.booking, $("action-message").value.trim()));
    if (result) { $("action-dialog").close(); toast(action.ok); load(); }
  });

  $("counter-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const when = combine($("counter-date").value, $("counter-time").value);
    if (when <= new Date()) { toast("Propón un momento futuro ⏰", "error"); return; }
    const result = await withBusy(e.submitter, () => counterPropose(current.booking.id, when,
      Number($("counter-duration").value), $("counter-message").value.trim()));
    if (result) { $("counter-dialog").close(); toast("Contrapropuesta enviada 🔁"); load(); }
  });

  onChanges(["rt_bookings"], () => { load(); refreshBadge(ctx); });
  load();

  async function load() {
    try {
      bookings = await loadBookings();
      render();
      refreshBadge(ctx);
    } catch (err) {
      $("sections").innerHTML = `<div class="empty-state">No se pudieron cargar las solicitudes: ${escapeHtml(err.message)}</div>`;
    }
  }

  function render() {
    const now = new Date();
    const future = (b) => new Date(b.scheduled_at) > now;
    const open = (b) => OPEN_STATUSES.includes(b.status) && future(b);
    const groups = [
      { title: "Te toca responder", kicker: "PENDIENTES", items: bookings.filter((b) => open(b) && b.awaiting_user_id === me.user_id),
        empty: "Nada pendiente. Tranquilidad absoluta 😌" },
      { title: "Próximas salidas juntos", kicker: "PLANES CERRADOS", items: bookings.filter((b) => b.status === "accepted" && future(b)),
        empty: `Todavía ninguna. ${partner ? `¿Por qué no le propones algo a ${escapeHtml(partner.display_name)}? 😉` : ""}` },
      { title: `Esperando a ${partner ? escapeHtml(partner.display_name) : "la otra persona"}`, kicker: "ENVIADAS",
        items: bookings.filter((b) => open(b) && b.awaiting_user_id !== me.user_id), empty: "No tienes nada en el aire." },
      { title: "¿La hicisteis?", kicker: "POR CONFIRMAR", items: bookings.filter((b) => b.status === "accepted" && !future(b)), hideEmpty: true },
      { title: "Historial", kicker: "RECUERDOS", items: bookings.filter((b) => ["declined", "cancelled", "completed"].includes(b.status) || (OPEN_STATUSES.includes(b.status) && !future(b))).reverse().slice(0, 20),
        empty: "Aquí irán quedando vuestras salidas." },
    ];
    $("sections").innerHTML = groups.filter((g) => g.items.length || !g.hideEmpty).map((g) => `
      <section class="requests-section">
        <div class="toolbar compact"><div><span class="section-kicker">${g.kicker}</span><h2>${g.title}</h2></div>
          ${g.items.length ? `<span class="count-pill">${g.items.length}</span>` : ""}</div>
        <div class="booking-list">${g.items.length ? g.items.map(renderBooking).join("") : `<div class="empty-state">${g.empty}</div>`}</div>
      </section>`).join("");
  }

  function kindLabel(b) {
    const mine = b.requester_id === me.user_id;
    const partnerName = escapeHtml(partner?.display_name || "");
    if (b.kind === "join") return mine ? `Te apuntas a la salida de ${partnerName}` : `${partnerName} se apunta a tu salida`;
    return mine ? "Tu propuesta" : `Propuesta de ${partnerName}`;
  }

  function renderBooking(b) {
    const status = displayStatus(b);
    const isPast = new Date(b.scheduled_at) <= new Date();
    const statusLabel = status === "accepted" && isPast ? "Aceptada" : STATUS[status] || status;
    const thread = b.events.map((ev) => {
      const mine = ev.actor_id === me.user_id;
      const label = (mine ? EVENT_LABEL_ME : EVENT_LABEL)[ev.event_type] || ev.event_type;
      const extra = ev.event_type === "counterproposed" && ev.scheduled_at ? ` → ${escapeHtml(formatShortDay(ev.scheduled_at))} ${formatTime(ev.scheduled_at)}` : "";
      return `<li>${mine ? "" : `<b>${escapeHtml(nameOf(ev.actor_id))}</b> `}${mine ? capitalize(label) : label}${extra}${ev.message ? `: <q>${escapeHtml(ev.message)}</q>` : ""}</li>`;
    }).join("");
    return `<article class="booking-item">
      <div class="booking-date"><strong>${escapeHtml(capitalize(formatShortDay(b.scheduled_at)))}</strong><span>${formatTime(b.scheduled_at)}</span><small>${b.duration_minutes} min</small></div>
      <div class="booking-detail">
        <strong>${escapeHtml(b.title)}</strong>
        <small>${kindLabel(b)}</small>
        <span class="status ${status}">${statusLabel}</span>
        ${thread ? `<ul class="thread">${thread}</ul>` : ""}
      </div>
      <div class="booking-actions">${actionsFor(b, status)}</div>
    </article>`;
  }

  function actionsFor(b, status) {
    const btn = (action, label, cls = "") => `<button type="button" class="pill-button ${cls}" data-action="${action}" data-id="${b.id}">${label}</button>`;
    if (status === "expired") return "";
    if (OPEN_STATUSES.includes(status)) {
      return b.awaiting_user_id === me.user_id
        ? btn("accept", "✓ Aceptar", "accept") + btn("counter", "🔁 Otra hora") + btn("decline", "× No puedo", "reject")
        : btn("withdraw", "Retirar", "reject");
    }
    if (status === "accepted") {
      return new Date(b.scheduled_at) > new Date() ? btn("cancel", "Cancelar", "reject") : btn("complete", "🏅 ¡La hicimos!", "accept");
    }
    return "";
  }

  function summary(b) {
    return `<span class="eyebrow">${kindLabel(b).toUpperCase()}</span>
      <strong>${escapeHtml(capitalize(formatDay(b.scheduled_at)))} · ${formatTime(b.scheduled_at)}</strong>
      <span>${escapeHtml(b.title)} · ${b.duration_minutes} min</span>`;
  }

  function openAction(action, booking) {
    const cfg = ACTIONS[action];
    current = { action, booking };
    $("action-eyebrow").textContent = cfg.eyebrow;
    $("action-title").textContent = cfg.title;
    $("action-submit").textContent = cfg.submit;
    $("action-summary").innerHTML = summary(booking);
    $("action-message").value = "";
    renderIdeas($("action-ideas"), cfg.ideas, $("action-message"));
    $("action-dialog").showModal();
  }

  function openCounter(booking) {
    current = { action: "counter", booking };
    const at = new Date(booking.scheduled_at);
    $("counter-date").value = toISODate(at);
    $("counter-date").min = toISODate(new Date());
    $("counter-time").value = at.toTimeString().slice(0, 5);
    $("counter-duration").value = booking.duration_minutes;
    $("counter-message").value = "";
    $("counter-dialog").showModal();
  }
}

const ctx = await requireMember();
if (ctx) init(ctx);
