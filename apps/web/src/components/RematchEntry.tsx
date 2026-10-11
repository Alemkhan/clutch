import { useEffect, useState } from 'react';
import type { CategoryId } from '@clutch/shared';
import {
  ApiError,
  fetchRematchPreview,
  setOutbidNotifications,
  type RematchPreview,
} from '../lib/api';
import type { LaunchIntent } from '../lib/launchIntent';

interface RematchEntryProps {
  intent: LaunchIntent;
  onStartRematch: (inviteId: string, category: CategoryId, mode: RematchPreview['mode']) => void;
  onClose: () => void;
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; preview: RematchPreview }
  | { status: 'gone'; reason?: string }
  | { status: 'error' };

export function rematchErrorKind(error: unknown): 'gone' | 'error' {
  return error instanceof ApiError && [403, 404, 410].includes(error.status) ? 'gone' : 'error';
}

/** Почему приглашение не открылось; сервер называет причину у ссылок «Позвать друга». */
export function rematchGoneText(reason: string | undefined): string {
  if (reason === 'own') return 'Это твоя ссылка. Отправь её другу.';
  if (reason === 'taken') return 'Ссылку уже занял другой игрок.';
  if (reason === 'expired') return 'Срок ссылки вышел.';
  return 'Приглашение уже использовано, устарело или адресовано другому игроку.';
}

function RematchInvite({ inviteId, onStartRematch, onClose }: {
  inviteId: string;
  onStartRematch: RematchEntryProps['onStartRematch'];
  onClose: () => void;
}) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const friend = (state.status === 'ready' && state.preview.friend === true)
    || (state.status === 'gone' && state.reason !== undefined);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchRematchPreview(inviteId, controller.signal)
      .then((preview) => { if (!controller.signal.aborted) setState({ status: 'ready', preview }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(rematchErrorKind(error) === 'gone'
          ? { status: 'gone', reason: error instanceof ApiError ? error.reason : undefined }
          : { status: 'error' });
      });
    return () => controller.abort();
  }, [inviteId, attempt]);

  return (
    <section className="matchmaking">
      <div className="matchmaking-body">
        <span className="matchmaking-eyebrow">{friend ? 'Вызов' : 'Реванш'}</span>
        {state.status === 'loading' && (
          <>
            <h1 className="screen-title">Открываем приглашение</h1>
            <div className="matchmaking-loading" role="status"><span /> Загружаем</div>
          </>
        )}
        {state.status === 'ready' && (
          <>
            {state.preview.friend ? (
              <>
                <h1 className="screen-title">Обгони {state.preview.challengerName}</h1>
                <p className="matchmaking-status">Его результат: {state.preview.challengerProgress}%.</p>
              </>
            ) : (
              <>
                <h1 className="screen-title">Реванш с {state.preview.challengerName}</h1>
                <p className="matchmaking-status">
                  {state.preview.challengerName} обошёл вашу запись: {state.preview.challengerProgress}% против {state.preview.yourProgress}%.
                  {state.preview.mode === 'solo'
                    ? 'Это будет новый забег по другому набору: твой результат сравнят с его.'
                    : 'Вопросы будут те же, соперник — его сохранённая запись.'}
                </p>
              </>
            )}
            <button
              className="cta-btn"
              onClick={() => onStartRematch(state.preview.inviteId, state.preview.category, state.preview.mode)}
            >
              {state.preview.friend ? 'Играть' : 'Начать реванш'}
            </button>
            <button className="ghost-btn" onClick={onClose}>Не сейчас</button>
          </>
        )}
        {state.status === 'gone' && (
          <>
            <h1 className="screen-title">{state.reason ? 'Ссылка недоступна' : 'Реванш недоступен'}</h1>
            <p className="matchmaking-error" role="alert">{rematchGoneText(state.reason)}</p>
            <button className="cta-btn" onClick={onClose}>На главную</button>
          </>
        )}
        {state.status === 'error' && (
          <>
            <h1 className="screen-title">Не удалось открыть приглашение</h1>
            <p className="matchmaking-error" role="alert">Проверь соединение и попробуй ещё раз.</p>
            <button className="cta-btn" onClick={() => setAttempt((value) => value + 1)}>Повторить</button>
            <button className="ghost-btn" onClick={onClose}>На главную</button>
          </>
        )}
      </div>
    </section>
  );
}

type UnsubscribeState = 'working' | 'off' | 'on' | 'error';

function Unsubscribe({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<UnsubscribeState>('working');

  const change = (enabled: boolean) => {
    setState('working');
    setOutbidNotifications(enabled)
      .then(() => setState(enabled ? 'on' : 'off'))
      .catch(() => setState('error'));
  };

  // Opening the link is the request: nothing else to confirm.
  useEffect(() => { change(false); }, []);

  return (
    <section className="matchmaking">
      <div className="matchmaking-body">
        <span className="matchmaking-eyebrow">Уведомления</span>
        {state === 'working' && (
          <div className="matchmaking-loading" role="status"><span /> Сохраняем</div>
        )}
        {state === 'off' && (
          <>
            <h1 className="screen-title">Сообщения отключены</h1>
            <p className="matchmaking-status">Мы больше не пишем, когда вашу запись обходят.</p>
            <button className="cta-btn" onClick={onClose}>На главную</button>
            <button className="ghost-btn" onClick={() => change(true)}>Включить обратно</button>
          </>
        )}
        {state === 'on' && (
          <>
            <h1 className="screen-title">Сообщения включены</h1>
            <p className="matchmaking-status">Напишем, когда вашу запись обойдут.</p>
            <button className="cta-btn" onClick={onClose}>На главную</button>
          </>
        )}
        {state === 'error' && (
          <>
            <h1 className="screen-title">Не удалось сохранить</h1>
            <p className="matchmaking-error" role="alert">Настройка не изменена. Попробуй ещё раз.</p>
            <button className="cta-btn" onClick={() => change(false)}>Повторить</button>
            <button className="ghost-btn" onClick={onClose}>На главную</button>
          </>
        )}
      </div>
    </section>
  );
}

export function RematchEntry({ intent, onStartRematch, onClose }: RematchEntryProps) {
  return intent.type === 'rematch'
    ? <RematchInvite inviteId={intent.inviteId} onStartRematch={onStartRematch} onClose={onClose} />
    : <Unsubscribe onClose={onClose} />;
}
