import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ClanBoardResponse, ClanMeResponse, ClanMemberView } from '@clutch/shared';
import { parseLaunchPayload } from '../../app/launchIntent';
import { ClanHomeCardView } from './ClanHomeCard';
import { ClanInviteEntryView } from './ClanInviteEntry';
import { ClanResultNudgeView } from './ClanResultNudge';
import { clanInvitePreviewUrl } from './clanInvite';
import { ClaimView, ClanWarView, MemberTree, MyClanView } from './ClanScreen';
import { PlayerAvatar } from '../../ui/PlayerAvatar';

const myClan: NonNullable<ClanMeResponse['clan']> = {
  emoji: '🦆',
  slug: '1f986',
  members: 3,
  founderName: 'Аня',
  createdAt: 1,
  week: { weekKey: '2026-11-16', score: 42, rank: 2 },
  isFounder: false,
  youWeekPoints: 150,
  infectedByYou: 1,
  invitedByName: 'Аня',
  inviteLink: 'https://t.me/bot?startapp=cl_AAAAAAAAAA',
  inviteCode: 'AAAAAAAAAA',
};

function member(id: number, parentId: number | null, extra: Partial<ClanMemberView> = {}): ClanMemberView {
  return { id, parentId, displayName: `Игрок ${id}`, weekPoints: id * 10, infected: 0, isFounder: false, isOriginalFounder: false, isYou: false, ...extra };
}

describe('clan invite link', () => {
  it('parses only well-formed clan codes', () => {
    expect(parseLaunchPayload('cl_AbCdE12345')).toEqual({ type: 'clan-invite', code: 'cl_AbCdE12345' });
    for (const bad of ['cl_short', 'cl_AbCdE123456', 'cl_AbCdE1234!']) expect(parseLaunchPayload(bad)).toBeNull();
  });
});

describe('clan on home', () => {
  it('invites to claim an emoji only after the first run', () => {
    expect(renderToStaticMarkup(<ClanHomeCardView me={{ clan: null, canFound: false }} onOpen={vi.fn()} />)).toBe('');
    expect(renderToStaticMarkup(<ClanHomeCardView me={{ clan: null, canFound: true }} onOpen={vi.fn()} />)).toContain('Займи своё эмодзи');
  });

  it('shows the clan with its place in the war', () => {
    const html = renderToStaticMarkup(<ClanHomeCardView me={{ clan: myClan, canFound: false }} onOpen={vi.fn()} />);
    expect(html).toContain('Клан 🦆');
    expect(html).toContain('3 участника · #2 в войне кланов');
  });
});

describe('claiming an emoji', () => {
  it('asks for a first run before the claim button', () => {
    const html = renderToStaticMarkup(<ClaimView canFound={false} onPlay={vi.fn()} />);
    expect(html).toContain('Сыграй первый забег');
    expect(html).toContain('Играть');
  });

  it('warns that the choice is forever', () => {
    const html = renderToStaticMarkup(<ClaimView canFound onPlay={vi.fn()} />);
    expect(html).toContain('Один клан навсегда');
    expect(html).toContain('disabled');
  });
});

describe('my clan', () => {
  it('shows who infected me, the week and the invite button', () => {
    const html = renderToStaticMarkup(<MyClanView clan={myClan} />);
    expect(html).toContain('Тебя заразил Аня');
    expect(html).toContain('#2');
    expect(html).toContain('>150<');
    expect(html).toContain('Заразить друга 🦆');
  });

  it('draws the infection tree from the founder down', () => {
    const html = renderToStaticMarkup(<MemberTree members={[
      member(2, 1, { isYou: true }),
      member(1, null, { isFounder: true, isOriginalFounder: true, infected: 1 }),
      member(3, 2),
    ]} />);
    expect(html.indexOf('Игрок 1')).toBeLessThan(html.indexOf('Игрок 2'));
    expect(html.indexOf('Игрок 2')).toBeLessThan(html.indexOf('Игрок 3'));
    expect(html.match(/clan-tree-children/g)).toHaveLength(2);
    expect(html).toContain('основатель');
    expect(html).toContain(' · ты');
  });

  it('marks patient zero once the founder role has moved on', () => {
    const html = renderToStaticMarkup(<MemberTree members={[
      member(1, null, { isOriginalFounder: true }),
      member(2, 1, { isFounder: true }),
    ]} />);
    expect(html).toContain('нулевой пациент');
  });
});

