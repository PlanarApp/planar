import { Controller, Get, Inject, NotFoundException, Param, Req } from '@nestjs/common';
import { z } from 'zod';
import { getAuth } from '../auth/auth.js';
import { PullService } from './pull.service.js';

@Controller('api/tasks')
export class ActivityController {
  constructor(@Inject(PullService) private pull: PullService) {}

  @Get(':id/activity')
  activity(@Req() req: object, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new NotFoundException('задача не найдена');
    return this.pull.taskActivity(getAuth(req).userId, id);
  }
}
