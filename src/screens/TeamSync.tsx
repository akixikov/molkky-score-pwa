// Team sync settings: web app URL, passphrase and status.
import { useState, type ChangeEvent } from 'react';

import { type Match } from '../store';
import { errorText, isConfigured, newSettings, pendingCount, ping, URL_RE, type SyncSettings } from '../sync';
import { type Go } from '../ui';
import { type Sync, clock, showsWhenIdle } from '../useTeamSync';

/** Connects this phone to the team spreadsheet's web app. */
export function TeamSync({ sync, matches, go }: { sync: Sync; matches: Match[]; go: Go }) {
  const [form, setForm] = useState<SyncSettings>(() => sync.settings ?? newSettings());
  const [test, setTest] = useState('');
  const [armed, setArmed] = useState(false);
  const clean = { ...form, url: form.url.trim(), token: form.token.trim(), recorder: form.recorder.trim() };
  const urlOk = URL_RE.test(clean.url);
  const valid = urlOk && !!clean.token && !!clean.recorder;
  const on = isConfigured(sync.settings);
  const pending = pendingCount(sync.queue);
  const field = (k: 'url' | 'token' | 'recorder') => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const testConnection = async () => {
    setTest('Testing…');
    const r = await ping(clean);
    setTest(r.ok ? 'Connected.' : errorText(r.error));
  };
  return (
    <div className="screen">
      <header className="head">
        <button className="link" onClick={() => go({ name: 'home' })}>← Back</button>
        <h1>Team sync</h1>
      </header>
      <div className="muted">
        Sends the matches recorded on this phone to the team spreadsheet. Ask the person who set up the sheet for the web app URL and the passphrase.
      </div>
      <div className="card col">
        <label className="field">
          Web app URL
          <input value={form.url} onChange={field('url')} placeholder="https://script.google.com/macros/s/…/exec" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
        {form.url.trim() && !urlOk && <div className="muted tiny warn-text">The URL should start with https://script.google.com/macros/s/ and end with /exec.</div>}
        <label className="field">Passphrase<input type="password" value={form.token} onChange={field('token')} autoCapitalize="off" autoCorrect="off" /></label>
        <label className="field">Your name<input value={form.recorder} onChange={field('recorder')} placeholder="Shown to teammates" /></label>
        <label className="inline check"><input type="checkbox" checked={form.auto} onChange={(e) => setForm({ ...form, auto: e.target.checked })} /> Sync automatically</label>
        <div className="grid2">
          <button className="ghost" disabled={!urlOk || !clean.token} onClick={testConnection}>Test connection</button>
          <button className="primary" disabled={!valid} onClick={() => { sync.save(clean); setTest(''); }}>Save</button>
        </div>
        {test && <div className="muted">{test}</div>}
      </div>
      {on && (
        <div className="card col">
          <div className="strong">Status</div>
          <div>{pending} unsent · {sync.status.lastSync ? `last sync ${clock(sync.status.lastSync)}` : 'not synced yet'}</div>
          <div className="muted">{sync.remote.length} {sync.remote.length === 1 ? 'match' : 'matches'} from teammates</div>
          {sync.status.lastError && (pending > 0 || showsWhenIdle(sync.status.lastError)) && <div className="warn-text">{errorText(sync.status.lastError)}</div>}
          <button className="ghost" disabled={sync.busy} onClick={() => void sync.run(true)}>{sync.busy ? 'Syncing…' : 'Sync now'}</button>
          <div className="muted tiny">
            Changes are sent automatically, and teammates' matches are fetched when the app opens and after sending. Sync now does both right away.
          </div>
          <div className="col gap4">
            <button className="link tiny" disabled={sync.busy || matches.length === 0} onClick={sync.sendAll}>Resend all my matches ({matches.length})</button>
            <div className="muted tiny">
              Only needed for matches recorded before sync was set up or while it was off, or after the sheet was replaced.
            </div>
          </div>
          <button className={armed ? 'danger small' : 'link'} onClick={() => {
            if (armed) { sync.save({ ...clean, url: '', token: '' }); setForm({ ...form, url: '', token: '' }); setArmed(false); } else setArmed(true);
          }}>
            {armed ? 'Really turn off sync' : 'Turn off sync'}
          </button>
        </div>
      )}
    </div>
  );
}
