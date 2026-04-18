# NanoClaw 仕様 (agent.md)

最終更新: 2026-04-18

## 概要

専用 Windows ミニ PC (`NucBoxG3_Plus`) 上で 24H365D 稼働する AI / AI エージェント統合基盤。13 個の MCP を連携し、Slack `#ai-agents` チャンネルに AI ニュース等を定期投稿する。`@NanoClaw` メンションで対話応答も行う。

## アーキテクチャ

```
Windows ミニ PC (NucBoxG3_Plus)
└── Docker Desktop (WSL 2 バックエンド)
     └── WSL Ubuntu (user=nano, default)
          │
          ├── [常駐層] user-level systemd
          │    └── nanoclaw.service
          │         Exec: /usr/bin/node /home/nano/nanoclaw/dist/index.js
          │         Unit: /home/nano/.config/systemd/user/nanoclaw.service
          │         Restart=always, RestartSec=5
          │         内包機能:
          │           - @slack/bolt Socket Mode (Slack WebSocket)
          │           - task-scheduler.ts (60秒ポーリング)
          │           - IPC Watcher
          │           - Credential Proxy (port 3001)
          │
          └── [ワーカー層] on-demand コンテナ
                docker run -i --rm nanoclaw-agent:latest
                コンテナ名: nanoclaw-slack-<group>-<unixms>
                終了時に自動破棄（--rm）
                13 MCP 設定を bind mount:
                  gmail / calendar / contacts / drive / sheets /
                  docs / maps / notion / memory / tasks /
                  youtube / github / ms365
                シークレットは各 MCP 設定ディレクトリに分散保存
                （.env は /dev/null 経由でマウントし露出を防止）
                Anthropic API は ANTHROPIC_BASE_URL=http://host.docker.internal:3001
                経由でホスト Credential Proxy から取得
```

## 登録スケジュール

データ実体: `/home/nano/nanoclaw/store/messages.db` (SQLite) の `scheduled_tasks` テーブル
登録方法: Slack で `@NanoClaw 毎朝X時に〇〇して` と発話すると DB に INSERT される（ファイル直編集ではない）

| タスク名 | 発火時刻 (JST) | 内容 | 採用期間（2026-04-18 追加）|
|---|---|---|---|
| ainews | 毎日 6 / 9 / 12 / 15 / 18 / 21 時 (3 時間おき) | AI ニュース収集 → `#ai-agents` 投稿 | 重要度 4-5: 直近 72h / 重要度 1-3: 直近 24h |
| ghtrend | 毎日 07:00 | GitHub トレンド投稿 | 直近 7 日以内に活動ある repo / 直近 24h 急上昇は ⭐ |
| ldyq11 | 毎日 09:00 | 朝の収集状況レポート | 直近 24h（本日分のみ）|
| weekly | 毎週月曜 08:00 | 週次ダイジェスト | 過去 7 日間の投稿集計（集計範囲そのものが 7 日）|

全 4 タスクとも JSON 出力時の `source` は `"ai-agents"` 固定（投稿先チャンネル名）。

## 収集タスクの期間フィルタ仕様（2026-04-18 導入）

`ainews` / `ghtrend` / `ldyq11` の 3 タスクは、古い記事や活動のない repo がレポートに混ざる問題を解消するため、プロンプト内に「採用期間ウィンドウ」を明示している。

共通ルール:

- 各記事 / repo には発表日（公開日）または最終コミット日 (YYYY-MM-DD) を必須項目として含める
- 日付が判別不能なものは採用しない
- 採用期間外のものは出力に含めない（ドロップ）
- 最終レポート末尾に「採用 N 件 / 期間外ドロップ M 件」を明記する（検証可能性）
- 実行時刻は `date '+%Y-%m-%d %H:%M JST'` の実シェル結果を使う（cron 予定時刻を引っ張らない）

各タスクのウィンドウ定義:

| タスク | 採用ウィンドウ |
|---|---|
| ainews | 重要度 4-5 → 宣言した実行日の 3 日前 00:00 JST 以降 / 重要度 1-3 → 1 日前 00:00 JST 以降 |
| ghtrend | 宣言した実行日の 7 日前 00:00 JST 以降 / うち 1 日前以降に動きがある repo は ⭐ マーク |
| ldyq11 | 宣言した実行日の 1 日前 00:00 JST 以降（固定 24h） |

プロンプト本体は `prompts/ainews.txt` / `prompts/ghtrend.txt` / `prompts/ldyq11.txt` / `prompts/weekly.txt` に保管し、DB の `scheduled_tasks.prompt` 列に反映する運用（readme.md 参照）。

## 機械可読データ出力仕様（schema v1.0、2026-04-18 改訂）

