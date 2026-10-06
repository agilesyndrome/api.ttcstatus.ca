export const LATEST_SNAKE_VERSION = 2 as const;

export type SnakeVersion = 2;

const VERSION_PATHS: Record<string, SnakeVersion> = {
  '/snake/v2': 2,
};

export function snakeVersionForPath(pathname: string): SnakeVersion | undefined {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/snake') return LATEST_SNAKE_VERSION;
  return VERSION_PATHS[path];
}
