import type { ReactNode } from 'react';

interface ScreenHeaderProps {
  /** Без onBack кнопки нет: так выглядят корневые вкладки нижней панели. */
  onBack?: () => void;
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

/** Шапка экрана: кнопка «Назад» (если есть onBack) и, при необходимости, заголовок. Единая разметка и семантика. */
export function ScreenHeader({
  onBack,
  backLabel,
  backAriaLabel,
  title,
  titleAs: Title = 'h1',
  leading,
  className,
}: ScreenHeaderProps) {
  if (!onBack && leading === undefined) {
    return title !== undefined ? <Title className="screen-title">{title}</Title> : null;
  }
  return (
    <>
      <header className={className ? `screen-header ${className}` : 'screen-header'}>
        {leading}
        {onBack && (
          <button
            type="button"
            className="back-btn"
            aria-label={backAriaLabel}
            onClick={() => { onBack(); }}
          >
            {backLabel ?? (<><span aria-hidden="true">←</span> Назад</>)}
          </button>
        )}
      </header>
      {title !== undefined && <Title className="screen-title">{title}</Title>}
    </>
  );
}
