import { createRequire } from 'node:module';
import http from 'node:http';
import net from 'node:net';

const require = createRequire(import.meta.url);

// ─────────────────────────────────────────────────────────────
// proxy.js — Gemini 选择性代理适配层
//
// 策略：
//   - 全局流量：直连（依赖 NAS 透明代理/TUN，不干预）
//   - Gemini / Google 认证域名：通过本地 HTTP→SOCKS5 桥接代理
//     URnetwork SOCKS5 监听在 127.0.0.1:19999（美国节点）
//
// 实现：启动一个本地 HTTP CONNECT 代理（端口 18081），
//       只对 Gemini 相关域名的请求转发到 SOCKS5，其余直连。
// ─────────────────────────────────────────────────────────────

const SOCKS_PORT = 19999;       // URnetwork SOCKS5 端口
const BRIDGE_PORT = 18081;      // 本地 HTTP→SOCKS5 桥接端口

// 只代理「模型调用」端点（地区检查发生在调 gemini 模型时）；
// 登录/认证/头像/userinfo 等一律直连，用户真实 IP 不暴露给 URnetwork 第三方
const GEMINI_DOMAINS = new Set([
  'cloudcode-pa.googleapis.com',         // Antigravity Code Assist 模型调用
  'daily-cloudcode-pa.googleapis.com',   // Code Assist daily 变体（cli.log 实测）
  'autopush-cloudcode-pa.sandbox.googleapis.com',
  'generativelanguage.googleapis.com',   // Gemini API 模型调用
  'aicode.googleapis.com',
  'agentaicode.googleapis.com',
  'businessaicode.googleapis.com',
  'aiplatform.googleapis.com',
  // token 刷新端点：实测直连被 SSL_ERROR_SYSCALL 掐断，必须走代理否则 agy 起不来
  // 注意：走代理意味着 refresh_token 经 URnetwork 第三方，请知悉
  'oauth2.googleapis.com',
  'oauth2.mtls.googleapis.com',
  'accounts.google.com',        // OAuth 登录/授权
  'lh3.googleusercontent.com',  // profile picture CDN
  'googleusercontent.com',
]);

function isGeminiHost(host) {
  if (!host) return false;
  const h = host.split(':')[0].toLowerCase();
  if (GEMINI_DOMAINS.has(h)) return true;
  for (const d of GEMINI_DOMAINS) {
    if (h.endsWith('.' + d)) return true;
  }
  return false;
}

let _bridgeUrl = null;
let _socksAlive = false;
let _bridgeServer = null;

let _bytesSent = 0;
let _bytesReceived = 0;
let _activeConnections = 0;
let _totalRequests = 0;

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getProxyTrafficStats() {
  return {
    bytesSent: _bytesSent,
    bytesReceived: _bytesReceived,
    totalBytes: _bytesSent + _bytesReceived,
    formattedSent: formatBytes(_bytesSent),
    formattedReceived: formatBytes(_bytesReceived),
    formattedTotal: formatBytes(_bytesSent + _bytesReceived),
    activeConnections: _activeConnections,
    totalRequests: _totalRequests
  };
}

/**
 * 检查 SOCKS5 端口是否可用
 */
async function checkSocksAlive() {
  return new Promise((resolve) => {
    const s = net.connect(SOCKS_PORT, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    setTimeout(() => { try { s.destroy(); } catch (_) {} resolve(false); }, 1500);
  });
}

/**
 * SOCKS5 握手：连接到 socks5://127.0.0.1:19999，
 * 然后请求连接目标 host:port。
 */
function socks5Connect(targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCKS_PORT, '127.0.0.1');
    sock.once('error', reject);

    // 握手：无认证
    sock.once('connect', () => {
      sock.write(Buffer.from([0x05, 0x01, 0x00])); // VER=5, NMETHODS=1, METHOD=NO_AUTH
    });

    let state = 'auth';
    sock.on('data', (data) => {
      if (state === 'auth') {
        if (data[0] !== 0x05 || data[1] !== 0x00) {
          return reject(new Error('SOCKS5 auth failed'));
        }
        state = 'connect';
        // 发送 CONNECT 请求
        const host = Buffer.from(targetHost, 'utf8');
        const req = Buffer.alloc(7 + host.length);
        req[0] = 0x05;                        // VER
        req[1] = 0x01;                        // CMD: CONNECT
        req[2] = 0x00;                        // RSV
        req[3] = 0x03;                        // ATYP: DOMAINNAME
        req[4] = host.length;                 // domain length
        host.copy(req, 5);
        req.writeUInt16BE(targetPort, 5 + host.length);
        sock.write(req);
      } else if (state === 'connect') {
        if (data[0] !== 0x05 || data[1] !== 0x00) {
          return reject(new Error(`SOCKS5 connect failed: ${data[1]}`));
        }
        state = 'done';
        sock.removeAllListeners('data');
        resolve(sock);
      }
    });
  });
}

