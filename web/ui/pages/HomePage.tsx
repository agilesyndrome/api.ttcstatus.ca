import { useLanguage } from '../i18n/react';
import { HomeWorkspace } from '../features/map/HomeWorkspace';
import { useHomeWorkspace } from '../features/map/useHomeWorkspace';
import type { SnakeVersion } from '../snake-route';

export function HomePage({
  initialSnakeVersion,
}: {
  initialSnakeVersion?: SnakeVersion;
}) {
  useLanguage();
  const workspace = useHomeWorkspace(initialSnakeVersion);
  return <HomeWorkspace workspace={workspace} />;
}
