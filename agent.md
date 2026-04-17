# NanoClaw 仕様 (agent.md)

最終更新: 2026-04-17

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

| タスク名 | 発火時刻 (JST) | 内容 |
|---|---|---|
| ainews | 毎日 6 / 9 / 12 / 15 / 18 / 21 時 (3 時間おき) | AI ニュース収集 → `#ai-agents` 投稿 |
| ghtrend | 毎日 07:00 | GitHub トレンド投稿 |
| ldyq11 | 毎日 09:00 | 朝の収集状況レポート |
| weekly | 毎週月曜 08:00 | 週次ダイジェスト |

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