/**
 * 启动本地 HTTP CONNECT 桥：
 * - 收到 CONNECT host:port 请求时：
 *   - 若 host 属于 Gemini 域名 → 通过 SOCKS5 连接
 *   - 否则 → 直连 host:port
 */
function startBridgeServer() {
  return new Promise((resolve, reject) => {
    if (_bridgeServer) return resolve();

    const server = http.createServer((req, res) => {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Use CONNECT method');
    });

    server.on('connect', async (req, clientSock, head) => {
      const [host, portStr] = req.url.split(':');
      const port = parseInt(portStr || '443', 10);

      let targetSock;
      const useProxy = _socksAlive && isGeminiHost(host);

      try {
        if (useProxy) {
          targetSock = await socks5Connect(host, port);
        } else {
          targetSock = net.connect(port, host);
          await new Promise((res, rej) => {
            targetSock.once('connect', res);
            targetSock.once('error', rej);
          });
        }
      } catch (err) {
        clientSock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        return;
      }

      clientSock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      _totalRequests++;
      _activeConnections++;
      if (head && head.length > 0) {
        _bytesSent += head.length;
        targetSock.write(head);
      }

      clientSock.on('data', (chunk) => {
        _bytesSent += chunk.length;
      });
      targetSock.on('data', (chunk) => {
        _bytesReceived += chunk.length;
      });

      targetSock.pipe(clientSock);
      clientSock.pipe(targetSock);

      let cleaned = false;
      const cleanup = () => {
        if (!cleaned) {
          cleaned = true;
          _activeConnections = Math.max(0, _activeConnections - 1);
        }
        try { targetSock.destroy(); } catch (_) {}
        try { clientSock.destroy(); } catch (_) {}
      };
      targetSock.on('error', cleanup);
      clientSock.on('error', cleanup);
      targetSock.on('close', cleanup);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // 端口已被占用，认为桥已在运行
        _bridgeUrl = `http://127.0.0.1:${BRIDGE_PORT}`;
        resolve();
      } else {
        reject(err);
      }
    });

    server.listen(BRIDGE_PORT, '127.0.0.1', () => {
      _bridgeServer = server;
      _bridgeUrl = `http://127.0.0.1:${BRIDGE_PORT}`;
      console.log(`[proxy] ✅ Gemini 选择性代理桥已启动: ${_bridgeUrl}`);
      resolve();
    });
  });
}

/**
 * 判断给定 URL 是否需要走 Gemini 代理
 */
export function needsGeminiProxy(url) {
  if (!url) return false;
  try {
    return isGeminiHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * 初始化代理（模块加载时自动调用）。
 * 全局流量不受影响，只有 Gemini 相关域名走 SOCKS5。
 */
export async function startLocalProxy() {
  const systemProxy = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy || null;

  // undici ProxyAgent 只支持 http/https 代理；socks5:// 必须经本地 HTTP 桥转接，不能直接喂给 fetch
  if (systemProxy && /^https?:\/\//i.test(systemProxy)) {
    _bridgeUrl = systemProxy;
    console.log(`[proxy] 检测到 HTTP 系统代理: ${systemProxy}（全局生效）`);
    return { getUrl: () => _bridgeUrl };
  }

  // socks5 系统代理或无代理 → 检测 SOCKS5 是否就绪并启动本地 HTTP→SOCKS5 桥
  _socksAlive = await checkSocksAlive();
  if (_socksAlive) {
    console.log(`[proxy] ✅ URnetwork SOCKS5 就绪 (127.0.0.1:${SOCKS_PORT})`);
  } else {
    console.log(`[proxy] URnetwork SOCKS5 未就绪，Gemini 请求将直连（等待启动）`);
    // 30秒后重试，等待 urnetwork-socks 启动
    setTimeout(async () => {
      _socksAlive = await checkSocksAlive();
      if (_socksAlive) {
        console.log(`[proxy] ✅ URnetwork SOCKS5 已就绪，Gemini 选择性代理已激活`);
      }
    }, 30000);
  }

  // 无论 SOCKS 是否就绪都启动桥，桥会在每次请求时动态检查
  try {
    await startBridgeServer();
  } catch (err) {
    console.warn('[proxy] 桥接服务启动失败:', err.message);
  }

  return { getUrl: () => _bridgeUrl };
}

/**
 * 获取代理地址
 */
export function getProxyUrl() {
  return _bridgeUrl;
}

/**
 * 获取专供 Gemini 请求使用的代理地址
 */
export function getGeminiProxyUrl() {
  return _bridgeUrl;
}

// 模块加载即自动初始化
startLocalProxy();
