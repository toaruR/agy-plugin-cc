<!-- spec-doc:last-reviewed-commit=75244ff2e3bc8b47f9e2376ca274e42f83fdf366 (agy-plugin-cc) reviewed-at=2026-07-24 -->

# 仕様書

<!--
このファイルは /spec-doc コマンドが git 差分から自動で追記・更新する。
- 先頭のマーカー行は /spec-doc が「前回どのコミットまで確認したか」を記録するためのもの。
  手で編集しない（初回はマーカーなしのままでもよく、その場合 /spec-doc が初回モードで動く）
- 構成: 対象（機能 / モジュール / API / 設定 など）ごとに節を分ける
- 実装手順ではなく「何が・どう振る舞うか」（仕様・挙動・設計意図）を書く
-->

## 概要

Claude Code 用のコミュニティプラグイン。Google の Antigravity CLI (`agy`) をローカルから呼び出し、
Claude Code のセッション内でコードレビューやタスク委任を行えるようにする。`openai/codex-plugin-cc`
の仕組みを Antigravity CLI 向けに移植したもので、Google 非公式（非提携）。

- ユーザーのローカル `agy` インストール・認証情報をそのまま利用する（プラグイン独自のランタイムは
  持たない）。
- Windows / macOS / Linux で動作する。
- Node.js 18+ が必要。

## リポジトリ構成

```
.claude-plugin/marketplace.json        マーケットプレイス定義
src/plugins/agy/
  .claude-plugin/plugin.json           プラグイン定義
  commands/                            /agy:* スラッシュコマンド定義（review/delegate/status/result/cancel/setup）
  agents/agy-runner.md                 委任用サブエージェント
  skills/agy-cli-runtime/              内部ランタイム契約（agy-runner サブエージェント専用、非公開）
  hooks/hooks.json                     セッションライフサイクルの記帳フック
  scripts/agy-companion.mjs            ランタイムブローカー本体
  scripts/session-lifecycle-hook.mjs   SessionStart/SessionEnd フック本体
src/tests/                             テストスイート（companion.test.mjs, helpers.mjs）
```

- マーケットプレイス名: `antigravity-agy`（owner: toaruR）。プラグイン名: `agy`。
  `.claude-plugin/marketplace.json` の `plugins[].source` が `./src/plugins/agy` を指す。
- インストール: `/plugin marketplace add toaruR/agy-plugin-cc` → `/plugin install agy@antigravity-agy`。

## マーケットプレイス / プラグインのバージョニング

- `package.json`・`marketplace.json`・`plugin.json` はいずれも `version: "0.1.0"` で揃えて管理する。

## スラッシュコマンド

すべてのコマンドは `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" <サブコマンド> ...` を
呼び出し、その標準出力を**そのまま**（要約・言い換え・追記なしで）ユーザーに返す設計。

### `/agy:review [--wait|--background] [--base <ref>]`

- 現在の git 差分に対する読み取り専用の agy コードレビューを実行する。
- 独自のフォーカステキストは受け付けない。差分から strict な read-only レビュープロンプトを
  companion 側で自動生成する。
- 実行モードの決定:
  - 引数に `--wait` があれば確認なしでフォアグラウンド実行。
  - 引数に `--background` があれば確認なしでバックグラウンド実行（Claude の `Bash`
    `run_in_background: true` で起動し、その場で `BashOutput` を呼ばず完了を待たない）。
  - どちらも無ければ差分サイズを見積もり（working tree なら `git status`/`diff --shortstat`、
    base 指定なら `git diff --shortstat <base>...HEAD`。未追跡ファイルもレビュー対象として扱う）、
    概ね 1〜2 ファイルの小さい差分のときだけ「待つ」を推奨、それ以外（不明な場合を含む）は
    「バックグラウンド」を推奨した上で `AskUserQuestion` を一度だけ提示する。
- レビュー専用であり、指摘の修正やパッチ適用、修正予告は行わない。

