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
  Put,
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
  @Post('tasks/batch')
  @HttpCode(200)
  batchTasks(@Req() req: object, @Body() b: unknown) {
    return this.rest.batchTasks(getAuth(req).userId, b, getAuth(req).tokenId);
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
  @Patch('comments/:id')
  patchComment(@Req() req: object, @Param('id') id: string, @Body() b: unknown) {
    return this.rest.patchComment(getAuth(req).userId, id, b, getAuth(req).tokenId);
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
  getDoc(@Req() req: object, @Param('id') id: string, @Query() q: unknown) {
    return this.rest.doc(getAuth(req).userId, id, q);
  }
  @Post('docs')
  createDoc(@Req() req: object, @Body() b: unknown) {
    return this.rest.createDoc(getAuth(req).userId, b, getAuth(req).tokenId);
  }
  @Patch('docs/:id')
  updateDoc(@Req() req: object, @Param('id') id: string, @Body() b: unknown) {
    return this.rest.updateDoc(getAuth(req).userId, id, b, getAuth(req).tokenId);
  }
  @Get('docs/:id/comments')
  docComments(@Req() req: object, @Param('id') id: string) {
    return this.rest.docComments(getAuth(req).userId, id);
  }
  @Post('docs/:id/comments')
  createDocComment(@Req() req: object, @Param('id') id: string, @Body() b: unknown) {
    return this.rest.createDocComment(getAuth(req).userId, id, b, getAuth(req).tokenId);
  }
  @Post('docs/:id/comments/:cid/resolve')
  @HttpCode(200)
  resolveDocComment(@Req() req: object, @Param('id') id: string, @Param('cid') cid: string) {
    return this.rest.resolveDocComment(getAuth(req).userId, id, cid, getAuth(req).tokenId);
  }
  @Post('docs/:id/patch')
  @HttpCode(200)
  patchDocPage(@Req() req: object, @Param('id') id: string, @Body() b: unknown) {
    return this.rest.patchDocPage(getAuth(req).userId, id, b, getAuth(req).tokenId);
  }
  @Post('docs/:id/tasks')
  linkDocTask(@Req() req: object, @Param('id') id: string, @Body() b: unknown) {
    return this.rest.linkDocTask(getAuth(req).userId, id, b, getAuth(req).tokenId);
  }
  @Get('projects/:id/automations')
  automations(@Req() req: object, @Param('id') id: string) {
    return this.rest.automations(getAuth(req).userId, id);
  }

  // project settings (PLNRAPP-266): one mutation as the user; ids come from the path
  private set(req: object, mutator: string, input: object) {
    return this.rest.setting(getAuth(req).userId, mutator, input, getAuth(req).tokenId);
  }
  private async unset(req: object, mutator: string, input: object) {
    await this.set(req, mutator, input);
  }
  @Patch('projects/:id')
  updateProject(@Req() req: object, @Param('id') id: string, @Body() b: object) {
    return this.set(req, 'project.update', { ...b, id });
  }
  @Put('projects/:id/modules/:moduleId')
  setModule(
    @Req() req: object,
    @Param('id') id: string,
    @Param('moduleId') moduleId: string,
    @Body() b: object,
  ) {
    return this.rest.setModule(
      getAuth(req).userId,
      { ...b, projectId: id, moduleId },
      getAuth(req).tokenId,
    );
  }
  @Post('projects/:id/statuses')
  createStatus(@Req() req: object, @Param('id') id: string, @Body() b: object) {
    return this.set(req, 'status.create', { ...b, projectId: id });
  }
  @Patch('statuses/:id')
  updateStatus(@Req() req: object, @Param('id') id: string, @Body() b: object) {
    return this.set(req, 'status.update', { ...b, id });
  }
  @Delete('statuses/:id')
  @HttpCode(204)
  deleteStatus(@Req() req: object, @Param('id') id: string, @Query() q: object) {
    return this.unset(req, 'status.delete', { ...q, id });
  }
  @Post('projects/:id/labels')
  createLabel(@Req() req: object, @Param('id') id: string, @Body() b: object) {
    return this.set(req, 'label.create', { ...b, projectId: id });
  }
  @Patch('labels/:id')
  updateLabel(@Req() req: object, @Param('id') id: string, @Body() b: object) {
    return this.set(req, 'label.update', { ...b, id });
  }
  @Delete('labels/:id')
  @HttpCode(204)
  deleteLabel(@Req() req: object, @Param('id') id: string) {
    return this.unset(req, 'label.delete', { id });
  }
  @Post('projects/:id/fields')
  createField(@Req() req: object, @Param('id') id: string, @Body() b: object) {
    return this.set(req, 'field.create', { ...b, projectId: id });
  }
  @Patch('fields/:id')
  updateField(@Req() req: object, @Param('id') id: string, @Body() b: object) {
    return this.set(req, 'field.update', { ...b, id });
  }
  @Delete('fields/:id')
  @HttpCode(204)
  deleteField(@Req() req: object, @Param('id') id: string) {
    return this.unset(req, 'field.delete', { id });
  }
  @Post('projects/:id/automations')
  createAutomation(@Req() req: object, @Param('id') id: string, @Body() b: object) {
    return this.set(req, 'automations.create', { ...b, projectId: id });
  }
  @Patch('automations/:id')
  updateAutomation(@Req() req: object, @Param('id') id: string, @Body() b: object) {
    return this.set(req, 'automations.update', { ...b, id });
  }
  @Delete('automations/:id')
  @HttpCode(204)
  deleteAutomation(@Req() req: object, @Param('id') id: string) {
    return this.unset(req, 'automations.delete', { id });
  }
  @Get('projects/:id/ai-actions')
  aiActions(@Req() req: object, @Param('id') id: string) {
    return this.rest.aiActions(getAuth(req).userId, id);
  }
  @Post('projects/:id/ai-actions')
  createAiAction(@Req() req: object, @Param('id') id: string, @Body() b: object) {
    return this.set(req, 'ai.action.create', { ...b, projectId: id });
  }
  @Patch('ai-actions/:id')
  updateAiAction(@Req() req: object, @Param('id') id: string, @Body() b: object) {
    return this.set(req, 'ai.action.update', { ...b, id });
  }
  @Delete('ai-actions/:id')
  @HttpCode(204)
  deleteAiAction(@Req() req: object, @Param('id') id: string) {
    return this.unset(req, 'ai.action.delete', { id });
  }
}
