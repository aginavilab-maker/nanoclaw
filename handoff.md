# 引き継ぎドキュメント (handoff.md)

最終更新: 2026-04-18

このドキュメントは、**ノート PC 側の AI News Dashboard 開発セッション**と、**ミニ PC 側の NanoClaw 運用セッション**の両方が、互いの作業状況を引き継げるようにするための資料です。新しい Cowork セッションを開いたら最初に読むこと。

## 全体像（2 台の PC が何をするか）

```
┌────────────────────────────────────────┐         ┌────────────────────────────────────────┐
│ NanoClaw 本番ミニ PC (NucBoxG3_Plus)   │         │ AI News Dashboard 開発ノート PC (CF-LV9)│
│                                        │         │                                        │
│ - 24H365D 稼働の AI エージェント基盤   │ ───────>│ - Slack の #ai-agents から投稿を読取   │
│ - 4 つの定期タスクで #ai-agents に投稿 │  Slack  │ - JSON ブロックを優先パース             │
│ - 投稿末尾に schema v1.0 の JSON 埋込  │         │ - PostgreSQL (pgvector) に格納         │
│ - Git: aginavilab-maker/nanoclaw       │         │ - Next.js 15 Web UI で可視化           │
│                                        │         │ - Git: ybbtsuyoshi/AI_News_Dashboard   │
└────────────────────────────────────────┘         └────────────────────────────────────────┘
                    │                                                 │
                    └─────────┐                   ┌───────────────────┘
                              ▼                   ▼
                        ┌─────────────────────────────┐
                        │ Slack ワークスペース         │
                        │ - #ai-agents (C0AQ1TZMY1E)  │  ← NanoClaw の投稿先、Dashboard の情報源
                        │ - #cowork-sync (C0ATKUAKL7M)│  ← PC 間の連絡チャンネル
                        │ - #nanoclaw-test (C0ANMH020RF) │
                        └─────────────────────────────┘
```

## データ契約 (schema v1.0、2026-04-18 改訂版)

NanoClaw の 4 タスクの投稿は **Markdown 本文 + 末尾の 1 個の JSON コードブロック** で構成される。ダッシュボードは JSON を優先、無ければ Markdown にフォールバック。

### ルート JSON スキーマ

```
{
  "schema_version": "1.0",       // 必須、固定値
  "source":         "ai-agents",  // 必須、固定値
  "collected_at":   ISO 8601+JST, // 必須、例: "2026-04-18T20:15:00+09:00"
  "articles":       [...]         // 必須、配列
}
```

### 各 article のスキーマ

| キー | 型 | 必須 | 値 |
|---|---|---|---|
| `title` | string | ✓ | 記事タイトル（原文）|
| `summary` | string | ✓ | **日本語** 3-5 行、改行は `\n` |
| `category` | enum | ✓ | LLM / Agent / Tool / Policy / Research / Product / Funding / OSS / Infra / Ethics |
| `importance` | int 1-5 | ✓ | 5=業界変革 / 4=主要プレイヤー / 3=注目 / 2=一般 / 1=参考 |
| `region` | enum | ✓ | global / us / eu / jp / cn / kr / in |
| `sentiment` | enum | ✓ | positive / negative / neutral |
| `primary_url` | string | ✓ | 一次情報 URL（取得不可なら空文字 `""`）|
| `report_url` | string | 任意 | 報道記事 URL、無ければキー省略 |
| `related_url` | string | 任意 | 関連 URL、無ければキー省略 |

### 禁止キー（スキーマ外、LLM が混入しがち）

`id`, `url`, `source_name`, `publisher`, `tags`, `keywords`, `published_at`, `date`, `report_type`, `is_report`, `summary_ja`, `description`, `content`, `author`, `language`, `thumbnail`, `image_url` 等は絶対に混入してはならない（NanoClaw 側のプロンプトで明示禁止）。

### タスク別の意味合い

| タスク | cron | articles の中身 |
|---|---|---|
| ainews | 6/9/12/15/18/21 時 | 期間フィルタ通過のニュース（重要度 4-5: 72h / 1-3: 24h）|
| ghtrend | 07:00 | 採用 GitHub repo（直近 7 日以内に活動、`title`=owner/name、`primary_url`=repo URL）|
| weekly | 月曜 08:00 | 今週のトップニュース 5 件（トレンドキーワード等は Markdown のみ、JSON には含めない）|
| ldyq11 (daily) | 09:00 | 本日分（24h）採用記事全件（Markdown は上位 3 件、JSON は全件）|

