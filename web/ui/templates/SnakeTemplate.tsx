import { useLanguage } from '../i18n/react';
import { HomeWorkspace } from '../features/map/HomeWorkspace';
import { useHomeWorkspace } from '../features/map/useHomeWorkspace';
import type { SnakeVersion } from '../snake-route';

export interface SnakeTemplateProps {
  initialSnakeVersion: SnakeVersion;
}

/** The map application template with the current Snake game opened on entry. */
export function SnakeTemplate({ initialSnakeVersion }: SnakeTemplateProps) {
  useLanguage();
  const workspace = useHomeWorkspace(initialSnakeVersion);
  return <HomeWorkspace workspace={workspace} />;
}
