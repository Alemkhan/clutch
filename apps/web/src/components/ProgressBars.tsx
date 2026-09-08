interface ProgressBarsProps {
  player: number;
  opponent: number;
  opponentName: string;
}

function sinkPercentFor(progress: number): number {
  return Math.min(88, progress * 0.88);
}

interface LabelSideProps {
  label: string;
  value: number;
  avatar: string;
}

function LabelSide({ label, value, avatar }: LabelSideProps) {
  return (
    <div className="stump-label-side">
      <img className="stump-label-avatar" src={avatar} alt="" />
      <span className="stump-label-name">{label}</span>
      <span className="stump-label-value">{value}%</span>
    </div>
  );
}

export function ProgressBars({ player, opponent, opponentName }: ProgressBarsProps) {
  return (
    <div className="shared-stump-card">
      <div className="shared-stump-labels">
        <LabelSide label="You" value={player} avatar="/sprites/avatar-player.png" />
        <LabelSide label={opponentName} value={opponent} avatar="/sprites/avatar-opponent.png" />
      </div>
      <div className="shared-stump-scene">
        <img className="shared-stump-img" src="/sprites/stump-dual.png" alt="" />
        <div className="shared-nail-slot left">
          <img src="/sprites/nail.png" alt="" style={{ transform: `translateY(${sinkPercentFor(player)}%)` }} />
        </div>
        <div className="shared-nail-slot right">
          <img src="/sprites/nail.png" alt="" style={{ transform: `translateY(${sinkPercentFor(opponent)}%)` }} />
        </div>
      </div>
    </div>
  );
}