## URL 3 鉄則（2026-04-18 追加の思想）

ダッシュボード側はノート PC 側セッションで合意された「**一次情報の URL はエビデンス（証拠）である**」という思想に基づいて設計される。ユーザーが要約の正しさを URL で検証できる仕組み。

NanoClaw 側はこれに従い:
1. URL が取得できない記事は採用しない（例外時は `primary_url=""`、summary 末尾に `※URL取得不可` 明示）
2. URL は加工せず原文保存（短縮、リダイレクト解決、UTM 除去 すべて禁止）
3. 要約は URL の記事本文から読み取れる事実のみ、LLM の事前知識で補完・推測しない

## ⚠️ パーサ実装時の既知の注意点

### (1) Slack の URL 自動ラッピング（重要）

NanoClaw のプロンプトは純粋な URL を指示していますが、Slack は投稿受信時に URL を山括弧でラップします。実際の JSON にはこう入る:

```
"primary_url": "<https://fazm.ai/blog/new-llm-releases-april-2026>",
```

または `<url|display_text>` 形式:

```
"primary_url": "<https://example.com|Example Site>",
```

**パーサ側で必要な処理**: URL フィールドの値から:
1. 先頭の `<` と末尾の `>` を剥がす
2. 値内に `|` があればパイプ以降を切り落として URL 部分だけ残す

これは Slack API の仕様で NanoClaw 側では回避不可能。

### (2) null フィールドの残存

プロンプトは「null を書かない、任意フィールドが無ければキー自体を省略」と明示していますが、LLM の遵守率は 100% ではありません。パーサは「フィールド不在」と「値が null」の両方を undefined 相当として扱うこと。

### (3) JSON 文字列内の改行

`summary` 内の改行は `\n` でエスケープされて入る（例: `"summary": "行1\\n行2\\n行3"`）。JSON パーサは自動でアンエスケープする。

### (4) LLM のスキーマ違反リスク

LLM が指示を無視して「ニュース API でありがちなキー」（`id`, `url`, `source_name`, `tags`, `published_at` 等）を追加したり、summary を英語のまま出すケースが 2026-04-18 のテストで確認されている。NanoClaw 側は以下で対処済み:

- 許可キー完全列挙 + 禁止キー名指し
- summary は日本語必須、英語 NG 例 / 日本語 OK 例の対比
- 送信前最終チェックリスト

それでも違反が起きる可能性はあるので、**ダッシュボード側は defensive parsing** を推奨（未知キー無視、値の型チェック、英語 summary でも受け入れる等）。

## 検証状況（2026-04-18 現在）

| タスク | スキーマ遵守 | 日本語 summary | 検証日時 |
|---|---|---|---|
| ainews (手動) | ✅ 許可キーのみ (20:15 投稿) | ⏳ 英語残存あり → 翻訳強制強化後、21:00 自然発火で再検証 | 2026-04-18 20:15 JST |
| ghtrend | ⏳ 未検証 | ⏳ 未検証 | 2026-04-19 07:00 JST 予定 |
| ldyq11 (daily) | ⏳ 未検証 | ⏳ 未検証 | 2026-04-19 09:00 JST 予定 |
| weekly | ⏳ 未検証 | ⏳ 未検証 | 2026-04-20 08:00 JST 予定 |

Dashboard 側は JSON 優先パーサ実装済み（ノート PC セッションで完了済）。ainews の 20:15 投稿を使ったサンプル検証可能。

## 主要な参照先

### NanoClaw 側（ミニ PC、GitHub: `aginavilab-maker/nanoclaw`）

- `agent.md` 「機械可読データ出力仕様」節: スキーマ v1.0 の完全仕様
- `readme.md` 「ダッシュボード連携と JSON データ契約」節: 運用手順
- `prompts/ainews.txt` / `ghtrend.txt` / `weekly.txt` / `ldyq11.txt`: 各タスクのプロンプト本体
- `backups/` ディレクトリ: プロンプト変更時の旧版バックアップ（`.gitignore` 対象）

