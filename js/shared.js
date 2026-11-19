// Utilidades compartidas entre páginas: sesión, cabecera, avisos y formato.
import { supabase, isConfigured } from "./supabase.js";
import { countAwaitingMe, loadProfiles } from "./api.js";
import { CONFIG } from "./config.js";

export const ROOT = new URL("../", import.meta.url);
export const appUrl = (path = "") => new URL(path, ROOT).href;

export const CATEGORY = {
  easy: "Rodaje suave", hard: "Entrenamiento duro", long: "Tirada larga",
  recovery: "Recuperación", walk: "Paseo", improvised: "Improvisado", other: "Otro",
};

export const STATUS = {
  pending: "Pendiente", counterproposed: "Contrapropuesta", accepted: "¡Vais juntos!",
  declined: "Rechazada", cancelled: "Cancelada", completed: "Realizada", expired: "Caducada",
};

export const MESSAGE_IDEAS = {
  join: ["¿Me guardas sitio? 😉", "Prometo no ir demasiado rápido", "Llevo yo el agua 💧", "Te espero en la puerta"],
  proposal: ["¿Te apetece? 🏃", "Hoy sin excusas 😏", "Después, café ☕", "Ritmo de charla, prometido"],
  accept: ["¡Hecho! 🎉", "Ahí estaré 👟", "No llegues tarde 😏"],
  decline: ["Hoy no puedo, otro día 🙈", "Me sabe mal… ¿la próxima?", "Esta vez me toca descansar 😴"],
  cancel: ["Lo siento, me ha surgido algo 😔", "Te debo una salida", "Lo recuperamos pronto, prometido"],
  counter: ["¿Y si mejor un poco antes?", "A esa hora no llego, ¿te va así?", "Mejor así y luego café ☕"],
  complete: ["¡Qué buena salida! 🔥", "La próxima, a mi ritmo 😏", "Me debes un café ☕"],
};

// ---------- Sesión ----------
export async function requireMember() {
  if (!isConfigured) {
    document.body.innerHTML = `<main class="shell"><div class="empty-state big">⚙️ Falta configurar <code>SUPABASE_ANON_KEY</code> en <code>js/config.js</code>.</div></main>`;
    return null;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.replace(appUrl("pages/login.html")); return null; }

  let profiles = [];
  try { profiles = await loadProfiles(); } catch (err) { console.error(err); }
  const me = profiles.find((p) => p.user_id === session.user.id);
  if (!me) {
    await supabase.auth.signOut();
    location.replace(appUrl("pages/login.html?sin-acceso=1"));
    return null;
  }
  const partner = profiles.find((p) => p.user_id !== me.user_id) || null;
  return { user: session.user, me, partner, profiles };
}

export async function logout() {
  await supabase.auth.signOut();
  location.replace(appUrl("pages/login.html"));
}

// ---------- Cabecera y navegación ----------
export function renderHeader(active, ctx) {
  const links = [
    { id: "agenda", href: appUrl("index.html"), label: "Agenda" },
    { id: "solicitudes", href: appUrl("pages/solicitudes.html"), label: "Solicitudes", badge: true },
    { id: "mis-salidas", href: appUrl("pages/mis-salidas.html"), label: "Mis salidas" },
  ];
  const header = document.getElementById("app-header");
  header.innerHTML = `
    <a class="brand" href="${appUrl("index.html")}"><span class="brand-mark">↗</span><span>run<span class="brand-light">together</span></span></a>
    <nav class="main-nav" aria-label="Principal">
      ${links.map((l) => `<a href="${l.href}" class="${l.id === active ? "active" : ""}">${l.label}${l.badge ? `<span id="nav-badge" class="nav-badge hidden"></span>` : ""}</a>`).join("")}
    </nav>
    <div class="user-pill" title="${escapeHtml(ctx.me.email)}">
      <span>${escapeHtml(ctx.me.emoji)}</span><span class="user-name">${escapeHtml(ctx.me.display_name)}</span>
      <button id="logout-button" class="text-button" type="button">Salir</button>
    </div>`;
  document.getElementById("logout-button").addEventListener("click", logout);
  refreshBadge(ctx);
}

export async function refreshBadge(ctx) {
  const badge = document.getElementById("nav-badge");
  if (!badge) return;
  const count = await countAwaitingMe(ctx.me.user_id);
  badge.textContent = count;
  badge.classList.toggle("hidden", count === 0);
}

// ---------- UI ----------
let toastTimer;
export function toast(message, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

export function escapeHtml(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Conecta los botones [data-close] de los diálogos y los chips de ideas de mensaje.
export function wireDialogs(root = document) {
  root.querySelectorAll("[data-close]").forEach((btn) =>
    btn.addEventListener("click", () => document.getElementById(btn.dataset.close).close()));
}

export function renderIdeas(container, kind, textarea) {
  container.innerHTML = MESSAGE_IDEAS[kind].map((m) => `<button type="button" class="idea-chip">${escapeHtml(m)}</button>`).join("");
  container.querySelectorAll(".idea-chip").forEach((chip) =>
    chip.addEventListener("click", () => { textarea.value = chip.textContent; textarea.focus(); }));
}

// Ejecuta una acción mostrando estado ocupado en el botón y errores en el toast.
export async function withBusy(button, action) {
  if (button) { button.disabled = true; button.classList.add("busy"); }
  try { return await action(); }
  catch (err) { toast(err.message || String(err), "error"); return undefined; }
  finally { if (button) { button.disabled = false; button.classList.remove("busy"); } }
}

// ---------- Formato ----------
const fmt = (opts) => new Intl.DateTimeFormat("es-ES", { timeZone: CONFIG.TIMEZONE, ...opts });
export const formatDay = (d) => fmt({ weekday: "long", day: "numeric", month: "long" }).format(new Date(d));
export const formatShortDay = (d) => fmt({ weekday: "short", day: "numeric", month: "short" }).format(new Date(d));
export const formatDayMonth = (d) => fmt({ day: "numeric", month: "short" }).format(new Date(d));
export const formatTime = (d) => fmt({ hour: "2-digit", minute: "2-digit" }).format(new Date(d));
export const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function greeting(name) {
  const h = new Date().getHours();
  if (h < 6) return `¿Insomnio, ${name}? 🌙`;
  if (h < 12) return `Buenos días, ${name} ☀️`;
  if (h < 20) return `Buenas tardes, ${name} 👋`;
  return `¿Planeando lo de mañana, ${name}? 🌙`;
}
