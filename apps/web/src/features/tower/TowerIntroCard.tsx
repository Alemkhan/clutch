import { useEffect, useRef } from 'react';

/** Объяснение при первой встрече с Башней; стили общие с карточкой молотка (hammerIntro.css). */
export function TowerIntro({ onConfirm }: { onConfirm: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    buttonRef.current?.focus();
  }, []);
  return (
    <section className="hammer-intro tower-intro" role="region" aria-labelledby="tower-intro-title">
      <h2 id="tower-intro-title" className="hammer-intro-title">Как строить башню</h2>
      <ul className="hammer-intro-list">
        <li>Блок ездит влево-вправо над башней.</li>
        <li>Тапни, чтобы уронить его на верхний блок.</li>
        <li>Чем больше блок совпал с нижним, тем больше прогресса.</li>
        <li>Промах не даёт прогресса, но попытку не отнимает.</li>
      </ul>
      <p className="hammer-intro-note">С каждым удачным блоком совпадать нужно точнее.</p>
      <button type="button" className="hammer-intro-btn" ref={buttonRef} onClick={onConfirm}>
        Понятно, роняю
      </button>
    </section>
  );
}