### ダッシュボード側（ノート PC、GitHub: `ybbtsuyoshi/AI_News_Dashboard`）

- `src/lib/universal-parser.ts`: 投稿パーサ本体（JSON 優先パース実装済み）
- 技術スタック: Next.js 15 + React 19 + Tailwind / PostgreSQL 16 (pgvector) / Prisma 6.11.1 / Redis 7 + BullMQ 5 / Docker Compose
- Worker ジョブ: slack-sync (15 分) / keyword-sync (1h) / trend-update (6h) / player-update (6h) / auto-archive (03:00) / daily-digest (07:00) / cache-warm (06:00)
- 注意: Cowork サンドボックス（Linux）から `git push` 不可 → 実機 PowerShell から実行
- 全日時処理は JST 基準、UTC バグ再発防止ルールあり
- Prisma は 6.11.1 固定（7.x へのアップグレード禁止）

### Slack チャンネル

- `#ai-agents` (C0AQ1TZMY1E): NanoClaw の定期投稿先、ダッシュボードの情報源
- `#cowork-sync` (C0ATKUAKL7M): **PC 間の連絡チャンネル**。PC 登録・設計変更・検証結果はここに投稿し両 PC の Cowork セッションが読める
- `#nanoclaw-test` (C0ANMH020RF): NanoClaw のテスト用

## 運用上の約束事

### スキーマ変更時

- `schema_version` を上げる（v1.0 → v1.1 → v2.0）
- `#cowork-sync` に変更案を投稿し両 PC の合意を取る
- 旧バージョン互換の扱いを明示（廃止期限・併存期間など）
- NanoClaw 側の prompts/*.txt と agent.md を更新 → Git コミット
- ダッシュボード側の universal-parser.ts を更新 → Git コミット

### 手動発火とテスト

NanoClaw の定期タスクを即時実行したい場合:

```python
# /home/nano/nanoclaw/store/messages.db の next_run を過去時刻に書き換え
import sqlite3, datetime
con = sqlite3.connect("/home/nano/nanoclaw/store/messages.db")
past = (datetime.datetime.now(datetime.UTC) - datetime.timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
con.execute("UPDATE scheduled_tasks SET next_run=? WHERE id='task-1774596632748-ainews'", (past,))
con.commit()
```

task-scheduler が 60 秒以内に拾って発火する。詳細は NanoClaw 側 `readme.md` の「手動発火」節参照。

タスク ID 参照:
- ainews: `task-1774596632748-ainews`
- ghtrend: `task-1774596632748-ghtrend`
- weekly: `task-1774596632748-weekly`
- ldyq11 (daily): `task-1774667756106-ldyq11`

### バグや改善要望

- 投稿フォーマットの不具合: NanoClaw 側で prompts を改訂
- パース漏れや表示バグ: ダッシュボード側で parser を改訂
- どちらでも対応できるものは `#cowork-sync` で相談

### Cowork セッションを引き継ぐとき

1. ノート PC or ミニ PC で Cowork を開く
2. **最初に `handoff.md`（本ファイル）を読む**
3. `#cowork-sync` の最近のメッセージを読む（相手 PC 側の作業履歴）
4. 必要に応じて `agent.md` / `readme.md` も確認
5. 作業内容と進捗を適宜 `#cowork-sync` に投稿して相手 PC に共有

## 連絡経路

| 種別 | 手段 |
|---|---|
| 同期的な設計合意 | `#cowork-sync` への投稿（両 PC の Cowork から読める）|
| NanoClaw の不具合 | `#nanoclaw-test` で `@NanoClaw ping` 等で生存確認 |
| ダッシュボード issue | GitHub Issues (`ybbtsuyoshi/AI_News_Dashboard`) |
| NanoClaw issue | GitHub Issues (`aginavilab-maker/nanoclaw`) |

## 改訂履歴

| 日付 | 内容 | 担当 |
|---|---|---|
| 2026-04-18 | 初版作成 (旧 schema: report_type/summary_ja/is_report/published_at/source_url) | ミニ PC 側 Cowork |
| 2026-04-18 | 改訂 (新 schema: source/summary/sentiment/report_url、禁止キー明示、URL 3 鉄則、日本語 summary 必須) — ノート PC 側スレッド指示に準拠 | ミニ PC 側 Cowork |
