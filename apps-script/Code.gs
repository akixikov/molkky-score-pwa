// Mölkky Scorer team sync: a web app bound to the team spreadsheet.
// Every member's app posts here with the shared passphrase. No sheet ID, URL or passphrase
// lives in this file; the passphrase is kept in the script properties (menu: Set passphrase).

var VERSION = 3;
var GAMES = 'Games';
var THROWS = 'Throws';
var GAMES_HEAD = ['MatchID', 'DeviceID', 'Recorder', 'UpdatedAt', 'DeletedAt', 'Json'];
// Must match SHEET_COLUMNS in src/store.ts (checked by the app's tests).
var THROW_COLUMNS = [
  'MatchID', 'SetID', 'Date', 'Tournament', 'Kind', 'Opponent', 'SetNo', 'FirstTeam', 'ThrowNo', 'Team',
  'TeamThrowNo', 'Player', 'Pins', 'Score', 'Before', 'After', 'Event', 'FaultStreakBefore', 'SetWinner',
  'ThrowID', 'SideName',
];
var THROWS_HEAD = THROW_COLUMNS.concat(['DeviceID', 'Recorder', 'SyncedAt']);
var TEAMS = ['us', 'them', 's1', 's2', 's3', 's4', 's5', 's6'];
var MAX_ROWS = 500;
// A cell holds up to 50,000 characters.
var MAX_JSON = 45000;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Mölkky Scorer').addItem('Set passphrase', 'setPassphrase').addToUi();
}

function setPassphrase() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Passphrase', 'Members enter the same passphrase in the app.', ui.ButtonSet.OK_CANCEL);
  var value = res.getResponseText().trim();
  if (res.getSelectedButton() === ui.Button.OK && value) {
    PropertiesService.getScriptProperties().setProperty('TOKEN', value);
    ui.alert('Passphrase saved.');
  }
}

function doGet() {
  return json({ ok: true });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'bad-request' });
  }
  var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || !req || req.token !== token) return json({ ok: false, error: 'unauthorized' });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return json(handle(req, SpreadsheetApp.getActive(), new Date()));
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Runs one authorised request against the spreadsheet. Kept free of Apps Script globals for testing. */
function handle(req, ss, now) {
  if (req.op === 'ping') return { ok: true, version: VERSION };
  var games = sheetOf(ss, GAMES, GAMES_HEAD);
  var throws = sheetOf(ss, THROWS, THROWS_HEAD);
  var stamp = now.toISOString();

  if (req.op === 'putMatch') {
    var err = validatePut(req);
    if (err) return { ok: false, error: err };
    var id = req.match.id;
    var found = findGame(games, id);
    // A teammate may correct a match only when the app confirmed it with the user (force), and
    // only one already on the sheet. The recording phone stays the owner and picks up the fix.
    var other = found && found.values[1] !== req.deviceId;
    if (other && req.force !== true) return { ok: false, error: 'not-owner' };
    if (!found && req.force === true) return { ok: false, error: 'not-found' };
    // Deleted on the sheet (possibly by a teammate): the recording phone must not bring it back.
    if (found && found.values[4]) return { ok: false, error: 'deleted' };
    var body = JSON.stringify(req.match);
    if (body.length > MAX_JSON) return { ok: false, error: 'too-large' };
    var owner = other ? found.values[1] : req.deviceId;
    var recorder = other ? found.values[2] : req.recorder || '';
    var row = [id, owner, recorder, stamp, '', body];
    if (found) games.getRange(found.index, 1, 1, GAMES_HEAD.length).setValues([row]);
    else games.appendRow(row);
    removeRows(throws, id);
    var values = req.rows.map(function (r) {
      return THROW_COLUMNS.map(function (c) { return r[c] === undefined ? '' : r[c]; })
        .concat([owner, recorder, stamp]);
    });
    if (values.length > 0) throws.getRange(throws.getLastRow() + 1, 1, values.length, THROWS_HEAD.length).setValues(values);
    return { ok: true, rows: values.length };
  }

  if (req.op === 'deleteMatch') {
    if (!isId(req.matchId) || !isId(req.deviceId)) return { ok: false, error: 'bad-request' };
    var game = findGame(games, req.matchId);
    if (!game) return { ok: true };
    // Deleting a teammate's match is allowed only when the app confirmed it with the user (force).
    if (game.values[1] !== req.deviceId && req.force !== true) return { ok: false, error: 'not-owner' };
    // Keep the row (and its Json, so a mistaken deletion can be undone by clearing DeletedAt) so every
    // device learns about the deletion when it pulls. The recording phone stays the owner.
    games.getRange(game.index, 1, 1, GAMES_HEAD.length).setValues([[req.matchId, game.values[1], game.values[2], stamp, stamp, game.values[5]]]);
    removeRows(throws, req.matchId);
    return { ok: true };
  }

  if (req.op === 'pull') {
    var last = games.getLastRow();
    var list = last < 2 ? [] : games.getRange(2, 1, last - 1, GAMES_HEAD.length).getValues().map(function (r) {
      return { matchId: r[0], deviceId: r[1], recorder: r[2], updatedAt: String(r[3]), deletedAt: String(r[4]), match: r[5] ? JSON.parse(r[5]) : null };
    });
    // The version tells the app whether it may send corrections to teammates' matches (3+).
    return { ok: true, version: VERSION, games: list };
  }

  return { ok: false, error: 'bad-op' };
}

function isId(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 100;
}

/** Returns an error code, or '' when the putMatch request is acceptable. */
function validatePut(req) {
  if (!req.match || !isId(req.match.id) || !isId(req.deviceId)) return 'bad-request';
  if (!Array.isArray(req.rows) || req.rows.length > MAX_ROWS) return 'bad-rows';
  for (var i = 0; i < req.rows.length; i++) {
    var r = req.rows[i];
    if (!r || typeof r !== 'object') return 'bad-rows';
    for (var key in r) if (THROW_COLUMNS.indexOf(key) < 0) return 'bad-rows';
    if (r.MatchID !== req.match.id) return 'bad-rows';
    if (typeof r.Score !== 'number' || r.Score % 1 !== 0 || r.Score < 0 || r.Score > 12) return 'bad-rows';
    if (TEAMS.indexOf(r.Team) < 0) return 'bad-rows';
  }
  return '';
}

function sheetOf(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function findGame(games, id) {
  var last = games.getLastRow();
  if (last < 2) return null;
  var data = games.getRange(2, 1, last - 1, GAMES_HEAD.length).getValues();
  for (var i = 0; i < data.length; i++) if (data[i][0] === id) return { index: i + 2, values: data[i] };
  return null;
}

/** Deletes a match's rows by rewriting the data block (one write instead of one call per row). */
function removeRows(sh, matchId) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var width = sh.getLastColumn();
  var range = sh.getRange(2, 1, last - 1, width);
  var data = range.getValues();
  var keep = data.filter(function (r) { return r[0] !== matchId; });
  if (keep.length === data.length) return;
  range.clearContent();
  if (keep.length > 0) sh.getRange(2, 1, keep.length, width).setValues(keep);
}
