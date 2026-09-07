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

export function recommendMonthly(list: Expedition[], completed: string[], goal: MonthlyGoal, avoidHeavy: boolean) {
  const done = new Set(completed);
  const candidates = list.filter(e => e.purposeTags.includes('マンスリー') && !done.has(e.id)
    && (!avoidHeavy || e.combatType !== 'II'));
  return candidates.map(expedition => {
    const screws = expedition.itemReward.includes('改修資材');
    const special = expedition.itemReward.includes('伊良湖');
    const total = Object.values(expedition.rewards).reduce((a, b) => a + b, 0);
    const missing = monthlyParents(expedition, list).filter(e => !done.has(e.id));
    const score = goal === 'screws' ? (screws ? 10000 : 0) + total
      : goal === 'fuel' ? expedition.rewards.fuel
      : goal === 'bauxite' ? expedition.rewards.bauxite
      : goal === 'items' ? (special ? 12000 : screws ? 10000 : expedition.itemReward.includes('高速修復材') ? 5000 : 0) + total
      : (screws ? 2000 : 0) + (special ? 1200 : 0) + total;
    return { expedition, missing, score,
      reason: goal === 'fuel' ? `燃料 ${expedition.rewards.fuel}（成功時）`
        : goal === 'bauxite' ? `ボーキ ${expedition.rewards.bauxite}（成功時）`
        : special && goal === 'items' ? '伊良湖を狙える（確率入手）'
        : screws ? '大成功で改修資材を獲得' : `基本資源の合計 ${total}` };
  }).sort((a, b) => b.score - a.score || a.expedition.durationMinutes - b.expedition.durationMinutes).slice(0, 5);
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

// Legacy manual checks have no individual timestamps. Preserve the latest calendar-month
// checks in the period containing their snapshot; reconstruct dated records accurately.
export function migrateMonthlyChecks(old: Record<string, string[]>, history: { expeditionId: string; completedAt: number }[], savedAt = Date.now()) {
  const migrated: Record<string, string[]> = {};
  for (const record of history) {
    const key = monthlyPeriodKey(record.completedAt);
    migrated[key] = [...new Set([...(migrated[key] ?? []), record.expeditionId])];
  }
  const jst = new Date(savedAt + 9 * 3600000);
  const calendar = `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
  const period = monthlyPeriodKey(savedAt);
  migrated[period] = [...new Set([...(migrated[period] ?? []), ...(old[calendar] ?? [])])];
  return migrated;
}
