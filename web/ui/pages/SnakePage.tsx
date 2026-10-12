import { LATEST_SNAKE_VERSION } from '../snake-route';
import { SnakeTemplate } from '../templates/SnakeTemplate';

/** The current Snake page is the map workspace with the v2 game opened on
 * entry. Keeping this route-level wrapper separate gives Storybook and the
 * URL router a real page boundary without duplicating workspace orchestration.
 * The archived v1 game is intentionally not rendered here. */
export function SnakePage() {
  return <SnakeTemplate initialSnakeVersion={LATEST_SNAKE_VERSION} />;
}
