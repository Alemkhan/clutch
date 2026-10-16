import { useEffect, useRef } from 'react';

export function HammerIntro({ onConfirm }: { onConfirm: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    buttonRef.current?.focus();
  }, []);
  return (
    <section className="hammer-intro" role="region" aria-labelledby="hammer-intro-title">
      <h2 id="hammer-intro-title" className="hammer-intro-title">Как забить гвоздь</h2>
      <ul className="hammer-intro-list">
        <li>Маркер бежит по полосе туда и обратно.</li>
        <li>Тапни, чтобы остановить его в целевой зоне.</li>
        <li>Чем ближе к центру, тем больше прогресса за удар.</li>
        <li>Промах не даёт прогресса, но попытку не отнимает.</li>
      </ul>
      <p className="hammer-intro-note">С каждым удачным ударом зоны становятся уже.</p>
      <button type="button" className="hammer-intro-btn" ref={buttonRef} onClick={onConfirm}>
        Понятно, бью
      </button>
    </section>
  );
}
