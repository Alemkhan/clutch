import type { MiniGameId } from "@clutch/shared";
import { useMessages } from "../../../i18n/messages";
import { m } from "./messages";

/** Маленькая иллюстрация игры: простой SVG, без спрайтов и без движения. */
function MiniGameArt({ miniGameId }: { miniGameId: MiniGameId }) {
  return (
    <svg
      className="minigame-card-art"
      viewBox="0 0 390 96"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <rect x="0" y="78" width="390" height="18" fill="#2a2266" />
      {miniGameId === "tower_stack" ? (
        <>
          <rect x="140" y="54" width="110" height="24" rx="3" fill="#8b6cf6" />
          <rect x="146" y="30" width="104" height="24" rx="3" fill="#3ccf8e" />
          <rect x="190" y="6" width="104" height="24" rx="3" fill="#ffc94d" />
        </>
      ) : (
        <>
          <rect x="155" y="52" width="80" height="26" rx="3" fill="#8a6a45" />
          <rect x="191" y="22" width="8" height="30" rx="1" fill="#c9ccd1" />
          <rect x="176" y="6" width="38" height="16" rx="3" fill="#ffc94d" />
        </>
      )}
    </svg>
  );
}

/** «Мини-игра этой партии»: название и одна фраза правила. Игру выбирает сервер. */
export function MiniGameCard({ miniGameId }: { miniGameId: MiniGameId }) {
  const t = useMessages(m);
  return (
    <section className="minigame-card" aria-label={t.miniGameLabel}>
      <MiniGameArt miniGameId={miniGameId} />
      <div className="minigame-card-body">
        <span className="minigame-card-eyebrow">{t.miniGameLabel}</span>
        <h2 className="minigame-card-title">{t.miniGameTitle(miniGameId)}</h2>
        <p className="minigame-card-rule">{t.miniGameRule(miniGameId)}</p>
      </div>
    </section>
  );
}
