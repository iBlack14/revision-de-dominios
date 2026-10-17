# Integración de WebWatch API con PHP

Esta guía está destinada a clientes que consumirán WebWatch desde un backend PHP. Los ejemplos requieren PHP 8.1 o superior y la extensión cURL.

## Datos que recibe cada cliente

El administrador de WebWatch debe entregar al integrador:

```text
Base URL: https://monitor.tudominio.com
API key: ww_live_...
Webhook secret: ...
```

La API key identifica y aísla la cuenta. Debe guardarse solamente en el servidor PHP, nunca en JavaScript público, HTML, aplicaciones móviles sin backend ni repositorios Git.

Todas las rutas de cliente usan:

```http
X-API-Key: ww_live_REEMPLAZAR
Accept: application/json
```

## Cliente PHP incluido

El archivo `examples/php/WebWatchClient.php` funciona sin Composer ni paquetes externos.

```php
<?php

require __DIR__ . '/WebWatchClient.php';

use WebWatch\WebWatchClient;

$webWatch = new WebWatchClient(
    'https://monitor.tudominio.com',
    getenv('WEBWATCH_API_KEY'),
);
```

Configura la clave fuera del código:

```env
WEBWATCH_API_KEY=ww_live_REEMPLAZAR
WEBWATCH_WEBHOOK_SECRET=REEMPLAZAR
```

## Crear un monitor

```php
$monitor = $webWatch->createMonitor([
    'name' => 'Tienda principal',
    'url' => 'https://tienda.example.com',
    'interval_seconds' => 60,
    'timeout_ms' => 30000,
    'expected_status' => 200,
    'expected_text' => 'Productos',
    'fail_on_console_error' => false,
    'screenshot_mode' => 'failure',
    'enabled' => true,
]);

echo $monitor['id'];
```

Campos disponibles:

| Campo | Tipo | Valores |
| --- | --- | --- |
| `name` | string | Nombre visible, 2-120 caracteres |
| `url` | string | URL pública HTTP/HTTPS |
| `interval_seconds` | integer | `30` a `86400` |
| `timeout_ms` | integer | `1000` a `60000` |
| `expected_status` | integer | Normalmente `200` |
| `expected_text` | string/null | Texto que debe existir en el cuerpo |
| `fail_on_console_error` | boolean | Marca como caída si aparecen errores JS |
| `screenshot_mode` | string | `always`, `failure` o `never` |
| `enabled` | boolean | Activa o pausa el monitor |

## Listar, consultar y modificar

```php
$monitors = $webWatch->listMonitors()['data'];
$monitor = $webWatch->getMonitor($monitorId);

$updated = $webWatch->updateMonitor($monitorId, [
    'interval_seconds' => 300,
    'expected_text' => 'Comprar ahora',
]);

$webWatch->deleteMonitor($monitorId);
```

Los estados posibles son:

- `unknown`: todavía no se ejecutó una revisión.
- `up`: la última revisión fue correcta.
- `down`: la última revisión falló.

## Ejecutar una revisión inmediata

```php
$run = $webWatch->checkNow($monitorId);

echo $run['success'] ? 'Disponible' : 'Caída';
echo $run['http_status'] ?? 'Sin respuesta HTTP';
echo $run['duration_ms'];
echo $run['error'] ?? '';
```

La revisión puede tardar hasta el `timeout_ms` configurado. No la ejecutes dentro de una petición web con un timeout inferior.

## Consultar historial

```php
$runs = $webWatch->listRuns($monitorId, 25)['data'];

foreach ($runs as $run) {
    printf(
        "%s | %s | HTTP %s | %d ms\n",
        $run['created_at'],
        $run['success'] ? 'UP' : 'DOWN',
        $run['http_status'] ?? '-',
        $run['duration_ms'],
    );
}
```

Cada ejecución puede incluir:

- `console_errors`: errores escritos en la consola del navegador.
- `page_errors`: excepciones JavaScript no controladas.
- `failed_requests`: recursos que no pudieron cargarse.
- `has_screenshot`: indica si existe captura.
- `screenshot_url`: endpoint autenticado para descargarla.

## Descargar una captura

```php
if ($run['has_screenshot']) {
    $webWatch->downloadScreenshot(
        $run['id'],
        __DIR__ . '/storage/captura.png',
    );
}
```

No insertes directamente `screenshot_url` en una etiqueta `<img>` porque el navegador no enviará `X-API-Key`. Descarga la imagen desde PHP y entrégala al usuario mediante una ruta autenticada de tu propia aplicación.

## Eventos en tiempo real con SSE

Ejecuta el consumidor como proceso de consola, worker o supervisor, no dentro de una petición PHP-FPM normal:

