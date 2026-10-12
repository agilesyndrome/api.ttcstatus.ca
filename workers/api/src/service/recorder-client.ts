import type { Env } from '../env';

/** Every consumer addresses the same globally serialized feed owner. */
export const SERVICE_RECORDER_NAME = 'service-recorder';
export function recorderFetch(env: Env, path: string): Promise<Response> {
  const id = env.SERVICE_RECORDER.idFromName(SERVICE_RECORDER_NAME);
  return env.SERVICE_RECORDER.get(id).fetch(`https://service-recorder.internal${path}`);
}
