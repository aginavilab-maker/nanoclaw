# 開発ガイド

NanoClawの開発・運用に必要な情報をまとめたドキュメントです。

## 環境構成

### 必要な環境変数（`.env`）

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Yes | Claude Code認証トークン |
| `ASSISTANT_NAME` | No | トリガー名（デフォルト: `Andy`） |
| `CLAUDE_MODEL` | No | 使用するモデル（例: `claude-sonnet-4-20250514`） |
| `SLACK_BOT_TOKEN` | Slack使用時 | Slack Bot User OAuth Token |
| `SLACK_APP_TOKEN` | Slack使用時 | Slack App-Level Token（Socket Mode用） |
| `GMAIL_POLLING` | Gmail使用時 | Gmailポーリング有効化 |

### 現在有効なチャネル

チャネルは `src/channels/index.ts` で管理されます。importを追加/削除するだけで有効化/無効化できます。

```typescript
// src/channels/index.ts
import './slack.js';     // Slack — 有効
import './telegram.js';  // Telegram — 有効
// import './gmail.js';  // Gmail — 無効（OAuth token失効）
```

### ディレクトリ構成

```
nanoclaw/
├── src/                    # TypeScriptソースコード
│   ├── index.ts            # メインオーケストレーター
│   ├── channels/           # チャネル実装（自己登録方式）
│   │   ├── registry.ts     # チャネルレジストリ
│   │   ├── slack.ts        # Slack実装
│   │   ├── telegram.ts     # Telegram実装
│   │   └── gmail.ts        # Gmail実装
│   ├── config.ts           # 設定値（環境変数から読み込み）
│   ├── container-runner.ts # コンテナ起動・IPC処理
│   ├── container-runtime.ts # Docker/Apple Container抽象化
│   ├── credential-proxy.ts # 認証プロキシ（ポート3001）
│   ├── db.ts               # SQLiteデータベース操作
│   ├── router.ts           # メッセージルーティング
│   ├── task-scheduler.ts   # スケジュールタスク実行
│   ├── logger.ts           # pinoロガー設定
│   └── types.ts            # 型定義
├── container/              # エージェントコンテナ
│   ├── Dockerfile          # コンテナイメージ定義
│   ├── build.sh            # ビルドスクリプト
│   ├── agent-runner/       # コンテナ内エージェント実行
│   └── skills/             # コンテナ内スキル
├── groups/                 # グループごとの分離データ
│   ├── main/CLAUDE.md      # メインチャネルのメモリ
│   └── global/CLAUDE.md    # グローバルメモリ
├── data/                   # SQLiteデータベース
├── store/                  # 認証ストア
└── dist/                   # ビルド出力
```

## 開発コマンド

```bash
# 開発（ホットリロード）
npm run dev

# ビルド
npm run build

# 本番起動
npm run start

# テスト
npm run test           # 全テスト実行
npm run test:watch     # ウォッチモード

# 型チェック
npm run typecheck

# フォーマット
npm run format         # Prettierで整形
npm run format:check   # 整形チェックのみ

# コンテナイメージ再ビルド
./container/build.sh
```

## サービス管理

### Linux（systemd）

```bash
systemctl --user start nanoclaw     # 起動
systemctl --user stop nanoclaw      # 停止
systemctl --user restart nanoclaw   # 再起動
systemctl --user status nanoclaw    # 状態確認
journalctl --user -u nanoclaw -f    # ログをリアルタイム表示
```

### macOS（launchd）

```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # 再起動
```

## デバッグ

### ログ

- ログレベルは環境変数 `LOG_LEVEL` で制御（デフォルト: `info`）
- 利用可能なレベル: `trace`, `debug`, `info`, `warn`, `error`, `fatal`
- ログ出力は `pino-pretty` でフォーマットされ、色付きでstderrに出力

```bash
# デバッグレベルで起動
LOG_LEVEL=debug npm run dev

# サービスのログ確認（Linux）
journalctl --user -u nanoclaw --since "1 hour ago"

# nohupで起動した場合
tail -f nanoclaw.log
```

### よくある問題と対処法

| 症状 | 原因 | 対処 |
|------|------|------|
| `EADDRINUSE: address already in use 127.0.0.1:3001` | 前のプロセスが残っている | `lsof -i :3001` で確認し `kill` する |
| コンテナが起動しない | Dockerデーモン停止 | `docker info` で確認、`systemctl start docker` |
| メッセージに応答しない | トリガーパターン不一致 | `.env` の `ASSISTANT_NAME` を確認 |
| スケジュールタスクが実行されない | タイムゾーン不一致 | `TZ` 環境変数を確認 |
| コンテナビルドが古いまま | BuildKitキャッシュ | `docker builder prune` 後に `./container/build.sh` |

### データベース確認

SQLiteデータベースは `data/` ディレクトリにあります。

```bash
# メッセージ一覧
sqlite3 data/messages.db "SELECT chat_jid, sender_name, content, timestamp FROM messages ORDER BY timestamp DESC LIMIT 10;"

# 登録グループ一覧
sqlite3 data/messages.db "SELECT * FROM registered_groups;"

# スケジュールタスク一覧
sqlite3 data/messages.db "SELECT id, group_folder, prompt, schedule_value, status, next_run FROM scheduled_tasks;"

# セッション一覧
sqlite3 data/messages.db "SELECT * FROM sessions;"
```

## アーキテクチャの要点

### メッセージフロー

1. チャネル（Slack/Telegram等）がメッセージを受信し、SQLiteに保存
2. メインループが2秒ごとにSQLiteをポーリング
3. トリガーパターン（`@AssistantName`）にマッチするメッセージを検出
4. グループキューに投入（最大同時実行数: `MAX_CONCURRENT_CONTAINERS` = 5）
5. Docker/Apple Containerでエージェントを起動
6. エージェントの出力をパースし、ルーターが適切なチャネルにルーティング

### チャネルの追加方法

1. `src/channels/` にチャネル実装ファイルを作成
2. `registerChannel()` を使って自己登録
3. `src/channels/index.ts` にimportを追加

既存のチャネル実装（`slack.ts`, `telegram.ts`）を参考にしてください。

### 設定値の変更

設定値は `src/config.ts` に集約されています。主要な設定：

| 設定 | デフォルト | 説明 |
|------|-----------|------|
| `POLL_INTERVAL` | 2000ms | メッセージポーリング間隔 |
| `SCHEDULER_POLL_INTERVAL` | 60000ms | スケジューラーポーリング間隔 |
| `CONTAINER_TIMEOUT` | 1800000ms (30分) | コンテナ最大実行時間 |
| `IDLE_TIMEOUT` | 1800000ms (30分) | コンテナアイドルタイムアウト |
| `MAX_CONCURRENT_CONTAINERS` | 5 | 最大同時コンテナ数 |
| `CREDENTIAL_PROXY_PORT` | 3001 | 認証プロキシポート |

## コード修正の手順

1. **ソースを編集**: `src/` 配下のTypeScriptファイルを修正
2. **型チェック**: `npm run typecheck` でエラーがないか確認
3. **テスト**: `npm run test` で既存テストが通ることを確認
4. **ビルド**: `npm run build` でJavaScriptにコンパイル
5. **動作確認**: `npm run dev` で起動し、メッセージ送受信をテスト
6. **コンテナ変更時**: `./container/build.sh` でイメージを再ビルド

### コンテナ内スキルの修正

`container/skills/` のファイルを修正した場合、コンテナイメージの再ビルドが必要です：

```bash
# キャッシュを削除して完全クリーンビルド
docker builder prune -f
./container/build.sh
```
