# 🚀 Puesta en marcha

RunTogether usa el **mismo proyecto Supabase que Maldives VIP Experience** (`febogdjpoxbyfhetwgip`) con tablas propias `rt_*`, y se publica en **GitHub Pages** como slow-reveal. Sigue los pasos en orden.

---

## 1. Revisar el proyecto compartido (5 min)

Maldives no usa Supabase Auth; RunTogether sí, así que aparecerán dos usuarios autenticados en el proyecto.

- En **SQL Editor** ejecuta la primera parte del prompt de [SUPABASE_PROMPT.md](SUPABASE_PROMPT.md) (paso 1) o revisa a mano las políticas de las tablas que no empiezan por `rt_`.
- `maldives_experience_feedback` tiene la política `Enable read for all users USING (true)`: ya es legible de forma pública, así que RunTogether no empeora nada. Si quieres cerrarla, hazlo desde el proyecto Maldives.

## 2. Crear las tablas

**Opción A (recomendada):** abre `supabase/migrations/20261119000000_runtogether_init.sql`, pégalo entero en **SQL Editor → Run**. Es idempotente: se puede ejecutar más de una vez.

**Opción B:** pega el prompt de [SUPABASE_PROMPT.md](SUPABASE_PROMPT.md) en el asistente de IA de Supabase, revisa su propuesta y ejecútala.

> No uses `supabase db push` en este proyecto: Maldives no tiene historial de migraciones y el CLI intentaría reconciliarlo.

## 3. Crear los dos usuarios

1. **Authentication → Users → Add user → Create new user**: tu email + contraseña, marca *Auto Confirm User*. Repite para ella.
2. **Authentication → Sign In / Providers → Email**: desactiva **Allow new users to sign up**. Maldives no usa Auth, así que no le afecta y nadie más podrá registrarse.
3. En **SQL Editor**, da de alta los perfiles:

```sql
insert into public.rt_profiles (user_id, display_name, email, emoji)
select id, 'Jose Vicente', email, '🏃‍♂️' from auth.users where email = 'TU_EMAIL'
union all
select id, 'SU_NOMBRE', email, '🏃‍♀️' from auth.users where email = 'SU_EMAIL';
```

## 4. URLs de autenticación

**Authentication → URL Configuration**:

- **Site URL**: `https://agusplaylab.github.io/RunTogether/`
- **Redirect URLs**:
  - `https://agusplaylab.github.io/RunTogether/**`
  - `http://127.0.0.1:5500/**` y `http://localhost:5500/**` (Live Server)

Sin esto el enlace mágico no vuelve a la app. Con contraseña funciona igualmente.

## 5. Configurar el frontend

En [`js/config.js`](../js/config.js) pega la **anon / publishable key** (Project Settings → API Keys). La URL del proyecto ya está puesta.

La clave anon es pública por diseño (RLS protege los datos). **Nunca** pongas ahí la `service_role` ni la clave de Resend.

## 6. Edge Function de avisos (Resend)

Mismo flujo de trabajo que Maldives:

```powershell
npm install -g supabase          # si no lo tienes
supabase login
cd "C:\Users\josevicente.agusti\JVAGUSTI\Proyectos\Projects Lab\RunTogether"
supabase link --project-ref febogdjpoxbyfhetwgip

# Secretos (RESEND_API_KEY probablemente ya existe porque lo usa resend-emails de Maldives)
supabase secrets list
supabase secrets set RT_APP_URL="https://agusplaylab.github.io/RunTogether"
supabase secrets set RT_EMAIL_FROM="RunTogether <runtogether@TU-DOMINIO-VERIFICADO>"
# Solo si no existía:
# supabase secrets set RESEND_API_KEY="re_xxx"

supabase functions deploy rt-send-notification
```

**Diferencia con Maldives:** esta función se despliega **sin** `--no-verify-jwt`. Solo la pueden llamar los dos usuarios autenticados, y cada uno solo puede disparar los avisos que ha generado él.

**Resend:** sin dominio verificado, `onboarding@resend.dev` solo entrega al email de la cuenta de Resend. Para que le lleguen a ella, verifica un dominio en Resend y úsalo en `RT_EMAIL_FROM`. Si falta la clave o el envío falla, la reserva se guarda igual y el aviso queda en `rt_notifications.email_status` (`skipped` o `failed`) con el motivo.

Logs: **Edge Functions → rt-send-notification → Logs**, o `supabase functions logs rt-send-notification`.

### (Opcional) Correos de acceso con Resend

El SMTP por defecto de Supabase limita mucho los envíos (afecta al enlace mágico). En **Authentication → Emails → SMTP Settings**: host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = API key de Resend, remitente de tu dominio verificado. Personaliza la plantilla *Magic Link* con el tono de RunTogether.

## 7. Probar en local

Abre la carpeta en VS Code y lanza `index.html` con **Live Server** (puerto 5500), o:

```powershell
npx serve .
```

Tests (lógica de calendario + esquema SQL en un Postgres embebido):

```powershell
npm install
npm test
```

## 8. Publicar en GitHub Pages

1. Crea el repositorio `agusplaylab/RunTogether` y sube el contenido de esta carpeta (incluido `js/config.js`).
2. **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
3. Comprueba que la URL publicada está en las Redirect URLs del paso 4.

## ✅ Checklist

- [ ] Políticas de Maldives revisadas
- [ ] Migración ejecutada sin errores
- [ ] Dos usuarios creados, registro público desactivado
- [ ] Dos filas en `rt_profiles`
- [ ] Site URL y Redirect URLs configuradas
- [ ] Anon key en `js/config.js`
- [ ] `rt-send-notification` desplegada y secretos configurados
- [ ] Login con las dos cuentas, solicitud → aceptación → email recibido
- [ ] Publicado en GitHub Pages
