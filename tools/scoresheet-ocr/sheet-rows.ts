// Rows to append to the team sheet for matches read from paper (Games and Throws tabs).
// Mirrors what the web app's putMatch writes, with this tool as the recorder, so the app
// shows them as "by Claude" and teammates can correct or delete them like any other match.
import { readFileSync } from 'node:fs';
import { rowsForMatch, SHEET_COLUMNS, type Match } from '../../src/store';

export const DEVICE_ID = 'scoresheet-ocr';
export const RECORDER = 'Claude';

export function sheetRows(matches: Match[], stamp: string) {
  const games = matches.map((m) => [m.id, DEVICE_ID, RECORDER, stamp, '', JSON.stringify(m)]);
  const throws = matches.flatMap(rowsForMatch).map((r) => [...SHEET_COLUMNS.map((c) => r[c]), DEVICE_ID, RECORDER, stamp]);
  return { games, throws };
}

const file = process.argv[2];
if (file) {
  const matches = JSON.parse(readFileSync(file, 'utf8')) as Match[];
  console.log(JSON.stringify(sheetRows(matches, new Date().toISOString())));
}
