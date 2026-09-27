# モルック記録（molkky-score-pwa）

モルックの投擲を試合中にスマホで記録し、作戦のヒントと振り返りの集計を出す PWA。

- 記録するのは事実だけ（誰が投げて、どのピンが倒れたか／相手は得点だけ）
- 得点・バースト（50点超えで25点）・上がり・3連続ミス失格・セットの勝敗は `src/rules.ts` がすべて導出
- 集計（フォルト率、1ミス直後、4〜6投目、38点以上、選手別）は `src/stats.ts`
- データは端末の IndexedDB に保存。CSV書き出しとJSONバックアップあり

## 使い方（開発）

```sh
npm install
npm run dev        # http://localhost:5173/molkky-score-pwa/
npx vitest run     # ルールエンジンのテスト
npm run build
```

`fixtures-private/` に実データを置くと、実データとの突き合わせテストも走ります（公開リポジトリには含めません）。

## デプロイ

`main` に push すると GitHub Actions がテスト→ビルド→ GitHub Pages に公開します
（リポジトリの Settings → Pages → Source を「GitHub Actions」に設定）。
