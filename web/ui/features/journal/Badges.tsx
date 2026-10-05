import { journalBadges, type JournalEntry } from '../../../../shared/accounts/journal';
import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';

export function Badges({ entries }: { entries: JournalEntry[] }) {
  useLanguage();
  const collection = journalBadges(entries);
  const playedSnake = (() => {
    try {
      return localStorage.getItem('ttc:snake:v2:played') === '1';
    } catch {
      return false;
    }
  })();
  const playedClassic = (() => {
    try {
      return localStorage.getItem('ttc:snake:v1:played') === '1';
    } catch {
      return false;
    }
  })();
  return (
    <section className="streetcar-journal">
      <p className="eyebrow">{t('journal.yourRollingCollection')}</p>
      <h1>{t('navigation.badges')}</h1>
      <div className="journal-badges" aria-label={t('journal.collectionBadges')}>
        {collection.map((badge) => (
          <article className={'journal-badge' + (badge.earned ? ' earned' : '')} key={badge.name}>
            <span aria-hidden="true">{badge.icon}</span>
            <div><strong>{t(badge.name)}</strong><small>{t(badge.description)}</small><small>{badge.earned ? t('journal.unlocked') : `${badge.progress} / ${badge.target}`}</small></div>
          </article>
        ))}
        <article className={'journal-badge' + (playedSnake ? ' earned' : '')}>
          <span aria-hidden="true">🐍</span><div><strong>{t('badges.playedSnake')}</strong><small>{t('badges.playedSnakeDescription')}</small><small>{playedSnake ? t('journal.unlocked') : t('badges.notYetPlayed')}</small></div>
        </article>
        {!playedClassic && <article className="journal-badge"><span aria-hidden="true">?</span><div><strong>{t('badges.hidden')}</strong><small>{t('badges.hiddenDescription')}</small></div></article>}
      </div>
    </section>
  );
}
