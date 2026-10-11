import type { ReactNode } from 'react';

interface ScreenHeaderProps {
  onBack: () => void;
  /** Своя подпись кнопки (без стрелки). По умолчанию «← Назад». */
  backLabel?: string;
  /** Подробное имя для скринридера, если оно точнее видимой подписи. Должно содержать её. */
  backAriaLabel?: string;
  /** Заголовок экрана; выводится сразу после шапки. */
  title?: ReactNode;
  titleAs?: 'h1' | 'h2';
  /** Содержимое слева от кнопки (например, чип прогресса). */
  leading?: ReactNode;
  className?: string;
}

/** Шапка экрана: кнопка «Назад» и, при необходимости, заголовок. Единая разметка и семантика. */
export function ScreenHeader({
  onBack,
  backLabel,
  backAriaLabel,
  title,
  titleAs: Title = 'h1',
  leading,
  className,
}: ScreenHeaderProps) {
  return (
    <>
      <header className={className ? `screen-header ${className}` : 'screen-header'}>
        {leading}
        <button
          type="button"
          className="back-btn"
          aria-label={backAriaLabel}
          onClick={() => { onBack(); }}
        >
          {backLabel ?? (<><span aria-hidden="true">←</span> Назад</>)}
        </button>
      </header>
      {title !== undefined && <Title className="screen-title">{title}</Title>}
    </>
  );
}
