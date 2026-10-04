import { useEffect, useRef, useState } from 'react';
import { AccountRequired, AuthControls, useAccount } from '../features/accounts/auth';

export function ProfilePage() {
  const account = useAccount();
  return (
    <>
      <header className="account-header">
        <a className="account-link" href="/">
          ← TTC status
        </a>
        <AuthControls />
      </header>
      <main className="profile-page">
        <AccountRequired>
          <ProfileSettings key={account.userId} />
        </AccountRequired>
      </main>
    </>
  );
}
function ProfileSettings() {
  const account = useAccount();
  const request = useRef(account.request);
  request.current = account.request;
  const [username, setUsername] = useState('');
  const [publicBadges, setPublicBadges] = useState(false);
  const [saved, setSaved] = useState<{ username: string; publicBadges: boolean }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setSaved(undefined);
    setUsername('');
    setPublicBadges(false);
    setMessage('');
    void request
      .current('/api/v1/me/profile')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load your profile. Try again.');
        const profile = (await response.json()) as {
          username: string;
          publicBadges: boolean;
        };
        if (!cancelled) {
          setUsername(profile.username);
          setPublicBadges(profile.publicBadges);
          setSaved(profile);
        }
      })
      .catch((error) => {
        if (!cancelled) setMessage(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [account.userId, retry]);
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await account.request('/api/v1/me/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim().toLowerCase(), publicBadges }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? 'That username is taken. Choose another.'
            : 'Unable to save your profile. Please try again.',
        );
      const profile = (await response.json()) as {
        username: string;
        publicBadges: boolean;
      };
      setUsername(profile.username);
      setSaved(profile);
      setMessage('Profile saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save your profile.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">Your corner of the city</p>
      <h1>Your profile.</h1>
      <p className="helper">
        Choose a username and decide whether to share your accomplishments.
      </p>
      {message && (
        <p className="tip" role="status">
          {message}
        </p>
      )}
      {!saved ? (
        <>
          <p>Loading profile…</p>
          {message && (
            <button
              className="action-button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again
            </button>
          )}
        </>
      ) : (
        <form className="tool-form" onSubmit={save}>
          <fieldset disabled={busy}>
            <div className="form-control">
              <label htmlFor="profile-username">Username</label>
              <input
                id="profile-username"
                autoComplete="username"
                required
                minLength={3}
                maxLength={30}
                pattern="[a-z0-9][a-z0-9_-]{2,29}"
                value={username}
                onChange={(event) => setUsername(event.target.value.toLowerCase())}
                aria-describedby="username-help"
              />
              <p id="username-help" className="microcopy">
                3–30 lowercase letters, numbers, underscores or hyphens. Start with a
                letter or number.
              </p>
            </div>
            <label className="privacy-choice">
              <input
                type="checkbox"
                checked={publicBadges}
                onChange={(event) => setPublicBadges(event.target.checked)}
              />{' '}
              Show my profile and earned badges publicly
            </label>
            <p className="microcopy">
              Off by default. When enabled, anyone with your profile link can see your
              username and earned badges. Journal notes, saved cars, dates and account
              details remain private. You can turn sharing off at any time.
            </p>
            <button className="action-button" type="submit">
              {busy ? 'Saving…' : 'Save profile'}
            </button>
          </fieldset>
        </form>
      )}
      {saved?.publicBadges && (
        <p>
          <a className="account-link" href={`/u/${saved.username}#badges`}>
            View your public badges →
          </a>
        </p>
      )}
      <p>
        <a className="account-link" href="/#view=journal">
          Open your Journal →
        </a>
      </p>
    </>
  );
}

export function PublicProfilePage({ username }: { username: string }) {
  const [profile, setProfile] = useState<{
    username: string;
    badges: { name: string; icon: string; description: string }[];
  }>();
  const [message, setMessage] = useState('Loading profile…');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/profiles/${encodeURIComponent(username)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? 'This profile is private or does not exist.'
              : 'Unable to load this profile. Please try again.',
          );
        setProfile(await response.json());
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, [username]);
  return (
    <>
      <header className="account-header">
        <a className="account-link" href="/">
          ← TTC status
        </a>
        <AuthControls />
      </header>
      <main className="profile-page">
        {profile ? (
          <>
            <p className="eyebrow">Streetcar collector</p>
            <h1>@{profile.username}</h1>
            <section id="badges">
              <h2>Accomplishments</h2>
              <p className="microcopy">
                Badges celebrate a manually saved streetcar collection.
              </p>
              <div className="journal-badges">
                {profile.badges.map((badge) => (
                  <article className="journal-badge earned" key={badge.name}>
                    <span aria-hidden="true">{badge.icon}</span>
                    <div>
                      <strong>{badge.name}</strong>
                      <small>{badge.description}</small>
                    </div>
                  </article>
                ))}
              </div>
              {!profile.badges.length && (
                <p className="helper">The first badge is still ahead.</p>
              )}
            </section>
          </>
        ) : (
          <p role="status">{message}</p>
        )}
      </main>
    </>
  );
}
