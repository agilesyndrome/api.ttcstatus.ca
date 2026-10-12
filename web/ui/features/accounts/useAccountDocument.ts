import { useEffect, useRef, useState } from 'react';
import { useAccount } from './auth';
import { useActivity } from '../../services/platform/react';
import { readSnapshot, saveSnapshot } from '../../services/cache/snapshots';
import { accountDocumentKey } from './document-cache';

interface Document<T> {
  items: T;
  revision: number;
}
interface Options<T> {
  path: string;
  field: string;
  empty: T;
  valid(value: unknown): value is T;
  unavailable: string;
  conflict: string;
  unsaved: string;
}

/** Revision handling is shared; stop and journal schemas remain owned by their features. */
export function useAccountDocument<T>(options: Options<T>) {
  const account = useAccount();
  const request = useRef(account.request);
  request.current = account.request;
  const activity = useActivity();
  const identity = useRef(account.userId);
  identity.current = account.userId;
  const generation = useRef(0);
  const busy = useRef(false);
  const [state, setState] = useState({
    userId: account.userId,
    items: options.empty,
    revision: 0,
    loaded: false,
    saving: false,
    cached: false,
    error: '',
  });
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    const epoch = ++generation.current;
    const userId = account.userId;
    busy.current = false;
    if (!userId) {
      setState({
        userId,
        items: options.empty,
        revision: 0,
        loaded: false,
        saving: false,
        cached: false,
        error: '',
      });
      return;
    }
    if (!activity.active) return;
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted &&
      generation.current === epoch &&
      identity.current === userId;
    const key = accountDocumentKey(userId, options.path);
    const validDocument = (value: unknown): value is Document<T> => {
      if (!value || typeof value !== 'object') return false;
      const document = value as Partial<Document<T>>;
      return (
        options.valid(document.items) &&
        Number.isSafeInteger(document.revision) &&
        Number(document.revision) >= 0
      );
    };
    void (async () => {
      const cached = await readSnapshot(key, validDocument);
      if (!current()) return;
      const previous = latest.current.userId === userId ? latest.current : undefined;
      setState({
        userId,
        items: previous?.items ?? cached?.value.items ?? options.empty,
        revision: previous?.revision ?? cached?.value.revision ?? 0,
        loaded: Boolean(previous?.loaded || cached),
        saving: false,
        cached: true,
        error: '',
      });
      if (!activity.online) return;
      try {
        const response = await request.current(options.path, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(options.unavailable);
        const body = await response.json();
        const document = {
          items: body[options.field] as unknown,
          revision: body.revision as unknown,
        };
        if (!validDocument(document)) throw new Error(options.unavailable);
        if (!current()) return;
        setState({
          userId,
          ...document,
          loaded: true,
          saving: false,
          cached: false,
          error: '',
        });
        await saveSnapshot(key, { value: document, savedAt: Date.now() });
      } catch (error) {
        if (current())
          setState((previous) => ({
            ...previous,
            error: error instanceof Error ? error.message : options.unavailable,
          }));
      }
    })();
    return () => controller.abort();
    // Feature options are module constants; HTTP function identity may change with a token refresh.
  }, [account.userId, activity.active, activity.online]);
  const current =
    state.userId === account.userId
      ? state
      : { ...state, items: options.empty, loaded: false, cached: false };
  async function change(update: (items: T) => T) {
    if (!account.userId || !current.loaded || current.cached || busy.current)
      return false;
    const items = update(current.items);
    if (!options.valid(items)) return false;
    const userId = account.userId;
    const epoch = generation.current;
    const isCurrent = () => identity.current === userId && generation.current === epoch;
    busy.current = true;
    setState({ ...current, items, saving: true, error: '' });
    try {
      const response = await request.current(options.path, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [options.field]: items, revision: current.revision }),
      });
      if (!response.ok)
        throw new Error(response.status === 409 ? options.conflict : options.unsaved);
      const body = await response.json();
      if (!Number.isSafeInteger(body.revision) || body.revision <= current.revision)
        throw new Error(options.unsaved);
      if (!isCurrent()) return false;
      const document = { items, revision: body.revision as number };
      setState({
        userId,
        ...document,
        loaded: true,
        saving: false,
        cached: false,
        error: '',
      });
      await saveSnapshot(accountDocumentKey(userId, options.path), {
        value: document,
        savedAt: Date.now(),
      });
      return isCurrent();
    } catch (error) {
      if (isCurrent())
        setState({
          ...current,
          saving: false,
          error: error instanceof Error ? error.message : options.unsaved,
        });
      return false;
    } finally {
      if (isCurrent()) busy.current = false;
    }
  }
  return {
    userId: account.userId,
    items: current.items,
    change,
    ready: current.loaded && !current.cached && !current.saving && !busy.current,
    saving: current.saving,
    cached: current.loaded && current.cached,
    error: current.error,
  };
}
