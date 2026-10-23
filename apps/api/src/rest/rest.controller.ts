import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { getAuth } from '../auth/auth.js';
import { openapi } from './openapi.js';
import { RestService } from './rest.service.js';

@Controller('api/v1')
export class RestController {
  constructor(@Inject(RestService) private rest: RestService) {}

  @Get('openapi.json')
  doc() {
    return openapi();
  }
  @Get('spaces')
  spaces(@Req() req: object, @Query() q: unknown) {
    return this.rest.spaces(getAuth(req).userId, q);
  }
  @Get('projects')
  projects(@Req() req: object, @Query() q: unknown) {
    return this.rest.projects(getAuth(req).userId, q);
  }
  @Get('tasks')
  tasks(@Req() req: object, @Query() q: unknown) {
    return this.rest.tasks(getAuth(req).userId, q);
  }
  @Get('tasks/:task')
  task(@Req() req: object, @Param('task') t: string) {
    return this.rest.task(getAuth(req).userId, t);
  }
  @Post('tasks')
  createTask(@Req() req: object, @Body() b: unknown) {
    return this.rest.createTask(getAuth(req).userId, b);
  }
  @Patch('tasks/:task')
  patchTask(@Req() req: object, @Param('task') t: string, @Body() b: unknown) {
    return this.rest.patchTask(getAuth(req).userId, t, b);
  }
  @Get('tasks/:task/comments')
  comments(@Req() req: object, @Param('task') t: string, @Query() q: unknown) {
    return this.rest.comments(getAuth(req).userId, t, q);
  }
  @Post('tasks/:task/comments')
  createComment(@Req() req: object, @Param('task') t: string, @Body() b: unknown) {
    return this.rest.createComment(getAuth(req).userId, t, b);
  }
}