describe('clan war', () => {
  const board: ClanBoardResponse = {
    weekKey: '2026-11-16',
    lastDayKey: '2026-11-22',
    entries: [
      { rank: 1, emoji: '🐜', slug: '1f41c', members: 1, score: 40 },
      { rank: 2, emoji: '🦆', slug: '1f986', members: 3, score: 20 },
    ],
    you: { rank: 2, emoji: '🦆', slug: '1f986', members: 3, score: 20 },
  };

  it('lists clans by score and marks mine', () => {
    const html = renderToStaticMarkup(<ClanWarView board={board} onOpen={vi.fn()} />);
    expect(html.indexOf('🐜')).toBeLessThan(html.indexOf('🦆'));
    expect(html).toContain(' · твой');
    expect(html).toContain('22 ноября');
  });

  it('appends my clan when it is below the top', () => {
    const html = renderToStaticMarkup(<ClanWarView board={{ ...board, entries: [board.entries[0]], you: { ...board.you!, rank: 51 } }} onOpen={vi.fn()} />);
    expect(html).toContain('>51<');
  });
});

describe('joining by link', () => {
  it('greets a new member and an existing one differently', () => {
    const joined = renderToStaticMarkup(<ClanInviteEntryView state={{ status: 'done', result: { status: 'joined', me: { clan: myClan, canFound: false } } }} onClan={vi.fn()} onPlay={vi.fn()} onRetry={vi.fn()} />);
    expect(joined).toContain('Теперь ты 🦆');
    expect(joined).toContain('Тебя заразил Аня. В клане 3 участника. Один клан навсегда.');
    const already = renderToStaticMarkup(<ClanInviteEntryView state={{ status: 'done', result: { status: 'already', me: { clan: myClan, canFound: false } } }} onClan={vi.fn()} onPlay={vi.fn()} onRetry={vi.fn()} />);
    expect(already).toContain('Ты уже 🦆');
  });

  it('explains a broken link', () => {
    expect(renderToStaticMarkup(<ClanInviteEntryView state={{ status: 'gone' }} onClan={vi.fn()} onPlay={vi.fn()} onRetry={vi.fn()} />)).toContain('Приглашение не найдено');
  });
});

describe('player avatar', () => {
  it('uses the clan emoji and falls back to the creature', () => {
    expect(renderToStaticMarkup(<PlayerAvatar seed="Аня" emoji="🦆" />)).toContain('🦆');
    expect(renderToStaticMarkup(<PlayerAvatar seed="Аня" />)).not.toContain('emoji-avatar');
  });
});

describe('clan nudge after a daily run', () => {
  it('asks to infect a friend while the clan is short of ten', () => {
    const html = renderToStaticMarkup(<ClanResultNudgeView me={{ clan: myClan, canFound: false }} onInvite={vi.fn()} />);
    expect(html).toContain('Клану 🦆 нужно 10 бойцов — сейчас 3');
    expect(html).toContain('Твой вклад за неделю: 150 очков');
    expect(html).toContain('Заразить');
  });

  it('only shows the share once the clan is full', () => {
    const html = renderToStaticMarkup(<ClanResultNudgeView me={{ clan: { ...myClan, members: 12 }, canFound: false }} onInvite={vi.fn()} onClan={vi.fn()} />);
    expect(html).toContain('Ты сражаешься за 🦆');
    expect(html).not.toContain('нужно 10');
  });

  it('offers to claim an emoji without a clan, and nothing before the first run', () => {
    expect(renderToStaticMarkup(<ClanResultNudgeView me={{ clan: null, canFound: true }} onInvite={vi.fn()} onClan={vi.fn()} />)).toContain('Займи своё эмодзи');
    expect(renderToStaticMarkup(<ClanResultNudgeView me={{ clan: null, canFound: false }} onInvite={vi.fn()} onClan={vi.fn()} />)).toBe('');
  });
});

describe('invite card link', () => {
  it('carries the code, the member count as a cache key and the language', () => {
    expect(clanInvitePreviewUrl('https://api.example', { inviteCode: 'AbCdE12345', members: 7 }, 'kk'))
      .toBe('https://api.example/api/share/clan?c=AbCdE12345&v=7&l=kk');
  });
});
