# モルック記録 PWA（molkky-score-pwa）

チーム（3〜4人）が大会・練習でモルックの投擲をスマホに記録し、作戦ヒントと振り返り集計を得る PWA。
公開先: https://akixikov.github.io/molkky-score-pwa/ （`main` への push で GitHub Actions が自動デプロイ）

## コマンド
- `npm install` / `npm run dev`（http://localhost:5173/molkky-score-pwa/）
- `npx vitest run` — テスト。`fixtures-private/molkkylog.json` があれば実データ照合テストも走る
- `npm run build` — `tsc -b && vite build`。push 前に必ずテストとビルドを通す

## 構成
- `src/rules.ts` — ルールエンジン。得点・バースト（50超→25）・上がり（ちょうど50）・3連続ミス失格・次の投擲者・ヒントを**すべてここで導出**
- `src/stats.ts` — 集計（フォルト率、1ミス直後、4〜6投目、26/38点以上、選手別）
- `src/store.ts` — IndexedDB（idb-keyval）保存、CSV 書き出し
- `src/App.tsx` / `App.css` — 画面（ホーム、セット準備、投擲入力、相手入力、セット終了、振り返り）
- `vite.config.ts` — base `/molkky-score-pwa/`、vite-plugin-pwa
- `.github/workflows/deploy.yml` — test → build → Pages

## 守ること
- **記録は事実だけ**（誰が投げたか、1投ごとの得点）。倒れたピンは記録しない（古い記録には `pins` が残っている）。合計・イベント・勝敗は保存せず、常に `deriveSet` で導出する
- **公開リポジトリ**。実データ（`fixtures-private/`）、合言葉、個人のスプレッドシートURLは絶対にコミットしない
- TypeScript は `erasableSyntaxOnly`（enum 禁止）、`noUnusedLocals/Parameters`
- UI は英語（コメントも英語）。色: 背景 #F3EFE6、主色 #2E6B4E、警告 #A84B14、相手 #2F5D8A。フォント Zen Kaku Gothic New / Barlow Condensed
- 練習ゲーム: 1ゲーム＝1試合（kind `practice`）で、`config.sides` に全サイド（2〜6、合計最大6人、全員の投擲者を記録）。大会は `sides` なしで us / them。3連続ミスのサイドは抜けて続行、最後の1サイドが勝ち
- ルール: 1本倒し＝その番号、2本以上＝本数。セット1・2は先攻交互、セット3は1+2合計の高い方が先攻（大会による、手動で変更可）。50点未満でも勝つことがある（相手失格・時間切れ）
- 実データ照合の期待値（大会41セット）: フォルト22.2%、1ミス直後32.1%、4〜6投目28.6%、26点以上28.6%、38点以上34.5%。全77セット: バースト2、2ミス後ヒット22/23

## 次の作業
`docs/sheets-sync-plan.md`（案A：各自のスプレッドシートへ同期）を実装する。
