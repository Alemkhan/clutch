import { useSyncExternalStore } from 'react';
import { isSoundEnabled, subscribeSound, toggleSound } from '../lib/sounds';

export function useSoundEnabled(): boolean {
  return useSyncExternalStore(subscribeSound, isSoundEnabled, () => true);
}

interface SoundSwitchProps {
  enabled: boolean;
  onToggle: () => void;
  variant: 'profile' | 'hud';
}

// System control, not minigame art. Deliberately plays no sound when pressed.
export function SoundSwitch({ enabled, onToggle, variant }: SoundSwitchProps) {
  const label = enabled ? 'Звук включён' : 'Звук выключен';
  if (variant === 'hud') {
    return (
      <button
        type="button"
        className="sound-toggle-hud"
        aria-pressed={enabled}
        aria-label={label}
        onClick={(event) => { event.stopPropagation(); onToggle(); }}
      >
        <span aria-hidden="true">{enabled ? '♪' : '×'}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="sound-toggle-row"
      aria-pressed={enabled}
      aria-label={label}
      onClick={onToggle}
    >
      <span className="sound-toggle-title" aria-hidden="true">Звук</span>
      <span className="sound-toggle-state" aria-hidden="true">{enabled ? 'вкл' : 'выкл'}</span>
    </button>
  );
}

export function SoundToggle({ variant }: { variant: 'profile' | 'hud' }) {
  const enabled = useSoundEnabled();
  return <SoundSwitch enabled={enabled} onToggle={toggleSound} variant={variant} />;
}
