# NanoClaw 運用ガイド (readme.md)

最終更新: 2026-04-18

## これは何

NanoClaw は Windows ミニ PC 上で 24H365D 稼働する AI エージェント基盤です。
- **仕様**（何が・どこで・どう動いているか） → `agent.md` 参照
- **使い方・運用手順**（本ファイル） → 日常の確認・起動・停止・トラブル対応

## 環境前提

| 項目 | 値 |
|---|---|
| ホスト | Windows 11 ミニ PC (`NucBoxG3_Plus`) |
| ログオンアカウント | `G3 Plus2` (ローカルアカウント) |
| WSL ディストリ | Ubuntu (user: `nano`) |
| プロジェクトルート | `/home/nano/nanoclaw/` (WSL 内) |
| 運用チャンネル | Slack `#ai-agents` |
| テスト用チャンネル | Slack `#nanoclaw-test` |

## 日常の動作確認

### 最頻用: NanoClaw が生きているか (1 コマンド)

**PowerShell で:**

```powershell
wsl -d Ubuntu -- bash -lc "systemctl --user is-active nanoclaw"
```

→ `active` なら OK。`inactive` / `failed` なら後述のトラブル対応へ。

### Slack 経由の生存確認

`#nanoclaw-test` で `@NanoClaw ping` と投稿 → 数分以内に応答があれば完全稼働。

### 詳細状態

```powershell
wsl -d Ubuntu -- bash -lc "systemctl --user status nanoclaw --no-pager | head -15"
```

### Docker コンテナの稼働状況

```powershell
docker ps                                   # 現在走っているワーカー
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"   # 履歴
```

### Docker Desktop 自体の生死

```powershell
docker version
```

## 起動・停止・再起動

WSL Ubuntu 内で実行 (PowerShell で `wsl -d Ubuntu` 後)。

```bash
# 手動停止
systemctl --user stop nanoclaw

# 手動起動
systemctl --user start nanoclaw

# 手動再起動 (プロセス入れ替え)
systemctl --user restart nanoclaw

# 自動起動の有効化/無効化
systemctl --user enable nanoclaw
systemctl --user disable nanoclaw

# ログ (直近 50 行)
journalctl --user -u nanoclaw --no-pager -n 50

# ログ (リアルタイム追尾)
journalctl --user -u nanoclaw -f
```

## 再起動後の復帰フロー (確認ポイント)

Windows 再起動から NanoClaw 完全復活まで **約 3〜5 分**。

| 経過時間 | 起きること | 確認方法 |
|---|---|---|
| 0 秒 | 電源 / 再起動トリガー | — |
| 30 秒 | AutoAdminLogon で自動ログオン | ロック画面が素通りする |
| 1-2 分 | Docker Desktop 起動 | タスクトレイに鯨アイコン |
| 2-3 分 | WSL Ubuntu + systemd 起動 | `wsl --list --verbose` で Ubuntu `Running` |
| 3-4 分 | nanoclaw.service active | `systemctl --user is-active nanoclaw` = `active` |
| 4-5 分 | Slack Socket Mode 接続 | `#nanoclaw-test` で `@NanoClaw ping` |

## トラブル対応

### Q1. `systemctl --user is-active nanoclaw` が `inactive`

```powershell
# まず WSL が動いているか
wsl --list --verbose

# Ubuntu が Stopped だったらキック
wsl -d Ubuntu -- true

# それでも inactive なら手動起動を試みる
wsl -d Ubuntu -- bash -lc "systemctl --user start nanoclaw"

# 起動失敗の理由を journal で
wsl -d Ubuntu -- bash -lc "journalctl --user -u nanoclaw --no-pager -n 50"
```

### Q2. 再起動したのにロック画面で止まる (AutoAdminLogon 失敗)

1. 手動でパスワードを入れて Windows にログオン
2. PowerShell (管理者) で現在値確認:
   ```powershell
   Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' | Select-Object AutoAdminLogon, DefaultUserName, DefaultDomainName
   ```
3. パスワードが変わっているなら更新:
   ```powershell
   Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' `
       -Name 'DefaultPassword' -Value '新しいパスワード' -Type String
   ```

### Q3. Slack に投稿が来ない、`@NanoClaw` も反応しない

- `systemctl --user is-active nanoclaw` が `active` か確認
- `active` なのに来ない場合、Slack トークンが失効の可能性
- 各 MCP 設定ディレクトリ (`~/.slack-mcp/` など) を確認

### Q4. Docker コンテナが残留する

```powershell
docker container prune           # 停止済みコンテナを一括削除
docker system df                 # ディスク使用量確認
docker builder prune             # ビルドキャッシュ削除
```

### Q5. 完全にリセットして最初からやり直したい

WSL Ubuntu で:

```bash
# 現行プロセスを止める
systemctl --user stop nanoclaw
systemctl --user disable nanoclaw