ノート PC 側で稼働する「AI News Dashboard」(GitHub: `ybbtsuyoshi/AI_News_Dashboard`、パーサ: `src/lib/universal-parser.ts`) との連携のため、4 つの定期タスクは Slack 投稿の **最末尾に `json` コードブロックを 1 個** 付与する。ダッシュボード側は JSON があれば優先パース、無ければ従来の Markdown パーサにフォールバックする設計。

### 共通ルール

- Markdown 本文を出力した**後**、投稿の**最末尾**に ```\`\`\`json ... \`\`\`` を 1 個だけ置く
- `schema_version` は `"1.0"` 固定
- `source` は `"ai-agents"` 固定（投稿先チャンネル名、全タスク共通）
- `collected_at` は実行時刻を ISO 8601 + JST (`+09:00`) 形式で書く
- `articles` は採用（期間フィルタ通過）されたアイテムのみ、Markdown 本文と同じ並びで格納
- null は書かない（任意フィールドが無ければキー自体を省略）
- JSON は厳密に valid: trailing comma 禁止、文字列内の改行は `\n`、コメント禁止

### JSON スキーマ

ルート:

```
{
  "schema_version": "1.0",      // 必須、固定値
  "source":         "ai-agents", // 必須、固定値
  "collected_at":   ISO 8601+JST, // 必須
  "articles":       [...]        // 必須、配列
}
```

各 article:

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

### 禁止キー（LLM が勝手に追加しがち、出力 NG）

`id`, `url`, `source_name`, `publisher`, `tags`, `keywords`, `published_at`, `date`, `report_type`, `is_report`, `summary_ja`, `description`, `content`, `author`, `language`, `lang`, `type`, `thumbnail`, `image_url` 等スキーマにないキーは**絶対に書かない**。LLM はニュース API でありがちなキー構造を流用しようとするが、スキーマにあるキーだけを使う。

### URL 3 鉄則（エビデンス重視、2026-04-18 追加）

ダッシュボード側は URL を「要約の正しさをユーザーが検証できる証拠」として扱う。従って NanoClaw 側は以下を厳守する:

1. **URL が取得できない記事は採用しない**（ghtrend は repo URL 自体が取得できない場合採用不可）。例外的に採用する場合は `primary_url` を空文字 `""` にし、`summary` 末尾に「※URL 取得不可」と明示。
2. **URL は加工せず原文のまま保存**。短縮化、リダイレクト解決、UTM パラメータ除去、どれも禁止。
3. **要約は URL の記事本文から読み取れる事実のみで生成**。LLM の事前知識で補完・推測しない。記事に書かれていない情報（株価への影響、業界観測、周辺動向など）を含めない。

### summary の日本語必須化

元記事が英語でも、**日本語に翻訳してから** 3-5 行で要約する。英語記事の抜粋をそのまま貼るのは禁止。技術用語の略語（LLM, MCP, GPT, API, SDK 等）のみ英語のまま使ってよい。

### タスク別 articles の中身

| タスク | articles に入るもの | 備考 |
|---|---|---|
| ainews | 期間フィルタ通過の各ニュース記事 | 重要度 4-5: 72h / 1-3: 24h |
| ghtrend | 採用された各 GitHub repo | `title`=owner/name、`primary_url`=repo URL、スター数・言語等は `summary` 内に日本語で織り込む |
| weekly | 今週のトップニュース 5 件 | トレンドキーワード・注目プレイヤー・来週の注目は Markdown のみ、JSON には含めない |
| ldyq11 (daily) | 24h 採用記事全件 | Markdown 本文は上位 3 件のみ表示、JSON には全件 |

### 既知のパーサ側対応事項

ダッシュボード側で JSON を取り出してから以下の 2 点を処理する必要あり:

1. **Slack の URL 自動ラッピング**: プロンプトが純粋な URL を指示していても、Slack が投稿受信時に山括弧でラップする（例: `"primary_url": "<https://...>"`）。パーサ側で URL フィールド値から先頭の `<` と末尾の `>` を剥がす。`<url|text>` 形式の場合はパイプ以降をトリム。
2. **null の残存**: プロンプトは「null を書かず省略」と指示しているが、LLM の厳密遵守は 100% ではない。パーサは「フィールド不在」と「値が null」の両方を undefined 相当として扱うのが安全。

### 運用メモ

- プロンプト変更時は `prompts/*.txt` を編集し DB に反映 → 手動発火でテスト（readme.md「手動発火」節参照）
- schema 変更時はノート PC 側ダッシュボードとの合意が必要（`#cowork-sync` チャンネルで調整）
- schema v2.0 を導入する場合は 1.0 との互換維持または移行期間を設ける
- LLM がスキーマ違反を起こした場合（例: 禁止キーの混入、英語 summary の残存）はプロンプトの禁止キー列挙・翻訳強制の強度を上げて対処する

