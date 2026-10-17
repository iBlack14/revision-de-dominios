# Despliegue de WebWatch API en EasyPanel

Esta guía usa dos servicios dentro del mismo proyecto de EasyPanel:

- `database`: PostgreSQL administrado por EasyPanel.
- `api`: aplicación construida desde el `Dockerfile` del repositorio.

Esta opción es preferible al servicio Compose porque permite gestionar por separado las credenciales, copias de seguridad, dominio, recursos y almacenamiento.

## 1. Requisitos

- VPS con EasyPanel instalado.
- Dominio o subdominio, por ejemplo `monitor.tudominio.com`.
- Repositorio GitHub/Git con este proyecto.
- Recomendado: VPS con al menos 4 GB de RAM. Chromium consume memoria durante las revisiones.
- Puertos públicos `80` y `443` disponibles.

## 2. Subir el proyecto a Git

Desde la carpeta del proyecto:

```bash
git add .
git commit -m "Add WebWatch monitoring API"
git remote add origin https://github.com/USUARIO/REPOSITORIO.git
git push -u origin main
```

No subas `.env`, capturas ni credenciales. Ya están excluidas por `.gitignore`.

## 3. Crear el proyecto

1. Abre EasyPanel.
2. Selecciona **New Project**.
3. Usa un nombre sencillo, por ejemplo `webwatch`.

## 4. Crear PostgreSQL

1. Dentro de `webwatch`, selecciona **New Service**.
2. Elige **Postgres**.
3. Nombre del servicio: `database`.
4. Base de datos: `webwatch`.
5. Usuario: puedes conservar `postgres` o usar `webwatch`.
6. Genera una contraseña segura y crea el servicio.
7. Cuando esté iniciado, abre **Credentials**.
8. Copia la **Internal Connection URL** completa.

No publiques PostgreSQL en Internet. La aplicación debe usar la URL interna del proyecto.

## 5. Crear la aplicación

1. Dentro del mismo proyecto, selecciona **New Service → App**.
2. Nombre: `api`.
3. En **Source**, selecciona GitHub o Git.
4. Elige el repositorio y la rama `main`.
5. Configura **Build Path** como `/`.
6. En **Build**, selecciona **Dockerfile**.
7. Dockerfile Path: `Dockerfile`.

EasyPanel normalmente detecta el Dockerfile automáticamente cuando está dentro del Build Path.

## 6. Configurar variables

En **Environment**, agrega lo siguiente y reemplaza los valores indicados:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
DATABASE_URL=PEGAR_AQUI_LA_INTERNAL_CONNECTION_URL
ADMIN_TOKEN=GENERAR_SECRETO_1
SCREENSHOT_SIGNING_SECRET=GENERAR_SECRETO_2
PUBLIC_BASE_URL=https://monitor.tudominio.com
SCREENSHOT_DIR=/data/screenshots
CHECK_CONCURRENCY=2
MAX_MONITORS_PER_CLIENT=50
RETENTION_DAYS=30
ALLOW_PRIVATE_TARGETS=false
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=WebWatch <alertas@tudominio.com>
```

Genera `ADMIN_TOKEN` y `SCREENSHOT_SIGNING_SECRET` como valores diferentes. Desde Linux puedes usar:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

El correo es opcional. Sin SMTP, las revisiones, capturas, SSE y webhooks continúan funcionando.

## 7. Crear almacenamiento persistente

Las capturas no deben quedar dentro del filesystem temporal del contenedor.

1. Abre la pestaña **Storage** de la App.
2. Añade un almacenamiento de tipo **Volume**.
3. Nombre sugerido: `screenshots`.
4. Mount Path: `/data/screenshots`.
5. Guarda los cambios.

El contenedor ejecuta la aplicación con UID `10001`. Si los logs muestran `EACCES` al guardar capturas, verifica desde **Shell** que `/data/screenshots` sea escribible por ese usuario.

## 8. Configurar dominio y HTTPS

1. Abre **Domains** en el servicio `api`.
2. Añade `monitor.tudominio.com`.
3. Internal Protocol: `HTTP`.
4. Target Port: `8080`.
5. Márcalo como dominio principal.
6. Activa HTTPS/Let's Encrypt.
7. Crea previamente un registro DNS `A` apuntando el subdominio a la IP del VPS.

No publiques el puerto `8080` directamente. EasyPanel debe enrutar el tráfico mediante el dominio HTTPS.

## 9. Recursos recomendados

En **Resources** empieza con:

- CPU reservation: `0.5`.
- CPU limit: `2`.
- Memory reservation: `1024 MB`.
- Memory limit: `2048 MB`.
- Réplicas: `1`.

Mantén una sola réplica: el scheduler y los eventos SSE están diseñados para una instancia. Si aumentas la concurrencia de chequeos, incrementa primero la memoria.

## 10. Desplegar

1. Guarda Source, Environment, Storage, Domain y Resources.
2. Pulsa **Deploy**.
3. Abre la acción de despliegue para observar el build.
4. Después abre **Logs**.

El primer build tarda más porque instala Chromium y sus dependencias. Al arrancar, la aplicación ejecuta automáticamente las migraciones SQL.

## 11. Verificar

```bash
curl https://monitor.tudominio.com/health
```

Respuesta esperada:

```json
{"status":"ok","time":"..."}
```

La documentación estará disponible en:

```text
https://monitor.tudominio.com/docs
```

## 12. Crear el primer cliente

```bash
curl -X POST https://monitor.tudominio.com/v1/admin/clients \
  -H "Authorization: Bearer TU_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Cliente Demo",
    "alert_email": "soporte@cliente.com",
    "webhook_url": "https://cliente.com/webhooks/webwatch"
  }'
