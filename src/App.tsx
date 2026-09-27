import { useEffect, useMemo, useState } from 'react';
import './App.css';
import {
  deriveSet, hintsFor, other, PIN_ROWS, scoreOf, WIN_SCORE,
  type SetState, type Team, type ThrowRecord,
} from './rules';
import { pct, playerStats, teamStats, type Rate } from './stats';
import {
  download, emptyData, loadData, saveData, setWinner, toCsv, uid,
  type AppData, type Match, type MatchKind, type SetEntry,
} from './store';

type Screen =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'play'; matchId: string }
  | { name: 'review' };

const today = () => new Date().toLocaleDateString('sv-SE');
const teamLabel = (t: Team) => (t === 'us' ? '自チーム' : '相手');

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  useEffect(() => {
    loadData().then(setData);
  }, []);

  const update = (fn: (d: AppData) => AppData) => {
    setData((prev) => {
      const next = fn(prev ?? emptyData());
      saveData(next);
      return next;
    });
  };

  if (!data) return <div className="screen">読み込み中…</div>;

  switch (screen.name) {
    case 'home':
      return <Home data={data} update={update} go={setScreen} />;
    case 'new':
      return <NewMatch data={data} update={update} go={setScreen} />;
    case 'review':
      return <Review data={data} go={setScreen} />;
    case 'play': {
      const m = data.matches.find((x) => x.id === screen.matchId);
      if (!m) return <Home data={data} update={update} go={setScreen} />;
      return <Play match={m} data={data} update={update} go={setScreen} />;
    }
  }
}

type Update = (fn: (d: AppData) => AppData) => void;
type Go = (s: Screen) => void;

function patchMatch(d: AppData, id: string, fn: (m: Match) => Match): AppData {
  return { ...d, matches: d.matches.map((m) => (m.id === id ? fn(m) : m)) };
}

function patchCurrentSet(m: Match, fn: (s: SetEntry) => SetEntry): Match {
  const sets = [...m.sets];
  sets[sets.length - 1] = fn(sets[sets.length - 1]);
  return { ...m, sets };
}

/* ---------------- Home ---------------- */

function Home({ data, update, go }: { data: AppData; update: Update; go: Go }) {
  const [armed, setArmed] = useState<string | null>(null);
  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as AppData;
      if (parsed.version !== 1 || !Array.isArray(parsed.matches)) throw new Error('bad');
      update(() => parsed);
    } catch {
      alert('バックアップファイルを読み込めませんでした');
    }
  };
  const matches = [...data.matches].reverse();
  return (
    <div className="screen">
      <header className="head">
        <div className="sub">モルック記録</div>
        <h1>試合一覧</h1>
      </header>
      <button className="primary big" onClick={() => go({ name: 'new' })}>新しい試合を始める</button>
      <div className="list">
        {matches.length === 0 && <div className="muted">まだ記録がありません。</div>}
        {matches.map((m) => {
          const won = m.sets.filter((s) => setWinner(s) === 'us').length;
          const lost = m.sets.filter((s) => setWinner(s) === 'them').length;
          return (
            <div key={m.id} className="card row">
              <button className="rowmain" onClick={() => go({ name: 'play', matchId: m.id })}>
                <div className="sub">{m.date}・{m.tournament || '（大会名なし）'}{m.kind === 'practice' ? '・練習' : ''}</div>
                <div className="strong">vs {m.opponent || '相手'}　{won}-{lost}</div>
              </button>
              <button
                className={armed === m.id ? 'danger small' : 'ghost small'}
                onClick={() => {
                  if (armed === m.id) {
                    update((d) => ({ ...d, matches: d.matches.filter((x) => x.id !== m.id) }));
                    setArmed(null);
                  } else setArmed(m.id);
                }}
              >
                {armed === m.id ? '本当に削除' : '削除'}
              </button>
            </div>
          );
        })}
      </div>
      <div className="spacer" />
      <div className="grid2">
        <button className="ghost" onClick={() => go({ name: 'review' })}>振り返り</button>
        <button className="ghost" onClick={() => download(`molkky-${today()}.csv`, toCsv(data), 'text/csv')}>CSV書き出し</button>
        <button className="ghost" onClick={() => download(`molkky-backup-${today()}.json`, JSON.stringify(data), 'application/json')}>バックアップ保存</button>
        <label className="ghost filebtn">
          バックアップ読込
          <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </label>
      </div>
      <div className="muted tiny">記録はこの端末の中だけに保存されます。こまめにバックアップしてください。</div>
    </div>
  );
}

