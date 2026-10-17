import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { config } from "./config.js";

const blockedHostnames = new Set(["localhost", "localhost.localdomain"]);

function isPublicAddress(address: string): boolean {
  const parsed = ipaddr.parse(address);
  const range = parsed.range();
  return range === "unicast";
}

export async function assertSafeUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL inválida");
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("Solo se permiten URLs HTTP o HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("No se permiten credenciales dentro de la URL");
  }
  if (config.ALLOW_PRIVATE_TARGETS) return url;
  if (blockedHostnames.has(url.hostname.toLowerCase())) {
    throw new Error("No se permiten destinos locales");
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("El destino resuelve a una red privada o reservada");
  }
  return url;
}

export function isValidWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (config.NODE_ENV !== "production" && url.protocol === "http:");
  } catch {
    return false;
  }
}