# unit ファイルを削除
rm -f /home/nano/.config/systemd/user/nanoclaw.service
systemctl --user daemon-reload

# 再セットアップ
cd /home/nano/nanoclaw
npm run setup -- --step service
```

## 重要な設定ファイル・場所

| 項目 | 場所 |
|---|---|
| systemd user unit | `/home/nano/.config/systemd/user/nanoclaw.service` |
| WSL 起動設定 | `/etc/wsl.conf` (現状: `systemd=true`, `default=nano` のみ) |
| Windows 自動ログオン | レジストリ `HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon` |
| Docker 自動起動 | レジストリ `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run\Docker Desktop` + `%APPDATA%\Docker\settings-store.json` |
| スケジュール DB | `/home/nano/nanoclaw/store/messages.db` (`scheduled_tasks` テーブル) |
| NanoClaw ログ | `/home/nano/nanoclaw/logs/nanoclaw.log` + `.error.log` |
| NanoClaw journal | `journalctl --user -u nanoclaw` |

## スケジュールの追加・変更

Slack で NanoClaw に話しかける形で登録・変更が可能:

```
@NanoClaw 毎朝 07:30 に GitHub トレンドを集めて #ai-agents に投稿して
@NanoClaw 毎週月曜 9:00 の週次レポートは 10:00 に変更して
@NanoClaw 登録されているスケジュールを全部教えて
```

DB を直接編集する運用は避ける（プロンプト本文の変更を除く、後述）。

### 注意: Slack Bot のハルシネーションに注意

`@NanoClaw タスクを今すぐ実行して` のようなメンションに対して Bot が「**IPC トリガーファイルを書きました。`/workspace/ipc/.../run-xxx.json` を作成済みです**」等と応答することがあるが、これは Bot の**ハルシネーション**。`IPC Watcher` は outbound Slack 投稿用のブリッジで、任意パスの JSON を task trigger として拾う機能は**存在しない**。手動発火は次節の DB 更新方式を使う。

## 手動発火（今すぐ実行）

定期タスクを任意のタイミングで 1 回だけ走らせたい場合、`scheduled_tasks.next_run` を過去時刻に UPDATE すれば task-scheduler（60 秒ポーリング）が next poll 時に due と判定して発火する。発火後、`next_run` は cron 式から次の予定時刻へ自動再計算される。

```bash
# 例: ainews を今すぐ 1 回実行
cd /home/nano/nanoclaw && python3 <<'PY'
import sqlite3, datetime
con = sqlite3.connect("store/messages.db")
new_next_run = (datetime.datetime.now(datetime.UTC) - datetime.timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
con.execute("UPDATE scheduled_tasks SET next_run=? WHERE id='task-1774596632748-ainews'", (new_next_run,))
con.commit()
print(f"ainews: next_run -> {new_next_run}  (fires within 60s)")
con.close()
PY
```

タスク ID 参照表:

| タスク | ID |
|---|---|
| ainews | `task-1774596632748-ainews` |
| ghtrend | `task-1774596632748-ghtrend` |
| weekly | `task-1774596632748-weekly` |
| ldyq11 | `task-1774667756106-ldyq11` |

実行後 60 秒以内にログへ `Running scheduled task / taskId: ...` が出て、2-4 分で Slack 投稿まで完了する。JSON ブロックを書く分、従来より出力長が 3 倍前後に増えるので完了まで 6-8 分かかることもある。

## 収集タスクのプロンプト変更

4 タスク（`ainews` / `ghtrend` / `weekly` / `ldyq11`）の収集ルール本体は `prompts/ainews.txt` / `ghtrend.txt` / `weekly.txt` / `ldyq11.txt` にテキスト保管し、DB の `scheduled_tasks.prompt` 列に反映する。

変更手順:

1. `prompts/<task>.txt` を編集（期間ウィンドウ・キーワード・フォーマット等）
2. バックアップして DB へ UPDATE:

   ```bash
   cd /home/nano/nanoclaw && python3 <<'PY'
   import sqlite3, pathlib, datetime
   TID = "task-1774596632748-ainews"  # ← 対象タスクの ID
   SRC = pathlib.Path("/mnt/c/Users/G3 Plus2/Documents/NanoClaw/NanoClaw/prompts/ainews.txt")
   new_prompt = SRC.read_text(encoding="utf-8")
   con = sqlite3.connect("store/messages.db")
   old = con.execute("SELECT prompt FROM scheduled_tasks WHERE id=?", (TID,)).fetchone()
   ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
   pathlib.Path(f"backups/{TID}-{ts}.txt").write_text(old[0], encoding="utf-8")
   con.execute("UPDATE scheduled_tasks SET prompt=? WHERE id=?", (new_prompt, TID))
   con.commit(); con.close()
   print("updated")
   PY
   ```
3. 手動発火（前節の方法）でテスト → `#ai-agents` の投稿を目視確認
4. `prompts/*.txt` も Git コミット対象に含める

## ダッシュボード連携と JSON データ契約

NanoClaw の 4 つの定期タスクは、ノート PC 側で稼働する「AI News Dashboard」との連携のため、Slack 投稿末尾に **`json` コードブロック**を 1 個付与する（schema v1.0、2026-04-18 改訂版）。仕様詳細は `agent.md` の「機械可読データ出力仕様」節、または `handoff.md` を参照。

**重要な変更点 (2026-04-18 夕刻改訂)**:
- `report_type` → 廃止、全タスクで `source: "ai-agents"` 固定に統一
- `summary_ja` → `summary` にリネーム、3-5 行に拡張
- `is_report` / `published_at` → 廃止
- `source_url` → `report_url` にリネーム
- `sentiment` (positive/negative/neutral) 追加
- `region` 候補に `kr`, `in` 追加
- URL 3 鉄則（エビデンス重視）と日本語 summary 必須化

### 投稿後の JSON ブロック確認方法

```bash
# 直近の ainews 投稿の末尾を確認（Slack MCP や投稿リンク経由で）
# DB 側から見るには last_result に内部メモのみ格納されるので、実体確認は Slack で行う
```

Slack の `#ai-agents` チャンネルを開き、NanoClaw の最新投稿をスクロールすると末尾に畳まれた JSON コードブロックが見える。展開すると schema v1.0 構造の JSON が入っている。

### 引き継ぎドキュメント

ノート PC 側でダッシュボードの開発を継続する Cowork セッションには `handoff.md` に情報を集約してある。

- 現在の実装ステータス
- JSON パース時の既知の注意点（URL 自動ラップ、null 残存）
- 検証済み / 未検証の report_type
- Slack / Git / プロンプトへのポインタ

新しい Cowork セッション（ノート PC 側）を開いたら、まず `handoff.md` を読むことを推奨。

## 定期メンテナンス

月 1 回を目安に:

- [ ] `docker system df` でディスク消費を確認、必要なら prune
- [ ] `journalctl --user -u nanoclaw --since "30 days ago" | grep -i error` でエラー履歴
- [ ] Slack 各 MCP のトークン有効期限を確認
- [ ] Windows Update 適用 → 再起動テスト
- [ ] `git log --oneline -20` で直近の変更を確認

## 変更履歴の管理

変更は必ず Git コミット単位で:

```bash
cd /home/nano/nanoclaw
git status
git add agent.md readme.md <その他の変更ファイル>
git commit -m "docs: 変更内容を一行で"
```

コミットメッセージは Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) を推奨。