```php
$webWatch->streamEvents(function (string $event, array $payload): void {
    if ($event !== 'monitor.checked') {
        return;
    }

    printf(
        "Monitor %s cambió a %s\n",
        $payload['monitor_id'],
        $payload['status'],
    );
});
```

El cliente debe reconectar si el proceso termina o la red se interrumpe.

## Recibir y verificar webhooks

WebWatch envía webhooks únicamente cuando un monitor cambia de estado:

- `monitor.down`
- `monitor.recovered`

El cuerpo se firma con HMAC-SHA256. Verifica siempre la firma antes de procesarlo:

```php
<?php

$rawBody = file_get_contents('php://input');
$received = $_SERVER['HTTP_X_WEBWATCH_SIGNATURE'] ?? '';
$secret = getenv('WEBWATCH_WEBHOOK_SECRET');
$expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);

if (!hash_equals($expected, $received)) {
    http_response_code(401);
    exit('Firma inválida');
}

$payload = json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);

switch ($payload['event']) {
    case 'monitor.down':
        // Crear ticket, enviar WhatsApp o notificar al equipo.
        break;
    case 'monitor.recovered':
        // Cerrar incidente o notificar recuperación.
        break;
}

http_response_code(204);
```

La propiedad `run.screenshot_url` del webhook es un enlace temporal firmado y puede descargarse sin API key hasta que expire.

## Laravel

Variables en `.env`:

```env
WEBWATCH_URL=https://monitor.tudominio.com
WEBWATCH_API_KEY=ww_live_REEMPLAZAR
WEBWATCH_WEBHOOK_SECRET=REEMPLAZAR
```

Configuración en `config/services.php`:

```php
'webwatch' => [
    'url' => env('WEBWATCH_URL'),
    'key' => env('WEBWATCH_API_KEY'),
    'webhook_secret' => env('WEBWATCH_WEBHOOK_SECRET'),
],
```

Crear un monitor con el cliente HTTP de Laravel:

```php
use Illuminate\Support\Facades\Http;

$response = Http::baseUrl(config('services.webwatch.url'))
    ->withHeaders(['X-API-Key' => config('services.webwatch.key')])
    ->timeout(70)
    ->post('/v1/monitors', [
        'name' => 'Portal Laravel',
        'url' => 'https://cliente.example.com',
        'interval_seconds' => 60,
        'expected_status' => 200,
        'screenshot_mode' => 'failure',
    ])
    ->throw()
    ->json();
```

Ruta para webhooks en `routes/api.php`:

```php
use App\Http\Controllers\WebWatchWebhookController;

Route::post('/webhooks/webwatch', WebWatchWebhookController::class);
```

Controlador:

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class WebWatchWebhookController extends Controller
{
    public function __invoke(Request $request): Response
    {
        $expected = 'sha256=' . hash_hmac(
            'sha256',
            $request->getContent(),
            config('services.webwatch.webhook_secret'),
        );

        abort_unless(
            hash_equals($expected, (string) $request->header('X-WebWatch-Signature')),
            401,
        );

        $event = $request->json('event');
        $monitor = $request->json('monitor');

        // Despachar un Job para procesar la alerta fuera de la petición.

        return response()->noContent();
    }
}
```

Excluye esta ruta de la protección CSRF si la registras en `web.php`. En `api.php` normalmente no aplica CSRF.

## Errores y códigos HTTP

| Código | Significado habitual |
| --- | --- |
| `400` | JSON, URL o parámetros inválidos |
| `401` | Falta `X-API-Key` o la clave es incorrecta |
| `403` | Enlace firmado inválido o vencido |
| `404` | Monitor, ejecución o captura inexistente |
| `409` | La cuenta alcanzó su límite de monitores |
| `429` | Demasiadas peticiones |
| `500` | Error interno del servicio |

Registra el código HTTP y el campo JSON `error`, pero nunca escribas la API key en logs.

## Endpoints

| Método | Ruta |
| --- | --- |
| `GET` | `/health` |
| `GET` | `/v1/me` |
| `GET` | `/v1/monitors` |
| `POST` | `/v1/monitors` |
| `GET` | `/v1/monitors/{id}` |
| `PATCH` | `/v1/monitors/{id}` |
| `DELETE` | `/v1/monitors/{id}` |
| `POST` | `/v1/monitors/{id}/check` |
| `GET` | `/v1/monitors/{id}/runs?limit=50` |
| `GET` | `/v1/runs/{id}/screenshot` |
| `GET` | `/v1/events` |

El administrador del servicio crea las cuentas mediante `/v1/admin/clients`. Esa ruta no debe entregarse a usuarios finales ni llamarse desde aplicaciones cliente.
