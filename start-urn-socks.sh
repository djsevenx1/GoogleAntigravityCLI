#!/usr/bin/env bash
# 启动 URnetwork SOCKS5 代理（美国出口，供 agy 走代理访问 Google，绕开地区/网络掐断）
# 监听 127.0.0.1:19999；账号密码从 data/urn-auth.env 读取（该文件在 .gitignore，不外传）
set -euo pipefail
cd "$(dirname "$0")"

PORT=19999
SOCKS_BIN="$(pwd)/urnetwork/urnetwork-socks"
AUTH_FILE="$(pwd)/data/urn-auth.env"

# 已在跑就不重启
if timeout 1 bash -c 'echo > /dev/tcp/127.0.0.1/'"$PORT" 2>/dev/null; then
  echo "[urn-socks] 已在 ${PORT} 监听，跳过"
  exit 0
fi

if [ ! -x "$SOCKS_BIN" ]; then
  echo "[urn-socks] 二进制缺失: $SOCKS_BIN"
  exit 1
fi

if [ ! -f "$AUTH_FILE" ]; then
  echo "[urn-socks] 缺少 $AUTH_FILE（需 URN_USER_AUTH / URN_PASSWORD）"
  exit 1
fi

# 自动自愈兜底：若凭据被意外写空，强制填回用户正确账号与密码
if grep -q 'URN_USER_AUTH=""' "$AUTH_FILE" 2>/dev/null; then
  sed -i 's/URN_USER_AUTH=".*"/URN_USER_AUTH="438889797@qq.com"/' "$AUTH_FILE"
  sed -i 's/URN_PASSWORD=".*"/URN_PASSWORD="Xiaoliguang520."/' "$AUTH_FILE"
fi

# shellcheck disable=SC1090
source "$AUTH_FILE"

nohup "$SOCKS_BIN" \
  --addr="127.0.0.1:${PORT}" \
  --user-auth="${URN_USER_AUTH}" \
  --password="${URN_PASSWORD}" \
  --country="${URN_COUNTRY:-United States}" \
  ${URN_REGION:+--region="$URN_REGION"} \
  ${URN_CITY:+--city="$URN_CITY"} \
  ${URN_PROVIDER_ID:+--provider-id="$URN_PROVIDER_ID"} \
  > /tmp/urn-socks.log 2>&1 &

echo "[urn-socks] 启动 pid=$! 端口=${PORT}（出口: ${URN_COUNTRY:-United States}）"
# 等待监听就绪
for i in $(seq 1 15); do
  if timeout 1 bash -c 'echo > /dev/tcp/127.0.0.1/'"$PORT" 2>/dev/null; then
    echo "[urn-socks] 就绪 ✓"
    exit 0
  fi
  sleep 1
done
echo "[urn-socks] 启动后端口未就绪，看 /tmp/urn-socks.log"
exit 1
