import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HammerResult, strikeLabelText } from '../hammer/HammerGame';
import { SoloHud } from './SoloHud';
import { strikeGain } from '../hammer/hammerStrike';

const base = { paceProgress: null, paceName: null, round: 2, roundsLeft: 18 };

describe('SoloHud strike gain', () => {
  it('shows the new percent, the +N chip and a separate gain segment at the moment of the strike', () => {
    const { total, gain } = strikeGain(18, 18);
    const html = renderToStaticMarkup(<SoloHud {...base} progress={total} gain={gain} />);
    expect(html).toContain('<strong class="match-hud-value">36%</strong>');
    expect(html).toContain('<span class="match-hud-gain-chip">+18</span>');
    expect(html).toContain('class="match-hud-gain"');
    expect(html).toContain('width:18%');
    expect(html).toContain('aria-valuenow="36"');
  });

  it('has no chip or segment before a strike', () => {
    const html = renderToStaticMarkup(<SoloHud {...base} progress={18} />);
    expect(html).not.toContain('match-hud-gain');
  });

  it('keeps the full opponent name for assistive tech and tooltip', () => {
    const name = 'Очень-очень длинное имя соперника Александр';
    const html = renderToStaticMarkup(<SoloHud {...base} progress={10} paceProgress={20} paceName={name} />);
    expect(html).toContain(`title="${name}"`);
    expect(html).toContain(`>${name}</span>`);
  });
});

describe('HammerResult notes', () => {
  it('renders remaining and series lines', () => {
    const html = renderToStaticMarkup(
      <HammerResult result="great" remaining="До 100% — ещё 64%" series="Серия 2 · зоны стали уже" />,
    );
    expect(html).toContain('До 100% — ещё 64%');
    expect(html).toContain('Серия 2 · зоны стали уже');
  });
});

describe('strike label', () => {
  it('puts the name and percent in one element', () => {
    expect(strikeLabelText('great')).toBe('ОТЛИЧНО +18%');
    const html = renderToStaticMarkup(<HammerResult result="great" />);
    expect(html).toContain('<span class="strike-label">ОТЛИЧНО +18%</span>');
    expect(html).not.toContain('strike-progress');
  });

  it('shows a miss without +0%', () => {
    expect(strikeLabelText('miss')).toBe('МИМО');
    expect(renderToStaticMarkup(<HammerResult result="miss" />)).not.toContain('+0%');
  });
});
