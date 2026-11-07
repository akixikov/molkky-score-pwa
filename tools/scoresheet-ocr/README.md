# スコアシート読み取り（scoresheet-ocr）

大会の紙のスコアシートの写真から、自チームの投擲（誰が・何点）を起こす補助ツール。
数字を読むのは Claude Code のセッション（`/rc` でスマホから写真を送る想定）で、API キーは使わない。
画像処理と整合性チェックはこのフォルダの Python が受け持つ。

## 流れ

作業フォルダ（以下 `W`）は `fixtures-private/` の下に置く（実データなのでコミットしない）。

1. **表を切り出す** — `python3 tools/scoresheet-ocr/prepare.py headers $W <写真...>`
   - 各写真のセットの表を見つけて台形補正し、`$W/tables/` に保存（`*_lines.jpg` は検出した罫線の確認用）
   - `$W/headers.jpg` に全部の表の選手名欄を並べる
2. **自チームの側を決める** — `headers.jpg` を見て `$W/sides.json` に `{"IMG_0001/0": "A", ...}`（A＝左、B＝右）
3. **自チームだけを並べる** — `python3 tools/scoresheet-ocr/prepare.py strips $W $W/sides.json`
   - `$W/strips/<写真>.jpg` に、セットごとの「ターン番号｜自チームの選手欄｜計」だけが並ぶ
4. **読む** — `strips/*.jpg` を見て `$W/readings.txt` に書く（書式は `solve.py` の先頭）
   - 1 行 1 セット：`IMG_0001/0 | 選手1 選手2 選手3 | 1 7 7; 2 8 15; 3 - 15; ...`（選手は列の並び順）
   - 各行は「書かれた列 投擲 計」。ミスは `-`、空欄・判読不能は `_`、迷う字は `4/8`、線で消された行は投擲を `x`
   - 推測で埋めない（`_` や `4/8` にすれば計から決まる）
5. **整合性をそろえる** — `python3 tools/scoresheet-ocr/solve.py $W/readings.txt > $W/solved.json`
   - 計の流れ・50超えで25・50で上がり・3連続ミスで終了に合う中で、読みの修正が最少になる投擲を選ぶ
   - 投げた人は登録順の循環（`src/rules.ts` と同じ）。`check` が空でない行だけ人が確認する
   - 相手チームも同じ手順で読む（`sides.json` の A/B を逆にして `strips` → `readings_them.txt` → `solved_them.json`）
6. **試合データにする** — `python3 tools/scoresheet-ocr/matches.py $W/solved.json $W/solved_them.json $W/meta.json > $W/matches.json`
   - `meta.json` に試合ごとの日付・大会名・相手・ゲームごとの表と先攻を書く（書式は `matches.py` の先頭）
7. **チームのシートに追加する** — 行を作り、Games と Throws のタブの末尾に**追加だけ**する（既存の行は触らない）
   ```sh
   npx -p node@22 node node_modules/rolldown/bin/cli.mjs tools/scoresheet-ocr/sheet-rows.ts --platform node --format esm --file $W/sheet-rows.mjs
   node $W/sheet-rows.mjs $W/matches.json > $W/rows.json   # {"games": [...], "throws": [...]}
   ```
   - 記録者は `Claude`（端末 ID `scoresheet-ocr`）。アプリでは「by Claude」と出て、他の人の試合と同じく修正・削除できる
   - 書く前に、同じ試合がすでにシートにないか確かめる（その場でアプリに記録した試合と二重にしない）
   - 各端末はチーム同期の取り込みで受け取る。「Load backup」は使わない（端末の記録が置き換わる）

## 精度（2026-11-07、写真 21 枚・45 セット）

- 罫線の検出：45 表すべて（途中で切れた未使用の表は除外）
- 入力済みデータとの照合（16 枚・295 投）：`evaluate.py` で 99.0%。違いは 3 投で、すべて `check` 付き
  （用紙の投擲と計の食い違い、投擲欄が空の行、入力済みデータ側の抜けの疑い）
- 未入力の大会（5 枚・10 ゲーム・相手チームも含め 151 投）を読み、人が答え合わせ：修正 0 か所

```sh
python3 tools/scoresheet-ocr/evaluate.py $W/solved.json fixtures-private/molkkylog.json <写真フォルダ>
```

## 前提にしている用紙の形

各セットの表は、12 行のターン欄と「番号｜A チームの選手欄｜A 計｜B チームの選手欄｜B 計」の列。
大会ごとにセット数や配置、見出しが違っても、この骨格が同じなら読める（`grid.py` の `FRAME` が列の比率）。
骨格が違う用紙が来たら `*_lines.jpg` で検出結果を確かめる。
