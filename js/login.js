// Acceso: contraseña o enlace mágico. Sin registro público (shouldCreateUser: false).
import { supabase, isConfigured } from "./supabase.js";
import { appUrl, withBusy } from "./shared.js";

const $ = (id) => document.getElementById(id);
const message = $("login-message");
const say = (text) => { message.textContent = text; };

if (!isConfigured) say("⚙️ Falta configurar SUPABASE_ANON_KEY en js/config.js.");
if (new URLSearchParams(location.search).has("sin-acceso")) {
  say("Esta cuenta no tiene acceso a RunTogether. Esto es solo para dos 😉");
}

const { data: { session } } = await supabase.auth.getSession();
if (session && !new URLSearchParams(location.search).has("sin-acceso")) location.replace(appUrl("index.html"));

$("password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await withBusy(e.submitter, async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value,
    });
    if (error) throw new Error("Correo o contraseña incorrectos");
    location.replace(appUrl("index.html"));
  });
});

$("magic-link-button").addEventListener("click", async (e) => {
  const email = $("email").value.trim();
  if (!$("email").checkValidity() || !email) { say("Escribe primero tu correo 👆"); $("email").focus(); return; }
  await withBusy(e.currentTarget, async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: appUrl("index.html") },
    });
    // Mismo mensaje exista o no la cuenta, para no revelar quién está invitado.
    if (error && error.status !== 400 && error.status !== 422) throw new Error(error.message);
    say("Si tu correo está invitado, te llegará un enlace. Ábrelo desde este dispositivo 💌");
  });
});