/* ---------------- Lineup editor ---------------- */

function LineupEditor({ roster, lineup, onChange, onAddRoster }: {
  roster: string[]; lineup: string[]; onChange: (l: string[]) => void; onAddRoster: (n: string) => void;
}) {
  const [name, setName] = useState('');
  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (!roster.includes(n)) onAddRoster(n);
    if (!lineup.includes(n)) onChange([...lineup, n]);
    setName('');
  };
  return (
    <div className="card col">
      <div className="strong">投げる順番</div>
      {lineup.length === 0 && <div className="muted">下のメンバーをタップして順番に追加</div>}
      {lineup.map((p, i) => (
        <div key={p} className="lineup">
          <span className="num">{i + 1}</span>
          <span className="grow">{p}{i === 0 ? '（ブレーク）' : ''}</span>
          <button className="ghost small" disabled={i === 0} onClick={() => {
            const l = [...lineup];
            [l[i - 1], l[i]] = [l[i], l[i - 1]];
            onChange(l);
          }}>↑</button>
          <button className="ghost small" onClick={() => onChange(lineup.filter((x) => x !== p))}>×</button>
        </div>
      ))}
      <div className="chips">
        {roster.filter((r) => !lineup.includes(r)).map((r) => (
          <button key={r} className="chip" onClick={() => onChange([...lineup, r])}>＋ {r}</button>
        ))}
      </div>
      <div className="inline">
        <input value={name} placeholder="メンバーを追加" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="ghost small" onClick={add}>追加</button>
      </div>
    </div>
  );
}

function TeamToggle({ value, onChange }: { value: Team; onChange: (t: Team) => void }) {
  return (
    <div className="seg">
      {(['us', 'them'] as Team[]).map((t) => (
        <button key={t} className={value === t ? 'on' : ''} onClick={() => onChange(t)}>{teamLabel(t)}が先攻</button>
      ))}
    </div>
  );
}

/* ---------------- New match ---------------- */

function NewMatch({ data, update, go }: { data: AppData; update: Update; go: Go }) {
  const last = data.matches.at(-1);
  const [date, setDate] = useState(today());
  const [tournament, setTournament] = useState(last?.date === today() ? last.tournament : '');
  const [opponent, setOpponent] = useState('');
  const [kind, setKind] = useState<MatchKind>(last?.kind ?? 'tournament');
  const [firstTeam, setFirstTeam] = useState<Team>('us');
  const [lineup, setLineup] = useState<string[]>(last?.sets.at(-1)?.config.lineup ?? []);

  const start = () => {
    const m: Match = {
      id: uid(), date, tournament, opponent, kind,
      sets: [{ id: uid(), setNo: 1, config: { firstTeam, lineup }, records: [], closed: false }],
    };
    update((d) => ({ ...d, matches: [...d.matches, m] }));
    go({ name: 'play', matchId: m.id });
  };

  return (
    <div className="screen">
      <header className="head">
        <button className="link" onClick={() => go({ name: 'home' })}>← 戻る</button>
        <h1>セットの準備</h1>
      </header>
      <div className="card col">
        <label className="field">日付<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field">大会名<input value={tournament} onChange={(e) => setTournament(e.target.value)} placeholder="例：大和郡山オープン" /></label>
        <label className="field">相手チーム<input value={opponent} onChange={(e) => setOpponent(e.target.value)} /></label>
        <div className="seg">
          <button className={kind === 'tournament' ? 'on' : ''} onClick={() => setKind('tournament')}>大会</button>
          <button className={kind === 'practice' ? 'on' : ''} onClick={() => setKind('practice')}>練習</button>
        </div>
      </div>
      <div className="card col">
        <div className="strong">第1セット</div>
        <TeamToggle value={firstTeam} onChange={setFirstTeam} />
      </div>
      <LineupEditor
        roster={data.roster}
        lineup={lineup}
        onChange={setLineup}
        onAddRoster={(n) => update((d) => ({ ...d, roster: [...d.roster, n] }))}
      />
      <div className="spacer" />
      <button className="primary big" disabled={lineup.length === 0} onClick={start}>試合開始</button>
    </div>
  );
}

