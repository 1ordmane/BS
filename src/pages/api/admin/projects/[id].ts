import type { APIRoute } from 'astro';
import { handle, intParam, readJson } from '@/server/http';
import { deleteProject, publishProblems, updateProject } from '@/server/projects';

/** Saves the texts. `version` protects against overwriting a save made in another tab. */
export const PUT: APIRoute = ({ params, request, locals }) =>
  handle(async () => {
    const body = await readJson(request);
    const project = updateProject(intParam(params.id), body.data, body.version, locals.session!.user.id);
    return { project, problems: publishProblems(project) };
  });

export const DELETE: APIRoute = ({ params, locals }) =>
  handle(() => {
    deleteProject(intParam(params.id), locals.session!.user.id);
    return { ok: true };
  });
