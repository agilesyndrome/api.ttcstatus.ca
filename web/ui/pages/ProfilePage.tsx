import { english } from '../../../shared/i18n/messages';
import { LanguageSettings } from '../components/LanguageSettings';
import { t } from '../i18n';
import { useLanguage } from '../i18n/react';
import { useEffect, useRef, useState } from 'react';
import { AccountRequired, useAccount } from '../features/accounts/auth';
import { SiteHeader } from '../components/SiteHeader';
import { UserProfile } from '@clerk/react';

export function ProfilePage() {
  useLanguage();
  const account = useAccount();
  const [showClerkSettings, setShowClerkSettings] = useState(false);
  return (
    <>
      <SiteHeader current="settings" />
      <main className="profile-page">
        {/* Language preference is browser-local: the settings' own copy says
         * no account is required, so it must not sit behind the sign-in. */}
        <LanguageSettings />
        <AccountRequired>
          <ProfileSettings key={account.userId} />
          {!showClerkSettings && (
            <button
              className="action-button"
              type="button"
              onClick={() => setShowClerkSettings(true)}
            >
              {t('profile.usernameAndPassword')}
            </button>
          )}
          {showClerkSettings && (
            <section className="profile-clerk-settings">
              <h2>{t('profile.accountSettings')}</h2>
              <UserProfile routing="hash" />
            </section>
          )}
        </AccountRequired>
      </main>
    </>
  );
}
function ProfileSettings() {
  useLanguage();
  const account = useAccount();
  const request = useRef(account.request);
  request.current = account.request;
  const [username, setUsername] = useState('');
  const [publicBadges, setPublicBadges] = useState(false);
  const [saved, setSaved] = useState<{ username: string; publicBadges: boolean }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    setSaved(undefined);
    setUsername('');
    setPublicBadges(false);
    setMessage('');
    void request
      .current('/api/v1/me/profile')
      .then(async (response) => {
        if (!response.ok) throw new Error('profile.unavailable');
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
  }, [account.userId]);
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
            ? english('profile.thatUsernameIsTakenChooseAnother')
            : english('profile.unableToSaveYourProfilePleaseTryAgain'),
        );
      const profile = (await response.json()) as {
        username: string;
        publicBadges: boolean;
      };
      setUsername(profile.username);
      setSaved(profile);
      setMessage(english('profile.profileSaved'));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : english('profile.unableToSaveYourProfile'),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">{t('profile.yourCornerOfTheCity')}</p>
      <h1>{t('profile.yourProfile')}</h1>
      <p className="helper">
        {t('profile.chooseAUsernameAndDecideWhetherToShareYourAccomplishments')}
      </p>
      {message && (
        <p className="tip" role="status">
          {t(message)}
        </p>
      )}
      {!saved ? (
        message ? null : (
          <p>{t('profile.loadingProfile')}</p>
        )
      ) : (
        <form className="tool-form" onSubmit={save}>
          <fieldset disabled={busy}>
            <div className="form-control">
              <label htmlFor="profile-username">{t('profile.username')}</label>
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
                {t('profile.330LowercaseLettersNumbersUnderscoresOrHyphensStartWith')}
              </p>
            </div>
            <label className="privacy-choice">
              <input
                type="checkbox"
                checked={publicBadges}
                onChange={(event) => setPublicBadges(event.target.checked)}
              />{' '}
              {t('profile.showMyProfileAndEarnedBadgesPublicly')}
            </label>
            <p className="microcopy">
              {t('profile.offByDefaultWhenEnabledAnyoneWithYourProfileLink')}
            </p>
            <button className="action-button" type="submit">
              {busy ? t('profile.saving') : t('profile.saveProfile')}
            </button>
          </fieldset>
        </form>
      )}
      {saved?.publicBadges && (
        <p>
          <a className="account-link" href={`/u/${saved.username}#badges`}>
            {t('profile.viewYourPublicBadges')}
          </a>
        </p>
      )}
      <p>
        <a className="account-link" href="/#view=journal">
          {t('profile.openYourJournal')}
        </a>
      </p>
    </>
  );
}

export function PublicProfilePage({ username }: { username: string }) {
  useLanguage();
  const [profile, setProfile] = useState<{
    username: string;
    badges: { name: string; icon: string; description: string }[];
  }>();
  const [message, setMessage] = useState(english('profile.loadingProfile'));
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
              ? english('profile.thisProfileIsPrivateOrDoesNotExist')
              : english('profile.unableToLoadThisProfilePleaseTryAgain'),
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
      <SiteHeader />
      <main className="profile-page">
        {profile ? (
          <>
            <p className="eyebrow">{t('profile.streetcarCollector')}</p>
            <h1>@{profile.username}</h1>
            <section id="badges">
              <h2>{t('profile.accomplishments')}</h2>
              <p className="microcopy">
                {t('profile.badgesCelebrateAManuallySavedStreetcarCollection')}
              </p>
              <div className="journal-badges">
                {profile.badges.map((badge) => (
                  <article className="journal-badge earned" key={badge.name}>
                    <span aria-hidden="true">{badge.icon}</span>
                    <div>
                      <strong>{t(badge.name)}</strong>
                      <small>{t(badge.description)}</small>
                    </div>
                  </article>
                ))}
              </div>
              {!profile.badges.length && (
                <p className="helper">{t('profile.theFirstBadgeIsStillAhead')}</p>
              )}
            </section>
          </>
        ) : (
          <p role="status">{t(message)}</p>
        )}
      </main>
    </>
  );
}