## Slack 連携

- トリガーワード: `@NanoClaw` (正規表現 `^@NanoClaw\b`, 大文字小文字無視)
- 受信方式: `@slack/bolt` SDK の Socket Mode (WebSocket 常時接続)
- 対応チャンネル: `slack_main` / `slack_general` / `slack_ai_agents`
- メンション変換: Slack の `@UBOTID` 形式を `@NanoClaw` に自動変換して処理

## 自動起動の仕組み (2026-04-17 整備完了)

再起動後、人の介入なしで NanoClaw が復活する 8 段のリレー構造:

| 段 | レイヤー | 設定内容 |
|---|---|---|
| 1 | Windows 起動 | — |
| 2 | AutoAdminLogon | `HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon` に `AutoAdminLogon=1`, `DefaultUserName=G3 Plus2`, `DefaultDomainName=NUCBOXG3_PLUS`, `DefaultPassword=<設定済み>` |
| 3 | Docker Desktop 自動起動 | `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run\Docker Desktop` + `%APPDATA%\Docker\settings-store.json` の `autoStart=true` |
| 4 | WSL Ubuntu 起動 | Docker Desktop の WSL Integration 経由 |
| 5 | systemd 起動 | `/etc/wsl.conf` に `[boot] systemd=true` |
| 6 | ユーザー systemd 起動 | `loginctl enable-linger nano` (login セッションなしでも user manager を起動) |
| 7 | nanoclaw.service 起動 | `systemctl --user enable nanoclaw` |
| 8 | プロセス監視 | unit の `Restart=always, RestartSec=5` |

電源プラン: スリープ / 休止状態 / モニタタイムアウトをすべて無効化 (`powercfg /change ... 0`)

## 前提環境

- Windows 11 (ミニ PC: `NucBoxG3_Plus`)
- Docker Desktop 4.65 以上
- WSL 2 with Ubuntu ディストリ
- Node.js v20.20.1 (`/usr/bin/node`)
- Git
- ローカルアカウント `G3 Plus2` で運用

## セキュリティ方針

- シークレットは各 MCP 設定ディレクトリ (`~/.{service}-mcp/`) に分散保存
- プロジェクトの `.env` は `/dev/null` でマウントし内容を露出させない設計
- Anthropic 等の API トークンは Credential Proxy (port 3001) 経由で注入
- コンテナのコマンドラインにトークンを置かない（`CLAUDE_CODE_OAUTH_TOKEN=placeholder` でダミー）
- AutoAdminLogon のパスワードはレジストリ保存（物理アクセス限定の専用 PC 前提）
  - 将来強化したい場合: Sysinternals Autologon (LSA Secret 暗号化) に移行

## 変更管理ルール

- **仕様** は本ファイル (`agent.md`) を更新 → Git コミット
- **手順・運用** は `readme.md` を更新 → Git コミット
- **競合回避** のため新規サービスは Docker 化を原則とする
- **再起動耐性** を壊す変更は要注意（上記 8 段リレーのどれを変えるかを明示）

## 既知の注意点

- `npm run setup` は `-- --step <environment|container|groups|register|mounts|service|verify>` が必須。引数なしは usage を出して終了
- `systemctl status nanoclaw` (system-level) は "Unit not found" になる → **必ず `systemctl --user status nanoclaw`**
- `setup/service.ts` を root で実行すると system-level unit が作られるが `User=` 指定がないため `HOME=/root` になり `.env` が見えず失敗 → **通常ユーザー (`nano`) で実行が正解**
- `/etc/wsl.conf` にかつて `command=service nanoclaw start` が書かれていたが、対応する init.d スクリプトは存在せず空振りだった。2026-04-17 に削除済み
- **IPC (`/home/nano/nanoclaw/data/ipc/`) は outbound Slack 投稿のブリッジ専用**。ワーカーコンテナ → ホスト Node.js → Slack への片方向チャネルであり、任意の JSON ファイルを置いても task-scheduler は拾わない。Slack Bot が「IPC トリガーファイルを書きました」と応答しても、`@NanoClaw タスクを今すぐ実行して` のメンション経由では実際にスケジュールタスクは再発火しない（ハルシネーション応答）。手動発火は DB の `scheduled_tasks.next_run` を過去時刻に UPDATE する方法（readme.md 参照）で行う。
- `sqlite3` CLI は WSL にデフォルト未インストール。DB 参照 / 更新は Python の `sqlite3` モジュール経由で行う（`apt install` を要求しない）。
