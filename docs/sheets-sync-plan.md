# スプレッドシート同期（チーム共有シート）実装計画

> **状態：実装済み**（送信・取り込み・読むだけの表示）。以下は設計の記録。差分取り込み（`pull` の `since`）は未実装。

旧案A（各自が自分のシートへ送る）から変更。**チームで 1 つのスプレッドシートを共有し、全員の記録をアプリでも見られる**ようにする。

## 方針
- 代表者が 1 人だけ、ひな形スプレッドシートをコピーし、付属の Apps Script をウェブアプリとして公開する。
- メンバーは全員、同じ URL と合言葉をアプリに登録する。誰の端末で記録しても同じシートに届く。
- アプリは今と同じく**端末内（IndexedDB）が一次保存**。電波がなくても入力でき、送信は後から。連携を設定しなければ今と同じ動き。
- 他の人の記録はシートから取り込み、**読むだけ**で一覧・Review に混ぜて表示する。
- 開発者側のサーバーは使わない。データは端末とチームのシートの間だけを行き来する。

```
[PWA 端末A] --送信/取り込み(JSON, 合言葉)--+
[PWA 端末B] --------------------------------+--> [チームの Apps Script ウェブアプリ] --> [チームのスプレッドシート]
[PWA 端末C] --------------------------------+
```

## 運用ルール
- **1 試合（練習は 1 ゲーム）を記録するのは 1 台だけ**。記録した端末だけがその試合を修正・削除できる。
- シートの共有はチームメンバーの Google アカウントだけ（「リンクを知っている全員」にはしない）。
- URL と合言葉はメンバー以外に教えない。漏れたら代表者が合言葉を変えて伝え直す。

## 1. スプレッドシートとスクリプト（`apps-script/` にコードを置く）

### シート
| シート | 中身 | 書くのは |
|---|---|---|
| `Games` | 1 試合 1 行。`MatchID, DeviceID, Recorder, UpdatedAt, DeletedAt, Json`。`Json` はアプリの `Match` をそのまま（取り込みはこれを使う） | スクリプトだけ |
| `Throws` | 1 投 1 行の分析用。CSV 書き出しと同じ列 + `MatchID, SetID, DeviceID, Recorder, SyncedAt`。`Team` は `us` / `them` / `s1`…`s6`、`SideName` 付き | スクリプトだけ |
| 集計シート（任意） | `Throws` を数式で参照するだけ | 人が自由に |

- `Throws` だけでは投げる順番・手動の勝敗・練習のサイド構成が戻せないため、取り込み用に `Games` を持つ。
- 1 セルの上限（5 万文字）に対し 1 試合の JSON は数 KB。上限を超える試合は拒否してエラーを返す。

### `apps-script/Code.gs`（シート付属のスクリプト）
- `onOpen()`：メニュー「モルック記録 → 合言葉を設定」。入力値を `PropertiesService.getScriptProperties()` の `TOKEN` に保存。
- `doPost(e)`：
  1. `JSON.parse(e.postData.contents)`。`token` が `TOKEN` と一致しなければ `{ok:false, error:'unauthorized'}`
  2. `LockService.getScriptLock().waitLock(20000)` で排他
  3. 操作
     - `{op:'ping'}` → `{ok:true, version}`（接続テスト）
     - `{op:'putMatch', match, deviceId, recorder, rows}` → `Games` の同じ `MatchID` 行を置き換え（なければ追加）、`Throws` の同じ `MatchID` 行を削除して `rows` を追記。**試合単位で丸ごと置き換え＝何度送っても同じ結果**
       - 既存行の `DeviceID` が違う場合は拒否（`{ok:false, error:'not-owner'}`）。他人の試合を上書きしない
     - `{op:'deleteMatch', matchId, deviceId}` → `Games` の行に `DeletedAt` を入れ `Json` を空に、`Throws` の行を削除（他の端末に削除を伝えるため行自体は残す）
     - `{op:'pull'}` → `Games` の全行 `{matchId, deviceId, recorder, updatedAt, deletedAt, match}` を返す
  4. 検証：`Score` は 0〜12 の整数、`Team` は `us` / `them` / `s1`〜`s6`、列は既知のものだけ、1 リクエストの `rows` は最大 500 行。違反は拒否
  5. `ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON)`
- `doGet`：`{ok:true}` だけ返す（データは返さない）
- 検証と行の組み立ては純粋関数に分け、同じ判定を TypeScript 側のテストでも確認する。
- 公開設定：「次のユーザーとして実行：自分」「アクセスできるユーザー：全員」

### コードの反映
- 原本は `apps-script/Code.gs` と `apps-script/appsscript.json`。**シート ID・公開 URL・合言葉はリポジトリに入れない**。
- シートへの反映は代表者が行う。手で貼り付けるか、clasp（`npx @google/clasp login` → `push`）で送る。
- コードを直したら「デプロイを管理 → 編集 → 新しいバージョン」。URL は変わらない。