/* ---------------- Play ---------------- */

function Scoreboard({ state, current }: { state: SetState; current: Team | null }) {
  return (
    <div className="grid2">
      {(['us', 'them'] as Team[]).map((t) => {
        const s = state.teams[t];
        return (
          <div key={t} className={`card score ${t} ${current === t ? 'active' : ''}`}>
            <div className="label">{teamLabel(t)}</div>
            <div className="inline base">
              <span className="big-num">{s.score}</span>
              <span className="muted">残り{WIN_SCORE - s.score}</span>
            </div>
            <div className="dots">{[0, 1, 2].map((i) => <span key={i} className={i < s.faultStreak ? 'dot on' : 'dot'} />)}</div>
          </div>
        );
      })}
    </div>
  );
}

function Play({ match, update, go }: { match: Match; data: AppData; update: Update; go: Go }) {
  const set = match.sets[match.sets.length - 1];
  const state = useMemo(() => deriveSet(set.config, set.records), [set]);
  const winner = setWinner(set);
  const [override, setOverride] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const add = (rec: Omit<ThrowRecord, 'id' | 'ts'>) => {
    update((d) => patchMatch(d, match.id, (m) => patchCurrentSet(m, (s) => ({
      ...s, records: [...s.records, { ...rec, id: uid(), ts: Date.now() }],
    }))));
    setOverride(null);
  };
  const undo = () => update((d) => patchMatch(d, match.id, (m) => patchCurrentSet(m, (s) => ({
    ...s, records: s.records.slice(0, -1), manualWinner: undefined, closed: false,
  }))));

  const title = `vs ${match.opponent || '相手'}・第${set.setNo}セット`;

  if (winner || set.closed) {
    return <SetEnd match={match} set={set} state={state} winner={winner} update={update} go={go} undo={undo} title={title} />;
  }

  const next = state.nextTeam as Team;
  const player = override ?? state.nextPlayer ?? set.config.lineup[0];

  return (
    <div className="screen">
      <div className="topline">
        <button className="link" onClick={() => go({ name: 'home' })}>← 一覧</button>
        <span>{title}</span>
        <span>{teamLabel(set.config.firstTeam)}先攻</span>
      </div>
      <Scoreboard state={state} current={next} />
      {next === 'us'
        ? <PinInput state={state} player={player} lineup={set.config.lineup} onPlayer={setOverride} onThrow={add} />
        : <OpponentInput state={state} onThrow={add} />}
      <div className="spacer" />
      {manual ? (
        <div className="card col">
          <div className="strong">時間切れなどでセットを終える</div>
          <div className="grid2">
            {(['us', 'them'] as Team[]).map((t) => (
              <button key={t} className="ghost" onClick={() => update((d) => patchMatch(d, match.id, (m) => patchCurrentSet(m, (s) => ({ ...s, manualWinner: t, closed: true }))))}>
                {teamLabel(t)}の勝ち
              </button>
            ))}
          </div>
          <button className="link" onClick={() => setManual(false)}>やめる</button>
        </div>
      ) : (
        <div className="grid2">
          <button className="ghost" disabled={set.records.length === 0} onClick={undo}>1投取り消し</button>
          <button className="ghost" onClick={() => setManual(true)}>セットを終える…</button>
        </div>
      )}
    </div>
  );
}