## セキュリティメモ

- AutoAdminLogon のパスワードはレジストリに平文保存されている
- より安全にしたい場合: Microsoft Sysinternals の [Autologon](https://learn.microsoft.com/ja-jp/sysinternals/downloads/autologon) を使うと LSA Secret に暗号化保存される
- 物理的な PC のセキュリティ（誰もアクセスできない場所に設置等）が第一のガード
- Slack トークンや API キーは絶対に agent.md / readme.md / Git にコミットしない（.gitignore で .env 系を除外）

## 2026-04-17 の自動起動整備作業メモ

この日に実施した設定変更:

1. `loginctl enable-linger nano` で linger 有効化
2. `/etc/wsl.conf` から動作しない `command=service nanoclaw start` 行を削除
3. `npm run setup -- --step service` で user-level `nanoclaw.service` を (再)登録
4. Docker Desktop の `HKCU\...\Run` 登録 + `settings-store.json` の `autoStart=true`
5. Windows `HKLM\...\Winlogon` に `AutoAdminLogon=1` + `DefaultUserName=G3 Plus2` + `DefaultDomainName=NUCBOXG3_PLUS` + `DefaultPassword=<設定済み>`
6. `powercfg` でスリープ / 休止状態 / モニタタイムアウトを全て `0` (なし)

変更前の問題: 再起動後に NanoClaw が復旧せず、手動で Docker Desktop + サービス起動が必要だった。
変更後の期待: Windows 再起動 → 3〜5 分で完全復活（人手介入ゼロ）。
