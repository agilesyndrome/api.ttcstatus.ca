import { useEffect, useRef, useState } from 'react';
import { useAccount } from './auth';
import { useActivity } from '../../services/platform/react';
import { readSnapshot, saveSnapshot } from '../../services/cache/snapshots';
import { accountDocumentKey } from './document-cache';
import {
  readAccountDocument,
  writeAccountDocument,
  type PendingEdit,
} from './document-write';

interface Document<T> {
  items: T;
  revision: number;
  pending?: PendingEdit<T>;
}
interface Options<T> {
  path: string;
  field: string;
  empty: T;
  valid(value: unknown): value is T;
  merge(base: T, draft: T, current: T, preferDraft?: boolean): T | null;
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
  const mutation = useRef<AbortController | undefined>(undefined);
  const [state, setState] = useState({
    userId: account.userId,
    items: options.empty,
    revision: 0,
    loaded: false,
    saving: false,
    cached: false,
    error: '',
    pending: undefined as PendingEdit<T> | undefined,
  });
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    mutation.current?.abort();
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
        pending: undefined,
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
        Number(document.revision) >= 0 &&
        (document.pending === undefined ||
          (document.pending !== null &&
            typeof document.pending === 'object' &&
            options.valid(document.pending.base) &&
            options.valid(document.pending.items)))
      );
    };
    void (async () => {
      const cached = await readSnapshot(key, validDocument);
      if (!current()) return;
      const previous =
        latest.current.userId === userId && latest.current.loaded
          ? latest.current
          : undefined;
      const pending = previous?.pending ?? cached?.value.pending;
      setState({
        userId,
        items: previous?.items ?? cached?.value.items ?? options.empty,
        revision: previous?.revision ?? cached?.value.revision ?? 0,
        loaded: Boolean(previous?.loaded || cached),
        saving: false,
        cached: true,
        error: '',
        pending,
      });
      if (!activity.online) return;
      try {
        const response = await request.current(options.path, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(options.unavailable);
        const document = readAccountDocument(await response.json(), options);
        if (!document) throw new Error(options.unavailable);
        if (!current()) return;
        setState({
          userId,
          ...document,
          loaded: true,
          saving: false,
          cached: false,
          error: '',
          pending,
        });
        await saveSnapshot(key, { value: { ...document, pending }, savedAt: Date.now() });
      } catch (error) {
        if (current())
          setState((previous) => ({
            ...previous,
            error: error instanceof Error ? error.message : options.unavailable,
          }));
      }
    })();
    return () => {
      controller.abort();
      mutation.current?.abort();
    };
    // Feature options are module constants; HTTP function identity may change with a token refresh.
  }, [account.userId, activity.active, activity.online]);
  const current =
    state.userId === account.userId
      ? state
      : { ...state, items: options.empty, loaded: false, cached: false };
  async function commit(pending: PendingEdit<T>, preferDraft = false) {
    if (
      !account.userId ||
      !current.loaded ||
      current.cached ||
      busy.current ||
      !activity.online
    )
      return false;
    const userId = account.userId;
    const epoch = generation.current;
    const isCurrent = () => identity.current === userId && generation.current === epoch;
    const key = accountDocumentKey(userId, options.path);
    const controller = new AbortController();
    mutation.current = controller;
    busy.current = true;
    setState({ ...current, saving: true, pending, error: '' });
    try {
      // Persist before PUT so a disconnect or cold restart cannot erase the draft.
      await saveSnapshot(key, {
        value: { items: current.items, revision: current.revision, pending },
        savedAt: Date.now(),
      });
      if (!isCurrent()) return false;
      const result = await writeAccountDocument(
        request.current,
        options,
        current,
        pending,
        preferDraft,
        isCurrent,
        controller.signal,
      );
      if (!isCurrent()) return false;
      const retained = result.saved ? undefined : pending;
      setState({
        userId,
        ...result.document,
        pending: retained,
        loaded: true,
        saving: false,
        cached: false,
        error: result.saved ? '' : options.conflict,
      });
      await saveSnapshot(key, {
        value: { ...result.document, pending: retained },
        savedAt: Date.now(),
      });
      return result.saved && isCurrent();
    } catch {
      if (isCurrent())
        setState({ ...current, pending, saving: false, error: options.unsaved });
      return false;
    } finally {
      if (isCurrent()) busy.current = false;
    }
  }
  function change(update: (items: T) => T) {
    if (current.pending) return Promise.resolve(false);
    const items = update(current.items);
    if (!options.valid(items)) return Promise.resolve(false);
    return commit({ base: current.items, items });
  }
  function retryDraft(preferDraft = false) {
    return current.pending
      ? commit(current.pending, preferDraft)
      : Promise.resolve(false);
  }
  async function discardDraft() {
    if (!account.userId || busy.current) return;
    setState({ ...current, pending: undefined, error: '' });
    await saveSnapshot(accountDocumentKey(account.userId, options.path), {
      value: { items: current.items, revision: current.revision },
      savedAt: Date.now(),
    });
  }
  return {
    userId: account.userId,
    items: current.items,
    change,
    ready:
      current.loaded &&
      !current.cached &&
      !current.saving &&
      !busy.current &&
      !current.pending,
    hasDraft: Boolean(current.pending),
    canRetryDraft:
      current.loaded && !current.cached && !current.saving && activity.online,
    retryDraft,
    discardDraft,
    saving: current.saving,
    cached: current.loaded && current.cached,
    error: current.error,
  };
}
