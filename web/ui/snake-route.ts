export const LATEST_SNAKE_VERSION = 2 as const;

export type SnakeVersion = 2;

export function isClassicSnakePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === '/snake/v1' || path.startsWith('/snake/v1/');
}

export function snakeVersionForPath(pathname: string): SnakeVersion | undefined {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (isClassicSnakePath(path)) return undefined;
  if (path === '/snake' || path.startsWith('/snake/')) return LATEST_SNAKE_VERSION;
  return undefined;
}
