import { useEffect, useMemo, useState } from 'react';
import {
  normalizeClanEmoji,
  type ClanBoardResponse,
  type ClanCheckResponse,
  type ClanDetailResponse,
  type ClanMeResponse,
  type ClanMemberView,
} from '@clutch/shared';
import { ApiError, checkClanEmoji, fetchClan, fetchClanBoard, foundClan } from '../../platform/api';
import { displayPlayerName } from '../../i18n/playerName';
import { useLocale } from '../../i18n/locale';
import { useMessages } from '../../i18n/messages';
import { loadMyClan, setMyClan, useMyClan } from './clanStore';
import { useClanInvite } from './clanInvite';
import { m } from './messages';

const DATE_LOCALES = { ru: 'ru-RU', en: 'en-GB', kk: 'kk-KZ' } as const;
/** Подсказки для выбора: занятость проверяется при нажатии. */
const SUGGESTED = ['🦆', '🐸', '🦊', '🐺', '🦁', '🐼', '🐙', '🦄', '🐲', '🦖', '🦉', '🐝', '🔥', '⚡', '🌵', '🍉', '🍕', '🚀', '👾', '🤖', '👻', '💎', '🧠', '🎯'];
const TREE_DEPTH_LIMIT = 6;

type Tab = 'clan' | 'war';

export function ClanScreen({ onBack, onPlay, initialTab = 'clan' }: { onBack: () => void; onPlay: () => void; initialTab?: Tab }) {
  const t = useMessages(m);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [viewing, setViewing] = useState<string | null>(null);
  const clan = useMyClan();

  if (viewing) {
    return (
      <section className="clan-screen">
        <ClanDetail slug={viewing} onBack={() => setViewing(null)} />
      </section>
    );
  }

  return (
    <section className="clan-screen">
      <header className="clan-header">
        <button type="button" className="clan-back" onClick={onBack} aria-label={t.back}>‹</button>
        <h1 className="screen-title">{t.title}</h1>
      </header>
      <div className="clan-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'clan'} className={tab === 'clan' ? 'active' : ''} onClick={() => setTab('clan')}>{t.tabClan}</button>
        <button type="button" role="tab" aria-selected={tab === 'war'} className={tab === 'war' ? 'active' : ''} onClick={() => setTab('war')}>{t.tabWar}</button>
      </div>
      {tab === 'war' && <ClanWar onOpen={setViewing} />}
      {tab === 'clan' && (
        <>
          {(clan.status === 'idle' || clan.status === 'loading') && <div className="matchmaking-loading" role="status"><span /></div>}
          {clan.status === 'error' && (
            <div className="my-runs-message">
              <p className="matchmaking-error" role="alert">{t.loadError}</p>
              <button type="button" className="cta-btn" onClick={() => { void loadMyClan(true); }}>{t.retry}</button>
            </div>
          )}
          {clan.status === 'ready' && !clan.me.clan && <ClaimView canFound={clan.me.canFound} onPlay={onPlay} />}
          {clan.status === 'ready' && clan.me.clan && <MyClanView clan={clan.me.clan} />}
        </>
      )}
    </section>
  );
}

// ---- Занять эмодзи ----

type CheckState =
  | { state: 'idle' }
  | { state: 'invalid' }
  | { state: 'checking' }
  | { state: 'error' }
  | { state: 'done'; result: ClanCheckResponse };

