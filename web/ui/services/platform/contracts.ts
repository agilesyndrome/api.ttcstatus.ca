/** Device capabilities are ports, not globals embedded in feature components. */
export type Unsubscribe = () => void;
export interface Position {
  latitude: number;
  longitude: number;
  accuracy?: number;
}
export type LocationFailure = 'unavailable' | 'denied' | 'timeout' | 'failed';
export class LocationError extends Error {
  constructor(readonly reason: LocationFailure) {
    super(reason);
  }
}
export interface PreferenceStore {
  /** Immediate browser reads avoid a preference flash; native reads hydrate asynchronously. */
  peek(key: string): string | null;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface CacheStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface Activity {
  active: boolean;
  online: boolean;
}
export interface Reminder {
  id: number;
  title: string;
  body: string;
  at: Date;
  /** An internal route understood by the same router as shared map links. */
  destination: string;
}
export interface PlatformServices {
  native: boolean;
  location: { current(): Promise<Position> };
  preferences: PreferenceStore;
  cache: CacheStore;
  lifecycle: {
    current(): Activity;
    subscribe(listener: (state: Activity) => void): Unsubscribe;
    subscribeLinks(listener: (url: string) => void): Unsubscribe;
  };
  sharing: {
    share(url: string, title: string): Promise<'shared' | 'copied'>;
    download(contents: string, filename: string, type: string): Promise<void>;
  };
  notifications: {
    available: boolean;
    requestPermission(): Promise<boolean>;
    schedule(reminder: Reminder): Promise<void>;
    cancel(id: number): Promise<void>;
  };
}
