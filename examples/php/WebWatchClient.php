<?php

declare(strict_types=1);

namespace WebWatch;

use RuntimeException;

final class WebWatchException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $statusCode = 0,
        public readonly ?array $response = null,
    ) {
        parent::__construct($message, $statusCode);
    }
}

final class WebWatchClient
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly string $apiKey,
        private readonly int $timeoutSeconds = 70,
    ) {
    }

    public function listMonitors(): array
    {
        return $this->request('GET', '/v1/monitors');
    }

    public function getMonitor(string $monitorId): array
    {
        return $this->request('GET', "/v1/monitors/{$monitorId}");
    }

    public function createMonitor(array $monitor): array
    {
        return $this->request('POST', '/v1/monitors', $monitor);
    }

    public function updateMonitor(string $monitorId, array $changes): array
    {
        return $this->request('PATCH', "/v1/monitors/{$monitorId}", $changes);
    }

    public function deleteMonitor(string $monitorId): void
    {
        $this->request('DELETE', "/v1/monitors/{$monitorId}");
    }

    public function checkNow(string $monitorId): array
    {
        return $this->request('POST', "/v1/monitors/{$monitorId}/check");
    }

    public function listRuns(string $monitorId, int $limit = 50): array
    {
        $limit = max(1, min($limit, 200));
        return $this->request('GET', "/v1/monitors/{$monitorId}/runs?limit={$limit}");
    }

    public function downloadScreenshot(string $runId, string $destination): void
    {
        $file = fopen($destination, 'wb');
        if ($file === false) {
            throw new RuntimeException("No se pudo abrir {$destination} para escritura");
        }

        $curl = curl_init($this->url("/v1/runs/{$runId}/screenshot"));
        curl_setopt_array($curl, [
            CURLOPT_HTTPHEADER => ['X-API-Key: ' . $this->apiKey],
            CURLOPT_FILE => $file,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);

        $ok = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);
        curl_close($curl);
        fclose($file);

        if ($ok === false || $status < 200 || $status >= 300) {
            @unlink($destination);
            throw new WebWatchException($error ?: "No se pudo descargar la captura", $status);
        }
    }

    public function streamEvents(callable $listener): void
    {
        $buffer = '';
        $curl = curl_init($this->url('/v1/events'));
        curl_setopt_array($curl, [
            CURLOPT_HTTPHEADER => [
                'X-API-Key: ' . $this->apiKey,
                'Accept: text/event-stream',
            ],
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT => 0,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$buffer, $listener): int {
                $buffer .= str_replace("\r\n", "\n", $chunk);
                while (($position = strpos($buffer, "\n\n")) !== false) {
                    $message = substr($buffer, 0, $position);
                    $buffer = substr($buffer, $position + 2);
                    $event = 'message';
                    $dataLines = [];
                    foreach (explode("\n", $message) as $line) {
                        if (str_starts_with($line, 'event:')) {
                            $event = trim(substr($line, 6));
                        } elseif (str_starts_with($line, 'data:')) {
                            $dataLines[] = trim(substr($line, 5));
                        }
                    }
                    if ($dataLines !== []) {
                        $payload = json_decode(implode("\n", $dataLines), true, 512, JSON_THROW_ON_ERROR);
                        $listener($event, $payload);
                    }
                }
                return strlen($chunk);
            },
        ]);

        $ok = curl_exec($curl);
        if ($ok === false) {
            $error = curl_error($curl);
            curl_close($curl);
            throw new WebWatchException($error ?: 'La conexión SSE terminó inesperadamente');
        }
        curl_close($curl);
    }

    private function request(string $method, string $path, ?array $body = null): array
    {
        $curl = curl_init($this->url($path));
        $headers = [
            'Accept: application/json',
            'X-API-Key: ' . $this->apiKey,
        ];
        $options = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ];

        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            $options[CURLOPT_POSTFIELDS] = json_encode($body, JSON_THROW_ON_ERROR);
        }
        $options[CURLOPT_HTTPHEADER] = $headers;
        curl_setopt_array($curl, $options);

        $raw = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);
        curl_close($curl);

        if ($raw === false) {
            throw new WebWatchException($error ?: 'No se pudo conectar con WebWatch');
        }
        if ($status === 204) {
            return [];
        }

        $decoded = json_decode($raw, true);
        if ($status < 200 || $status >= 300) {
            $message = is_array($decoded) && isset($decoded['error'])
                ? (string) $decoded['error']
                : "WebWatch respondió HTTP {$status}";
            throw new WebWatchException($message, $status, is_array($decoded) ? $decoded : null);
        }
        if (!is_array($decoded)) {
            throw new WebWatchException('WebWatch devolvió una respuesta JSON inválida', $status);
        }
        return $decoded;
    }

    private function url(string $path): string
    {
        return rtrim($this->baseUrl, '/') . '/' . ltrim($path, '/');
    }
}
