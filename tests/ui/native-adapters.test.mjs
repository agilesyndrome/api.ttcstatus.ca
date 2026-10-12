import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { createNativeLocation, createNativeLifecycle, createNativeNotifications } =
  await compileModules(`
  export { createNativeLocation } from './web/ui/services/platform/capacitor/location';
  export { createNativeLifecycle } from './web/ui/services/platform/capacitor/lifecycle';
  export { createNativeNotifications } from './web/ui/services/platform/capacitor/notifications';
`);

test('native location uses the device plugin and normalizes permission and timeout failures', async () => {
  const device = createNativeLocation({
    getCurrentPosition: async (options) => {
      assert.equal(options.timeout, 10000);
      return { coords: { latitude: 43.65, longitude: -79.4, accuracy: 12 } };
    },
  });
  assert.deepEqual(await device.current(), {
    latitude: 43.65,
    longitude: -79.4,
    accuracy: 12,
  });
  for (const [code, reason] of [
    ['OS-PLUG-GLOC-0003', 'denied'],
    ['OS-PLUG-GLOC-0010', 'timeout'],
    ['OS-PLUG-GLOC-0007', 'unavailable'],
  ]) {
    await assert.rejects(
      createNativeLocation({
        getCurrentPosition: async () => {
          throw { code };
        },
      }).current(),
      (error) => error.reason === reason,
    );
  }
});

test('native lifecycle preserves cold launch links and broadcasts device activity and connectivity', async () => {
  const appListeners = new Map();
  const networkListeners = new Map();
  const service = await createNativeLifecycle(
    {
      getState: async () => ({ isActive: true }),
      getLaunchUrl: async () => ({ url: 'https://ttcstatus.ca/#stop=stop%3A1436' }),
      addListener: async (name, listener) => {
        appListeners.set(name, listener);
      },
    },
    {
      getStatus: async () => ({ connected: true }),
      addListener: async (name, listener) => {
        networkListeners.set(name, listener);
      },
    },
  );
  const states = [];
  const urls = [];
  const stopActivity = service.subscribe((state) => states.push(state));
  const stopLinks = service.subscribeLinks((url) => urls.push(url));
  assert.equal(urls.length, 1);
  appListeners.get('appStateChange')({ isActive: false });
  networkListeners.get('networkStatusChange')({ connected: false });
  appListeners.get('appUrlOpen')({ url: 'https://ttcstatus.ca/settings' });
  assert.deepEqual(service.current(), { active: false, online: false });
  assert.equal(states.length, 2);
  assert.equal(urls.length, 2);
  stopActivity();
  stopLinks();
  appListeners.get('appStateChange')({ isActive: true });
  assert.equal(states.length, 2, 'unmounted screens remove their bus subscriptions');
});

test('local notification scheduling uses native delivery and preserves the tap destination', async () => {
  let tapped;
  const scheduled = [];
  const cancelled = [];
  const opened = [];
  const service = await createNativeNotifications((url) => opened.push(url), {
    addListener: async (_name, listener) => {
      tapped = listener;
    },
    requestPermissions: async () => ({ display: 'granted' }),
    schedule: async (value) => scheduled.push(value),
    cancel: async (value) => cancelled.push(value),
  });
  assert.equal(await service.requestPermission(), true);
  const reminder = {
    id: 1,
    title: 'My stop',
    body: 'Time to leave',
    at: new Date(Date.now() + 60000),
    destination: '/#stop=stop%3A1436',
  };
  await service.schedule(reminder);
  assert.equal(scheduled[0].notifications[0].extra.destination, reminder.destination);
  tapped({ notification: scheduled[0].notifications[0] });
  assert.deepEqual(opened, [reminder.destination]);
  await service.cancel(1);
  assert.deepEqual(cancelled, [{ notifications: [{ id: 1 }] }]);
  await assert.rejects(service.schedule({ ...reminder, at: new Date(0) }));
  assert.equal(scheduled.length, 1);
});