参考：
- https://developers.google.com/apps-script/guides/web
- https://developers.google.com/apps-script/guides/bound
- https://developers.google.com/apps-script/guides/properties
- https://developers.google.com/apps-script/reference/lock/lock-service
- https://developers.google.com/apps-script/guides/content
- https://developers.google.com/apps-script/guides/services/quotas （個人アカウント：実行 1 回 6 分、同時実行 30 件/ユーザー。チームの利用量なら十分）

## 2. アプリ側

### データ
- 端末ごとの `deviceId`（初回に生成）と `recorder`（表示名、例「田中のスマホ」）を連携設定と一緒に保存。
- `Match` に `origin?: { deviceId, recorder }` と `updatedAt` を追加。既存の試合は読み込み時に自分の端末のものとして補完。
- 他の人の試合は本体データとは別に保存（例 `molkky-remote-v1`）。JSON バックアップには含めない。
- 連携設定（URL・合言葉・deviceId・recorder・自動同期 ON/OFF）も別に保存（例 `molkky-sync-v1`）。**バックアップに合言葉を含めない**。
- URL は `https://script.google.com/macros/s/…/exec` の形だけ受け付ける。

### 送信（`src/sync.ts`）
- `fetch(url, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body})`（`text/plain` で CORS の事前確認を避ける）
- `Throws` の行は CSV と同じ導出を共通化した `rowsForMatch(match)` で作る（`toCsv` もこれを使う）。
- **未送信キュー**：変更のあった試合 ID と削除した試合 ID を IndexedDB に保存。投擲の追加・取り消し・ゲーム終了・試合の編集や削除で積み、変更直後・アプリ起動時・`online` イベント時に送る。成功したら外す。同じ試合の変更は最新 1 回にまとめる。
- 失敗しても入力は止めない。ホームに「未送信 n 件」「最終同期 hh:mm」、手動の「今すぐ同期」。

### 取り込み
- アプリ起動時・「今すぐ同期」・送信の後に `pull`。
- 自分の `deviceId` の試合は無視（端末内が正しい）。他の端末の試合は `updatedAt` が新しければ置き換え、`deletedAt` があれば消す。
- 取り込んだ試合は**読むだけ**：一覧に「記録：○○」の印、入力・修正・削除のボタンは出さない。Review・試合結果画面には自分の記録と同じく出す。
- 保存済みメンバー（roster）は、取り込んだ試合に出てくる名前を候補に加える（削除は各端末で）。

### 画面
- ホームに「Team sync」：URL、合言葉、表示名、接続テスト（ping）、今すぐ同期、未送信件数、最終同期時刻。
- 連携未設定なら今と同じ画面（連携の入り口だけ出す）。

## 3. テスト
- `rowsForMatch` の出力が `toCsv` の該当行と一致する
- キュー：同じ試合を何度変更しても送信は最新 1 回、失敗時は残る、削除は送信後に外れる
- 取り込みの合わせ方：自分の試合は上書きされない／他端末の新しい更新で置き換わる／`deletedAt` で消える
- 送信・取り込みは `fetch` をモック（成功・unauthorized・not-owner・ネットワークエラー）
- スクリプト側の検証関数（Score・Team・行数・試合の持ち主）

## 4. 手順書（`docs/setup-sheets.md`、日本語・箇条書き）
代表者：
1. ひな形のコピー用リンク（`https://docs.google.com/spreadsheets/d/<ID>/copy`）でコピー
2. メニュー「モルック記録 → 合言葉を設定」
3. 拡張機能 → Apps Script → デプロイ → 新しいデプロイ → ウェブアプリ（実行：自分、アクセス：全員）→ 承認（「このアプリは確認されていません」→ 詳細 → 移動）
4. シートをメンバーの Google アカウントに「閲覧者」で共有
5. URL と合言葉をメンバーに伝える

メンバー：
1. アプリの「Team sync」に URL・合言葉・表示名を入れて「接続テスト」
2. 「今すぐ同期」で全員分が一覧に出ることを確認

## 5. 手作業が必要なもの（代表者が行う）
- ひな形スプレッドシートの作成と `Code.gs` の反映、コピー用リンクの README 記載
- 公開と、メンバーへの URL・合言葉の共有
- 自分の端末での接続テスト

## 進め方
1. 送信だけ（`putMatch` / `deleteMatch` / `ping`）を作り、代表者のシートで確認
2. 取り込み（`pull`）と読むだけの表示
3. 手順書とメンバーでの確認

## 完了条件
- 端末 A で入力 → 数秒以内に `Games` と `Throws` に反映。取り消すと `Throws` の行も消える
- 端末 B で「今すぐ同期」→ A の試合が一覧と Review に出る。B からは修正・削除できない
- A で試合を削除 → B で同期すると消える
- 機内モードで入力 → 復帰後に自動で送信される
- 合言葉違いは拒否され、アプリに「合言葉が違います」と出る。他端末の試合の上書きは拒否される
- リポジトリに URL・合言葉・シート ID・実データが含まれていない（`git grep script.google.com/macros/s/` が手順書の例示以外ヒットしない）

## 決めたこと・残りの検討
- 自チーム名の既定値は端末ごと（共有しない）。大会ごとの Result メモは廃止
- 取り込み量が増えたときの差分取り込み（`pull` に `since` を足す）。初回は全件
