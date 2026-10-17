# WebWatch API

API multiusuario para vigilar sitios web en intervalos configurables. Usa un navegador Chromium real para detectar caídas, respuestas HTTP incorrectas, texto faltante, errores JavaScript y recursos fallidos. Guarda historial, genera capturas y avisa por webhook o correo cuando un sitio cae o se recupera.

## Funciones

- API keys independientes por cliente.
- Monitores cada 30 segundos o más.
- Comprobación HTTP, contenido esperado y errores del navegador.
- Capturas en cada revisión o solamente al fallar.
- Eventos en tiempo real mediante Server-Sent Events (SSE).
- Alertas firmadas por webhook y correos con captura adjunta.
- Enlaces temporales firmados para capturas.
- Bloqueo de URLs locales/privadas para reducir ataques SSRF.
- Límites de peticiones, concurrencia y cantidad de monitores.
- Eliminación automática del historial según la retención configurada.
- PostgreSQL, Docker Compose y documentación Swagger en `/docs`.

## Inicio rápido con Docker

```bash
cp .env.example .env
```

Configura como mínimo estos valores con secretos distintos:

```env
ADMIN_TOKEN=un-token-administrativo-largo-y-aleatorio
SCREENSHOT_SIGNING_SECRET=otro-secreto-largo-y-aleatorio
PUBLIC_BASE_URL=https://monitor.example.com
POSTGRES_PASSWORD=una-clave-segura-para-postgres
```

En Linux puedes generar secretos con `openssl rand -hex 32`.

```bash
docker compose up -d --build
curl http://127.0.0.1:8080/health
```

El contenedor ejecuta automáticamente las migraciones pendientes al iniciar.

## Crear un cliente

La API key solo se devuelve una vez.

```bash
curl -X POST http://127.0.0.1:8080/v1/admin/clients \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Cliente Demo",
    "alert_email": "soporte@cliente.com",
    "webhook_url": "https://cliente.com/webhooks/webwatch"
  }'
```

## Crear un monitor

```bash
curl -X POST http://127.0.0.1:8080/v1/monitors \
  -H "X-API-Key: ww_live_REEMPLAZAR" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Página principal",
    "url": "https://example.com",
    "interval_seconds": 60,
    "timeout_ms": 30000,
    "expected_status": 200,
    "expected_text": "Example Domain",
    "fail_on_console_error": false,
    "screenshot_mode": "failure"
  }'
```

## Endpoints principales

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/health` | Salud del servicio |
| `POST` | `/v1/admin/clients` | Crear cliente y API key |
| `GET/POST` | `/v1/monitors` | Listar o crear monitores |
| `GET/PATCH/DELETE` | `/v1/monitors/:id` | Gestionar un monitor |
| `POST` | `/v1/monitors/:id/check` | Ejecutar revisión inmediata |
| `GET` | `/v1/monitors/:id/runs` | Consultar historial |
| `GET` | `/v1/runs/:id/screenshot` | Descargar captura autenticada |
| `GET` | `/v1/events` | Flujo SSE en tiempo real |
| `GET` | `/docs` | Interfaz Swagger |

Todas las rutas de cliente requieren `X-API-Key`.

## Eventos en tiempo real

```bash
curl -N http://127.0.0.1:8080/v1/events \
  -H "X-API-Key: ww_live_REEMPLAZAR"
```

Cada revisión publica un evento `monitor.checked` con el estado y el resultado completo.

## Webhooks

Los webhooks reciben `monitor.down` y `monitor.recovered`. El cuerpo JSON se firma con HMAC-SHA256 y la cabecera:

```text
X-WebWatch-Signature: sha256=...
```

Calcula el HMAC sobre el cuerpo sin modificar usando el `webhook_secret` entregado al crear el cliente.

## Despliegue en VPS

1. Instala Docker Engine y Docker Compose.
2. Apunta un dominio al VPS.
3. Clona o copia este proyecto y configura `.env`.
4. Ejecuta `docker compose up -d --build`.
5. Instala Caddy y adapta `Caddyfile.example` para obtener HTTPS automático.
6. Permite públicamente solo los puertos `80` y `443`; PostgreSQL y `8080` deben permanecer privados.
7. Configura copias de seguridad del volumen `postgres_data` y límites de disco.

Para varios servidores de API, sustituye el SSE en memoria por Redis Pub/Sub y separa los workers antes de escalar horizontalmente.

## Seguridad operativa

- No habilites `ALLOW_PRIVATE_TARGETS` en un servicio público.
- Ejecuta el contenedor en una red sin acceso a servicios internos sensibles.
- Mantén `CHECK_CONCURRENCY` bajo hasta medir CPU y RAM; Chromium consume recursos.
- Define `RETENTION_DAYS` según el espacio disponible.
- Usa HTTPS y rota inmediatamente una API key filtrada.
- El activador KMS encontrado anteriormente en este equipo no debe copiarse al VPS.

## Desarrollo local

Requiere Node.js 22, PostgreSQL y Chromium de Playwright.

```bash
npm install
npx playwright install chromium
npm run migrate
npm run dev
```

Pruebas y compilación:

```bash
npm test
npm run build
```
