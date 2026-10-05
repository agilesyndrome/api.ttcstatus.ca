import { useLanguage } from '../i18n/react';
import { HomeWorkspace } from '../features/map/HomeWorkspace';
import { useHomeWorkspace } from '../features/map/useHomeWorkspace';

export function HomePage() {
  useLanguage();
  const workspace = useHomeWorkspace();
  return <HomeWorkspace workspace={workspace} />;
}
