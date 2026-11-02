// Curated from content/other-flags/pending.json. The owner approved the free municipal
// and state symbols for the live «Другие флаги» pool on 2026-11-01. Organisation marks
// and explicitly blocked files remain inventory-only until their rights review is complete.
import inventory from '../../../../content/other-flags/pending.json';
import type { HistoricFlagPool } from './historicFlags';

type InventoryItem = {
  id: string;
  group: 'us_state' | 'kazakhstan_city' | 'organisation';
  labelRu: string;
  adoptedYear: number | null;
  assetKind: 'flag' | 'coat_of_arms';
  wikidataUrl: string;
  sourceTitle: string;
  assetLicenseStatus: 'free' | 'manual_review';
  reviewStatus: 'pending' | 'approved_ready' | 'blocked';
  trademarkReview?: 'required';
  asset: { url: string; pageUrl: string; license: string; author: string | null };
};

type OtherHistoricFlag = {
  id: string;
  labelRu: string;
  era: string;
  mediaUrl: string;
  assetKind: 'flag' | 'coat_of_arms';
  factRu: string;
  sourceUrl: string;
  assetPageUrl: string;
  assetLicense: string;
  assetAuthor: string | null;
  pool: Exclude<HistoricFlagPool, 'historic'>;
};

const items = (inventory.items as InventoryItem[])
  .filter((item) => item.group !== 'organisation' && item.assetLicenseStatus === 'free' && item.reviewStatus !== 'blocked' && !item.trademarkReview)
  .sort((a, b) => a.id.localeCompare(b.id));

// Wikidata can contain several competing depictions of the same coat of arms. One answer
// label must map to one image, so retain the deterministic first reviewed file only.
const unique = [...new Map(items.map((item) => [`${item.group}:${item.labelRu}:${item.assetKind}`, item])).values()];

export const otherFlags: OtherHistoricFlag[] = unique.map((item) => {
  const kindRu = item.assetKind === 'coat_of_arms' ? 'Герб' : 'Флаг';
  const period = item.adoptedYear ? String(item.adoptedYear) : 'действует';
  return {
    id: `other-${item.id.replace(/[^a-z0-9]+/gi, '-')}`.toLowerCase(),
    labelRu: `${kindRu} ${item.labelRu}`,
    era: period,
    mediaUrl: item.asset.url,
    assetKind: item.assetKind,
    factRu: `${kindRu} ${item.labelRu}. Изображение: Wikimedia Commons (${item.asset.license}).`,
    sourceUrl: item.wikidataUrl,
    assetPageUrl: item.asset.pageUrl,
    assetLicense: item.asset.license,
    assetAuthor: item.asset.author,
    pool: item.group === 'kazakhstan_city' ? 'kz_city' : 'us_state',
  };
});
