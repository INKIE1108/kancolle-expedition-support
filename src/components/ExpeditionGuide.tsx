import { useState } from 'react';
import type { Expedition } from '../types';
import { monthlyParents, prerequisiteLayers, recommendMonthly, riskLabels, type MonthlyGoal } from '../utils/expeditionGuide';
import { minutesToLabel } from '../utils/time';

export function CombatBadge({ expedition }: { expedition: Expedition }) {
  if (!expedition.combatType) return null;
  return <span className={`combat-badge combat-${expedition.combatType}`}>{riskLabels[expedition.combatType]}</span>;
}

export function UnlockRoute({ expedition, list, onSelect }: { expedition: Expedition; list: Expedition[]; onSelect: (id: string) => void }) {
  const layers = prerequisiteLayers(expedition.id, list);
  const group = (depth: number) => <div className="route-layer" key={depth}>
    <strong>{depth === 1 ? '1個前：直接の前提' : `${depth}個前の前提`}</strong>
    <div className="route-chips">{layers.filter(item => item.depth === depth).map(({ expedition: item }) =>
      <button type="button" key={item.id} onClick={() => onSelect(item.id)}>{item.id} {item.name}</button>
    )}</div>
  </div>;
  return <section className="unlock-route" aria-label="開放ルート">
    <h3>開放ルート</h3>
    <p>近い前提から表示。複数ある場合は、各遠征の条件を確認してね。</p>
    <div className="route-target">目的：{expedition.id} {expedition.name}</div>
    {[1, 2].filter(d => layers.some(item => item.depth === d)).map(group)}
    {layers.some(item => item.depth > 2) && <details key={expedition.id}>
      <summary>3個前より先も見る（{layers.filter(item => item.depth > 2).length}件）</summary>
      <div className="route-expanded">{[...new Set(layers.filter(item => item.depth > 2).map(item => item.depth))].map(group)}</div>
    </details>}
  </section>;
}

export function MonthlyLinks({ expedition, list, done, onSelect }: { expedition: Expedition; list: Expedition[]; done: string[]; onSelect: (id: string) => void }) {
  const parents = monthlyParents(expedition, list);
  const next = list.filter(e => monthlyParents(e, list).some(p => p.id === expedition.id));
  if (!parents.length && !next.length) return null;
  return <div className="monthly-links">
    {parents.length > 0 && <div><strong>今期の前提（すべて必要）</strong><div className="route-chips">{parents.map(p =>
      <button type="button" key={p.id} onClick={() => onSelect(p.id)}>{done.includes(p.id) ? '✅' : '未記録'} {p.id} {p.name} →</button>
    )}</div></div>}
    {next.length > 0 && <div><strong>この遠征の次に進める候補</strong><div className="route-chips">{next.map(p =>
      <button type="button" key={p.id} onClick={() => onSelect(p.id)}>→ {p.id} {p.name}</button>
    )}</div><small>ほかの前提がある場合は、その達成も必要です。</small></div>}
  </div>;
}

export function MonthlyRecommendations({ list, done, onSelect }: { list: Expedition[]; done: string[]; onSelect: (id: string) => void }) {
  const [goal, setGoal] = useState<MonthlyGoal>('balanced');
  const [avoidHeavy, setAvoidHeavy] = useState(false);
  const recommendations = recommendMonthly(list, done, goal, avoidHeavy);
  return <section className="monthly-recommendations" aria-label="マンスリーおすすめ">
    <h3>今期のおすすめ！</h3>
    <div className="recommendation-controls">
      <label>優先したい報酬 <select value={goal} onChange={e => setGoal(e.target.value as MonthlyGoal)}>
        <option value="balanced">資源＋アイテム</option><option value="screws">改修資材</option>
        <option value="bauxite">ボーキサイト</option><option value="fuel">燃料</option><option value="items">アイテム</option>
      </select></label>
      <label><input type="checkbox" checked={avoidHeavy} onChange={e => setAvoidHeavy(e.target.checked)} />🔴 交戦II型を除く</label>
    </div>
    <p>未実施から最大5件。成功時の基本資源量とアイテムを比較（消費・修理費、大発補正、前提の所要時間は含みません）。改修資材は大成功を目指してね。</p>
    {recommendations.length === 0 && <p>この条件の未実施遠征はありません。</p>}
    <div className="recommendation-grid">{recommendations.map(({ expedition: e, reason, missing }) => <article key={e.id}>
      <button type="button" className="recommendation-title" onClick={() => onSelect(e.id)}>{e.id} {e.name}</button>
      <CombatBadge expedition={e} /><strong>{reason}</strong>
      <span>{minutesToLabel(e.durationMinutes)} ・ 燃{e.rewards.fuel} / 弾{e.rewards.ammo} / 鋼{e.rewards.steel} / ボ{e.rewards.bauxite}</span>
      <small>{e.itemReward}</small>
      {missing.length ? <div><strong>先にこの前提を記録</strong><div className="route-chips">{missing.map(p => <button type="button" key={p.id} onClick={() => onSelect(p.id)}>{p.id} {p.name}</button>)}</div></div>
        : <small>✅ 今期の前提に未記録なし（初回開放条件は詳細で確認）</small>}
    </article>)}</div>
  </section>;
}
