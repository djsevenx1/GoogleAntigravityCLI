#!/usr/bin/env bash
# Google Antigravity Web UI — 自动保活脚本(单例锁,防多实例)
cd "$(dirname "$0")"
export PATH="/vol5/@apphome/trim.openclaw/data/home/.nvm/versions/node/v24.19.0/bin:/vol5/@apphome/claude code/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export HOME="$(pwd)/home"

PORT="${PORT:-3100}"
PIDFILE="/tmp/antigravity-webui-keepalive-v2.pid"
if [ -f "$PIDFILE" ]; then
  OLD_PID=$(cat "$PIDFILE" 2>/dev/null)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    if [ "$OLD_PID" != "$$" ] && grep -q "keepalive.sh" /proc/"$OLD_PID"/cmdline 2>/dev/null; then
      echo "[keepalive] 已有实例在跑 (PID: $OLD_PID), 退出"
      exit 0
    fi
  fi
fi
echo "$$" > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT INT TERM

COUNT=0

# 启动 URnetwork SOCKS5 守护进程（仅代理 Gemini 认证流量）
URNETWORK_SOCKS="$(pwd)/urnetwork/urnetwork-socks"
URNETWORK_SOCKS_PORT=19999
URNETWORK_SOCKS_LOG="$(pwd)/urnetwork/socks.log"

URN_AUTH_FILE="$(pwd)/data/urn-auth.env"

if [ -x "$URNETWORK_SOCKS" ]; then
  # 方案一：保证 19999 代理始终打开、重启自动拉起、开机长驻不中断
  # 仅当切换文件不存在时初始化为 yes，不强行覆盖用户选择
  [ ! -f "$(pwd)/proxy-toggle.txt" ] && echo "yes" > "$(pwd)/proxy-toggle.txt" 2>/dev/null || true
  echo "[socks] 方案一已启用：19999 代理开启长驻守护，开机与掉线自动自愈拉起…"

  (
    export LD_LIBRARY_PATH="$(pwd)/urnetwork"
    while true; do
      if ! ss -tlnp 2>/dev/null | grep -q ":${URNETWORK_SOCKS_PORT} "; then
        # 自动自愈兜底：若凭据被写空或缺失，强制填回用户正确账号与密码
        [ -f "$URN_AUTH_FILE" ] && source "$URN_AUTH_FILE" 2>/dev/null || true
        if [ -z "${URN_USER_AUTH:-}" ] || [ -z "${URN_PASSWORD:-}" ]; then
          export URN_USER_AUTH="438889797@qq.com"
          export URN_PASSWORD="Xiaoliguang520."
          cat << 'EOF' > "$URN_AUTH_FILE"
# URnetwork SOCKS5 代理凭据（由系统设置面板写入，.gitignore 忽略不外传）
URN_USER_AUTH="438889797@qq.com"
URN_PASSWORD="Xiaoliguang520."
URN_COUNTRY="United States"
URN_REGION=""
URN_CITY=""
URN_PROVIDER_ID=""
URN_STABLE="true"
URN_PRIVACY="true"
URN_QUANTUM="true"
EOF
        fi
        echo "[socks] $(date '+%F %T'): 端口未监听，自动拉起 urnetwork-socks (country=${URN_COUNTRY:-United States})" >> "$URNETWORK_SOCKS_LOG"
        "$URNETWORK_SOCKS" \
          --user-auth="${URN_USER_AUTH}" \
          --password="${URN_PASSWORD}" \
          --addr="127.0.0.1:${URNETWORK_SOCKS_PORT}" \
          --country="${URN_COUNTRY:-United States}" \
          ${URN_REGION:+--region="$URN_REGION"} \
          ${URN_CITY:+--city="$URN_CITY"} \
          ${URN_PROVIDER_ID:+--provider-id="$URN_PROVIDER_ID"} >> "$URNETWORK_SOCKS_LOG" 2>&1 || true
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
