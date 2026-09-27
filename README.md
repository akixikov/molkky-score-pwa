# モルック記録（molkky-score-pwa）

モルックの投擲を試合中・練習中にスマホで記録し、振り返り（チームと個人の KPI 推移）を出す PWA。

- 記録するのは事実だけ（誰が投げて、何点だったか）。大会は自チームと相手、練習は 2〜6 サイドの全員を記録
- 合計・50点超えで25点・上がり・3連続ミス失格・ゲームの勝敗は `src/rules.ts` がすべて導出
- KPI（ヒット率、平均得点、Finish 率、1ミス直後、4〜6投目、38点以上）は `src/stats.ts`
- データは端末の IndexedDB に保存。CSV 書き出しと JSON バックアップあり
- チーム共有の Google スプレッドシートと同期できる（[手順](docs/setup-sheets.md)）

## 使い方（開発）

```sh
npm install
npm run dev        # http://localhost:5173/molkky-score-pwa/
npm test           # テスト（Node 22.12 以上。`.nvmrc` は 22）
npm run build
```

`fixtures-private/` に実データを置くと、実データとの突き合わせテストも走ります（公開リポジトリには含めません）。

## デプロイ

`main` に push すると GitHub Actions がテスト→ビルド→ GitHub Pages に公開します
（リポジトリの Settings → Pages → Source を「GitHub Actions」に設定）。
