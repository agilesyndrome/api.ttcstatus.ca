import { abortable } from './cancellation';
import { completedResponse } from './response';
import { apiUrl } from './config';

export type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;
export interface ClientOptions {
  origin?: string;
  token?: () => Promise<string | null>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  credentials?: RequestCredentials;
}

/** One transport seam for browser hooks, native account adapters, and deterministic tests. */
export function createApiClient(options: ClientOptions = {}): ApiRequest {
  return async (path, init = {}) => {
    const headers = new Headers(init.headers);
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new TypeError('Request timed out')),
      options.timeoutMs ?? 15000,
    );
    try {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (options.token) {
        const token = await abortable(options.token(), controller.signal);
        if (!token) throw new Error('account.yourSessionHasEndedSignInAgain');
        headers.set('authorization', `Bearer ${token}`);
      }
      const response = await abortable(
        (options.fetch ?? fetch)(apiUrl(path, options.origin), {
          ...init,
          headers,
          signal: controller.signal,
          cache: init.cache ?? 'no-store',
          credentials: init.credentials ?? options.credentials ?? 'same-origin',
        }),
        controller.signal,
      );
      return await completedResponse(response, controller.signal);
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
    }
  };
}

export const apiRequest = createApiClient();
