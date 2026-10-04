import assert from 'node:assert/strict';

/** Browser-only SDK/session fixture. Server cryptographic verification has separate tests. */
export async function installAccountFixture(context, { signedIn = false } = {}) {
  const journals = new Map();
  const profiles = new Map();
  await context.addInitScript((value) => {
    let saved = null;
    try {
      saved = sessionStorage.getItem('fixture-account');
    } catch {
      /* about:blank or blocked browser storage */
    }
    window.__testUser =
      saved === 'signed-out' ? null : (saved ?? (value ? 'user_a' : null));
  }, signedIn);
  await context.route('**/api/v1/auth/config', (route) =>
    route.fulfill({ json: { enabled: true, publishableKey: 'pk_test_fixture' } }),
  );
  await context.route('**/@clerk_react.js*', async (route) => {
    // Reuse Vite's resolved React import so the fixture shares the renderer's instance.
    const original = await route.fetch();
    const source = await original.text();
    const reactImport = /from ["']([^"']*\/react\.js(?:\?[^"']*)?)["']/.exec(source)?.[1];
    assert.ok(reactImport, 'Clerk fixture requires the resolved React module');
    const reactUrl = new URL(reactImport, route.request().url());
    return route.fulfill({
      contentType: 'application/javascript',
      body: `
      import React from ${JSON.stringify(reactUrl.href)};
      export const ClerkProvider = ({children}) => children;
      export function useAuth() {
        const [userId, setUser] = React.useState(window.__testUser);
        React.useEffect(() => { const update = () => { setUser(window.__testUser); try { sessionStorage.setItem('fixture-account', window.__testUser ?? 'signed-out'); } catch {} }; window.addEventListener('fixture-account', update); return () => window.removeEventListener('fixture-account', update); }, []);
        return {isLoaded: true, userId, getToken: async () => window.__testUser ? 'fixture:' + window.__testUser : null};
      }
      const switchAccount = value => { window.__testUser = value; window.dispatchEvent(new Event('fixture-account')); };
      export const useClerk = () => ({openSignIn: () => switchAccount('user_a'), openSignUp: () => switchAccount('user_a')});
      export const UserButton = () => React.createElement('button', {onClick: () => switchAccount(null), 'aria-label': 'Sign out'}, 'Account');
    `,
    });
  });
  await context.route('**/api/v1/me/*', async (route) => {
    const request = route.request();
    const authorization = request.headers().authorization;
    assert.ok(
      authorization?.startsWith('Bearer fixture:'),
      'account API requires the session bearer token',
    );
    const userId = authorization.slice('Bearer fixture:'.length);
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/journal')) {
      const current = journals.get(userId) ?? { entries: [], revision: 0 };
      if (request.method() === 'GET') return route.fulfill({ json: current });
      const update = request.postDataJSON();
      if (update.revision !== current.revision)
        return route.fulfill({ status: 409, json: { error: 'journal-conflict' } });
      journals.set(userId, { entries: update.entries, revision: current.revision + 1 });
      return route.fulfill({ json: { revision: current.revision + 1 } });
    }
    if (request.method() === 'GET')
      return route.fulfill({
        json: profiles.get(userId) ?? { username: '', publicBadges: false },
      });
    const profile = request.postDataJSON();
    profiles.set(userId, profile);
    return route.fulfill({ json: profile });
  });
  return { journals, profiles };
}
