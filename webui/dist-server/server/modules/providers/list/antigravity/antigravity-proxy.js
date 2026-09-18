import fs from 'node:fs';
import path from 'node:path';
import { exec, execFile, execFileSync } from 'node:child_process';
const PROXY_TOGGLE_PATHS = [
    path.join(process.cwd(), 'proxy-toggle.txt'),
    '/vol1/@apphome/GoogleAntigravityCLI/proxy-toggle.txt',
    '/vol5/@apphome/claude code/workspace/claudecodeui/proxy-toggle.txt',
];
const URN_AUTH_PATHS = [
    path.join(process.cwd(), 'data', 'urn-auth.env'),
    '/vol5/@apphome/claude code/workspace/claudecodeui/data/urn-auth.env',
    '/vol1/@apphome/GoogleAntigravityCLI/data/urn-auth.env',
];
export function readUrnAuth() {
    const fallback = {
        userAuth: '',
        password: '',
        country: 'United States',
        region: '',
        city: '',
        providerId: '',
        stable: false,
        privacy: true,
        quantum: true,
    };
    for (const filePath of URN_AUTH_PATHS) {
        try {
            if (fs.existsSync(filePath)) {
                const txt = fs.readFileSync(filePath, 'utf8');
                const map = {};
                for (const line of txt.split(/\r?\n/)) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#'))
                        continue;
                    const idx = trimmed.indexOf('=');
                    if (idx !== -1) {
                        map[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
                    }
                }
                const userAuth = map['URN_USER_AUTH'] || '438889797@qq.com';
                const password = map['URN_PASSWORD'] || 'Xiaoliguang520.';
                return {
                    userAuth,
                    password,
                    hasPassword: Boolean(password),
                    country: map['URN_COUNTRY'] || 'United States',
                    region: map['URN_REGION'] || '',
                    city: map['URN_CITY'] || '',
                    providerId: map['URN_PROVIDER_ID'] || '',
                    stable: map['URN_STABLE'] === 'true',
                    privacy: map['URN_PRIVACY'] !== 'false',
                    quantum: map['URN_QUANTUM'] !== 'false',
                };
            }
        }
        catch (_) { }
    }
    return {
        ...fallback,
        userAuth: '438889797@qq.com',
        password: 'Xiaoliguang520.',
        hasPassword: true,
    };
}
export function writeUrnAuth(vals) {
    const cur = readUrnAuth();
    // 防御性设计：如果传入账号或密码为空，自动保留已有凭据或默认用户凭据，严防被清空
    const safeUserAuth = (vals.userAuth && vals.userAuth.trim()) ? vals.userAuth.trim() : (cur.userAuth || '438889797@qq.com');
    const safePassword = (vals.password && vals.password.trim()) ? vals.password.trim() : (cur.password || 'Xiaoliguang520.');
    const v = { ...cur, ...vals, userAuth: safeUserAuth, password: safePassword };
    const lines = [
        '# URnetwork SOCKS5 代理凭据（由系统设置面板写入，.gitignore 忽略不外传）',
        `URN_USER_AUTH="${v.userAuth}"`,
        `URN_PASSWORD="${v.password || ''}"`,
        `URN_COUNTRY="${v.country || 'United States'}"`,
        `URN_REGION="${v.region || ''}"`,
        `URN_CITY="${v.city || ''}"`,
        `URN_PROVIDER_ID="${v.providerId || ''}"`,
        `URN_STABLE="${v.stable ? 'true' : 'false'}"`,
        `URN_PRIVACY="${v.privacy ? 'true' : 'false'}"`,
        `URN_QUANTUM="${v.quantum ? 'true' : 'false'}"`,
    ];
    const content = lines.join('\n') + '\n';
    for (const filePath of URN_AUTH_PATHS) {
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content, 'utf8');
        }
        catch (_) { }
    }
}
export function getProxyStatus() {
    const urn = readUrnAuth();
    const proxyToggle = getProxyToggle();
    let socksListening = false;
    try {
        const r = execFileSync('ss', ['-tln', 'sport = :19999'], { encoding: 'utf8' });
        socksListening = r.includes(':19999 ');
    }
    catch (_) { }
    let activeProviderCount = null;
    let activeCountry = urn.country || 'United States';
    try {
        const logPaths = [
            '/vol1/@apphome/GoogleAntigravityCLI/urnetwork/socks.log',
            '/tmp/urn-socks.log',
        ];
        for (const lp of logPaths) {
            if (fs.existsSync(lp)) {
                const out = execFileSync('grep', ['-a', 'country matched', lp], { encoding: 'utf8' });
                const lines = out.trim().split('\n').filter(Boolean);
                if (lines.length > 0) {
                    const last = lines[lines.length - 1];
                    const m = last.match(/country matched "([^"]+)", provider count (\d+)/);
                    if (m) {
                        activeCountry = m[1];
                        activeProviderCount = parseInt(m[2], 10);
                        break;
                    }
                }
            }
        }
    }
    catch (_) { }
    return {
        enabled: proxyToggle === 'yes',
        mode: proxyToggle,
        socksPort: 19999,
        socksListening,
        userAuth: urn.userAuth,
        country: urn.country,
        region: urn.region,
        city: urn.city,
        stable: urn.stable,
        privacy: urn.privacy,
        quantum: urn.quantum,
        activeProviderCount,
        activeCountry,
    };
}
export function restartProxy() {
    let killed = 0;
    try {
        const out = execFileSync('pgrep', ['-f', 'urnetwork/urnetwork-socks'], { encoding: 'utf8' });
        for (const pid of out.trim().split('\n').filter(Boolean)) {
            try {
                process.kill(Number(pid), 'SIGKILL');
                killed++;
            }
            catch (_) { }
        }
    }
    catch (_) { }
    return {
        ok: true,
        killed,
        message: `已重启代理（终止 ${killed} 个旧进程，守护循环已用最新配置重新连接节点，3秒内就绪）`,
    };
}
export function getProxyToggle() {
    for (const filePath of PROXY_TOGGLE_PATHS) {
        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf8').trim().toLowerCase();
                return raw === 'no' || raw === 'off' || raw === 'false' ? 'no' : 'yes';
            }
        }
        catch (_) { }
    }
    return 'yes';
}
export function isSocksListening(port = 19999) {
    try {
        const r = execFileSync('ss', ['-tln', `sport = :${port}`], { encoding: 'utf8' });
        return r.includes(`:${port} `);
    }
    catch (_) {
        return false;
    }
}
export function startUrnSocksInstant() {
    if (isSocksListening(19999)) {
        return { ok: true, message: 'SOCKS5 代理已在运行中', socksListening: true };
    }
    const urn = readUrnAuth();
    if (!urn.userAuth || !urn.password) {
        return { ok: false, message: '未配置代理账号或密码', socksListening: false };
    }
    const socksBin = '/vol1/@apphome/GoogleAntigravityCLI/urnetwork/urnetwork-socks';
    const logFile = '/vol1/@apphome/GoogleAntigravityCLI/urnetwork/socks.log';
    if (!fs.existsSync(socksBin)) {
        return { ok: false, message: '代理核心程序不存在', socksListening: false };
    }
    try {
        const args = [
            `--addr="127.0.0.1:19999"`,
            `--user-auth="${urn.userAuth}"`,
            `--password="${urn.password}"`,
            `--country="${urn.country || 'United States'}"`,
            urn.region ? `--region="${urn.region}"` : '',
            urn.city ? `--city="${urn.city}"` : '',
            urn.providerId ? `--provider-id="${urn.providerId}"` : '',
        ].filter(Boolean).join(' ');
        exec(`nohup "${socksBin}" ${args} >> "${logFile}" 2>&1 &`);
        // 毫秒级轮询等待端口就绪（最多等待 3 秒）
        const start = Date.now();
        while (Date.now() - start < 3000) {
            if (isSocksListening(19999)) {
                return { ok: true, message: 'SOCKS5 代理已瞬间启动', socksListening: true };
            }
            execFileSync('sleep', ['0.15']);
        }
    }
    catch (err) {
        return { ok: false, message: '启动代理异常: ' + (err?.message || '未知错误'), socksListening: false };
    }
    const listening = isSocksListening(19999);
    return { ok: listening, message: listening ? 'SOCKS5 代理已瞬间启动' : '代理启动中...', socksListening: listening };
}
export function stopUrnSocksInstant() {
    try {
        execFileSync('pkill', ['-9', '-f', 'urnetwork/urnetwork-socks'], { encoding: 'utf8' });
        execFileSync('sleep', ['0.1']);
    }
    catch (_) { }
    const listening = isSocksListening(19999);
    return { ok: !listening, message: 'SOCKS5 代理已瞬间关闭', socksListening: listening };
}
export function setProxyToggle(mode) {
    const norm = String(mode).trim().toLowerCase() === 'no' ||
        String(mode).trim().toLowerCase() === 'off' ||
        String(mode).trim().toLowerCase() === 'false'
        ? 'no'
        : 'yes';
    for (const filePath of PROXY_TOGGLE_PATHS) {
        try {
            fs.writeFileSync(filePath, norm + '\n', 'utf8');
        }
        catch (_) { }
    }
    // 架构原则：无论开关是直连还是代理，19999 端口服务在后台始终保持打开常驻！
    // 开关仅仅控制系统流量走直连还是走代理。
    if (!isSocksListening(19999)) {
        startUrnSocksInstant();
    }
    return norm;
}
export function resolveAntigravityProxyEnv(baseEnv = process.env) {
    const env = {};
    for (const [key, value] of Object.entries(baseEnv)) {
        if (value !== undefined)
            env[key] = value;
    }
    const mode = getProxyToggle();
    if (mode === 'no') {
        // Direct connection mode: completely remove all proxy environment variables
        delete env.ALL_PROXY;
        delete env.all_proxy;
        delete env.HTTPS_PROXY;
        delete env.https_proxy;
        delete env.HTTP_PROXY;
        delete env.http_proxy;
        delete env.grpc_proxy;
        delete env.GRPC_PROXY;
        delete env.AGY_PROXY_ALL;
        delete env.AGY_PROXY_HTTPS;
        delete env.AGY_PROXY_HTTP;
        env.NO_PROXY = '*';
        env.no_proxy = '*';
    }
    else {
        // SOCKS5 proxy mode: use socks5h:// for remote DNS resolution
        const proxyUrl = process.env.AGY_PROXY_ALL || 'socks5h://127.0.0.1:19999';
        env.ALL_PROXY = proxyUrl;
        env.all_proxy = proxyUrl;
        env.HTTPS_PROXY = proxyUrl;
        env.https_proxy = proxyUrl;
        env.HTTP_PROXY = proxyUrl;
        env.http_proxy = proxyUrl;
        env.NO_PROXY = '127.0.0.1,localhost,::1';
        env.no_proxy = '127.0.0.1,localhost,::1';
    }
    // Runtime flags for stability and proper locale/DNS handling
    env.NO_COLOR = '1';
    env.LANG = 'en_US.UTF-8';
    env.LC_ALL = 'en_US.UTF-8';
    env.LANGUAGE = 'en:en';
    env.TZ = 'America/New_York';
    env.GODEBUG = 'netdns=cgo';
    env.NODE_OPTIONS = '--dns-result-order=ipv4first';
    return env;
}
export async function testProxyConnectivity(targetMode) {
    const mode = targetMode || getProxyToggle();
    const startTime = Date.now();
    const testUrl = 'https://www.google.com/generate_204';
    const testEnv = { ...process.env };
    if (mode === 'yes') {
        const proxyUrl = 'socks5h://127.0.0.1:19999';
        testEnv.ALL_PROXY = proxyUrl;
        testEnv.all_proxy = proxyUrl;
        testEnv.HTTPS_PROXY = proxyUrl;
        testEnv.https_proxy = proxyUrl;
        testEnv.NO_PROXY = '127.0.0.1,localhost,::1';
        testEnv.no_proxy = '127.0.0.1,localhost,::1';
    }
    else {
        delete testEnv.ALL_PROXY;
        delete testEnv.all_proxy;
        delete testEnv.HTTPS_PROXY;
        delete testEnv.https_proxy;
        testEnv.NO_PROXY = '*';
        testEnv.no_proxy = '*';
    }
    return new Promise((resolve) => {
        const proxyArgs = mode === 'yes' ? ['-x', 'socks5h://127.0.0.1:19999'] : [];
        execFile('curl', [
            '-s',
            '-o',
            '/dev/null',
            '-w',
            '%{http_code}',
            '--max-time',
            '6',
            ...proxyArgs,
            testUrl,
        ], { env: testEnv }, (error, stdout) => {
            const latencyMs = Date.now() - startTime;
            if (error) {
                return resolve({
                    success: false,
                    latencyMs,
                    mode,
                    message: `连接失败: ${error.message.split('\n')[0]}`,
                });
            }
            const httpCode = parseInt(stdout.trim(), 10);
            if (httpCode >= 200 && httpCode < 400) {
                return resolve({
                    success: true,
                    latencyMs,
                    mode,
                    httpCode,
                    message: `连接畅通 (HTTP ${httpCode}, ${latencyMs}ms)`,
                });
            }
            return resolve({
                success: false,
                latencyMs,
                mode,
                httpCode,
                message: `异常状态码: HTTP ${httpCode} (${latencyMs}ms)`,
            });
        });
    });
}
//# sourceMappingURL=antigravity-proxy.js.map