function Hints({ state, team }: { state: SetState; team: Team }) {
  const hints = hintsFor(state, team);
  if (hints.length === 0) return null;
  return (
    <div className="col gap8">
      {hints.map((h) => (
        <div key={h.title} className={`hint ${h.level}`}>
          <div className="strong">{h.title}</div>
          <div>{h.body}</div>
        </div>
      ))}
    </div>
  );
}

function PinInput({ state, player, lineup, onPlayer, onThrow }: {
  state: SetState; player: string; lineup: string[];
  onPlayer: (p: string) => void; onThrow: (r: Omit<ThrowRecord, 'id' | 'ts'>) => void;
}) {
  const [pins, setPins] = useState<number[]>([]);
  const score = scoreOf(pins);
  const before = state.teams.us.score;
  const preview = before + score > WIN_SCORE ? 'バースト → 25点' : before + score === WIN_SCORE ? '50点ちょうど！' : `${before + score}点`;
  const toggle = (p: number) => setPins((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));
  const commit = (ps: number[]) => {
    onThrow({ team: 'us', player, pins: [...ps].sort((a, b) => a - b), score: scoreOf(ps) });
    setPins([]);
  };
  return (
    <>
      <div className="col gap4">
        <div className="inline between">
          <div className="sub">自チームの番（{state.teams.us.throws + 1}投目）</div>
          <select value={player} onChange={(e) => onPlayer(e.target.value)}>
            {lineup.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="h2">{player} の投擲：倒れたピンをタップ</div>
      </div>
      <Hints state={state} team="us" />
      <div className="pins">
        {[...PIN_ROWS].reverse().map((row, i) => (
          <div key={i} className="pinrow">
            {row.map((p) => (
              <button key={p} className={`pin ${pins.includes(p) ? 'on' : ''}`} onClick={() => toggle(p)}>{p}</button>
            ))}
          </div>
        ))}
        <div className="muted tiny center">奥 ↑　（初期配置）　↓ 手前</div>
      </div>
      <div className="card preview">
        <span>{pins.length === 0 ? 'ピン未選択' : `${pins.length}本 → ${score}点`}</span>
        <span className="strong">{pins.length > 0 ? preview : ''}</span>
      </div>
      <div className="grid3">
        <button className="ghost" disabled={pins.length === 0} onClick={() => setPins([])}>クリア</button>
        <button className="warnbtn" onClick={() => commit([])}>ミス</button>
        <button className="primary" disabled={pins.length === 0} onClick={() => commit(pins)}>決定</button>
      </div>
    </>
  );
}

function OpponentInput({ state, onThrow }: { state: SetState; onThrow: (r: Omit<ThrowRecord, 'id' | 'ts'>) => void }) {
  const t = state.teams.them;
  const need = WIN_SCORE - t.score;
  return (
    <>
      <div className="col gap4">
        <div className="sub">相手の番（{t.throws + 1}投目）</div>
        <div className="h2">相手の得点をタップ</div>
      </div>
      <div className="grid4">
        <button className="warnbtn tall" onClick={() => onThrow({ team: 'them', score: 0 })}>ミス</button>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
          <button key={n} className="numbtn tall" onClick={() => onThrow({ team: 'them', score: n })}>{n}</button>
        ))}
      </div>
      <div className="card col gap4">
        <div className="inline between"><span className="muted">連続ミス</span><span className="strong">{t.faultStreak}回</span></div>
        <div className="inline between"><span className="muted">上がりに必要な点</span><span className="strong">{need}点{need > 12 ? '（2投以上必要）' : ''}</span></div>
      </div>
    </>
  );
}

/* ---------------- Set end ---------------- */

