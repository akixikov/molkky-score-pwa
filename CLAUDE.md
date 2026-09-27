# モルック記録 PWA（molkky-score-pwa）

チーム（3〜4人）が大会・練習でモルックの投擲をスマホに記録し、作戦ヒントと振り返り（チームと個人の KPI 推移）を得る PWA。チーム共有の Google スプレッドシートと同期できる。
公開先: https://akixikov.github.io/molkky-score-pwa/ （`main` への push で GitHub Actions が自動デプロイ）

## コマンド
- `npm install` / `npm run dev`（http://localhost:5173/molkky-score-pwa/）
- `npx vitest run` — テスト。`fixtures-private/molkkylog.json` があれば実データ照合テストも走る
- `npm run build` — `tsc -b && vite build`。push 前に必ずテストとビルドを通す

## 構成
- `src/rules.ts` — ルールエンジン。得点・50超→25・上がり（ちょうど50）・3連続ミス失格・次のサイドと投擲者・ヒントを**すべてここで導出**（2〜6サイド対応）
- `src/stats.ts` — KPI の唯一の定義（Hit rate / Avg score / Finish rate / After a miss / Mid-game / Finishing zone）と「自チームの投擲」の範囲。画面とテストはこれだけを使う
- `src/store.ts` — IndexedDB（idb-keyval）保存、CSV 書き出し（`rowsForMatch` はシート同期と共通）
- `src/sync.ts` — チーム共有シートとの同期（設定・未送信キュー・送信・取り込み）。設定と合言葉は本体データ・バックアップと別に保存。`src/useTeamSync.ts` が画面側の状態
- `apps-script/Code.gs` — チームのシートに貼る Apps Script（ウェブアプリ）。`src/appsScript.test.ts` が同じコードを擬似シートで検証する
- `src/App.tsx` — 画面の切り替えだけ。`src/screens/`（Home・NewMatch・PracticeSetup・Play・SetEnd・MatchSummary・Review・TeamSync）、`src/components/`（ScoreSheet・TrendChart など）、`src/ui.ts`（遷移の型と共通ヘルパー）、`App.css`
- `vite.config.ts` — base `/molkky-score-pwa/`、vite-plugin-pwa
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

## 開発環境の注意
- CI は Node 22。開発コンテナの Node が古い場合は `npx -p node@22 node node_modules/vitest/vitest.mjs run` のように Node 22 で実行する

