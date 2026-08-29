import { type Ref, onScopeDispose, ref, watch } from 'vue';
import { apiUrl } from '../api/client';
import { useAuthStore } from '../stores/auth';
import type { RunEventDto } from '../types';

/**
 * Subscribes to `GET /events/runs/:id` (SSE) for live RunEvent updates.
 *
 * Browser `EventSource` cannot set custom headers, so the API token is passed
 * via `?access_token=` (apps/server/src/auth/token.ts `extractToken()`,
 * priority 3 — documented as existing specifically for this case).
 *
 * The server always replays persisted events first (DB) before switching to
 * the live in-process bus, so reconnecting with `afterSeq` never loses events.
 * A `ping` event (no `id`) arrives every ~15s as a keep-alive; it carries no
 * RunEvent semantics and is ignored here.
 */
export function useRunEvents(runId: Ref<string | undefined | null>) {
  const events = ref<RunEventDto[]>([]) as Ref<RunEventDto[]>;
  const connected = ref(false);
  const lastError = ref<string | null>(null);

  let source: EventSource | null = null;
  let lastSeq = -1;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function reset() {
    events.value = [];
    lastSeq = -1;
    connected.value = false;
  }

  function teardown() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (source) {
      source.close();
      source = null;
    }
  }

  function connect(id: string) {
    teardown();
    connected.value = false;
    lastError.value = null;

    const auth = useAuthStore();
    const params = new URLSearchParams();
    if (auth.token) params.set('access_token', auth.token);
    if (lastSeq >= 0) params.set('afterSeq', String(lastSeq));

    const url = `${apiUrl(`/events/runs/${id}`)}?${params.toString()}`;
    const es = new EventSource(url);
    source = es;

    es.onopen = () => {
      connected.value = true;
      lastError.value = null;
    };

    es.onmessage = (message) => {
      // Named events (status/log/tool/artifact/verification/error) are handled
      // via addEventListener below; this default handler only sees unnamed
      // messages, which should not normally occur.
      handleRawEvent(message);
    };

    const eventTypes = ['status', 'log', 'tool', 'artifact', 'verification', 'error', 'approval'];
    for (const type of eventTypes) {
      es.addEventListener(type, (message) => handleRawEvent(message as MessageEvent));
    }
    es.addEventListener('ping', () => {
      // keep-alive only, nothing to persist
    });

    es.onerror = () => {
      connected.value = false;
      lastError.value = 'connection lost, retrying…';
      // EventSource retries automatically, but we force a clean reconnect
      // with the latest afterSeq to be safe across proxies that drop it.
      es.close();
      reconnectTimer = setTimeout(() => connect(id), 2000);
    };
  }

  function handleRawEvent(message: MessageEvent) {
    try {
      const parsed = JSON.parse(message.data) as RunEventDto;
      if (typeof parsed.seq === 'number' && parsed.seq <= lastSeq) {
        return; // duplicate from replay/reconnect overlap
      }
      if (typeof parsed.seq === 'number') {
        lastSeq = parsed.seq;
      }
      events.value.push(parsed);
    } catch {
      // ignore malformed payloads
    }
  }

  watch(
    runId,
    (id) => {
      reset();
      teardown();
      if (id) connect(id);
    },
    { immediate: true },
  );

  onScopeDispose(() => teardown());

  return { events, connected, lastError };
}
