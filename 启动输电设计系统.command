#!/bin/bash
cd "$(dirname "$0")" || exit 1
NODE_BIN="$(command -v node 2>/dev/null)"
if [ -z "$NODE_BIN" ]; then
  for candidate in "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then NODE_BIN="$candidate"; break; fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  echo '未找到 Node.js，请安装 Node.js 22 或更高版本。'
  exit 1
fi
"$NODE_BIN" scripts/start-local.mjs "$@"
result=$?
if [ "$result" -ne 0 ] && [ -t 0 ]; then
  read -r -p '请记录以上错误，按回车关闭。'
fi
exit "$result"
