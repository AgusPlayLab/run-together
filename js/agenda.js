// Agenda semanal compartida: salidas de los dos, descansos, coincidencias y reservas.
import { requireMember, renderHeader, refreshBadge, toast, escapeHtml, wireDialogs, renderIdeas, withBusy,
  CATEGORY, greeting, formatDay, formatDayMonth, formatTime, capitalize, appUrl } from "./shared.js";
import { loadWeekData, requestJoin, propose, onChanges } from "./api.js";
import { buildWeek, mondayOf, addDays, toISODate, combine, DAY_NAMES, OPEN_STATUSES } from "./schedule.js";

const $ = (id) => document.getElementById(id);

const ctx = await requireMember();
if (ctx) init(ctx);

function init(ctx) {
  const { me, partner } = ctx;
  const members = [me, partner].filter(Boolean);
  const thisMonday = mondayOf(new Date());
  let weekStart = thisMonday;
  let days = [];
  let pendingJoin = null;

  renderHeader("agenda", ctx);
  wireDialogs();
  renderIdeas($("join-ideas"), "join", $("join-message"));
  renderIdeas($("proposal-ideas"), "proposal", $("proposal-message"));
  $("greeting").innerHTML = escapeHtml(greeting(me.display_name));
  $("hero-sub").textContent = partner
    ? `Mira cuándo sale ${partner.display_name} y apúntate. O propón tú el plan. 😉`
    : "Cuando la otra persona tenga su perfil, aquí veréis las salidas de los dos.";
  $("legend").innerHTML = members.map((p, i) =>
    `<span class="legend-item ${i === 0 ? "me" : "partner"}"><span class="swatch"></span>${escapeHtml(p.emoji)} ${i === 0 ? "Tú" : escapeHtml(p.display_name)}</span>`).join("");
  document.body.classList.remove("booting");

  $("prev-week").addEventListener("click", () => { weekStart = addDays(weekStart, -7); load(); });
  $("next-week").addEventListener("click", () => { weekStart = addDays(weekStart, 7); load(); });
  $("today-week").addEventListener("click", () => { weekStart = thisMonday; load(); });
  $("improvise-button").addEventListener("click", () => openProposal(toISODate(new Date())));
  $("improvise-button").classList.toggle("hidden", !partner);

  $("join-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!pendingJoin) return;
    const result = await withBusy(e.submitter, () =>
      requestJoin(pendingJoin.sessionId, pendingJoin.date, $("join-message").value.trim()));
    if (result) {
      $("join-dialog").close();
      toast("Solicitud enviada. ¡A cruzar los dedos! 🤞");
      load();
    }
  });

  $("proposal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const when = combine($("proposal-date").value, $("proposal-time").value);
    if (when <= new Date()) { toast("Propón un momento futuro ⏰", "error"); return; }
    const result = await withBusy(e.submitter, () => propose(when, Number($("proposal-duration").value),
      $("proposal-title").value.trim(), $("proposal-message").value.trim()));
    if (result) {
      $("proposal-dialog").close();
      toast("Propuesta enviada 💌");
      load();
    }
  });

  $("week-grid").addEventListener("click", (e) => {
    const join = e.target.closest("[data-join]");
    if (join) return openJoin(join.dataset.join, join.dataset.date);
    const prop = e.target.closest("[data-propose]");
    if (prop) return openProposal(prop.dataset.propose);
  });

  onChanges(["rt_sessions", "rt_session_exceptions", "rt_rest_days", "rt_bookings"], () => { load(); refreshBadge(ctx); });
  load();

  async function load() {
    renderWeekLabel();
    try {
      const data = await loadWeekData(weekStart);
      days = buildWeek(weekStart, data, members.map((m) => m.user_id));
      renderStats(data);
      renderWeek();
    } catch (err) {
      $("week-grid").innerHTML = `<div class="empty-state">No se pudo cargar la semana: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderWeekLabel() {
    const diff = Math.round((weekStart - thisMonday) / (7 * 864e5));
    const labels = { 0: "Esta semana", 1: "La semana que viene", "-1": "La semana pasada" };
    $("week-label").textContent = labels[diff] ?? `${formatDayMonth(weekStart)} – ${formatDayMonth(addDays(weekStart, 6))}`;
    $("today-week").classList.toggle("hidden", diff === 0);
  }

  function renderStats(data) {
    const runs = (uid) => days.reduce((n, d) => n + (d.people[uid]?.occurrences.filter((o) => !o.cancelled).length || 0), 0);
    const together = data.bookings.filter((b) => ["accepted", "completed"].includes(b.status)).length;
    const awaiting = data.bookings.filter((b) => b.awaiting_user_id === me.user_id && OPEN_STATUSES.includes(b.status)
      && new Date(b.scheduled_at) > new Date()).length;
    const stats = [
      { value: runs(me.user_id), label: "Tus salidas" },
      partner && { value: runs(partner.user_id), label: `De ${partner.display_name}` },
      partner && { value: together, label: "Juntos 💫" },
      awaiting && { value: awaiting, label: "Te esperan", href: appUrl("pages/solicitudes.html"), hot: true },
    ].filter(Boolean);
    $("stats").innerHTML = stats.map((s) => {
      const inner = `<strong>${s.value}</strong><span>${escapeHtml(s.label)}</span>`;
      return s.href ? `<a class="stat hot" href="${s.href}">${inner}</a>` : `<div class="stat">${inner}</div>`;
    }).join("");
  }

  function renderWeek() {
    $("week-grid").innerHTML = days.map(renderDay).join("");
  }

  function renderDay(day) {
    const coincidence = day.coincidence && !day.isPast
      ? `<span class="chip spark" title="Salís a horas parecidas">💫 Coincidís</span>` : "";
    const proposals = day.proposals.map((b) => {
      const mine = b.requester_id === me.user_id;
      const label = b.status === "accepted" ? "🤝 Plan juntos" : mine ? "⏳ Propuesta enviada" : "💌 Te proponen";
      return `<a class="together-item ${b.status}" href="${appUrl("pages/solicitudes.html")}">
        <strong>${formatTime(b.scheduled_at)}</strong>
        <span>${escapeHtml(b.title)}</span><em>${label}</em></a>`;
    }).join("");
    const canPropose = partner && !day.isPast;
    return `<article class="day-card ${day.isToday ? "today" : ""} ${day.isPast ? "past" : ""}">
      <div class="day-head">
        <div><span>${DAY_NAMES[day.dow - 1]}</span><strong>${capitalize(formatDayMonth(day.date))}</strong>${day.isToday ? `<span class="chip today-chip">Hoy</span>` : ""}</div>
        ${coincidence}
      </div>
      <div class="lanes">${members.map((p, i) => renderLane(day, p, i === 0)).join("")}</div>
      ${proposals ? `<div class="together">${proposals}</div>` : ""}
      ${canPropose ? `<button class="link-button" type="button" data-propose="${day.iso}">＋ Proponer este día</button>` : ""}
    </article>`;
  }

  function renderLane(day, person, isMe) {
    const pd = day.people[person.user_id];
    let body;
    if (pd.occurrences.length) {
      body = pd.occurrences.map((o) => renderOccurrence(o, isMe)).join("");
      if (pd.state !== "run") body += pd.state === "rest" ? `<div class="state rest">😴 Descanso</div>` : `<div class="state unplanned">❔ Sin planificar</div>`;
    } else if (pd.state === "rest") {
      body = `<div class="state rest">😴 Descanso${pd.rest.note ? ` · ${escapeHtml(pd.rest.note)}` : ""}</div>`;
    } else {
      body = `<div class="state unplanned">❔ Sin planificar</div>`;
    }
    return `<div class="lane ${isMe ? "me" : "partner"}">
      <div class="lane-head">${escapeHtml(person.emoji)} ${isMe ? "Tú" : escapeHtml(person.display_name)}</div>${body}</div>`;
  }

  function renderOccurrence(o, isMe) {
    const s = o.session;
    const meta = [CATEGORY[s.category] || "Salida", `${s.duration_minutes} min`, s.meeting_point].filter(Boolean).map(escapeHtml).join(" · ");
    let flag = "";
    if (o.cancelled) flag = `<span class="chip muted-chip">Este día no sale${o.exception?.note ? ` · ${escapeHtml(o.exception.note)}` : ""}</span>`;
    else if (o.moved) flag = `<span class="chip">🔁 Cambiada a las ${o.start}</span>`;

    let status = "";
    if (o.booking) {
      if (o.booking.status === "accepted") status = `<span class="chip ok">🤝 Vais juntos</span>`;
      else if (o.booking.requester_id === me.user_id) status = `<span class="chip wait">⏳ Esperando respuesta</span>`;
      else status = `<a class="chip hot" href="${appUrl("pages/solicitudes.html")}">👀 ${escapeHtml(partner?.display_name || "")} quiere venir</a>`;
    }

    const canJoin = !isMe && !o.cancelled && !o.isPast && !o.booking;
    const action = canJoin
      ? `<button class="join-button" type="button" data-join="${s.id}" data-date="${o.date}">Me apunto 👟</button>` : "";

    return `<div class="session-card ${o.cancelled ? "cancelled" : ""} ${o.isPast ? "past" : ""}">
      <div class="session-time">${o.start}</div>
      <div class="session-info">
        <strong>${escapeHtml(s.title)}</strong><small>${meta}</small>
        ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ""}
        ${flag}${status}
      </div>${action}</div>`;
  }

  function openJoin(sessionId, date) {
    const day = days.find((d) => d.iso === date);
    const occ = day?.people[partner.user_id]?.occurrences.find((o) => o.session.id === sessionId);
    if (!occ) return;
    pendingJoin = { sessionId, date };
    $("join-summary").innerHTML = `
      <span class="eyebrow">${escapeHtml(partner.emoji)} ${escapeHtml(partner.display_name.toUpperCase())} SALE</span>
      <strong>${escapeHtml(capitalize(formatDay(occ.startsAt)))} · ${occ.start}</strong>
      <span>${escapeHtml(occ.session.title)} · ${escapeHtml(CATEGORY[occ.session.category] || "")} · ${occ.session.duration_minutes} min</span>
      ${occ.session.meeting_point ? `<span>📍 ${escapeHtml(occ.session.meeting_point)}</span>` : ""}`;
    $("join-message").value = "";
    $("join-dialog").showModal();
  }

  function openProposal(date) {
    $("proposal-form").reset();
    $("proposal-date").value = date;
    $("proposal-date").min = toISODate(new Date());
    $("proposal-dialog").showModal();
  }
}