export function ClaimView({ canFound, onPlay }: { canFound: boolean; onPlay: () => void }) {
  const t = useMessages(m);
  const [value, setValue] = useState('');
  const [check, setCheck] = useState<CheckState>({ state: 'idle' });
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [recheck, setRecheck] = useState(0);

  useEffect(() => {
    setClaimError('');
    if (!value.trim()) { setCheck({ state: 'idle' }); return undefined; }
    const emoji = normalizeClanEmoji(value);
    if (!emoji) { setCheck({ state: 'invalid' }); return undefined; }
    setCheck({ state: 'checking' });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      checkClanEmoji(emoji.emoji, controller.signal).then(
        (result) => { if (!controller.signal.aborted) setCheck({ state: 'done', result }); },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setCheck(error instanceof ApiError && error.status === 400 ? { state: 'invalid' } : { state: 'error' });
        },
      );
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [value, recheck]);

  const free = check.state === 'done' && check.result.available ? check.result : null;
  const claim = () => {
    if (!free || claiming) return;
    setClaiming(true);
    foundClan(free.emoji).then(
      (me: ClanMeResponse) => setMyClan(me),
      (error: unknown) => {
        setClaiming(false);
        if (error instanceof ApiError && error.reason === 'taken') {
          setClaimError(t.takenNow);
          setRecheck((n) => n + 1);
        } else if (error instanceof ApiError && error.reason === 'already_member') {
          void loadMyClan(true);
        } else {
          setClaimError(t.claimError);
        }
      },
    );
  };

  return (
    <div className="clan-claim">
      <div className="clan-claim-preview" aria-hidden="true">{free?.emoji ?? (check.state === 'done' ? check.result.emoji : '❔')}</div>
      <h2 className="clan-claim-title">{t.claimTitle}</h2>
      <p className="clan-claim-text">{t.claimText}</p>
      <label className="clan-input-label" htmlFor="clan-emoji">{t.inputLabel}</label>
      <input
        id="clan-emoji"
        className="open-answer-input clan-input"
        value={value}
        placeholder={t.inputPlaceholder}
        autoComplete="off"
        inputMode="text"
        onChange={(event) => setValue(event.target.value)}
      />
      <p className="clan-check" role="status">
        {check.state === 'checking' && t.checking}
        {check.state === 'invalid' && t.invalid}
        {check.state === 'error' && t.claimError}
        {check.state === 'done' && (check.result.available
          ? t.free(check.result.emoji)
          : t.taken(check.result.emoji, t.members(check.result.members)))}
      </p>
      <p className="clan-suggest-label">{t.suggestions}</p>
      <div className="clan-suggest">
        {SUGGESTED.map((emoji) => (
          <button key={emoji} type="button" className="clan-suggest-btn" onClick={() => setValue(emoji)} aria-label={emoji}>{emoji}</button>
        ))}
      </div>
      {claimError && <p className="matchmaking-error" role="alert">{claimError}</p>}
      {canFound ? (
        <>
          <button type="button" className="cta-btn" disabled={!free || claiming} onClick={claim}>
            {claiming ? t.claiming : free ? t.claim(free.emoji) : t.claimTitle}
          </button>
          <p className="clan-forever">{t.forever}</p>
        </>
      ) : (
        <>
          <p className="clan-forever">{t.needsRun}</p>
          <button type="button" className="cta-btn" onClick={onPlay}>{t.play}</button>
        </>
      )}
    </div>
  );
}

// ---- Свой клан ----

export function MyClanView({ clan }: { clan: NonNullable<ClanMeResponse['clan']> }) {
  const t = useMessages(m);
  const invite = useClanInvite('clan');
  const [detail, setDetail] = useState<ClanDetailResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchClan(clan.slug, controller.signal).then((value) => { if (!controller.signal.aborted) setDetail(value); }, () => {});
    return () => controller.abort();
  }, [clan.slug, clan.members]);

  return (
    <div className="clan-mine">
      <div className="clan-hero">
        <span className="clan-hero-emoji" aria-hidden="true">{clan.emoji}</span>
        <p className="clan-hero-meta">{t.members(clan.members)}</p>
        <p className="clan-hero-sub">
          {clan.isFounder ? t.youFounder : clan.invitedByName ? t.invitedBy(displayPlayerName(clan.invitedByName)) : t.founderLine(displayPlayerName(clan.founderName))}
        </p>
      </div>
      <div className="home-stats-card clan-stats">
        <div className="mini-stat">
          <span className="mini-stat-value">{clan.week.rank ? `#${clan.week.rank}` : '–'}</span>
          <span className="mini-stat-label">{t.place}</span>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-value">{clan.week.score}</span>
          <span className="mini-stat-label">{t.weekScore}</span>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-value">{clan.youWeekPoints}</span>
          <span className="mini-stat-label">{t.yourPoints}</span>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-value">{clan.infectedByYou}</span>
          <span className="mini-stat-label">{t.infected}</span>
        </div>
      </div>
      <button type="button" className="cta-btn clan-invite" onClick={() => invite.share(clan)}>
        {t.invite} {clan.emoji}
      </button>
      {invite.status === 'copied' && <p className="clan-check" role="status">{t.inviteCopied}</p>}
      {invite.status === 'failed' && <p className="clan-check" role="status">{t.inviteFailed}</p>}
      {invite.status === 'unavailable' && <p className="clan-check" role="status">{t.inviteUnavailable}</p>}
      {detail && <MemberTree members={detail.memberList} />}
    </div>
  );
}

// ---- Дерево заражений ----

export function MemberTree({ members }: { members: readonly ClanMemberView[] }) {
  const t = useMessages(m);
  const { roots, children } = useMemo(() => {
    const byParent = new Map<number, ClanMemberView[]>();
    const ids = new Set(members.map((member) => member.id));
    const rootList: ClanMemberView[] = [];
    for (const member of members) {
      if (member.parentId !== null && ids.has(member.parentId)) {
        byParent.set(member.parentId, [...(byParent.get(member.parentId) ?? []), member]);
      } else {
        rootList.push(member);
      }
    }
    // Основатель - первым среди корней.
    rootList.sort((a, b) => Number(b.isFounder) - Number(a.isFounder) || Number(b.isOriginalFounder) - Number(a.isOriginalFounder));
    return { roots: rootList, children: byParent };
  }, [members]);

  const node = (member: ClanMemberView, depth: number) => {
    const kids = children.get(member.id) ?? [];
    return (
      <li key={member.id} className={`clan-tree-node${member.isYou ? ' mine' : ''}`}>
        <div className="clan-tree-row">
          <span className="clan-tree-name">
            {displayPlayerName(member.displayName)}
            {member.isYou && <span className="clan-tree-you"> · {t.you}</span>}
          </span>
          {member.isFounder && <span className="clan-badge">{t.founder}</span>}
          {member.isOriginalFounder && !member.isFounder && <span className="clan-badge muted">{t.zeroPatient}</span>}
          <span className="clan-tree-points">{t.points(member.weekPoints)}</span>
        </div>
        {kids.length > 0 && (depth < TREE_DEPTH_LIMIT
          ? <ul className="clan-tree-children">{kids.map((kid) => node(kid, depth + 1))}</ul>
          : <p className="clan-tree-more">{t.more(countDescendants(kids, children))}</p>)}
      </li>
    );
  };

  return (
    <section className="clan-tree" aria-label={t.tree}>
      <h2 className="section-heading">{t.tree}</h2>
      <ul className="clan-tree-root">{roots.map((member) => node(member, 0))}</ul>
    </section>
  );
}

