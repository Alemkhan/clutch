import { Composition } from 'remotion';
import { Promo, PROMO_DURATION } from './Promo';
import { A_DURATION, B_DURATION, PromoA, PromoB } from './Promos';

export const Root = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={PROMO_DURATION} fps={30} width={1080} height={1920} />
    {/* Full-bleed experiments; the phone cut above read better. */}
    <Composition id="PromoA" component={PromoA} durationInFrames={A_DURATION} fps={30} width={1080} height={1920} />
    <Composition id="PromoB" component={PromoB} durationInFrames={B_DURATION} fps={30} width={1080} height={1920} />
  </>
);
