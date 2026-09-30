#!/usr/bin/env bash
# URnetwork SOCKS5 代理常驻守护进程（防掉线、自愈保活、单通道支持）
set -u
cd /vol1/@apphome/GoogleAntigravityCLI

PORT=19999
SOCKS_BIN="/vol1/@apphome/GoogleAntigravityCLI/urnetwork/urnetwork-socks"
AUTH_FILE="/vol1/@apphome/GoogleAntigravityCLI/data/urn-auth.env"
LOG_FILE="/vol1/@apphome/GoogleAntigravityCLI/urnetwork/socks.log"

export LD_LIBRARY_PATH="/vol1/@apphome/GoogleAntigravityCLI/urnetwork"

while true; do
  # 检查开关
  TOGGLE="yes"
  if [ -f "/vol1/@apphome/GoogleAntigravityCLI/proxy-toggle.txt" ]; then
    TOGGLE=$(cat "/vol1/@apphome/GoogleAntigravityCLI/proxy-toggle.txt" 2>/dev/null | tr -d ' \r\n')
  fi

  if [ "$TOGGLE" = "no" ] || [ "$TOGGLE" = "off" ] || [ "$TOGGLE" = "false" ]; then
    if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
      pkill -15 -f "urnetwork-socks" 2>/dev/null || true
      sleep 0.3
      pkill -9 -f "urnetwork-socks" 2>/dev/null || true
    fi
    sleep 2
    continue
  fi

  if ! ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
    [ -f "$AUTH_FILE" ] && source "$AUTH_FILE" 2>/dev/null || true
    USER_AUTH="${URN_USER_AUTH:-xiaopangxia@vip.qq.com}"
    PASSWORD="${URN_PASSWORD:-Xiaoliguang520.}"
    COUNTRY="${URN_COUNTRY:-United States}"
    PROVIDER_ID="${URN_PROVIDER_ID:-}"

    echo "[daemon] $(date '+%F %T'): 拉起 urnetwork-socks (provider=${PROVIDER_ID:-auto}, country=${COUNTRY})..." >> "$LOG_FILE"
    
    "$SOCKS_BIN" \
      --addr="127.0.0.1:${PORT}" \
      --user-auth="${USER_AUTH}" \
      --password="${PASSWORD}" \
      --country="${COUNTRY}" \
      ${PROVIDER_ID:+--provider-id="$PROVIDER_ID"} >> "$LOG_FILE" 2>&1 || true

    echo "[daemon] $(date '+%F %T'): 进程退出，3秒后自愈重试..." >> "$LOG_FILE"
    sleep 3
  else
    sleep 2
  fi
done
