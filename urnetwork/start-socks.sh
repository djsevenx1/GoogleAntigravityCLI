#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export LD_LIBRARY_PATH="$SCRIPT_DIR"

AUTH_FILE="${BASE_DIR}/data/urn-auth.env"
if [ -f "$AUTH_FILE" ]; then
  # shellcheck disable=SC1090
  source "$AUTH_FILE"
fi

USER_AUTH="${URN_USER_AUTH:-}"
PASSWORD="${URN_PASSWORD:-}"
ADDR="${SOCKS_ADDR:-127.0.0.1:19999}"
COUNTRY="${URN_COUNTRY:-United States}"

if [ -z "$USER_AUTH" ] || [ -z "$PASSWORD" ]; then
  echo "[ERROR] 请在 data/urn-auth.env 或系统环境变量中配置 URN_USER_AUTH 和 URN_PASSWORD"
  exit 1
fi

exec "$SCRIPT_DIR/urnetwork-socks" \
  --user-auth="$USER_AUTH" \
  --password="$PASSWORD" \
  --addr="$ADDR" \
  --country="$COUNTRY"
