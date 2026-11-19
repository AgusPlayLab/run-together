# 🏃 RunTogether — ¿Corres conmigo?

Un pequeño "Booking" privado para que dos personas sincronicen sus salidas a correr: cada uno publica cuándo sale, el otro se apunta o propone otro momento, y los dos reciben un aviso por email. Cercano, sencillo y con un punto de complicidad.

**Stack:** HTML + CSS + JavaScript sin frameworks (ES modules) · Supabase (Auth, PostgreSQL, RLS, Realtime, Edge Functions) · Resend · GitHub Pages.
Es el mismo modo de trabajo que Maldives VIP Experience y slow-reveal, y el mismo proyecto Supabase.

## ✨ Funcionalidades

| Área | Qué hace |
|---|---|
| **Acceso privado** | Email + contraseña o enlace mágico. Sin registro público: solo los dos perfiles de `rt_profiles`. |
| **Agenda compartida** | Semana de lunes a domingo con un carril para cada persona: 🏃 corre, 😴 descanso o ❔ sin planificar. Navegación entre semanas. |
| **Varias salidas por día** | Semanales o puntuales, con tipo, duración, punto de encuentro y detalle. |
| **Excepciones** | "Este lunes no salgo" o "este lunes a las 8" sin tocar la semana tipo. Descansos fijos o puntuales. |
| **Me apunto 👟** | Solicitar unirse a una salida del otro, con ideas de mensaje ("¿Me guardas sitio? 😉"). |
| **¿Y si improvisamos? 💌** | Proponer un momento libre. |
| **Respuestas** | Aceptar, rechazar o contraproponer otra hora. Solo responde a quien le toca. Se detectan solapamientos. |
| **Seguimiento** | Pendientes, próximas salidas juntos, enviadas, "¿La hicisteis? 🏅" e historial con el hilo de mensajes. |
| **💫 Coincidencias** | Aviso cuando los dos salís el mismo día con menos de 1 h de diferencia. |
| **Tiempo real** | La agenda y las solicitudes se refrescan solas cuando el otro cambia algo. |
| **Emails** | Edge Function `rt-send-notification` con Resend y plantillas con el tono de la app. |

## 📁 Estructura

```
RunTogether/
├── index.html                  # Agenda semanal compartida
├── pages/
│   ├── login.html              # Acceso
│   ├── solicitudes.html        # Bandeja de reservas
│   └── mis-salidas.html        # Semana tipo, excepciones, descansos y perfil
├── css/style.css               # Estilos globales (mobile-first)
├── js/
│   ├── config.js               # URL + anon key (públicas) del proyecto Supabase
│   ├── supabase.js             # Cliente único
│   ├── api.js                  # Acceso a datos y llamadas RPC + aviso por email
│   ├── schedule.js             # Lógica de calendario pura (testeada)
│   ├── shared.js               # Sesión, cabecera, toasts, formato y textos
│   ├── agenda.js · login.js · solicitudes.js · mis-salidas.js   # Una por página
├── assets/favicon.svg
├── supabase/
│   ├── migrations/20261119000000_runtogether_init.sql   # Esquema, RLS y RPC
│   └── functions/rt-send-notification/index.ts          # Emails con Resend
├── docs/
│   ├── SETUP.md                # Puesta en marcha paso a paso
│   └── SUPABASE_PROMPT.md      # Prompt para el asistente de IA de Supabase
├── tests/                      # node:test — calendario + esquema SQL (PGlite)
└── package.json                # Solo para los tests (npm test)
```

## 🏗️ Arquitectura

```
Navegador (GitHub Pages)
  │  supabase-js + anon key + JWT del usuario
  ├──► PostgREST ── tablas rt_* protegidas por RLS (lecturas, planificación propia)
  ├──► RPC rt_request_join / rt_propose / rt_respond / rt_counter_propose / rt_cancel / rt_complete
  │        └─ SECURITY DEFINER: valida turnos, fechas y solapamientos; registra evento + aviso
  ├──► Realtime (cambios en salidas y reservas)
  └──► Edge Function rt-send-notification (JWT verificado)
           └─ service_role + RESEND_API_KEY (secretos) ──► Resend ──► email a la otra persona
```

**Seguridad**

- Sin acceso anónimo a ninguna tabla `rt_`. Los usuarios autenticados que no tengan perfil (por ejemplo, otros usuarios del proyecto) no ven nada.
- Cada persona solo edita sus salidas, excepciones y descansos.
- Las reservas no se pueden escribir directamente: solo mediante RPC. Así nadie puede aceptar su propia solicitud ni cambiar la fecha de otra.
- La `service_role` y la clave de Resend solo existen como secretos de Supabase.

## 🚀 Puesta en marcha

Sigue [docs/SETUP.md](docs/SETUP.md). En resumen: ejecutar la migración, crear los dos usuarios y sus perfiles, configurar las URLs de Auth, poner la anon key en `js/config.js`, desplegar la Edge Function y publicar en GitHub Pages.

## 🧪 Tests

```powershell
npm install
npm test
```

- `tests/schedule.test.mjs`: estados del día, excepciones, coincidencias y caducidad.
- `tests/database.test.mjs`: aplica la migración en PGlite (Postgres embebido) y comprueba RLS, turnos, solapamientos y que no se pueda escribir saltándose las RPC.

## 🗺️ Siguientes pasos

- Recordatorio la noche anterior ("Mañana a las 7:00 te esperan 😉") con `pg_cron` y la misma Edge Function.
- Estadísticas: kilómetros compartidos, rachas y logros.
- Comentario o foto después de cada salida.
- Previsión del tiempo para la hora de la salida.