function SetEnd({ match, set, state, winner, update, go, undo, title }: {
  match: Match; set: SetEntry; state: SetState; winner: Team | null;
  update: Update; go: Go; undo: () => void; title: string;
}) {
  const ours = state.rows.filter((r) => r.team === 'us');
  const afterOne = ours.filter((r) => r.faultStreak === 1);
  const entry = ours.find((r) => r.before < 38 && r.after >= 38 && r.after < WIN_SCORE);
  const last = state.rows.at(-1);
  const reason = set.manualWinner
    ? '手動で判定（時間切れなど）'
    : state.endReason === 'finish'
      ? `50点ちょうどに到達${last?.player ? `（${last.player}）` : ''}`
      : '相手が3回連続ミスで失格';

  // Next set's first team: sets 1→2 alternate; set 3 goes to the higher 1+2 total.
  const defaultFirst = (): Team => {
    if (match.sets.length === 1) return other(set.config.firstTeam);
    const tot = (t: Team) => match.sets.slice(0, 2).reduce((a, s) => a + deriveSet(s.config, s.records).teams[t].score, 0);
    const us = tot('us'), them = tot('them');
    return us === them ? other(set.config.firstTeam) : us > them ? 'us' : 'them';
  };
  const [first, setFirst] = useState<Team>(defaultFirst);
  const [lineup, setLineup] = useState(set.config.lineup);
  const [editLineup, setEditLineup] = useState(false);

  const nextSet = () => {
    update((d) => patchMatch(d, match.id, (m) => ({
      ...patchCurrentSet(m, (s) => ({ ...s, closed: true })),
      sets: [
        ...m.sets.slice(0, -1), { ...set, closed: true },
        { id: uid(), setNo: set.setNo + 1, config: { firstTeam: first, lineup }, records: [], closed: false },
      ],
    })));
  };
  const finishMatch = () => {
    update((d) => patchMatch(d, match.id, (m) => patchCurrentSet(m, (s) => ({ ...s, closed: true }))));
    go({ name: 'home' });
  };

  return (
    <div className="screen">
      <div className="topline"><button className="link" onClick={() => go({ name: 'home' })}>← 一覧</button><span>{title}</span><span /></div>
      <div className={`result ${winner === 'them' ? 'lose' : ''}`}>
        <div>セット終了（自動判定）</div>
        <div className="result-title">{winner ? `${teamLabel(winner)}の勝ち` : '判定なし'}</div>
        <div>決着：{reason}</div>
        <div className="inline base gap12">
          <span className="huge">{state.teams.us.score}</span><span>対</span><span className="huge dim">{state.teams.them.score}</span>
        </div>
      </div>
      <div className="card col">
        <div className="strong">このセットの自チーム</div>
        <div className="grid2">
          <Stat label="投擲数" value={String(ours.length)} />
          <Stat label="ミス" value={String(ours.filter((r) => r.score === 0).length)} />
          <Stat label="1ミス直後" value={afterOne.length === 0 ? '—' : `${afterOne.filter((r) => r.score > 0).length}/${afterOne.length} ヒット`} />
          <Stat label="38点に入った時" value={entry ? `残り${WIN_SCORE - entry.after}点` : '—'} />
        </div>
      </div>
      <div className="card col">
        <div className="strong">第{set.setNo + 1}セット</div>
        <TeamToggle value={first} onChange={setFirst} />
        {editLineup
          ? <LineupEditor roster={lineup} lineup={lineup} onChange={setLineup} onAddRoster={() => {}} />
          : <div className="inline between"><span>順番：{lineup.join(' → ')}</span><button className="link" onClick={() => setEditLineup(true)}>変える</button></div>}
      </div>
      <div className="spacer" />
      <div className="grid3">
        <button className="ghost" onClick={undo}>最後の1投を修正</button>
        <button className="ghost" onClick={finishMatch}>試合終了</button>
        <button className="primary" onClick={nextSet}>次のセットへ</button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="muted tiny">{label}</div>
      <div className="strong">{value}</div>
    </div>
  );
}

/* ---------------- Review ---------------- */

const GOALS: { key: 'overall' | 'afterOneMiss' | 'throws4to6' | 'over38'; label: string; goal: number }[] = [
  { key: 'overall', label: '全体', goal: 0.19 },
  { key: 'afterOneMiss', label: '1回ミス直後', goal: 0.22 },
  { key: 'throws4to6', label: '4〜6投目', goal: 0.23 },
  { key: 'over38', label: '38点以上', goal: 0.3 },
];

