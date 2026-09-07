import { useMemo, useState } from 'react';
import type { Expedition } from '../types';
import { monthlyParents, prerequisiteLayers, recommendMonthly, riskLabels, type MonthlyGoal, type MonthlyStrategy } from '../utils/expeditionGuide';
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
    <div className="route-layer"><strong>1個前：直接の前提</strong>
      {layers.filter(item => item.depth === 1).map(({ expedition: parent }) => <div className="route-branch" key={parent.id}>
        <div className="route-chips"><button type="button" onClick={() => onSelect(parent.id)}>{parent.id} {parent.name}</button><CombatBadge expedition={parent} /></div>
        {(parent.prerequisites ?? []).some(p => list.some(e => e.id === p.expeditionId)) && <div className="route-branch-parents">
          <small>2個前：{parent.id} に必要な前提</small>
          <div className="route-chips">{(parent.prerequisites ?? []).map(p => list.find(e => e.id === p.expeditionId)).filter((e): e is Expedition => Boolean(e)).map(e => <button type="button" key={e.id} onClick={() => onSelect(e.id)}>{e.id} {e.name}</button>)}</div>
        </div>}
      </div>)}
      {layers.length === 0 && <p>前提の遠征は登録されていません。ほかの開放条件も確認してください。</p>}
    </div>
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
  const [strategy, setStrategy] = useState<MonthlyStrategy>('reward');
  const [avoidHeavy, setAvoidHeavy] = useState(false);
  const [readyOnly, setReadyOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const recommendations = useMemo(() => recommendMonthly(list, done, goal, avoidHeavy, { strategy, readyOnly }), [list, done, goal, avoidHeavy, strategy, readyOnly]);
  return <section className="monthly-recommendations" aria-label="マンスリーおすすめ">
    <h3>今期のおすすめ！</h3>
    <div className="recommendation-controls">
      <label>優先したい報酬 <select value={goal} onChange={e => { setGoal(e.target.value as MonthlyGoal); setExpanded(false); }}>
        <option value="balanced">資源＋アイテム</option><option value="screws">改修資材</option>
        <option value="bauxite">ボーキサイト</option><option value="fuel">燃料</option><option value="items">アイテム</option>
      </select></label>
      <label>選び方 <select value={strategy} onChange={e => setStrategy(e.target.value as MonthlyStrategy)}>
        <option value="reward">報酬重視</option><option value="efficiency">前提込みの時間効率</option><option value="safe">損傷回避</option>
      </select></label>
      <label><input type="checkbox" checked={readyOnly} onChange={e => setReadyOnly(e.target.checked)} />今期の前提を記録済みのみ</label>
      <label><input type="checkbox" checked={avoidHeavy} onChange={e => setAvoidHeavy(e.target.checked)} />🔴 前提を含めて交戦II型を除く</label>
    </div>
    <details className="recommendation-explanation"><summary>おすすめの計算方法</summary>
      <p>資源は成功時の基本量、アイテムは最大入手数を使った独自の比較点です。確率を含む期待値ではありません。時間効率は目標遠征の比較点を、未記録の前提マンスリーを含む時間で割ります。前提でもらえる報酬・初回開放にかかる時間・消費・修理費・大発補正は含みません。</p>
      <p>損傷回避は前提を含む交戦リスクが低い順。同じリスクなら報酬で比較します。通常遠征の初回クリア状況は未管理なので、交戦II型の除外は初回前提も含めた慎重な判定です。</p>
    </details>
    {recommendations.length === 0 && <p>この条件の未実施遠征はありません。絞り込み条件を変更してみてね。</p>}
    <div className="recommendation-grid">{(expanded ? recommendations : recommendations.slice(0, 3)).map(({ expedition: e, reason, missing, risks, routeMinutes }) => <article key={e.id}>
      <button type="button" className="recommendation-title" onClick={() => onSelect(e.id)}>{e.id} {e.name}</button>
      <CombatBadge expedition={e} /><strong>{reason}</strong>
      <span>{minutesToLabel(e.durationMinutes)}{missing.length > 0 && ` ／ 前提込み ${minutesToLabel(routeMinutes)}`}</span>
      {missing.length > 0 ? <small>前提の未記録 {missing.length}件</small> : <small>✅ 今期の前提は記録済み／なし</small>}
      {risks.some(p => p.id !== e.id && p.combatType === 'II') && <strong className="route-risk-warning">🔴 前提ルートに交戦II型あり</strong>}
      <details className="recommendation-details"><summary>報酬・前提を確認</summary>
        <p>燃{e.rewards.fuel} / 弾{e.rewards.ammo} / 鋼{e.rewards.steel} / ボ{e.rewards.bauxite}</p><small>{e.itemReward}</small>
        {missing.length > 0 && <div><strong>先にこの前提を記録（手前から順に）</strong><div className="route-chips">{missing.map(p => <button type="button" key={p.id} onClick={() => onSelect(p.id)}>{p.id} {p.name}</button>)}</div></div>}
        {risks.filter(p => p.id !== e.id).map(p => <div key={p.id}><small>{p.id} {p.name}</small><CombatBadge expedition={p} /></div>)}
        <small>初回の開放条件・編成条件は遠征詳細で確認してください。</small>
      </details>
    </article>)}</div>
    {recommendations.length > 3 && <button type="button" className="show-more" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? '上位3件にたたむ' : `上位${recommendations.length}件を表示`}</button>}
  </section>;
}
