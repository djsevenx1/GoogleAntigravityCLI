#!/usr/bin/env bash
# 一键启动 Google Antigravity Web UI（连接本机安装的 antigravity CLI）
set -euo pipefail
cd "$(dirname "$0")"

# 设独立 HOME：让 agy 读取本目录 home/ 下的登录态与对话历史，脱离 vol5 原 HOME
export HOME="$(pwd)/home"

# 强制英文/非亚洲环境，避免 agy 识别成中文区域触发地区报错
export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"
export LANGUAGE="en:en"
export TZ="America/New_York"

# 1) 检查 CLI
AGY_BIN="${AGY_BIN:-}"
if [ -z "$AGY_BIN" ]; then
  for cand in "$(pwd)/bin/antigravity" "$(pwd)/bin/agy" "$(command -v antigravity || true)" /usr/local/bin/antigravity "$HOME/.local/bin/antigravity"; do
    if [ -n "$cand" ] && [ -x "$cand" ]; then AGY_BIN="$cand"; break; fi
  done
fi
if [ -z "$AGY_BIN" ]; then
  echo "未找到 Antigravity CLI，请先安装："
  echo "  curl -fsSL https://antigravity.google/cli/install.sh | bash"
  exit 1
fi
echo "[CLI] $AGY_BIN  ($("$AGY_BIN" --version 2>/dev/null || echo '?'))"

# 2) 检查现代版 WebUI 核心依赖
if [ ! -d "$(pwd)/webui/node_modules" ] || [ ! -d "$(pwd)/webui/dist-server" ]; then
  echo "[webui] 正在检查或初始化现代版 WebUI 依赖…"
  (cd "$(pwd)/webui" && npm install)
fi

# 3) 代理开关：读根目录 proxy-toggle.txt，yes=起 SOCKS5 代理，no=直连不起
#    代理 env export 到 server 进程：agy spawn 继承 process.env，不依赖 cli.js 代码，
#    agy 自动更新后无需重启 server 代理仍生效（解决每天更新导致地区报错）
PROXY_TOGGLE="$(cat "$(pwd)/proxy-toggle.txt" 2>/dev/null | tr -d '[:space:]' | tr 'A-Z' 'a-z')"
if [ "$PROXY_TOGGLE" = "yes" ] || [ "$PROXY_TOGGLE" = "on" ] || [ "$PROXY_TOGGLE" = "true" ]; then
  echo "[socks] proxy-toggle=yes，启动 URnetwork SOCKS5 代理（美国出口）"
  bash "$(pwd)/start-urn-socks.sh" || echo "[socks] URnetwork SOCKS5 启动失败，agy 将直连"
  export ALL_PROXY="socks5://127.0.0.1:19999"
  export HTTPS_PROXY="socks5://127.0.0.1:19999"
  export HTTP_PROXY="socks5://127.0.0.1:19999"
else
  echo "[socks] proxy-toggle=no，直连模式（不起 SOCKS5）"
  unset ALL_PROXY HTTPS_PROXY HTTP_PROXY
fi

# 4) 启动现代化 WebUI 主服务 (端口 3100)
echo "[run] 正在启动现代化 Antigravity WebUI (端口 3100)…"
exec /bin/bash "$(cd "$(dirname "$0")" && pwd)/webui/run-3100-server.sh"