import './App.css';
import { useEffect, useRef, useState } from 'react';
import { emptyData, loadData, saveData, stampChanged, type AppData } from './store';
import { type Screen } from './ui';
import { useTeamSync } from './useTeamSync';
import { Home } from './screens/Home';
import { TeamSync } from './screens/TeamSync';
import { NewMatch } from './screens/NewMatch';
import { PracticeSetup } from './screens/PracticeSetup';
import { Play } from './screens/Play';
import { MatchSummary } from './screens/MatchSummary';
import { Review } from './screens/Review';

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  // The latest data, so consecutive updates and the sync see every change in order.
  const dataRef = useRef<AppData | null>(null);
  const sync = useTeamSync(() => dataRef.current?.matches ?? []);

  useEffect(() => {
    loadData().then((d) => {
      dataRef.current = d;
      setData(d);
    });
  }, []);

  const update = (fn: (d: AppData) => AppData) => {
    const prev = dataRef.current ?? emptyData();
    const next = stampChanged(prev, fn(prev));
    dataRef.current = next;
    setData(next);
    saveData(next);
    sync.onChange(prev, next);
  };

  if (!data) return <div className="screen">Loading…</div>;
  // Own matches plus teammates' (read-only), for lists and review.
  const all = [...data.matches, ...sync.remote.map((g) => ({ ...g.match, remoteBy: g.recorder || 'a teammate' }))];

  switch (screen.name) {
    case 'home':
      return <Home data={data} all={all} update={update} go={setScreen} sync={sync} />;
    case 'sync':
      return <TeamSync sync={sync} matches={data.matches} go={setScreen} />;
    case 'new':
      return <NewMatch data={data} update={update} go={setScreen} />;
    case 'practice':
      return <PracticeSetup data={data} update={update} go={setScreen} />;
    case 'review':
      return <Review matches={all} go={setScreen} />;
    case 'play': {
      const m = data.matches.find((x) => x.id === screen.matchId);
      if (!m) return <Home data={data} all={all} update={update} go={setScreen} sync={sync} />;
      return <Play match={m} data={data} update={update} go={setScreen} />;
    }
    case 'match': {
      const m = all.find((x) => x.id === screen.matchId);
      if (!m) return <Home data={data} all={all} update={update} go={setScreen} sync={sync} />;
      return <MatchSummary match={m} update={update} go={setScreen} />;
    }
  }
}
