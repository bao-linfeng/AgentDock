import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { RunEventDto } from '../runs/runs.dto.js';

/**
 * In-process fan-out of run events to SSE subscribers.
 *
 * Events are always persisted first (`run_events`), so a subscriber that misses
 * a live event can replay it via `GET /runs/:id/events?afterSeq=`. MVP is a
 * single server process; a multi-instance deployment would swap this for
 * Redis pub/sub.
 */
@Injectable()
export class RunEventsBus {
  private readonly streams = new Map<string, Subject<RunEventDto>>();

  publish(event: RunEventDto): void {
    this.streams.get(event.runId)?.next(event);
  }

  observe(runId: string): Observable<RunEventDto> {
    return new Observable<RunEventDto>((subscriber) => {
      let subject = this.streams.get(runId);
      if (!subject) {
        subject = new Subject<RunEventDto>();
        this.streams.set(runId, subject);
      }
      const subscription = subject.subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        const current = this.streams.get(runId);
        if (current && !current.observed) {
          this.streams.delete(runId);
        }
      };
    });
  }
}
