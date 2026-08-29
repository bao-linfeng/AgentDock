import {
  Controller,
  Inject,
  type MessageEvent,
  Param,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { type Observable, concat, from, interval, map, merge, mergeMap, of } from 'rxjs';
import { z } from 'zod';
import { ApiTokenGuard } from '../auth/api-token.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RunsService } from '../runs/runs.service.js';
import { RunEventsBus } from './run-events.bus.js';

const StreamQuerySchema = z.object({
  /** Resume point: only events with a higher `seq` are replayed. */
  afterSeq: z.coerce.number().int().nonnegative().optional(),
});
type StreamQuery = z.infer<typeof StreamQuerySchema>;

/** Keep-alive interval so proxies do not drop an idle SSE connection. */
const PING_INTERVAL_MS = 15_000;

/**
 * EventsModule — live run timeline for the Web console (architecture §9:
 * Runner → Server → DB → SSE → Web).
 *
 * Events are replayed from the database first, then streamed live. Because the
 * browser `EventSource` cannot send headers, the token may be passed as
 * `?access_token=` (see `extractToken`).
 */
@Controller('events')
@UseGuards(ApiTokenGuard)
export class EventsController {
  constructor(
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(RunEventsBus) private readonly bus: RunEventsBus,
  ) {}

  @Sse('runs/:id')
  stream(
    @Param('id') runId: string,
    @Query(new ZodValidationPipe(StreamQuerySchema)) query: StreamQuery,
  ): Observable<MessageEvent> {
    const replay = from(this.runs.listEvents(runId, { afterSeq: query.afterSeq, limit: 500 })).pipe(
      mergeMap((events) => from(events)),
    );
    // Replay first, then live. A client that reconnects should pass the last
    // `seq` it saw as `afterSeq` to close any gap.
    const events = concat(replay, this.bus.observe(runId)).pipe(
      map((event): MessageEvent => ({ id: String(event.seq), type: event.type, data: event })),
    );
    const ping = interval(PING_INTERVAL_MS).pipe(
      mergeMap(() => of<MessageEvent>({ type: 'ping', data: { at: new Date().toISOString() } })),
    );
    return merge(events, ping);
  }
}
