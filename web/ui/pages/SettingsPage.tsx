import { ProfilePage } from './ProfilePage';

/** Canonical settings shortcut. ProfilePage remains available for the legacy
 * `/profile` URL, while the app's navigation and new links use `/settings`. */
export function SettingsPage() {
  return <ProfilePage />;
}
