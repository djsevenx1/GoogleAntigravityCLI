#!/bin/bash
# URnetwork SOCKS5 守护脚本 — 自动重启

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export LD_LIBRARY_PATH="$SCRIPT_DIR"

SOCKS_BIN="$SCRIPT_DIR/urnetwork-socks"
LOG="$SCRIPT_DIR/socks.log"
PID_FILE="$SCRIPT_DIR/socks.pid"
PORT=19999

AUTH_FILE="${BASE_DIR}/data/urn-auth.env"
if [ -f "$AUTH_FILE" ]; then
  # shellcheck disable=SC1090
  source "$AUTH_FILE"
fi

USER_AUTH="${URN_USER_AUTH:-}"
PASSWORD="${URN_PASSWORD:-}"
COUNTRY="${URN_COUNTRY:-United States}"

if [ -z "$USER_AUTH" ] || [ -z "$PASSWORD" ]; then
  echo "[socks-daemon] 未配置 URN_USER_AUTH 或 URN_PASSWORD，等待配置..." >> "$LOG"
fi

echo "[socks-daemon] 启动守护进程 $(date)" >> "$LOG"

while true; do
    # 检查端口是否已在监听
    if ss -tlnp 2>/dev/null | grep -q ":$PORT"; then
        sleep 10
        continue
    fi

    echo "[socks-daemon] 启动 urnetwork-socks $(date)" >> "$LOG"
    "$SOCKS_BIN" \
        --user-auth="$USER_AUTH" \
        --password="$PASSWORD" \
        --addr="127.0.0.1:$PORT" \
        --country="$COUNTRY" >> "$LOG" 2>&1 &
    
    CHILD_PID=$!
    echo $CHILD_PID > "$PID_FILE"
    
    # 等待子进程退出
    wait $CHILD_PID
    echo "[socks-daemon] urnetwork-socks 退出，5秒后重启... $(date)" >> "$LOG"
    sleep 5
done
