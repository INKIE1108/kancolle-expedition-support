import type { Expedition } from '../types';

export function monthlyPeriodKey(timestamp = Date.now()): string {
  const jst = new Date(timestamp + 9 * 3600000);
  if (jst.getUTCDate() < 15 || (jst.getUTCDate() === 15 && jst.getUTCHours() < 12)) {
    jst.setUTCDate(1);
    jst.setUTCMonth(jst.getUTCMonth() - 1);
  }
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthlyParents(expedition: Expedition, list: Expedition[]): Expedition[] {
  return (expedition.prerequisites ?? [])
    .filter(p => p.note?.includes('毎月'))
    .map(p => list.find(e => e.id === p.expeditionId))
    .filter((e): e is Expedition => Boolean(e));
}

// Breadth-first traversal keeps direct prerequisites first and assigns shortest distance.
export function prerequisiteLayers(id: string, list: Expedition[]) {
  const seen = new Set([id]);
  const result: { expedition: Expedition; depth: number }[] = [];
  const queue = [{ id, depth: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const p of list.find(e => e.id === current.id)?.prerequisites ?? []) {
      const expedition = list.find(e => e.id === p.expeditionId);
      if (!expedition || seen.has(expedition.id)) continue;
      seen.add(expedition.id);
      const depth = current.depth + 1;
      result.push({ expedition, depth });
      queue.push({ id: expedition.id, depth });
    }
  }
  return result;
}

export const riskLabels = {
  II: '🔴 交戦II型・大破しやすい',
  I: '🟠 交戦I型・損傷あり',
  none: '🟢 交戦なし'
};

export type MonthlyGoal = 'balanced' | 'screws' | 'bauxite' | 'fuel' | 'items';

export type MonthlyStrategy = 'reward' | 'efficiency' | 'safe';

// Stop at completed monthly prerequisites; deduplicate branches and cycles.
export function outstandingMonthlyParents(expedition: Expedition, list: Expedition[], completed: string[]) {
  const seen = new Set([expedition.id, ...completed]);
  const result: Expedition[] = [];
  const visit = (e: Expedition) => {
    for (const parent of monthlyParents(e, list)) {
      if (seen.has(parent.id)) continue;
      seen.add(parent.id);
      visit(parent);
      result.push(parent);
    }
  };
  visit(expedition);
  return result;
}

export function routeCombatRisk(expedition: Expedition, list: Expedition[], completed: string[]) {
  const seen = new Set([expedition.id]);
  const route = [expedition];
  for (let i = 0; i < route.length; i++) {
    for (const p of route[i].prerequisites ?? []) {
      const parent = list.find(e => e.id === p.expeditionId);
      if (!parent || seen.has(parent.id)) continue;
      seen.add(parent.id);
      if (parent.purposeTags.includes('マンスリー') && completed.includes(parent.id)) continue;
      route.push(parent);
    }
  }
  return route.filter(e => e.combatType === 'I' || e.combatType === 'II');
}

// Item ranges describe possible rewards, not drop probabilities or expected values.
function itemMaximum(expedition: Expedition, name: string) {
  const match = expedition.itemReward.match(new RegExp(name + '[^0-9/]*([0-9]+)(?:[〜～~－-]([0-9]+))?'));
  return match ? Number(match[2] ?? match[1]) : 0;
}

export function recommendMonthly(list: Expedition[], completed: string[], goal: MonthlyGoal, avoidHeavy: boolean,
  options: { strategy?: MonthlyStrategy; readyOnly?: boolean } = {}) {
  const done = new Set(completed);
  return list.filter(e => e.purposeTags.includes('マンスリー') && !done.has(e.id)).map(expedition => {
    const screws = itemMaximum(expedition, '改修資材');
    const special = itemMaximum(expedition, '伊良湖');
    const buckets = itemMaximum(expedition, '高速修復材');
    const total = Object.values(expedition.rewards).reduce((a, b) => a + b, 0);
    const missing = outstandingMonthlyParents(expedition, list, completed);
    const risks = routeCombatRisk(expedition, list, completed);
    const risk = Math.max(0, ...risks.map(e => e.combatType === 'II' ? 2 : 1));
    const routeMinutes = expedition.durationMinutes + missing.reduce((sum, e) => sum + e.durationMinutes, 0);
    const score = goal === 'screws' ? screws * 10000 + total
      : goal === 'fuel' ? expedition.rewards.fuel
      : goal === 'bauxite' ? expedition.rewards.bauxite
      : goal === 'items' ? special * 12000 + screws * 10000 + buckets * 5000 + total
      : screws * 2000 + special * 1200 + total;
    const eligible = goal === 'screws' ? screws > 0 : goal === 'items' ? special + screws + buckets > 0 : score > 0;
    return { expedition, missing, risks, risk, routeMinutes, score, eligible,
      efficiency: score / Math.max(1, routeMinutes) * 60,
      reason: goal === 'fuel' ? `燃料 ${expedition.rewards.fuel}（成功時）`
        : goal === 'bauxite' ? `ボーキ ${expedition.rewards.bauxite}（成功時）`
        : special && goal === 'items' ? `伊良湖 最大${special}個（確率入手）`
        : screws ? `改修資材 最大${screws}個（大成功を目指そう）` : `基本資源の合計 ${total}` };
  }).filter(r => r.eligible && (!avoidHeavy || r.risk < 2) && (!options.readyOnly || r.missing.length === 0))
    .sort((a, b) => (options.strategy === 'safe' ? a.risk - b.risk : 0)
      || (options.strategy === 'efficiency' ? b.efficiency - a.efficiency : b.score - a.score)
      || a.routeMinutes - b.routeMinutes).slice(0, 5);
}

const names: Record<string, string> = {
  軽巡: '軽巡', 練巡: '練巡', 駆逐: '駆逐', 海防: '海防', 水母: '水母',
  '空母系': '軽空母', '潜水空母': '潜水艦'
};

export function concreteFormation(value: string) {
  if (value.startsWith('駆逐2が最低条件')) return { requirement: '駆逐2【必須・最低条件】', example: '駆逐2（最低条件のみ。支援威力は編成・装備で変わります）' };
  const source = value.replace(/。.*$/, '').replace(/^艦種自由/, '自由').replace(/\s/g, '');
  const tokens = source.split(/[＋+]/);
  const requirements: string[] = [];
  const examples: string[] = [];
  for (const token of tokens) {
    const m = token.match(/^(.+?)(\d+)(?:隻)?$/);
    if (!m) return { requirement: value, example: '編成条件の艦種・隻数を確認してください。' };
    const [, raw, count] = m;
    const flagship = raw.includes('旗艦');
    const choices = raw.replace(/[()（）]/g, '').replace('旗艦', '').split(/\/|or/);
    const free = choices[0] === '自由' || choices[0] === '自由枠';
    const chosen = choices.includes('軽巡') ? '軽巡' : choices[0];
    requirements.push(free ? `自由${count}` : `${choices.length > 1 ? `（${choices.join(' または ')}）` : chosen}${count}${flagship ? '【旗艦】' : '【必須】'}`);
    examples.push(`${free ? '駆逐' : names[chosen] ?? chosen}${count}${free ? '（自由枠）' : flagship ? '（旗艦）' : ''}`);
  }
  return { requirement: requirements.join(' ＋ '), example: examples.join(' ＋ ') };
}

export function isMonthlyCompleted(expedition: Expedition | undefined, completed: string[]): boolean {
  return Boolean(expedition?.purposeTags.includes('マンスリー') && completed.includes(expedition.id));
}

export function sanitizeMonthlyChecks(checks: Record<string, string[]>, list: Expedition[]) {
  const monthlyIds = new Set(list.filter(e => e.purposeTags.includes('マンスリー')).map(e => e.id));
  return Object.fromEntries(Object.entries(checks).map(([period, ids]) =>
    [period, [...new Set(ids.filter(id => monthlyIds.has(id)))]]));
}

// Legacy manual checks have no individual timestamps. Preserve the latest calendar-month
// checks in the period containing their snapshot; reconstruct dated records accurately.
export function migrateMonthlyChecks(old: Record<string, string[]>, history: { expeditionId: string; completedAt: number }[], list: Expedition[], savedAt = Date.now()) {
  const migrated: Record<string, string[]> = {};
  for (const record of history) {
    const key = monthlyPeriodKey(record.completedAt);
    migrated[key] = [...new Set([...(migrated[key] ?? []), record.expeditionId])];
  }
  const jst = new Date(savedAt + 9 * 3600000);
  const calendar = `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
  const period = monthlyPeriodKey(savedAt);
  migrated[period] = [...new Set([...(migrated[period] ?? []), ...(old[calendar] ?? [])])];
  return sanitizeMonthlyChecks(migrated, list);
}
