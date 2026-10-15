import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatchHud } from './MatchHud';
import { Profile } from './Profile';
import { SoundSwitch } from './SoundToggle';

const noop = () => {};

describe('sound controls markup', () => {
  it('renders the profile row in both states', () => {
    const on = renderToStaticMarkup(<SoundSwitch enabled onToggle={noop} variant="profile" />);
    expect(on).toContain('<button type="button"');
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('aria-label="Звук включён"');
    expect(on).toContain('Звук');
    expect(on).toContain('вкл');
    const off = renderToStaticMarkup(<SoundSwitch enabled={false} onToggle={noop} variant="profile" />);
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('aria-label="Звук выключен"');
    expect(off).toContain('выкл');
  });

  it('renders the compact HUD button in both states', () => {
    const on = renderToStaticMarkup(<SoundSwitch enabled onToggle={noop} variant="hud" />);
    expect(on).toContain('class="sound-toggle-hud"');
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('aria-label="Звук включён"');
    const off = renderToStaticMarkup(<SoundSwitch enabled={false} onToggle={noop} variant="hud" />);
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('aria-label="Звук выключен"');
  });

  it('is present in the real Profile and MatchHud', () => {
    expect(renderToStaticMarkup(<Profile />)).toContain('class="sound-toggle-row"');
    expect(
      renderToStaticMarkup(<MatchHud player={0} opponent={0} opponentName="Алекс" round={1} totalRounds={10} />),
    ).toContain('class="sound-toggle-hud"');
  });
});