### `/agy:delegate [--background|--wait] [--resume|--fresh] [--read-only] [--model <model>] [--effort <low|medium|high>] [--mode <accept-edits|plan>] <依頼内容>`

- `Agent` ツール経由で `agy:agy-runner` サブエージェント（`subagent_type: "agy:agy-runner"`）に
  ユーザーの依頼をそのまま転送する。コマンド自身は `Skill(...)` を呼ばない。
- 実行モード: `--background`/`--wait` は Claude 側の実行制御であり、companion の `task` へは
  転送しない。指定が無ければ、小さく閉じたタスクはフォアグラウンド、オープンエンドで多段の作業は
  バックグラウンドをデフォルトとする。
- `--model`/`--effort`/`--mode` はそのまま companion へ転送する（タスク本文には含めない）。
- 再開判定: `--resume`/`--fresh` が明示されていればそれに従う。無ければ
  `task-resume-candidate --json` で直前の完了済み task ジョブの有無を確認し、`available: true`
  なら「続きから」か「新規スレッド」かを `AskUserQuestion` で一度だけ確認する（ユーザー発話が
  明らかに続き作業を示す場合は「続きから」を推奨、それ以外は「新規」を推奨）。
- 既定は書き込み可能な実行。読み取り専用にするには `--read-only` を明示する。
- companion が agy 未インストールと報告した場合は `/agy:setup` の実行を案内して停止する。

### `/agy:status [<job-id>]`

- このリポジトリに対する実行中・直近のジョブ一覧（または指定 ID の詳細 JSON）を表示する。

### `/agy:result [<job-id>]`

- 指定ジョブ（省略時は最新の完了済みジョブ）の保存済み出力を表示する。

### `/agy:cancel [<job-id>]`

- 指定ジョブ（省略時は最新の実行中ジョブ）をキャンセルする。

### `/agy:setup [--json]`

- `agy` の導入・認証状態を確認する。未インストールの場合のみ `AskUserQuestion` で
  インストール可否を一度確認し、承諾されればプラットフォーム別のインストールコマンドを実行して
  再チェックする。インストール済みなら導入可否は問わず、未認証の場合のみ `agy` を一度実行して
  サインインするよう案内する。

## サブエージェント: `agy:agy-runner`

- モデル: `sonnet`。使用可能ツールは `Bash` のみ。`agy-cli-runtime` スキルを参照する。
- 役割は companion `task` サブコマンドへの**単純な転送のみ**。リポジトリの調査・ファイル読み込み・
  grep・進捗監視・ステータス確認・結果取得・キャンセル・出力の要約など、転送以外の作業は一切行わない。
- `Bash` 呼び出しは 1 回のみ:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task ...`
- `review`/`status`/`result`/`cancel` は呼び出さない（`task` 専用）。
- 既定は書き込み可能な実行。ユーザーが明示的にレビュー/診断/調査のみを求めた場合のみ
  `--read-only` を付与する。
- `Bash` 呼び出しが失敗した場合、あるいは agy を起動できなかった場合は何も返さない
  （フォールバック文言を生成しない）。

## スキル: `agy-cli-runtime`（非公開・内部契約）

- `user-invocable: false`。`agy:agy-runner` サブエージェント内でのみ使用する内部ヘルパー契約。
- フラグの扱い:
  - `--background`/`--wait`: Claude 側の実行制御。`task` を呼ぶ前に取り除き、タスク本文には
    含めない。
  - `--model`/`--effort`/`--mode`: そのまま companion へ転送する。
  - `--resume`（companion 側で `agy -c` を付与）/`--fresh`: そのまま転送する。
  - `--read-only`: 書き込み可能動作をオフにする。省略時は既定で書き込み可能。
- companion による agy 起動方式（後述）と、書き込み可能実行時に
  `--dangerously-skip-permissions` が付与される点を明記している。

## ランタイムブローカー: `scripts/agy-companion.mjs`

Claude Code とローカルの `agy` CLI をつなぐ単一の Node スクリプト。サブコマンド:
`setup`, `review`, `task`, `status`, `result`, `cancel`, `task-resume-candidate`。

### agy の検出・設定確認

- `agy --version` を実行できるかで `installed` を判定する（起動エラー時は未インストール扱い）。
- `isConfigured()` は `~/.gemini/antigravity-cli/` の存在有無で認証済みかを判定する
  （ハードコードされたパス。agy 側の実装がこのパスを変更した場合は追随が必要）。
- `setup` の `installHint` は Windows で
  `irm https://antigravity.google/cli/install.ps1 | iex`、それ以外で
  `curl -fsSL https://antigravity.google/cli/install.sh | bash`。

