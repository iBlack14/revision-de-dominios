import type { ServerResponse } from "node:http";

class EventHub {
  private readonly subscribers = new Map<string, Set<ServerResponse>>();

  subscribe(clientId: string, response: ServerResponse): () => void {
    const current = this.subscribers.get(clientId) ?? new Set<ServerResponse>();
    current.add(response);
    this.subscribers.set(clientId, current);
    return () => {
      current.delete(response);
      if (!current.size) this.subscribers.delete(clientId);
    };
  }

  publish(clientId: string, event: string, payload: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of this.subscribers.get(clientId) ?? []) {
      response.write(message);
    }
  }
}

export const eventHub = new EventHub();
