import "server-only";

import { realtimeEventSchema, type RealtimeEvent } from "./events";

const HEARTBEAT_INTERVAL_MS = 20_000;
const encoder = new TextEncoder();

type Subscriber = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  userId: string | undefined;
  close: () => void;
};

type RealtimeHub = {
  subscribers: Set<Subscriber>;
};

declare global {
  var xpAtendimentoRealtimeHub: RealtimeHub | undefined;
}

function getHub(): RealtimeHub {
  globalThis.xpAtendimentoRealtimeHub ??= { subscribers: new Set() };
  return globalThis.xpAtendimentoRealtimeHub;
}

function frame(data: string): Uint8Array {
  return encoder.encode(data);
}

function removeSubscriber(subscriber: Subscriber): void {
  getHub().subscribers.delete(subscriber);
}

export function publishRealtime(event: RealtimeEvent): void {
  const validatedEvent = realtimeEventSchema.parse(event);
  const payload = frame(`event: update\ndata: ${JSON.stringify(validatedEvent)}\n\n`);

  for (const subscriber of getHub().subscribers) {
    try {
      subscriber.controller.enqueue(payload);
    } catch {
      removeSubscriber(subscriber);
      continue;
    }

    if (
      validatedEvent.type === "user.updated" &&
      subscriber.userId === validatedEvent.userId
    ) {
      subscriber.close();
    }
  }
}

export function subscribeRealtime(
  signal: AbortSignal,
  userId?: string,
): ReadableStream<Uint8Array> {
  let subscriber: Subscriber | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let abortListenerAttached = false;
  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }

    closed = true;

    if (abortListenerAttached) {
      signal.removeEventListener("abort", close);
      abortListenerAttached = false;
    }

    if (heartbeat) {
      clearInterval(heartbeat);
    }

    if (subscriber) {
      removeSubscriber(subscriber);
      try {
        subscriber.controller.close();
      } catch {
        // The stream is already closed or errored.
      }
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      subscriber = { controller, userId, close };

      if (signal.aborted) {
        close();
        return;
      }

      getHub().subscribers.add(subscriber);
      controller.enqueue(frame(": connected\n\n"));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(frame(": heartbeat\n\n"));
        } catch {
          close();
        }
      }, HEARTBEAT_INTERVAL_MS);
      signal.addEventListener("abort", close, { once: true });
      abortListenerAttached = true;
    },
    cancel() {
      close();
    },
  });
}

export function realtimeSubscriberCount(): number {
  return getHub().subscribers.size;
}
