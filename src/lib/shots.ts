import type { Attachment, JobRequest, Model, Shot } from "./api";
import { isArrayInput } from "./params";

export const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

/**
 * Turn a director shot into a job request. "@file" placeholders in media params are matched
 * by filename against the brief's attachments and become uploads; missing files are reported.
 */
export function shotToRequest(
  shot: Shot,
  model: Model,
  briefFiles: string[],
  opts: { projectId: string | null; briefId: string; index: number },
): { req: JobRequest; missing: string[] } {
  const params: Record<string, unknown> = {};
  const attachments: Attachment[] = [];
  const missing: string[] = [];
  const byName = new Map(briefFiles.map((p) => [basename(p).toLowerCase(), p]));

  const resolve = (v: string, param: string) => {
    const name = v.slice(1).trim();
    const path = byName.get(basename(name).toLowerCase());
    if (path) attachments.push({ path, param });
    else missing.push(name);
  };

  for (const [k, v] of Object.entries(shot.params ?? {})) {
    const input = model.inputs.find((i) => i.name === k);
    if (typeof v === "string" && v.startsWith("@")) {
      resolve(v, k);
    } else if (
      Array.isArray(v) &&
      input &&
      isArrayInput(input) &&
      v.some((x) => typeof x === "string" && x.startsWith("@"))
    ) {
      const rest = v.filter((x) => !(typeof x === "string" && x.startsWith("@")));
      v.filter((x): x is string => typeof x === "string" && x.startsWith("@")).forEach((x) => resolve(x, k));
      if (rest.length) params[k] = rest;
    } else {
      params[k] = v;
    }
  }
  return {
    req: {
      model_id: shot.model_id,
      params,
      attachments,
      project_id: opts.projectId,
      source: "brief",
      brief_id: opts.briefId,
      shot_index: opts.index,
    },
    missing,
  };
}

/** Request to re-run a finished job with the same settings (new idempotency key server-side). */
export function retryRequest(job: {
  id: string;
  model_id: string;
  params: Record<string, unknown>;
  attachments: Attachment[];
  project_id: string | null;
}): JobRequest {
  return {
    model_id: job.model_id,
    params: { ...job.params },
    attachments: job.attachments.map((a) => ({ path: a.path, param: a.param })),
    project_id: job.project_id,
    retry_of: job.id,
  };
}
