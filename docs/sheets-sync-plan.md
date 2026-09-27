# スプレッドシート同期（案A）実装計画

## 方針
PWA は全員共通。**書き込み先は使う人ごとの設定**（端末内にだけ保存）。
各自が「受け口スクリプト付きのひな形スプレッドシート」を自分のドライブにコピーし、
Apps Script をウェブアプリとして自分で公開、その URL と合言葉を PWA に登録する。
データは端末 → 本人のスプレッドシートへ直接届き、開発者側のサーバーは経由しない。

```
[PWA (GitHub Pages)] --POST(JSON, 合言葉)--> [本人の Apps Script ウェブアプリ] --> [本人のスプレッドシート]
```

## 1. ひな形スプレッドシート（`apps-script/` にコードを置き、手順書も用意）
- シート `Throws`（生データ・スクリプトだけが書く）: CSV 書き出しと同じ列 + `MatchID`, `SetID`, `SyncedAt`
  - 列: MatchID, SetID, Date, Tournament, Kind, Opponent, SetNo, FirstTeam, ThrowNo, Team, TeamThrowNo, Player, Pins, Score, Before, After, Event, FaultStreakBefore, SetWinner, ThrowID, SyncedAt
- 集計用シートは `Throws` を数式で参照するだけにする（人が編集してよいのはこちら）
- `apps-script/Code.gs`（コンテナバインド。コピー時にスクリプトも複製される）
  - `onOpen()` でメニュー「モルック記録 → 合言葉を設定」→ `SpreadsheetApp.getUi().prompt` で入力し `PropertiesService.getScriptProperties().setProperty('TOKEN', …)`
  - `doPost(e)`:
    1. `JSON.parse(e.postData.contents)`。`token` がスクリプトプロパティと一致しなければ `{ok:false, error:'unauthorized'}`
    2. `LockService.getScriptLock().waitLock(20000)` で排他
    3. 操作:
       - `{op:'ping'}` → `{ok:true, version}`（接続テスト用）
       - `{op:'putSet', setId, matchId, rows:[…]}` → `Throws` から同じ `SetID` の行を削除して `rows` を追記（**セット単位で丸ごと置き換え＝冪等**。取り消し・修正にも対応）
       - `{op:'deleteMatch', matchId}` → その `MatchID` の行を全削除
    4. 検証: Score は 0〜12 の整数、Team は us/them、列は既知のものだけ、1リクエスト最大 200 行。違反は拒否
    5. `ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON)`
  - `doGet` は `{ok:true}` だけ返す（データは返さない）
- 公開設定: 「次のユーザーとして実行: 自分」「アクセスできるユーザー: 全員」

参考:
- https://developers.google.com/apps-script/guides/web
- https://developers.google.com/apps-script/guides/bound
- https://developers.google.com/apps-script/guides/properties
- https://developers.google.com/apps-script/reference/lock/lock-service
- https://developers.google.com/apps-script/guides/content

## 2. PWA 側
- **設定画面**（ホームに「スプレッドシート連携」）: ウェブアプリ URL、合言葉、「接続テスト」ボタン（ping）、自動送信 ON/OFF
  - 保存キーは本体データと分ける（例 `molkky-sync-v1`）。**JSON バックアップに合言葉を含めない**
  - URL は `https://script.google.com/macros/s/…/exec` の形だけ受け付ける
- **送信処理**（`src/sync.ts`）
  - `fetch(url, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(payload)})`
    （`text/plain` にして CORS プリフライトを避ける。Apps Script はリダイレクト後に JSON を返す）
  - 行の生成は `toCsv` と同じ導出ロジックを共通化（`rowsForSet(match, set)`）して使う
  - **未送信キュー**: 変更のあったセット ID（と削除した試合 ID）を IndexedDB に保存。
    投擲の追加・取り消し・セット終了・試合削除でキューに積み、アプリ起動時・`online` イベント時・変更直後に送信。成功したら外す
  - 失敗しても入力は止めない。ホームに「未送信 n セット」「最終送信 hh:mm」を表示し、手動の「今すぐ送信」も置く
- `SetEntry` に `updatedAt` を追加（既存データは読み込み時に補完）

## 3. テスト
- `rowsForSet` の出力が `toCsv` の該当行と一致すること
- キュー: 同じセットを複数回変更しても送信は最新の1回にまとまること、失敗時に残ること
- 送信は `fetch` をモックしてテスト（成功・unauthorized・ネットワークエラー）
- Apps Script の検証ロジックは純粋関数に切り出し、同じ判定を TS 側テストでも確認できるとなお良い

## 4. 利用者向け手順書（`docs/setup-sheets.md`、日本語・スクショ前提の箇条書き）
1. ひな形のコピー用リンク（`https://docs.google.com/spreadsheets/d/<ID>/copy`）を開いてコピー
2. メニュー「モルック記録 → 合言葉を設定」で合言葉を決める
3. 拡張機能 → Apps Script → デプロイ → 新しいデプロイ → 種類「ウェブアプリ」、実行ユーザー「自分」、アクセス「全員」→ 承認（「このアプリは確認されていません」→ 詳細 → 移動）
4. 表示された URL と合言葉を PWA の「スプレッドシート連携」に貼り付けて「接続テスト」
5. 合言葉が漏れたら手順2で変更し、PWA 側も更新
※ スクリプトを変更したら「デプロイを管理 → 編集 → 新しいバージョン」で URL を変えずに更新できる

## 5. 手作業が必要なもの（Aki が行う）
- ひな形スプレッドシートの作成と `Code.gs` の貼り付け（または clasp で push）、コピー用リンクの README 記載
- 自分用のコピーで接続テスト

## 完了条件
- 自分のコピーに対して、投擲入力 → 数秒以内に `Throws` に反映。取り消しすると行も消える
- 機内モードで入力 → 復帰後に自動で送信される
- 合言葉違いは拒否され、PWA に「合言葉が違います」と出る
- リポジトリに URL・合言葉・実データが含まれていない（`git grep script.google.com/macros/s/` が手順書の例示以外ヒットしない）
