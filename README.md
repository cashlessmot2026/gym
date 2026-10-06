# IronYellow Gym 🟨⬛

Una sola app en React (Vite) para gestionar un gimnasio y hacer seguimiento de entrenamientos. Funciona como **PWA instalable y offline** y como **app nativa Android** (Capacitor). Usa Supabase como base de datos.

## Interfaces

| URL | Para quién | Qué hace |
|---|---|---|
| `/` | Cliente | Primero elige su objetivo, sus modalidades y su nivel. Luego ve los días que le quedan de membresía y los ejercicios de cada día de la semana, agrupados por músculo. Cada ejercicio tiene un contador de series, repeticiones, trabajo y descanso. Al terminar ve las estadísticas del día. También tiene IMC y medidas, nutricionista IA con descarga en PDF, biblioteca de ejercicios en internet, su QR y la vinculación del smartwatch. |
| `/admin` (oculta) | Administrador | Dashboard, inscripciones (QR, botón **Asignar NFC**, registro facial), membresías, vencimientos y renovaciones, planes, asistencia, usuarios de coaches y personal, y modalidades editables. |
| `/coach` | Entrenadores | Ven a todos los clientes y su perfil, asignan ejercicios o rutinas por día, crean rutinas y grupos (el grupo carga los ejercicios a todos sus miembros automáticamente), buscan ejercicios en internet y ven la analítica. |
| `/check` | Recepción | Registra la asistencia por cédula, QR, NFC (botón de encendido/apagado de 5 s y lector USB) o reconocimiento facial. |

## Instalación

### 1. Base de datos (Supabase)
1. En el Dashboard de Supabase abre **SQL Editor → New query**.
2. Pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**.
3. Usuario inicial: **admin** / **admin123**. Cámbialo enseguida en `/admin → Coaches y personal`.

### 2. Nutricionista IA (opcional, con Claude)
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy nutri-ai --no-verify-jwt
```
Si la función no está desplegada, la app usa un motor local basado en las guías ISSN, ACSM y OMS.

### 2b. Notificaciones push y promociones
1. Ejecuta [`supabase/02_push.sql`](supabase/02_push.sql) en el SQL Editor. Crea las tablas, activa Realtime y crea el bucket `promos` para las imágenes.
2. Configura las claves VAPID. La privada está en `.env.vapid.json`, que solo existe en el PC donde se generó y **nunca se sube a git**:
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=<publicKey> VAPID_PRIVATE_KEY=<privateKey> VAPID_SUBJECT=mailto:tu@correo.com
   supabase functions deploy send-push --no-verify-jwt
   ```
3. Para la app nativa Android, crea un proyecto en Firebase y copia `google-services.json` a `android/app/`. Luego configura la cuenta de servicio:
   `supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"`

Cómo funciona:
- **App abierta**: Supabase Realtime muestra un banner interno al instante y actualiza la campana con la bandeja.
- **App cerrada o en segundo plano**: el Service Worker (`public/push-sw.js`) muestra la notificación del sistema. En Android nativo se usa FCM.
- **Panel del admin** (`/admin → Promociones push`): plantillas, imagen, destino (una pestaña de la app o un enlace externo), audiencia (todos, activos, por vencer, vencidos, por modalidad o clientes específicos), vista previa en un teléfono e historial con las entregas.
- Si `send-push` no está desplegada, la campaña igual aparece dentro de la app.
- En iPhone, el push web solo funciona con la app instalada en la pantalla de inicio (iOS 16.4+).

### 2c. Clases grupales, pagos y nutricionista gratis
1. Ejecuta en orden `supabase/03_pagos_cop.sql` y `supabase/04_clases.sql`. El 04 activa `pg_cron` para revisar cada minuto qué clase empieza en 10 minutos.
2. Despliega las funciones:
   ```bash
   supabase functions deploy send-push class-reminders nutri-ai --no-verify-jwt
   ```
3. Configura los secretos (Dashboard > Edge Functions > Secrets):
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: claves de las notificaciones web (están en `.env.vapid.json`).
   - `GEMINI_API_KEY`: nutricionista con IA **gratis**. Créala en https://aistudio.google.com/apikey.
   - Opcionales: `GYM_TIMEZONE` (por defecto `America/Bogota`) y `CLASS_REMINDER_MINUTES` (por defecto `10`).

**Notificaciones en la app Android: sin Firebase.** Las alertas de clase se programan en el propio teléfono, con canal de alarma, 10 minutos antes. Una tarea en segundo plano consulta Supabase cada ~15 min para traer las promociones.

**Nutricionista IA:** usa Gemini (gratis) si está configurado. Si no, una IA gratuita sin clave, a la que se envían datos anónimos. Como último respaldo, guías oficiales (ISSN, ACSM, COI, OMS, ICBF). Las novedades científicas se descargan cada lunes de PubMed (`.github/workflows/nutrition-updates.yml`).

### 3. Ejecutar
```bash
npm install
npm run dev        # desarrollo
npm run build      # build de producción (PWA)
```
La conexión a Supabase ya viene configurada. Para cambiarla, copia `.env.example` a `.env.local`.

### 4. App nativa Android
```bash
npx cap add android
npm run cap:android   # compila, sincroniza y abre Android Studio
```
Agrega en `android/app/src/main/AndroidManifest.xml` los permisos de cámara y Bluetooth (`CAMERA`, `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`).

## Tecnología
- **Autenticación propia**: las contraseñas se validan en la base de datos y se guardan cifradas con bcrypt (`pgcrypto`) en la tabla `credentials`, que no se puede leer desde el cliente. Para recuperar una contraseña se escribe el correo; a los 3 s aparece una clave temporal nueva con un botón para copiarla.
- **Reconocimiento facial**: `@vladmandic/face-api` (SSD MobileNet, 68 landmarks y descriptor ResNet de 128 dimensiones). Toma 5 muestras con control de calidad (luz, tamaño, rostro de frente). La validación usa un umbral estricto de 0.45, exige un margen frente al segundo candidato y 3 confirmaciones seguidas. Los modelos se sirven en local (`/public/models`).
- **NFC**: Web NFC (Chrome en Android) para leer el UID y escribir el código del socio en el tag. También acepta lectores USB que funcionan como teclado.
- **Smartwatch**: `@capacitor-community/bluetooth-le` (nativo y Web Bluetooth). Muestra la frecuencia cardiaca en vivo (servicio estándar 0x180D). Cualquier botón BLE del reloj detiene el contador. Los controles multimedia del reloj (Pausa, Play, Siguiente) también manejan el temporizador.
- **Fórmulas**: IMC y categorías de la OMS, metabolismo basal con Mifflin-St Jeor, gasto diario (TMB × factor de actividad), % de grasa con el método US Navy, índices cintura/cadera y cintura/estatura, y macros según ISSN.
- **Ejercicios en internet**: API pública de [wger.de](https://wger.de) y un catálogo curado por modalidad con enlaces a videos de técnica.
- **Gráficas**: Recharts. **PDF**: jsPDF + autotable. **QR**: `qrcode` y `html5-qrcode`.

> ⚠️ Mientras no exista login con Google, las tablas de negocio se acceden con la anon key (RLS permisivo). Las credenciales están protegidas. Al migrar a Supabase Auth hay que restringir las políticas por rol.
