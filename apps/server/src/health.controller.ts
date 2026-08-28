import { RUN_STATUSES } from '@agentdock/protocol';
import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health(): { status: 'ok'; runStatuses: number } {
    // Imports from @agentdock/protocol to prove cross-package ESM wiring works.
    return { status: 'ok', runStatuses: RUN_STATUSES.length };
  }
}