function Bar({ label, r, goal }: { label: string; r: Rate; goal: number }) {
  const w = Number.isNaN(r.fault) ? 0 : Math.min(100, (r.fault / 0.4) * 100);
  return (
    <div className="col gap4">
      <div className="inline between">
        <span>{label}</span>
        <span><span className="strong">{pct(r.fault)}</span><span className="muted">　目標 {pct(goal, 0)}・{r.n}投</span></span>
      </div>
      <div className="bar"><div className={r.fault > goal ? 'fill warn' : 'fill'} style={{ width: `${w}%` }} /></div>
    </div>
  );
}

function Review({ data, go }: { data: AppData; go: Go }) {
  const [scope, setScope] = useState<'tournament' | 'all'>('tournament');
  const [tour, setTour] = useState<string>('');
  const tournaments = [...new Set(data.matches.map((m) => `${m.date} ${m.tournament}`))].reverse();
  const matches = data.matches.filter((m) =>
    (scope === 'all' || m.kind === 'tournament') && (!tour || `${m.date} ${m.tournament}` === tour));
  const sets = matches.flatMap((m) => m.sets);
  const s = teamStats(sets);
  const ps = playerStats(sets);
  return (
    <div className="screen">
      <header className="head">
        <button className="link" onClick={() => go({ name: 'home' })}>← 戻る</button>
        <h1>振り返り</h1>
      </header>
      <div className="seg">
        <button className={scope === 'tournament' ? 'on' : ''} onClick={() => setScope('tournament')}>大会のみ</button>
        <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>練習も含む</button>
      </div>
      <select value={tour} onChange={(e) => setTour(e.target.value)}>
        <option value="">すべての日</option>
        {tournaments.map((t) => <option key={t}>{t}</option>)}
      </select>
      <div className="muted">{matches.length}試合・{s.sets}セット・{s.throws}投・50点で上がったセット {s.finishedSets}</div>
      <div className="card col">
        <div className="inline between"><span className="strong">目標との比較</span><span className="muted tiny">フォルト（0点）率</span></div>
        {GOALS.map((g) => <Bar key={g.key} label={g.label} r={s[g.key]} goal={g.goal} />)}
        <div className="muted tiny">バーは40%を右端とした目安。件数が少ない項目は参考値です。</div>
      </div>
      <div className="card col">
        <div className="strong">その他</div>
        <div className="grid2">
          <Stat label="2ミス後のヒット" value={`${s.afterTwoMisses.hits}/${s.afterTwoMisses.n}`} />
          <Stat label="バースト" value={`${s.bursts}回`} />
          <Stat label="1投目の平均" value={Number.isNaN(s.firstThrowAvg) ? '—' : s.firstThrowAvg.toFixed(2)} />
          <Stat label="上がりまでの投数" value={Number.isNaN(s.throwsPerFinishedSet) ? '—' : s.throwsPerFinishedSet.toFixed(1)} />
        </div>
      </div>
      <div className="card col">
        <div className="strong">選手ごと（1投目を除く）</div>
        <table>
          <thead><tr><th>選手</th><th>フォルト</th><th>平均</th><th>38点以上</th><th>残り5〜9</th></tr></thead>
          <tbody>
            {ps.map((p) => (
              <tr key={p.player}>
                <td>{p.player}</td>
                <td>{pct(p.nonFirst.fault, 0)}<span className="muted tiny"> {p.nonFirst.n}</span></td>
                <td>{p.avgScore.toFixed(1)}</td>
                <td>{pct(p.zone.fault, 0)}<span className="muted tiny"> {p.zone.n}</span></td>
                <td>{p.rem5to9.finishes}/{p.rem5to9.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted tiny">「残り5〜9」は上がれた回数／挑戦した回数。</div>
      </div>
    </div>
  );
}
