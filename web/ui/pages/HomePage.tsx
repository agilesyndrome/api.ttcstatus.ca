import { HomeWorkspace } from '../features/map/HomeWorkspace';
import { useHomeWorkspace } from '../features/map/useHomeWorkspace';

export function HomePage() {
  const workspace = useHomeWorkspace();
  return <HomeWorkspace workspace={workspace} />;
}
