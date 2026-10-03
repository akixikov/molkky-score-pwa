# モルック記録 PWA（molkky-score-pwa）

チーム（3〜4人）が大会・練習でモルックの投擲をスマホに記録し、振り返り（チームと個人の KPI 推移）を得る PWA。戦況の分析や助言は記録後にオフラインで行う方針で、入力中のヒントは出さない。チーム共有の Google スプレッドシートと同期できる。
公開先: GitHub Pages（`https://<ユーザー名>.github.io/<リポジトリ名>/`。`main` への push で GitHub Actions が自動デプロイ）

## コマンド
- `npm install` / `npm run dev`（`http://localhost:5173/<リポジトリ名>/`。パスは `package.json` の `name` から決まる）
- `npm test`（= `vitest run`）— テスト。`fixtures-private/molkkylog.json` があれば実データ照合テストも走る
- `npm run build` — `tsc -b && vite build`。push 前に必ずテストとビルドを通す

## 構成
- `src/rules.ts` — ルールエンジン。得点・50超→25・上がり（ちょうど50）・3連続ミス失格・次のサイドと投擲者を**すべてここで導出**（2〜6サイド対応）
- `src/stats.ts` — KPI の唯一の定義（Hit rate / Avg score / Finish rate / After a miss / Mid-game / Finishing zone）と「自チームの投擲」の範囲。画面とテストはこれだけを使う
- `src/store.ts` — IndexedDB（idb-keyval）保存、CSV 書き出し（`rowsForMatch` はシート同期と共通）
- `src/sync.ts` — チーム共有シートとの同期（設定・未送信キュー・送信・取り込み）。設定と合言葉は本体データ・バックアップと別に保存。`src/useTeamSync.ts` が画面側の状態
- `apps-script/Code.gs` — チームのシートに貼る Apps Script（ウェブアプリ）。`src/appsScript.test.ts` が同じコードを擬似シートで検証する
- `src/App.tsx` — 画面の切り替えだけ。`src/screens/`（Home・NewMatch・PracticeSetup・Play・SetEnd・MatchSummary・MatchEdit・Review・TeamSync）、`src/components/`（ScoreSheet・TrendChart など）、`src/ui.ts`（遷移の型と共通ヘルパー）、`App.css`
- `vite.config.ts` — base は `package.json` の `name` から自動生成（フォークしてリポジトリ名を変えたら `package.json` の `name` も合わせる）、vite-plugin-pwa
- `.github/workflows/deploy.yml` — test → build → Pages

## 守ること
- **記録は事実だけ**（誰が投げたか、1投ごとの得点）。倒れたピンは記録しない（古い記録には `pins` が残っている）。合計・イベント・勝敗は保存せず、常に `deriveSet` で導出する
- **公開リポジトリ**。実データ（`fixtures-private/`）、合言葉、個人のスプレッドシートURL・ウェブアプリURL・シートIDは絶対にコミットしない
- `SHEET_COLUMNS`（`src/store.ts`）と `THROW_COLUMNS`（`apps-script/Code.gs`）は同じに保つ（テストで確認）。`Code.gs` を変えたら代表者がシートへ反映し「新バージョン」でデプロイし直す
- TypeScript は `erasableSyntaxOnly`（enum 禁止）、`noUnusedLocals/Parameters`
- UI は英語（コメントも英語）。色: 背景 #F3EFE6、主色 #2E6B4E、警告 #A84B14、相手 #2F5D8A。フォント Zen Kaku Gothic New / Barlow Condensed
- 練習ゲーム: 1ゲーム＝1試合（kind `practice`）で、`config.sides` に全サイド（2〜6、合計最大6人、全員の投擲者を記録）。大会は `sides` なしで us / them。3連続ミスのサイドは抜けて続行、最後の1サイドが勝ち
- ルール: 1本倒し＝その番号、2本以上＝本数。ゲーム1・2は先攻交互、ゲーム3は1+2合計の高い方が先攻（大会による、手動で変更可）。50点未満でも勝つことがある（相手失格・時間切れ。結果画面でゲームごとの勝者を手動で直せる）
- 用語: 画面は協会ルールに合わせ「試合（Match）＞ゲーム（Game）」。コードと保存データでは歴史的にゲームを `set`（`SetEntry`・`setNo`）と呼ぶ。保存形式に関わるので名前は変えない
- 実データ照合の期待値（大会41ゲーム、ミス率＝1−ヒット率）: 全体22.2%、1ミス直後32.1%、4〜6投目28.6%、26点以上28.6%、38点以上34.5%。全77ゲーム: 50超→25 が2回、2ミス後ヒット22/23

## 運用上の注意
- 1 試合（練習は 1 ゲーム）を記録するのは 1 台だけ。シートは最初に送った端末を持ち主とし、他の端末からの上書きは拒否する
- 他の人の試合の修正（投擲・勝者）は `force` 付きの `putMatch` で送る。シートは持ち主（DeviceID・Recorder）を変えずに中身だけ置き換え、持ち主の端末は取り込み時にシートの `updatedAt` が自分のものより新しく、かつ未送信でなければシートの版に置き換える（`ownFixedElsewhere`）
- 削除は誰でもできる（他の人の試合は警告のうえ `force` で送る）。シートは行と `Json` を残して `DeletedAt` を付けるだけ。持ち主の端末は取り込み時に削除を反映し、`DeletedAt` を空にすると取り込み時に復活する
- 「Load backup」は端末の記録を丸ごと置き換える。同期中なら、置き換えで消えた自分の試合はシートからも削除される
- 実データの変換スクリプトは `fixtures-private/`（非公開）にある

## 残課題
- 同期の高速化：複数試合をまとめて送る、`Throws` の書き直しを減らす（`Code.gs` の再デプロイが必要）
- スマホを替えたとき：端末 ID の引き継ぎ、取り込んだ自分の試合の二重表示の防止
- 記録の修正：投擲の削除・途中への挿入（修正モード＝`MatchEdit`・`src/editDraft.ts` で得点と投擲者の修正、各サイドの次の空欄への追加はできる。他の人の試合も可）、記録中のゲームの途中の 1 投、他の人が記録した試合の続きの記録
- `pull` の差分取り込み（`since`）

## 開発環境の注意
- Node 22.12 以上が必要（`.nvmrc` は 22、`package.json` の `engines` は >=22.12。CI は `.nvmrc` を読む）。開発コンテナの Node が古い場合は `npx -p node@22 node node_modules/vitest/vitest.mjs run` のように Node 22 で実行する

