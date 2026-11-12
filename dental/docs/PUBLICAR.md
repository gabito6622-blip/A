# Publicar Dentalia (cuando la dueña lo autorice)

> **No se publica nada sin la autorización explícita de la dueña.** Esta guía deja todo listo para que, el día que diga «publicá», se haga en una tarde y sin improvisar. Los valores secretos nunca van al repositorio ni a un chat: se cargan solo en el panel del proveedor.

## 0. Antes de empezar (decisiones y cuentas, de la dueña)
- [ ] Autorización para crear el proyecto en Railway (u otro proveedor) y su costo mensual.
- [ ] Dominio, por ejemplo `app.clinica.bo`, y quién administra su DNS.
- [ ] Correo saliente (SMTP) para recuperar contraseñas, desbloquear cuentas y recibir alertas.
- [ ] Dónde se guardan los respaldos: un almacenamiento compatible con S3, **en otra cuenta o bucket** que el de los archivos clínicos, idealmente con bloqueo de objetos.
- [ ] Quién recibe las alertas (`ALERT_EMAILS`) y quién es el administrador de la plataforma.
- [ ] (Opcional) WhatsApp Business: token, id del número y secreto de la app de Meta.

## 1. Servicios en Railway
1. **Base de datos:** PostgreSQL 16 o 17. La imagen trae `pg_dump` 17, que sirve para las dos.
2. **Servicio web:**
   - Origen: este repositorio, carpeta `dental`; Railway usa `dental/Dockerfile` y `railway.json`.
   - Un **volumen** montado en `/data`, donde quedan los archivos clínicos si no usas S3 para ellos.
   - Comprobación de salud: `/api/health`, ya configurada en `railway.json`.
3. **Respaldo diario:** un servicio de **cron** con la misma imagen y las mismas variables. Comando `node server/dist/cli/backup.js run`, horario `15 7 * * *` (03:15 en La Paz).
4. **Simulacro semanal:** otro cron con el comando `node server/dist/cli/backup.js verify` y horario `45 8 * * 0` (domingos).
   - Si podés, que el simulacro restaure en **otro servidor** de PostgreSQL: definí `BACKUP_VERIFY_ADMIN_URL`.

## 2. Variables (en el panel, nunca en el repositorio)

| Variable | Obligatoria | Para qué |
|---|---|---|
| `NODE_ENV=production` | sí | Modo producción (cookies seguras, documentación de la API cerrada) |
| `DATABASE_URL` | sí | La base de Railway |
| `PUBLIC_URL` | sí | `https://…`: los enlaces de los correos |
| `DENTAL_MFA_KEY`, `DENTAL_LINK_KEY` | sí | Dos claves **distintas**: `openssl rand -hex 32`. Guardarlas también fuera de Railway |
| `BACKUP_PASSPHRASE` | sí | Cifra los respaldos (mínimo 20 caracteres). **Sin ella no se puede restaurar**: guardala fuera del servidor |
| `SMTP_URL`, `MAIL_FROM` | sí | Correo saliente |
| `ALERT_EMAILS` | recomendado | A quién avisar si falla un respaldo o el sistema |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_REGION` | recomendado | Respaldos fuera del servidor |
| `DENTAL_FILES_DRIVER=s3` y `DENTAL_S3_*` | opcional | Archivos clínicos en S3 en vez del volumen |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET` | opcional | Envío real por WhatsApp desde la cola |
| `ANTHROPIC_API_KEY` | opcional | Chat del asistente |

Lista completa y explicada en `.env.example`.

## 3. Chequeo previo
Con las variables cargadas, abrí una consola del servicio y ejecutá:
```
node server/dist/cli/preflight.js
```
Muestra ✔, ⚠ o ✘ por cada punto **sin mostrar ningún valor secreto**. Con algún ✘ **no se publica**: corregí y volvé a ejecutarlo.

## 4. Primera publicación
1. Desplegá el servicio web. Las migraciones se aplican solas al arrancar.
2. Creá el administrador de la plataforma desde la consola del servicio, una sola vez:
   `node server/dist/cli/createAdmin.js correo@dominio "Nombre y apellido"`.
   - Muestra una contraseña temporal **una sola vez**: ingresá, cambiala y activá los 2 pasos.
   - Después, en **Plataforma SaaS**, creá la clínica con su propietaria (recibe su propia contraseña temporal).
3. Entrá como plataforma, abrí **Estado del sistema** y pulsá **«Enviar alerta de prueba»**: tiene que llegar el correo.
4. Ejecutá a mano el cron de respaldo y después el de simulacro. Los dos tienen que quedar en verde en Estado del sistema.
5. Configurá un monitor externo (por ejemplo UptimeRobot) contra `https://…/api/ready`.
6. Si hay WhatsApp: en Meta, configurá el webhook `https://…/api/webhooks/whatsapp` con `WHATSAPP_VERIFY_TOKEN` y enviá un mensaje de prueba a un número propio.
7. Cargá los datos reales de la clínica con **Importar datos**, primero revisando sin guardar.

## 5. Después de publicar (primera semana)
- [ ] Cada mañana: Estado del sistema sin alertas, con el respaldo de la noche en verde.
- [ ] El domingo: simulacro en verde.
- [ ] Revisar «Actividad» y los ingresos fallidos.
- [ ] Prueba de penetración externa antes de cargar todos los pacientes (B-026).

## 6. Si algo sale mal (vuelta atrás)
- **La versión nueva falla al arrancar:** en Railway, «Redeploy» de la versión anterior.
  - Si una migración ya se aplicó, la versión anterior la tolera: las migraciones solo agregan.
  - Si no la tolerara, restaurá el último respaldo **en una base nueva** con `TARGET_DATABASE_URL=… npm run restore -- archivo`, apuntá `DATABASE_URL` a ella y redesplegá.
- **Datos dañados:** restaurá en una base nueva, nunca encima de la actual. Compará y recién después cambiá `DATABASE_URL`.
- **Clave perdida:**
  - sin `BACKUP_PASSPHRASE` no se pueden abrir los respaldos;
  - sin `DENTAL_MFA_KEY`, la verificación en dos pasos de cada persona hay que volver a activarla.

  Por eso se guardan fuera del servidor.
