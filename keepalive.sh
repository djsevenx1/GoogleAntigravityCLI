#!/usr/bin/env bash
# Google Antigravity Web UI — 自动保活脚本(单例锁,防多实例)
cd "$(dirname "$0")"
export HOME="$(pwd)/home"

PORT="${PORT:-3100}"
LOCKFILE="/tmp/antigravity-webui-keepalive-v2.lock"
# 单例锁:如果已有 keepalive 在跑,直接退出
exec 200>"$LOCKFILE"
flock -n 200 || { echo "[keepalive] 已有实例在跑,退出"; exit 0; }

COUNT=0

# 启动 URnetwork SOCKS5 守护进程（仅代理 Gemini 认证流量）
URNETWORK_SOCKS="$(pwd)/urnetwork/urnetwork-socks"
URNETWORK_SOCKS_PORT=19999
URNETWORK_SOCKS_LOG="$(pwd)/urnetwork/socks.log"

URN_AUTH_FILE="$(pwd)/data/urn-auth.env"

if [ -x "$URNETWORK_SOCKS" ]; then
  echo "[socks] 启动 URnetwork SOCKS5 守护 (127.0.0.1:${URNETWORK_SOCKS_PORT})…"
  (
    export LD_LIBRARY_PATH="$(pwd)/urnetwork"
    while true; do
      PROXY_TOGGLE="$(cat "$(pwd)/proxy-toggle.txt" 2>/dev/null | tr -d '[:space:]' | tr 'A-Z' 'a-z')"
      if [ "$PROXY_TOGGLE" = "no" ] || [ "$PROXY_TOGGLE" = "off" ] || [ "$PROXY_TOGGLE" = "false" ]; then
        if pgrep -f "urnetwork/urnetwork-socks" >/dev/null 2>&1; then
          pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true
          echo "[socks] $(date '+%F %T'): 检测到 proxy-toggle=no，已停止 SOCKS5 代理（直连模式）" >> "$URNETWORK_SOCKS_LOG"
        fi
        sleep 5
        continue
      fi

      if ! ss -tlnp 2>/dev/null | grep -q ":${URNETWORK_SOCKS_PORT} "; then
        # 每次启动前重新读取 urn-auth.env，使面板改的账号密码/节点即时生效
        [ -f "$URN_AUTH_FILE" ] && source "$URN_AUTH_FILE"
        echo "[socks] $(date '+%F %T'): 启动 urnetwork-socks (country=${URN_COUNTRY:-US})" >> "$URNETWORK_SOCKS_LOG"
        "$URNETWORK_SOCKS" \
          --user-auth="${URN_USER_AUTH:-}" \
          --password="${URN_PASSWORD:-}" \
          --addr="127.0.0.1:${URNETWORK_SOCKS_PORT}" \
          --country="${URN_COUNTRY:-United States}" \
          ${URN_REGION:+--region="$URN_REGION"} \
          ${URN_CITY:+--city="$URN_CITY"} \
          ${URN_PROVIDER_ID:+--provider-id="$URN_PROVIDER_ID"} >> "$URNETWORK_SOCKS_LOG" 2>&1 || true
        echo "[socks] $(date '+%F %T'): urnetwork-socks 退出，1秒后重启" >> "$URNETWORK_SOCKS_LOG"
        sleep 1
      else
        sleep 3
      fi
    done
  ) 200>&- &
  echo "[socks] 守护进程 PID=$!"
fi

echo "[keepalive] 准备启动现代化 Antigravity WebUI (端口 3100)..."
exec /bin/bash "$(cd "$(dirname "$0")" && pwd)/webui/run-3100-server.sh"
