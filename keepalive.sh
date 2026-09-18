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
  # 方案一：保证 19999 代理始终打开、重启自动拉起、开机长驻不中断
  echo "yes" > "$(pwd)/proxy-toggle.txt" 2>/dev/null || true
  echo "[socks] 方案一已启用：19999 代理开启长驻守护，开机与掉线自动自愈拉起…"

  (
    export LD_LIBRARY_PATH="$(pwd)/urnetwork"
    while true; do
      if ! ss -tlnp 2>/dev/null | grep -q ":${URNETWORK_SOCKS_PORT} "; then
        # 读取 urn-auth.env 凭据
        [ -f "$URN_AUTH_FILE" ] && source "$URN_AUTH_FILE"
        if [ -n "${URN_USER_AUTH:-}" ] && [ -n "${URN_PASSWORD:-}" ]; then
          echo "[socks] $(date '+%F %T'): 端口未监听，自动拉起 urnetwork-socks (country=${URN_COUNTRY:-US})" >> "$URNETWORK_SOCKS_LOG"
          "$URNETWORK_SOCKS" \
            --user-auth="${URN_USER_AUTH:-}" \
            --password="${URN_PASSWORD:-}" \
            --addr="127.0.0.1:${URNETWORK_SOCKS_PORT}" \
            --country="${URN_COUNTRY:-United States}" \
            ${URN_REGION:+--region="$URN_REGION"} \
            ${URN_CITY:+--city="$URN_CITY"} \
            ${URN_PROVIDER_ID:+--provider-id="$URN_PROVIDER_ID"} >> "$URNETWORK_SOCKS_LOG" 2>&1 || true
        fi
        sleep 1
      else
        sleep 2
      fi
    done
  ) 200>&- &
  echo "[socks] 方案一长驻守护进程已就绪 PID=$!"
fi

echo "[keepalive] 准备启动现代化 Antigravity WebUI (端口 3100)..."
exec /bin/bash "$(cd "$(dirname "$0")" && pwd)/webui/run-3100-server.sh"