### agy 実行方式（3 段フォールバック）

`agy -p "<prompt>"`（公式の非対話 print モード）を直接起動するのが基本。現行の agy（1.1.x）は
非 TTY な標準出力にも正しく出力するため、通常はこれで完結する。

1. **直接起動**（`runAgyDirect`）: `spawnSync("agy", agyArgs, ...)`。
2. 直接起動の標準出力が空だった場合のみリトライする（旧版 agy（<= 1.0.6）が標準出力を TTY に
   ゲートしていた [upstream bug #76](https://github.com/rhishi99/agy-headless-bridge) 対策）:
   - **POSIX**（`runAgyPty`）: 疑似端末経由で再実行する。macOS では
     `script -q /dev/null agy ...`、Linux（util-linux 版 script）では
     `script -qec "<command>" /dev/null`。
   - **Windows**（`runAgyBridge`）: `script` が無いため、`agy-bridge`
     （[agy-headless-bridge](https://github.com/rhishi99/agy-headless-bridge)、
     `pip install agy-headless-bridge`）が入っていればそれにフォールバックする。ただし
     **ロッシー**（プロンプトと `--model` のみ転送。`--effort`/`--mode`/`-c`/permission
     フラグは非対応）。
3. それでも出力が空なら、stderr があればそれを、無ければプラットフォーム別の案内文
   （script/agy-headless-bridge の導入や WSL 利用を促す）を出力として返す。
- 出力は `stripAnsi()` で ANSI エスケープ・OSC シーケンス・孤立した `\r` を除去してから扱う。

### ジョブ追跡

- 状態ディレクトリ: `~/.agy-plugin-cc/jobs/<repo-hash>/`（`repo-hash` は `git rev-parse
  --show-toplevel` の SHA-1 先頭 12 桁）。リポジトリ単位でジョブが分離される。
- ジョブ ID 形式: `job-<kind>-<YYYYMMDDHHmmss>-<6桁hex>`。`kind` は `review`/`task`。
- 各ジョブは `<jobsDir>/<id>.json` に `{ id, kind, status, startedAt, endedAt, pid, cwd, args,
  output, ...meta }` として保存される。`status` は `running` → `completed`/`failed`、または
  `cancel` 実行時は `cancelled`。
- `status`/`result`/`cancel` はジョブ ID 未指定の場合、それぞれ「最新順一覧」「直近の完了済み
  （running 以外）」「直近の running」を対象にする。
- `cancel` は `process.kill(pid, "SIGTERM")` を試み、失敗（プロセス消滅済み等）は無視した上で
  ジョブを `cancelled` にマークする。

### `review` サブコマンドの差分収集

- `--base <ref>` 指定時は `git diff <ref>...HEAD` を対象とする。
- 無指定時は working tree（staged diff + unstaged diff + 未追跡ファイル一覧）を対象とする。
  未追跡ファイルは diff 本文には出さず、「Untracked files (not shown in diff):」として
  ファイル名一覧のみ追記する。
- 対象差分が空なら `Nothing to review (<label> is clean).` を出して exit 0（ジョブ化しない）。
- 差分が 180,000 文字を超える場合はレビュー本文に diff を埋め込まず、agy 自身に読み取り専用で
  `git diff` を実行させる指示に切り替える（プロンプト肥大化・トークン超過対策と思われる。
  **要確認**: この閾値の根拠は diff 上からは読み取れない）。
- 生成される agy 呼び出しは常に `-p "<prompt>"` のみで、`--dangerously-skip-permissions` は
  一切付与しない（review は常に読み取り専用）。

### `task` サブコマンドのフラグ変換

- 位置引数（フラグ以外のトークン）を連結したものがタスク本文。空ならエラー終了。
- `--model`/`--effort`/`--mode` はそれぞれ `--model`/`--effort`/`--mode` として agy にそのまま
  転送する。
- `--resume`（または内部エイリアス `--resume-last`）かつ `--fresh` 非指定のときのみ `-c`
  （直近の会話を継続）を付与する。
- 既定は書き込み可能: `--read-only` かつ `--write` 非指定でない限り
  `--dangerously-skip-permissions` を付与する（headless agy は対話的な permission
  プロンプトに応答できないため、書き込み実行時は自動承認が前提設計）。
- `--read-only` を指定すると `--dangerously-skip-permissions` は付与されない。

### `task-resume-candidate`

- このリポジトリで直近に `completed` した `kind: "task"` ジョブがあるかを
  `{ available, jobId }` として返す（`--json` 指定時は JSON、無指定時は簡易文言）。
  `delegate` コマンドが「続きから/新規」の判定に使う。

## セッションライフサイクルフック（`hooks/hooks.json` / `scripts/session-lifecycle-hook.mjs`）

- `SessionStart`/`SessionEnd` の両方で
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-lifecycle-hook.mjs" <Phase>` を実行（各
  `timeout: 5` 秒）。
- 役割は状態ディレクトリ（`~/.agy-plugin-cc/jobs/<repo-hash>/`）の存在確保と、
  `.session.json` への `{ phase, root, at }` の記帳のみ。
- **セッションを絶対にブロックしない**設計: 内部処理は try/catch で包み、失敗時も必ず
  `process.exit(0)` で終了する。

## テストスイート（`src/tests/`）

- `node --test "src/tests/**/*.test.mjs"`（`npm test`）。POSIX（macOS/Linux）想定の CI。
- `helpers.mjs` が隔離環境を構築する: 一時 `HOME`/一時 git リポジトリ/最小限のツールだけを
  シンボリックリンクした `PATH`、および偽の `agy` シェバンスクリプト（`FAKE_AGY_VERSION`で
  バージョン偽装、`FAKE_AGY_TTY_ONLY=1` で「TTY 以外では何も出力しない」旧版挙動を再現可能）。
- `companion.test.mjs` が実際にカバーしている挙動: `setup` の導入判定、`review` の
  「差分なし→スキップ」「差分あり→ジョブ記録」「read-only（`--dangerously-skip-permissions`
  を含まない）」「`--base` で差分が空なら nothing-to-review」、`task` の
  「既定で書き込み可能」「`--read-only` で書き込みフラグなし」「`--resume` で `-c` 付与」
  「`--model`/`--effort`/`--mode` がプロンプト本文に混入せず個別転送されること」、`status` の
  新しい順一覧表示、`result` の最新完了ジョブ出力、`cancel` の「実行中ジョブなし」報告、
  `task-resume-candidate` の完了後 available 判定、TTY ゲート版 agy に対する PTY
  フォールバック（`script` が使える環境のみ）、未知サブコマンド時の Usage 表示。
- Windows 版フォールバック（`agy-bridge`）およびフォアグラウンド/バックグラウンド実行の
  Claude 側制御（`--wait`/`--background` の分岐）は、コマンド `.md` 側の振る舞いであり
  companion.test.mjs のテスト対象には含まれていない（**要確認**: Windows パスと
  スラッシュコマンドの実行モード分岐は自動テストのカバレッジ外）。
