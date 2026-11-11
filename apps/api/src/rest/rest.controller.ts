import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
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
  @Get('projects/:id/fields')
  fields(@Req() req: object, @Param('id') id: string) {
    return this.rest.fields(getAuth(req).userId, id);
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
    return this.rest.createTask(getAuth(req).userId, b, getAuth(req).tokenId);
  }
  @Patch('tasks/:task')
  patchTask(@Req() req: object, @Param('task') t: string, @Body() b: unknown) {
    return this.rest.patchTask(getAuth(req).userId, t, b, getAuth(req).tokenId);
  }
  @Get('tasks/:task/comments')
  comments(@Req() req: object, @Param('task') t: string, @Query() q: unknown) {
    return this.rest.comments(getAuth(req).userId, t, q);
  }
  @Post('tasks/:task/comments')
  createComment(@Req() req: object, @Param('task') t: string, @Body() b: unknown) {
    return this.rest.createComment(getAuth(req).userId, t, b, getAuth(req).tokenId);
  }
  @Get('tasks/:task/links')
  links(@Req() req: object, @Param('task') t: string) {
    return this.rest.links(getAuth(req).userId, t);
  }
  @Post('tasks/:task/links')
  createLink(@Req() req: object, @Param('task') t: string, @Body() b: unknown) {
    return this.rest.createLink(getAuth(req).userId, t, b, getAuth(req).tokenId);
  }
  @Delete('links/:id')
  @HttpCode(204)
  async deleteLink(@Req() req: object, @Param('id') id: string) {
    await this.rest.deleteLink(getAuth(req).userId, id, getAuth(req).tokenId);
  }
  @Get('time-entries')
  timeEntries(@Req() req: object, @Query() q: unknown) {
    return this.rest.timeEntries(getAuth(req).userId, q);
  }
  @Post('time-entries')
  logTime(@Req() req: object, @Body() b: unknown) {
    return this.rest.logTime(getAuth(req).userId, b, getAuth(req).tokenId);
  }
  @Get('timer')
  timer(@Req() req: object) {
    return this.rest.timer(getAuth(req).userId);
  }
  @Post('timer/start')
  startTimer(@Req() req: object, @Body() b: unknown) {
    return this.rest.startTimer(getAuth(req).userId, b, getAuth(req).tokenId);
  }
  @Post('timer/stop')
  @HttpCode(200)
  stopTimer(@Req() req: object) {
    return this.rest.stopTimer(getAuth(req).userId, getAuth(req).tokenId);
  }
  @Get('projects/:id/cycles')
  cycles(@Req() req: object, @Param('id') id: string) {
    return this.rest.cycles(getAuth(req).userId, id);
  }
  @Get('projects/:id/cycles/current')
  currentCycle(@Req() req: object, @Param('id') id: string) {
    return this.rest.currentCycle(getAuth(req).userId, id);
  }
  @Get('docs')
  docs(@Req() req: object, @Query() q: unknown) {
    return this.rest.docs(getAuth(req).userId, q);
  }
  @Get('docs/:id')
  getDoc(@Req() req: object, @Param('id') id: string) {
    return this.rest.doc(getAuth(req).userId, id);
  }
  @Post('docs')
  createDoc(@Req() req: object, @Body() b: unknown) {
    return this.rest.createDoc(getAuth(req).userId, b, getAuth(req).tokenId);
  }
  @Patch('docs/:id')
  updateDoc(@Req() req: object, @Param('id') id: string, @Body() b: unknown) {
    return this.rest.updateDoc(getAuth(req).userId, id, b, getAuth(req).tokenId);
  }
  @Post('docs/:id/tasks')
  linkDocTask(@Req() req: object, @Param('id') id: string, @Body() b: unknown) {
    return this.rest.linkDocTask(getAuth(req).userId, id, b, getAuth(req).tokenId);
  }
  @Get('projects/:id/automations')
  automations(@Req() req: object, @Param('id') id: string) {
    return this.rest.automations(getAuth(req).userId, id);
  }
}