```

Guarda `api_key` y `webhook_secret`: se muestran una sola vez.

## 13. Crear el primer monitor

```bash
curl -X POST https://monitor.tudominio.com/v1/monitors \
  -H "X-API-Key: ww_live_REEMPLAZAR" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Página principal",
    "url": "https://example.com",
    "interval_seconds": 60,
    "expected_status": 200,
    "expected_text": "Example Domain",
    "screenshot_mode": "always"
  }'
```

Para ejecutar una revisión inmediata:

```bash
curl -X POST https://monitor.tudominio.com/v1/monitors/ID_MONITOR/check \
  -H "X-API-Key: ww_live_REEMPLAZAR"
```

## 14. Copias de seguridad

Configura dos respaldos independientes:

1. En el servicio PostgreSQL, crea una copia lógica diaria con retención.
2. En el volumen `screenshots`, configura Volume Backups hacia S3, R2, Backblaze u otro proveedor externo.

Prueba manualmente cada respaldo. Las capturas antiguas se eliminan de la aplicación según `RETENTION_DAYS`.

## 15. Actualizaciones automáticas

Si usas GitHub:

1. Activa **Auto Deploy** en la App.
2. Cada push a la rama configurada generará un nuevo despliegue.
3. Usa **Force Rebuild** si cambias el Dockerfile o necesitas ignorar la caché.

## Problemas frecuentes

### El build termina con código 137

El VPS o Docker Builder se quedó sin memoria durante la instalación de Chromium. Aumenta RAM/swap o los límites del builder y ejecuta **Force Rebuild**.

### El build muestra `tsc: not found`

Confirma que el repositorio contiene el Dockerfile multietapa actual. La etapa `build` instala dependencias de desarrollo con `npm ci --include=dev`; la etapa final instala únicamente las dependencias de producción. Después ejecuta **Force Rebuild** para evitar una capa antigua de `npm ci` guardada en caché.

### La aplicación no conecta a PostgreSQL

- Usa la Internal Connection URL, no `localhost`.
- Confirma que ambos servicios estén en el mismo proyecto.
- Verifica que la contraseña no haya sido rotada después de copiar la URL.

### El dominio muestra 502

- Target Port debe ser `8080`.
- `HOST` debe ser `0.0.0.0`.
- Revisa Logs para confirmar que la aplicación terminó de iniciar.

### No se guardan capturas

- Confirma el volumen montado en `/data/screenshots`.
- Revisa permisos con `id` y `ls -ld /data/screenshots` desde Shell.
- Confirma que `SCREENSHOT_DIR=/data/screenshots`.

### Los chequeos consumen demasiada memoria

- Baja `CHECK_CONCURRENCY` a `1`.
- Aumenta el intervalo de los monitores.
- Sube el límite de memoria del servicio.
