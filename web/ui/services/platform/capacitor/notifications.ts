import { LocalNotifications } from '@capacitor/local-notifications';
import type { PlatformServices } from '../contracts';

export async function createNativeNotifications(
  open: (url: string) => void,
  plugin = LocalNotifications,
): Promise<PlatformServices['notifications']> {
  await plugin.addListener('localNotificationActionPerformed', ({ notification }) => {
    const destination: unknown = notification.extra?.destination;
    if (typeof destination === 'string') open(destination);
  });
  return {
    available: true,
    async requestPermission() {
      return (await plugin.requestPermissions()).display === 'granted';
    },
    async schedule(reminder) {
      if (
        !Number.isSafeInteger(reminder.id) ||
        reminder.id <= 0 ||
        !Number.isFinite(reminder.at.getTime()) ||
        reminder.at.getTime() <= Date.now()
      )
        throw new Error('Reminder needs a positive identifier and a future date');
      await plugin.schedule({
        notifications: [
          {
            id: reminder.id,
            title: reminder.title,
            body: reminder.body,
            schedule: { at: reminder.at },
            extra: { destination: reminder.destination },
          },
        ],
      });
    },
    async cancel(id) {
      await plugin.cancel({ notifications: [{ id }] });
    },
  };
}