function countDescendants(list: readonly ClanMemberView[], children: Map<number, ClanMemberView[]>): number {
  return list.reduce((sum, member) => sum + 1 + countDescendants(children.get(member.id) ?? [], children), 0);
}

// ---- Война кланов ----

export function ClanWar({ onOpen }: { onOpen: (slug: string) => void }) {
  const t = useMessages(m);
  const [board, setBoard] = useState<ClanBoardResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    fetchClanBoard(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setBoard(value); },
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [attempt]);
  if (failed) {
    return (
      <div className="my-runs-message">
        <p className="matchmaking-error" role="alert">{t.loadError}</p>
        <button type="button" className="cta-btn" onClick={() => setAttempt((n) => n + 1)}>{t.retry}</button>
      </div>
    );
  }
  if (!board) return <div className="matchmaking-loading" role="status"><span /></div>;
  return <ClanWarView board={board} onOpen={onOpen} />;
}

export function ClanWarView({ board, onOpen }: { board: ClanBoardResponse; onOpen: (slug: string) => void }) {
  const t = useMessages(m);
  const locale = useLocale();
  const until = new Date(`${board.lastDayKey}T12:00:00Z`).toLocaleDateString(DATE_LOCALES[locale], { day: 'numeric', month: 'long' });
  const yoursInList = board.you && board.entries.some((entry) => entry.slug === board.you!.slug);
  const row = (entry: ClanBoardResponse['entries'][number]) => (
    <button
      key={entry.slug}
      type="button"
      className={`solo-board-row clan-war-row${board.you?.slug === entry.slug ? ' mine' : ''}`}
      onClick={() => onOpen(entry.slug)}
    >
      <span className="solo-board-place">{entry.rank}</span>
      <span className="clan-war-emoji" aria-hidden="true">{entry.emoji}</span>
      <span className="solo-board-name">
        {t.members(entry.members)}
        {board.you?.slug === entry.slug && <span className="clan-tree-you"> · {t.yourClan}</span>}
      </span>
      <strong className="solo-board-score">{entry.score}</strong>
    </button>
  );
  return (
    <div className="clan-war">
      <p className="clan-war-until">{t.warUntil(until)}</p>
      {board.entries.length === 0
        ? <p className="profile-tag">{t.warEmpty}</p>
        : (
          <div className="solo-board-list" aria-label={t.warTitle}>
            {board.entries.map(row)}
            {board.you && !yoursInList && row(board.you)}
          </div>
        )}
      <p className="clan-war-rules">{t.warRules}</p>
    </div>
  );
}

// ---- Чужой клан ----

function ClanDetail({ slug, onBack }: { slug: string; onBack: () => void }) {
  const t = useMessages(m);
  const [detail, setDetail] = useState<ClanDetailResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchClan(slug, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setDetail(value); },
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [slug]);
  return (
    <>
      <header className="clan-header">
        <button type="button" className="clan-back" onClick={onBack} aria-label={t.back}>‹</button>
        <h1 className="screen-title">{t.warTitle}</h1>
      </header>
      {failed && <p className="matchmaking-error" role="alert">{t.loadError}</p>}
      {!detail && !failed && <div className="matchmaking-loading" role="status"><span /></div>}
      {detail && (
        <div className="clan-mine">
          <div className="clan-hero">
            <span className="clan-hero-emoji" aria-hidden="true">{detail.emoji}</span>
            <p className="clan-hero-meta">{t.members(detail.members)}</p>
            <p className="clan-hero-sub">{t.founderLine(displayPlayerName(detail.founderName))}</p>
          </div>
          <div className="home-stats-card clan-stats">
            <div className="mini-stat">
              <span className="mini-stat-value">{detail.week.rank ? `#${detail.week.rank}` : '–'}</span>
              <span className="mini-stat-label">{t.place}</span>
            </div>
            <div className="mini-stat">
              <span className="mini-stat-value">{detail.week.score}</span>
              <span className="mini-stat-label">{t.weekScore}</span>
            </div>
          </div>
          <MemberTree members={detail.memberList} />
        </div>
      )}
    </>
  );
}
