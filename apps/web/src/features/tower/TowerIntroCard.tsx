import { useEffect, useRef } from 'react';
import { m } from './messages';
import { messagesFor } from '../../i18n/messages';

/** Объяснение при первой встрече с Башней; стили общие с карточкой молотка (hammerIntro.css). */
export function TowerIntro({ onConfirm }: { onConfirm: () => void }) {
  const t = messagesFor(m);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    buttonRef.current?.focus();
  }, []);
  return (
    <section className="hammer-intro tower-intro" role="region" aria-labelledby="tower-intro-title">
      <h2 id="tower-intro-title" className="hammer-intro-title">{t.introTitle}</h2>
      <ul className="hammer-intro-list">
        <li>{t.intro1}</li>
        <li>{t.intro2}</li>
        <li>{t.intro3}</li>
        <li>{t.intro4}</li>
      </ul>
      <p className="hammer-intro-note">{t.introNote}</p>
      <button type="button" className="hammer-intro-btn" ref={buttonRef} onClick={onConfirm}>
        {t.introConfirm}
      </button>
    </section>
  );
}
