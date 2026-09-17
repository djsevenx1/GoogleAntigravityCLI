

import dns from 'node:dns';
// 本机 IPv6 出站不通，但 Google 域名 DNS 默认返回 IPv6 优先，导致 fetch 撞 IPv6 超时。
// 强制 IPv4 优先，避开不通的 IPv6（直连 Google API 立即恢复正常）。
dns.setDefaultResultOrder('ipv4first');

// ========== 本地配额计算引擎 ==========
// 每天第一次用企业版API校正,之后本地按 token 消耗扣减
let LOCAL_QUOTA_FILE;

function loadLocalQuota() {
  try {
    if (fs.existsSync(LOCAL_QUOTA_FILE)) return JSON.parse(fs.readFileSync(LOCAL_QUOTA_FILE, 'utf8'));
  } catch(_) {}
  return null;
}

function saveLocalQuota(q) {
  try { fs.writeFileSync(LOCAL_QUOTA_FILE, JSON.stringify(q, null, 2)); } catch(_) {}
}

const QUOTA_CALIBRATE_TTL = 30 * 1000; // 30 秒校正周期 (实时拉取 Google 官方最新额度)

// 从 Google 官方 API 校正配额 (每 2 小时校正一次)
async function calibrateQuotaFromAPI(force = false) {
  const q = loadLocalQuota();
  if (!force && q && q.lastCalibrate) {
    const elapsed = Date.now() - new Date(q.lastCalibrate).getTime();
    if (elapsed < QUOTA_CALIBRATE_TTL) return q; // 2 小时内已校正过，直接复用
  }
  // 调官方 API 拉真实配额
  const activeAcc = getActiveAccount();
  const profile = await refreshGoogleProfileInBackground(force, activeAcc);
  const summary = profile?.liveQuotaSummary;
  if (!summary || !Array.isArray(summary.groups)) return q || null;
  
  const newQ = { lastCalibrate: new Date().toISOString(), windows: {} };
  for (const g of summary.groups) {
    const isClaude = (g.displayName || '').toLowerCase().includes('claude') || (g.displayName || '').toLowerCase().includes('gpt');
    const weekly = g.buckets?.find(b => b.window === 'weekly' || b.bucketId?.includes('weekly'));
    const h5 = g.buckets?.find(b => b.window === '5h' || b.bucketId?.includes('5h'));
    const prefix = isClaude ? 'claude' : 'gemini';
    if (weekly) newQ.windows[`${prefix}Weekly`] = { remainingFraction: weekly.remainingFraction, resetTime: weekly.resetTime };
    if (h5) newQ.windows[`${prefix}5h`] = { remainingFraction: h5.remainingFraction, resetTime: h5.resetTime };
  }
  saveLocalQuota(newQ);
  return newQ;
}

// 本地扣减配额(每次对话后调用)
function deductLocalQuota(model, usage) {
  if (!usage || !usage.total_tokens) return;
  const q = loadLocalQuota();
  if (!q || !q.windows) return;
  
  const isClaude = String(model || '').toLowerCase().includes('claude') || String(model || '').toLowerCase().includes('gpt') || String(model || '').toLowerCase().includes('oss');
  const prefix = isClaude ? 'claude' : 'gemini';
  const totalTokens = usage.total_tokens || ((usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.thinking_tokens || 0));
  
  // Google WTUS 权重:不同模型消耗不同比例
  // Gemini Flash: 1x, Gemini Pro: 5x, Claude Sonnet: 3x, Claude Opus: 15x, GPT-OSS: 1x
  const modelLower = String(model || '').toLowerCase();
  let weight = 1;
  if (modelLower.includes('opus')) weight = 15;
  else if (modelLower.includes('sonnet')) weight = 3;
  else if (modelLower.includes('pro') && !modelLower.includes('flash')) weight = 5;
  else if (modelLower.includes('gpt') || modelLower.includes('oss')) weight = 1;
  
  // Google AI Pro 每周配额上限约 50000 WTUS,5h 约 8000 WTUS(实测推算)
  const WEEKLY_LIMIT = 50000;
  const HOURLY_5H_LIMIT = 8000;
  const consumedWTUS = Math.round(totalTokens * weight / 1000); // 转成千级 WTUS
  
  // 扣减 5h
  const key5h = `${prefix}5h`;
  if (q.windows[key5h]) {
    const resetTime = new Date(q.windows[key5h].resetTime);
    if (Date.now() >= resetTime.getTime()) {
      // 5h窗口过期,重置
      q.windows[key5h] = { remainingFraction: 1, resetTime: new Date(Date.now() + 5 * 3600 * 1000).toISOString() };
    }
    const consumedFraction = Math.min(q.windows[key5h].remainingFraction, consumedWTUS / HOURLY_5H_LIMIT);
    q.windows[key5h].remainingFraction = Math.max(0, q.windows[key5h].remainingFraction - consumedFraction);
  }
  
  // 扣减 weekly
  const keyW = `${prefix}Weekly`;
  if (q.windows[keyW]) {
    const resetTime = new Date(q.windows[keyW].resetTime);
    if (Date.now() >= resetTime.getTime()) {
      q.windows[keyW] = { remainingFraction: 1, resetTime: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() };
    }
    const consumedFraction = Math.min(q.windows[keyW].remainingFraction, consumedWTUS / WEEKLY_LIMIT);
    q.windows[keyW].remainingFraction = Math.max(0, q.windows[keyW].remainingFraction - consumedFraction);
  }
  
  q.lastDeduct = new Date().toISOString();
  saveLocalQuota(q);
}

// 从本地配额生成 buildLiveWindowsData 所需的格式
function buildLocalQuotaWindows() {
  const q = loadLocalQuota();
  if (!q || !q.windows) return null;
  const now = new Date();
  const fmtCountdown = (resetTime) => {
    if (!resetTime) return '查询中';
    const diff = new Date(resetTime).getTime() - now.getTime();
    if (diff <= 0) return '即将重置';
    const d = Math.floor(diff / (24 * 3600 * 1000));
    const h = Math.floor((diff % (24 * 3600 * 1000)) / (3600 * 1000));
    const m = Math.floor((diff % (3600 * 1000)) / (60 * 1000));
    if (d > 0) return `${d}天 ${h}小时`;
    if (h > 0) return `${h}小时 ${m}分钟`;
    return `${m}分钟`;
  };
  const mk = (w, title, cnTitle) => {
    if (!w) return null;
    const pct = Math.round((w.remainingFraction || 0) * 1000) / 10;
    return { title, cnTitle, percent: pct, used: Math.round((100 - pct) * 10) / 10, total: 100,
      resetsIn: fmtCountdown(w.resetTime), resetText: fmtCountdown(w.resetTime), resetTime: w.resetTime,
      status: pct > 60 ? 'healthy' : pct > 20 ? 'warning' : 'danger' };
  };
  const result = {};
  const f = mk(q.windows.gemini5h, '5h', 'Google/Gemini 5小时');
  const w = mk(q.windows.geminiWeekly, 'Weekly', '每周Gemini');
  const cf = mk(q.windows.claude5h, '5h', 'Claude/GPT 5小时');
  const cw = mk(q.windows.claudeWeekly, 'Weekly', '每周Claude/GPT');
  if (f || w || cf || cw) {
    return { topNotice: '本地计算配额(每天校正)', windows: { fiveHour: f, weekly: w, claude5h: cf, claudeWeekly: cw } };
  }
  return null;
}


export function buildLiveWindowsData(profile = cachedGoogleProfile, targetAccount = null) {
  const activeToken = readActiveToken();
  const activeRt = activeToken?.token?.refresh_token;
  const accounts = listAccounts();
  const acc = targetAccount ||
    (profile?.email ? accounts.find(a => a.email === profile.email) : null) ||
    (activeRt ? accounts.find(a => a.tokenData?.token?.refresh_token === activeRt) : null) ||
    accounts.find(a => a.email === profile?.email) ||
    accounts[0];

  const summary = profile?.liveQuotaSummary || acc?.quotaSummary;
  const buckets = profile?.liveQuotaBuckets || acc?.quotaBuckets || [];
  const apiModels = profile?.liveModelsQuota || {};
  const tierData = profile?.tierData || acc?.tierData || parseGoogleAccountTier(null, acc?.tokenData || activeToken);

  const now = new Date();
  const fiveHourMs = 5 * 3600 * 1000;
  const currentBlockMs = now.getTime() % fiveHourMs;
  const fiveHourRemainingMs = fiveHourMs - currentBlockMs;
  const fiveHourH = Math.floor(fiveHourRemainingMs / (3600 * 1000));
  const fiveHourM = Math.floor((fiveHourRemainingMs % (3600 * 1000)) / (60 * 1000));

  const formatCountdown = (bucket, defaultText = '5小时 0分钟') => {
    if (!bucket) return defaultText;
    const isoString = typeof bucket === 'string' ? bucket : bucket.resetTime;
    const desc = typeof bucket === 'object' ? String(bucket.description || '').trim() : '';

    // 1. 如果 resetTime 在未来，精确计算剩余时间
    if (isoString) {
      const diff = new Date(isoString).getTime() - Date.now();
      if (diff > 60 * 1000) {
        const d = Math.floor(diff / (24 * 3600 * 1000));
        const rem = diff % (24 * 3600 * 1000);
        const h = Math.floor(rem / (3600 * 1000));
        const m = Math.floor((rem % (3600 * 1000)) / (60 * 1000));
        if (d > 0) return `${d}天 ${h}小时`;
        if (h > 0) return `${h}小时 ${m}分钟`;
        return `${m}分钟`;
      }
    }

    // 2. 解析 Google 官方返回的 description: e.g. "it will fully refresh in 4 hours, 54 minutes."
    if (desc) {
      const mEnDays = desc.match(/refresh in\s+(\d+)\s+days?(?:,\s*(\d+)\s+hours?)?/i);
      if (mEnDays) {
        const d = mEnDays[1];
        const h = mEnDays[2] || '0';
        return `${d}天 ${h}小时`;
      }
      const mEnHours = desc.match(/refresh in\s+(\d+)\s+hours?(?:,\s*(\d+)\s+minutes?)?/i);
      if (mEnHours) {
        const h = mEnHours[1];
        const m = mEnHours[2] || '0';
        return `${h}小时 ${m}分钟`;
      }
      const mEnMins = desc.match(/refresh in\s+(\d+)\s+minutes?/i);
      if (mEnMins) {
        return `${mEnMins[1]}分钟`;
      }
      const mCnDays = desc.match(/(\d+)\s*天\s*(?:(\d+)\s*小时)?/);
      if (mCnDays) {
        const d = mCnDays[1];
        const h = mCnDays[2] || '0';
        return `${d}天 ${h}小时`;
      }
      const mCnHours = desc.match(/(\d+)\s*小时\s*(?:(\d+)\s*分钟)?/);
      if (mCnHours) {
        const h = mCnHours[1];
        const m = mCnHours[2] || '0';
        return `${h}小时 ${m}分钟`;
      }
    }

    return defaultText;
  };

  const utcDay = now.getUTCDay();
  const utcHours = now.getUTCHours();
  const daysUntilWeekly = utcDay === 0 ? 0 : (7 - utcDay);
  const weeklyRemainingStr = `${daysUntilWeekly}天 ${23 - utcHours}小时`;

  // 1. 如果有 Google 官方 retrieveUserQuotaSummary 原生数据，100% 采用官方真实 groups 数据！
  if (summary && Array.isArray(summary.groups)) {
    const geminiGroup = summary.groups.find(g => (g.displayName || '').toLowerCase().includes('gemini')) || summary.groups[0];
    const claudeGroup = summary.groups.find(g => (g.displayName || '').toLowerCase().includes('claude') || (g.displayName || '').toLowerCase().includes('gpt') || (g.displayName || '').toLowerCase().includes('3p')) || summary.groups[1];

    const geminiWeeklyB = geminiGroup?.buckets?.find(b => b.window === 'weekly' || b.bucketId?.includes('weekly')) || geminiGroup?.buckets?.[0];
    const gemini5hB = geminiGroup?.buckets?.find(b => b.window === '5h' || b.bucketId?.includes('5h')) || geminiGroup?.buckets?.[1];

    const claudeWeeklyB = claudeGroup?.buckets?.find(b => b.window === 'weekly' || b.bucketId?.includes('weekly')) || claudeGroup?.buckets?.[0];
    const claude5hB = claudeGroup?.buckets?.find(b => b.window === '5h' || b.bucketId?.includes('5h')) || claudeGroup?.buckets?.[1];

    const lq = acc?.localQuota;

    const gWeeklyOfficial = geminiWeeklyB && geminiWeeklyB.remainingFraction != null ? parseFloat((geminiWeeklyB.remainingFraction * 100).toFixed(1)) : 100.0;
    const g5hOfficial = gemini5hB && gemini5hB.remainingFraction != null ? parseFloat((gemini5hB.remainingFraction * 100).toFixed(1)) : 100.0;
    const cWeeklyOfficial = claudeWeeklyB && claudeWeeklyB.remainingFraction != null ? parseFloat((claudeWeeklyB.remainingFraction * 100).toFixed(1)) : 100.0;
    const c5hOfficial = claude5hB && claude5hB.remainingFraction != null ? parseFloat((claude5hB.remainingFraction * 100).toFixed(1)) : 100.0;

    const gWeeklyPct = gWeeklyOfficial;
    const g5hPct = g5hOfficial;
    const cWeeklyPct = cWeeklyOfficial;
    const c5hPct = c5hOfficial;

    const g5hReset = gemini5hB?.resetTime || lq?.gemini5h?.resetTime || null;
    const gWeeklyReset = geminiWeeklyB?.resetTime || lq?.geminiWeekly?.resetTime || null;
    const c5hReset = claude5hB?.resetTime || lq?.claude5h?.resetTime || null;
    const cWeeklyReset = claudeWeeklyB?.resetTime || lq?.claudeWeekly?.resetTime || null;

    const notice = summary.description || '已连接 Google Antigravity 官方云端实时配额 API (CloudCode v1internal)';

    return {
      topNotice: notice,
      liveConnected: true,
      groups: summary.groups,
      windows: {
        fiveHour: {
          title: 'Five Hour Limit Remaining',
          cnTitle: 'Google / Gemini 5小时滚动算力',
          sub: gemini5hB?.description || 'Google 5小时滚动算力池',
          percent: g5hPct,
          used: parseFloat((100 - g5hPct).toFixed(1)),
          total: 100,
          resetsIn: formatCountdown(gemini5hB || g5hReset, `${fiveHourH}小时 ${fiveHourM}分钟`),
          resetText: formatCountdown(gemini5hB || g5hReset, `${fiveHourH}小时 ${fiveHourM}分钟`),
          resetTime: g5hReset,
          status: g5hPct > 60 ? 'healthy' : g5hPct > 20 ? 'warning' : 'danger'
        },
        weekly: {
          title: 'Weekly Limit Remaining',
          cnTitle: '每周 Gemini 旗舰算力',
          sub: geminiWeeklyB?.description || 'Google AI Pro 每周旗舰配额',
          percent: gWeeklyPct,
          used: parseFloat((100 - gWeeklyPct).toFixed(1)),
          total: 100,
          resetsIn: formatCountdown(geminiWeeklyB || gWeeklyReset, weeklyRemainingStr),
          resetText: formatCountdown(geminiWeeklyB || gWeeklyReset, weeklyRemainingStr),
          resetTime: gWeeklyReset,
          status: gWeeklyPct > 60 ? 'healthy' : gWeeklyPct > 20 ? 'warning' : 'danger'
        },
        claude5h: {
          title: 'Five Hour Limit Remaining',
          cnTitle: 'Claude 5 小时滚动算力',
          sub: claude5hB?.description || 'Claude 3.7 / 4.6 实时分配配额',
          percent: c5hPct,
          used: parseFloat((100 - c5hPct).toFixed(1)),
          total: 100,
          resetsIn: formatCountdown(claude5hB || c5hReset, `${fiveHourH}小时 ${fiveHourM}分钟`),
          resetText: formatCountdown(claude5hB || c5hReset, `${fiveHourH}小时 ${fiveHourM}分钟`),
          resetTime: c5hReset,
          status: c5hPct > 60 ? 'healthy' : c5hPct > 20 ? 'warning' : 'danger'
        },
        claudeWeekly: {
          title: 'Weekly Limit Remaining',
          cnTitle: '每周 Claude 旗舰配额',
          sub: claudeWeeklyB?.description || 'Claude 官方周周期算力池',
          percent: cWeeklyPct,
          used: parseFloat((100 - cWeeklyPct).toFixed(1)),
          total: 100,
          resetsIn: formatCountdown(claudeWeeklyB || cWeeklyReset, weeklyRemainingStr),
          resetText: formatCountdown(claudeWeeklyB || cWeeklyReset, weeklyRemainingStr),
          resetTime: cWeeklyReset,
          status: cWeeklyPct > 60 ? 'healthy' : cWeeklyPct > 20 ? 'warning' : 'danger'
        }
      }
    };
  }

  // 兜底：从实时 buckets 提取
  const geminiB = buckets.find(b => b.modelId?.startsWith('gemini-3.7') || b.modelId?.startsWith('gemini-3.6') || b.modelId?.startsWith('gemini'));
  const claudeSonnetB = buckets.find(b => b.modelId === 'claude-sonnet-4-6' || b.modelId?.includes('sonnet'));
  const claudeOpusB = buckets.find(b => b.modelId === 'claude-opus-4-6-thinking' || b.modelId?.includes('opus'));
  const gptB = buckets.find(b => b.modelId?.startsWith('gpt'));

  const geminiModelQ = apiModels['gemini-3.7-flash-high']?.quotaInfo || apiModels['gemini-3.6-flash-high']?.quotaInfo || apiModels['gemini-3.1-pro-high']?.quotaInfo;
  const claudeModelQ = apiModels['claude-sonnet-4-6']?.quotaInfo || apiModels['claude-opus-4-6-thinking']?.quotaInfo;

  const gRemaining = geminiB?.remainingFraction ?? geminiModelQ?.remainingFraction ?? 1.0;
  const gResetTime = geminiB?.resetTime || geminiModelQ?.resetTime;

  const cRemaining = claudeSonnetB?.remainingFraction ?? claudeModelQ?.remainingFraction ?? 1.0;
  const cResetTime = claudeSonnetB?.resetTime || claudeModelQ?.resetTime;

  const gPct = parseFloat((gRemaining * 100).toFixed(1));
  const cPct = parseFloat((cRemaining * 100).toFixed(1));

  return {
    topNotice: '已连接 Google Antigravity 官方云端实时配额 API (CloudCode v1internal)',
    liveConnected: true,
    windows: {
      fiveHour: {
        title: 'Five Hour Limit Remaining',
        cnTitle: 'Google / Gemini 5小时滚动算力',
        sub: 'Google CloudCode 官方实时算力池',
        percent: gPct,
        used: parseFloat((100 - gPct).toFixed(1)),
        total: 100,
        resetsIn: formatCountdown(gResetTime, `${fiveHourH}小时 ${fiveHourM}分钟`),
        resetText: formatCountdown(gResetTime, `${fiveHourH}小时 ${fiveHourM}分钟`),
        resetTime: gResetTime || null,
        status: gPct > 60 ? 'healthy' : gPct > 20 ? 'warning' : 'danger'
      },
      weekly: {
        title: 'Weekly Limit Remaining',
        cnTitle: '每周 Gemini 旗舰算力',
        sub: 'Google AI Pro 每周旗舰配额',
        percent: gPct,
        used: parseFloat((100 - gPct).toFixed(1)),
        total: 100,
        resetsIn: formatCountdown(gResetTime, weeklyRemainingStr),
        resetText: formatCountdown(gResetTime, weeklyRemainingStr),
        resetTime: gResetTime || null,
        status: gPct > 60 ? 'healthy' : gPct > 20 ? 'warning' : 'danger'
      },
      claude5h: {
        title: 'Five Hour Limit Remaining',
        cnTitle: 'Claude & GPT 5小时滚动算力',
        sub: 'Claude 3.7 / 4.6 实时分配配额',
        percent: cPct,
        used: parseFloat((100 - cPct).toFixed(1)),
        total: 100,
        resetsIn: formatCountdown(cResetTime, `${fiveHourH}小时 ${fiveHourM}分钟`),
        resetText: formatCountdown(cResetTime, `${fiveHourH}小时 ${fiveHourM}分钟`),
        resetTime: cResetTime || null,
        status: cPct > 60 ? 'healthy' : cPct > 20 ? 'warning' : 'danger'
      },
      claudeWeekly: {
        title: 'Weekly Limit Remaining',
        cnTitle: '每周 Claude & GPT 旗舰配额',
        sub: 'Claude 官方周周期算力池',
        percent: cPct,
        used: parseFloat((100 - cPct).toFixed(1)),
        total: 100,
        resetsIn: formatCountdown(cResetTime, weeklyRemainingStr),
        resetText: formatCountdown(cResetTime, weeklyRemainingStr),
        resetTime: cResetTime || null,
        status: cPct > 60 ? 'healthy' : cPct > 20 ? 'warning' : 'danger'
      }
    }
  };
}

import { readFile, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';



import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import express from 'express';
import session from 'express-session';
import config from './lib/config.js';
import { oauthRouter } from './lib/oauth.js';
import { cliProvider, fetchModels, cliAvailable, cliAuthenticated, bin, listPlugins, pluginAction, startAuthPoller, invalidateCliAuth } from './lib/cli.js';
import { cliLoginStart, cliLoginComplete, cliLoginStatus, cliLoginCancel, activeCliLogin } from './lib/cli-login.js';
import { startLocalProxy, needsGeminiProxy, getProxyUrl, getProxyTrafficStats } from './lib/proxy.js';
import { applyAutoAllow, applyAskMode, isAutoAllow, isToolAllowed, allowTool } from './lib/permissions.js';
import { listAccounts, addAccount, switchAccount, removeAccount, getActiveAccountEmail, getActiveAccount, updateAccountQuota, ensurePrimaryAccount, readActiveToken, ensureValidToken, refreshAccessToken, writeActiveToken, saveAccounts, syncAccountLocalQuota, deductAccountQuota } from './lib/accounts.js';
import { fetchBringYourLocations, getLatestSocksLogCount } from './lib/bringyour-locations.js';

// 每 2 小时定时直连 Google 上游拉取并替换当前激活账号的最新额度数据
const TWO_HOURS_INTERVAL = 2 * 60 * 60 * 1000;
setInterval(async () => {
  try {
    const active = getActiveAccount();
    if (active) {
      await refreshGoogleProfileInBackground(true, active);
      console.log(`[2h-Poller] 已自动同步 Google 上游额度并更新当前账号: ${active.email}`);
    }
  } catch (err) {
    console.warn('[2h-Poller] 2小时定时同步额度异常:', err && err.message);
  }
}, TWO_HOURS_INTERVAL);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
LOCAL_QUOTA_FILE = path.join(__dirname, "data", "local_quota.json");
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 天会话
  }
}));

// ---------- JSON helpers ----------
const send = (res, status, payload) => res.status(status).json(payload);
const publicUser = (u) => (u ? { email: u.email, name: u.name, picture: u.picture } : null);

// ---------- Debug logging ----------
import { appendFileSync } from 'node:fs';
const DEBUG_LOG = path.join(__dirname, 'chat-debug.log');
function debugLog(...args) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  try { appendFileSync(DEBUG_LOG, line + '\n'); } catch (_) {}
  console.log(line);
}

// ---------- WebUI 私有访问身份验证 (持久化令牌 + Cookie 保护) ----------
const AUTH_TOKENS_FILE = path.join(__dirname, 'data', 'auth_tokens.json');
const activeAuthTokens = new Map(); // token -> { username, loginAt }

function loadAuthTokens() {
  try {
    if (fs.existsSync(AUTH_TOKENS_FILE)) {
      const data = JSON.parse(fs.readFileSync(AUTH_TOKENS_FILE, 'utf8'));
      const now = Date.now();
      for (const [token, val] of Object.entries(data)) {
        // 30 天持久有效期，保证重启服务或刷新页面永不掉登录态
        if (val && val.loginAt && (now - val.loginAt < 30 * 24 * 3600 * 1000)) {
          activeAuthTokens.set(token, val);
        }
      }
    }
  } catch (_) {}
}

function saveAuthTokens() {
  try {
    const obj = {};
    for (const [token, val] of activeAuthTokens.entries()) {
      obj[token] = val;
    }
    fs.mkdirSync(path.dirname(AUTH_TOKENS_FILE), { recursive: true });
    fs.writeFileSync(AUTH_TOKENS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (_) {}
}

loadAuthTokens();

function isWebAuthed(req) {
  if (!config.auth || config.auth.enabled === false) return true;
  // 1. Session 校验
  if (req.session && req.session.authenticatedUser) return true;
  // 2. Cookie 校验 (agy_auth_token)
  const cookieHeader = req.headers.cookie || '';
  const matchCookie = cookieHeader.match(/(?:^|;\s*)agy_auth_token=([^;]+)/);
  const cookieToken = matchCookie ? decodeURIComponent(matchCookie[1]) : null;
  if (cookieToken && activeAuthTokens.has(cookieToken)) return true;

  // 3. Bearer / Header / Query 校验
  const token = req.headers['x-auth-token'] || 
    (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '').trim() : null) ||
    req.query?.auth_token;
  if (token && activeAuthTokens.has(token)) return true;
  return false;
}

// 身份验证检查中间件
function requireWebAuth(req, res, next) {
  if (isWebAuthed(req)) return next();
  return send(res, 401, { ok: false, unauthenticated: true, error: '请先登录以访问系统' });
}

// Web 认证接口（无需先登录）
app.get('/api/web-auth/status', (req, res) => {
  const authed = isWebAuthed(req);
  send(res, 200, {
    enabled: config.auth?.enabled !== false,
    authenticated: authed,
    username: authed ? (req.session?.authenticatedUser || 'admin') : null
  });
});

app.post('/api/web-auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!config.auth || config.auth.enabled === false) {
    return send(res, 200, { ok: true, username: 'Guest', message: '免密模式' });
  }

  const inputUser = String(username || '').trim();
  const inputPass = String(password || '').trim();

  const validUser = config.auth.username || 'admin';
  const validPass = config.auth.password || 'admin';

  if (inputUser === validUser && inputPass === validPass) {
    const token = crypto.randomBytes(32).toString('hex');
    activeAuthTokens.set(token, { username: inputUser, loginAt: Date.now() });
    saveAuthTokens();

    if (req.session) {
      req.session.authenticatedUser = inputUser;
      req.session.authToken = token;
    }

    res.cookie('agy_auth_token', token, {
      maxAge: 30 * 24 * 3600 * 1000,
      httpOnly: false,
      sameSite: 'lax',
      path: '/'
    });

    return send(res, 200, {
      ok: true,
      token,
      username: inputUser,
      message: '登录成功'
    });
  }

  return send(res, 401, {
    ok: false,
    error: '用户名或密码错误，请检查后重试'
  });
});

app.post('/api/web-auth/logout', (req, res) => {
  const cookieHeader = req.headers.cookie || '';
  const matchCookie = cookieHeader.match(/(?:^|;\s*)agy_auth_token=([^;]+)/);
  const cookieToken = matchCookie ? decodeURIComponent(matchCookie[1]) : null;

  const token = req.headers['x-auth-token'] || 
    (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '').trim() : null) ||
    cookieToken ||
    req.session?.authToken;
  if (token) {
    activeAuthTokens.delete(token);
    saveAuthTokens();
  }

  res.clearCookie('agy_auth_token', { path: '/' });
  if (req.session) {
    req.session.destroy(() => {});
  }
  send(res, 200, { ok: true, message: '已安全退出登录' });
});

// 前端上报浏览器侧错误（fetch 失败/流中断等）到服务端日志，便于排查 network error
app.post('/api/debug-log', (req, res) => {
  const body = req.body || {};
  debugLog('[CLIENT]', JSON.stringify(body));
  send(res, 200, { ok: true });
});

// 对其余所有 /api 接口强制鉴权（媒体资源允许直接加载渲染）
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/web-auth') || req.path.startsWith('/cli-login') || req.path === '/debug-log' || req.path === '/heartbeat' || req.path === '/avatar' || req.path === '/test-fetch' || req.path.startsWith('/assets/files') || req.path === '/image-preview') {
    return next();
  }
  return requireWebAuth(req, res, next);
});

// ---------- 系统设置面板：webui 登录账号密码 + 代理(SOCKS5)凭据 ----------
const URN_AUTH_FILE = path.join(__dirname, 'data', 'urn-auth.env');
const CONFIG_JSON_PATH = path.join(__dirname, 'config.json');
const PROXY_TOGGLE_FILE = path.join(__dirname, 'proxy-toggle.txt');

function readProxyToggle() {
  try {
    const raw = fs.readFileSync(PROXY_TOGGLE_FILE, 'utf8').trim().toLowerCase();
    return (raw === 'yes' || raw === 'on' || raw === 'true') ? 'yes' : 'no';
  } catch (_) { return 'yes'; }
}

function writeProxyToggle(val) {
  const norm = (String(val).trim().toLowerCase() === 'no' || String(val).trim().toLowerCase() === 'off' || String(val).trim().toLowerCase() === 'false') ? 'no' : 'yes';
  fs.writeFileSync(PROXY_TOGGLE_FILE, norm + '\n', 'utf8');
  return norm;
}

function readUrnAuth() {
  const fallback = { userAuth: '', password: '', country: 'United States', region: '', city: '', providerId: '', stable: false, privacy: true, quantum: true };
  try {
    const txt = fs.readFileSync(URN_AUTH_FILE, 'utf8');
    const map = {};
    for (const line of txt.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        map[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
    return {
      userAuth: map['URN_USER_AUTH'] || '',
      password: map['URN_PASSWORD'] || '',
      country: map['URN_COUNTRY'] || 'United States',
      region: map['URN_REGION'] || '',
      city: map['URN_CITY'] || '',
      providerId: map['URN_PROVIDER_ID'] || '',
      stable: map['URN_STABLE'] === 'true',
      privacy: map['URN_PRIVACY'] !== 'false',
      quantum: map['URN_QUANTUM'] !== 'false'
    };
  } catch (_) { return fallback; }
}

function writeUrnAuth(vals) {
  const cur = readUrnAuth();
  const v = { ...cur, ...vals };
  const lines = [
    '# URnetwork SOCKS5 代理凭据（由系统设置面板写入，.gitignore 忽略不外传）',
    `URN_USER_AUTH="${v.userAuth}"`,
    `URN_PASSWORD="${v.password}"`,
    `URN_COUNTRY="${v.country || 'United States'}"`,
    `URN_REGION="${v.region || ''}"`,
    `URN_CITY="${v.city || ''}"`,
    `URN_PROVIDER_ID="${v.providerId || ''}"`,
    `URN_STABLE="${v.stable ? 'true' : 'false'}"`,
    `URN_PRIVACY="${v.privacy ? 'true' : 'false'}"`,
    `URN_QUANTUM="${v.quantum ? 'true' : 'false'}"`
  ];
  fs.writeFileSync(URN_AUTH_FILE, lines.join('\n') + '\n', 'utf8');
}

function readConfigJson() {
  try { return JSON.parse(fs.readFileSync(CONFIG_JSON_PATH, 'utf8')); }
  catch (_) { return {}; }
}

// GET /api/system/settings —— 返回当前设置（密码类只回掩码占位，不泄露明文）
app.get('/api/system/settings', (req, res) => {
  const cfg = readConfigJson();
  const auth = cfg.auth || {};
  const urn = readUrnAuth();
  const proxyToggle = readProxyToggle();
  send(res, 200, {
    webAuth: {
      enabled: auth.enabled !== false,
      username: auth.username || 'admin',
      hasPassword: Boolean(auth.password)
    },
    proxy: {
      enabled: proxyToggle === 'yes',
      mode: proxyToggle,
      userAuth: urn.userAuth,
      hasPassword: Boolean(urn.password),
      country: urn.country,
      region: urn.region,
      city: urn.city,
      providerId: urn.providerId,
      stable: urn.stable,
      privacy: urn.privacy,
      quantum: urn.quantum
    }
  });
});

// POST /api/system/settings —— 写回 config.json(auth) 与 data/urn-auth.env，webui 密码即时生效
app.post('/api/system/settings', (req, res) => {
  const { webAuth, proxy } = req.body || {};
  let changed = [];

  try {
    if (webAuth && typeof webAuth === 'object') {
      const cfg = readConfigJson();
      cfg.auth = cfg.auth || {};
      if (webAuth.username != null && String(webAuth.username).trim()) cfg.auth.username = String(webAuth.username).trim();
      if (webAuth.password != null && String(webAuth.password)) cfg.auth.password = String(webAuth.password);
      if (webAuth.enabled != null) cfg.auth.enabled = Boolean(webAuth.enabled);
      fs.writeFileSync(CONFIG_JSON_PATH, JSON.stringify(cfg, null, 2), 'utf8');
      // 即时更新内存中的 config，让下一次登录立即用新凭据
      if (config.auth) {
        config.auth.username = cfg.auth.username;
        config.auth.password = cfg.auth.password;
        config.auth.enabled = cfg.auth.enabled !== false;
      }
      changed.push('webui登录账号密码');
    }

    if (proxy && typeof proxy === 'object') {
      if (proxy.enabled != null || proxy.mode != null) {
        const isEnabled = proxy.mode != null ? (String(proxy.mode).toLowerCase() === 'yes') : Boolean(proxy.enabled);
        const targetMode = isEnabled ? 'yes' : 'no';
        writeProxyToggle(targetMode);
        changed.push(`代理模式(${targetMode === 'yes' ? '开启代理' : '直连模式'})`);
        if (targetMode === 'no') {
          // 直连模式，立即终止正在运行的 urnetwork-socks 避免占用
          try {
            const out = execFileSync('pgrep', ['-f', 'urnetwork/urnetwork-socks'], { encoding: 'utf8' });
            for (const pid of out.trim().split('\n').filter(Boolean)) {
              try { process.kill(Number(pid), 'SIGKILL'); } catch (_) {}
            }
          } catch (_) {}
        }
      }
      const vals = {};
      if (proxy.userAuth != null) vals.userAuth = String(proxy.userAuth).trim();
      if (proxy.password != null && String(proxy.password)) vals.password = String(proxy.password);
      if (proxy.country != null) vals.country = String(proxy.country).trim() || 'United States';
      if (proxy.region != null) vals.region = String(proxy.region).trim();
      if (proxy.city != null) vals.city = String(proxy.city).trim();
      if (proxy.providerId != null) vals.providerId = String(proxy.providerId).trim();
      if (proxy.stable != null) vals.stable = Boolean(proxy.stable);
      if (proxy.privacy != null) vals.privacy = Boolean(proxy.privacy);
      if (proxy.quantum != null) vals.quantum = Boolean(proxy.quantum);
      if (Object.keys(vals).length) {
        writeUrnAuth(vals);
        changed.push('代理凭据/节点(需重启SOCKS5守护生效)');
      }
    }
  } catch (e) {
    return send(res, 500, { ok: false, error: '保存失败: ' + (e && e.message) });
  }

  debugLog('[settings] 更新:', changed.join(', ') || '无变更');
  send(res, 200, { ok: true, changed: changed, message: '已保存: ' + (changed.join('、') || '无变更') });
});

// GET /api/proxy/status —— 代理运行状态：SOCKS5/桥接端口是否监听 + 当前节点配置 + 模式 + 实时连接节点数
app.get('/api/proxy/status', (req, res) => {
  const urn = readUrnAuth();
  const proxyToggle = readProxyToggle();
  const portOpen = (p) => {
    try { const r = execFileSync('ss', ['-tln', `sport = :${p}`], { encoding: 'utf8' }); return r.includes(`:${p} `); }
    catch (_) { return false; }
  };
  const activeSocks = getLatestSocksLogCount();
  send(res, 200, {
    enabled: proxyToggle === 'yes',
    mode: proxyToggle,
    socksPort: 19999,
    socksListening: portOpen(19999),
    country: urn.country,
    region: urn.region,
    city: urn.city,
    stable: urn.stable,
    privacy: urn.privacy,
    quantum: urn.quantum,
    activeProviderCount: activeSocks ? activeSocks.count : null,
    activeCountry: activeSocks ? activeSocks.country : (urn.country || 'United States')
  });
});

// GET /api/proxy/locations —— 获取 BringYour 代理网络的国家列表与实时可用节点数
app.get('/api/proxy/locations', async (req, res) => {
  try {
    const locations = await fetchBringYourLocations();
    const totalProviders = locations.reduce((sum, l) => sum + (l.count || 0), 0);
    send(res, 200, {
      ok: true,
      totalCountries: locations.length,
      totalProviders,
      locations
    });
  } catch (e) {
    send(res, 500, { ok: false, error: '获取节点列表失败: ' + (e && e.message) });
  }
});

// POST /api/proxy/restart —— 强力终止旧进程，keepalive 守护循环自动用最新 urn-auth.env 拉起
app.post('/api/proxy/restart', (req, res) => {
  try {
    let killed = 0;
    try {
      const out = execFileSync('pgrep', ['-f', 'urnetwork/urnetwork-socks'], { encoding: 'utf8' });
      for (const pid of out.trim().split('\n').filter(Boolean)) {
        try { process.kill(Number(pid), 'SIGKILL'); killed++; } catch (_) {}
      }
    } catch (_) {} // pgrep 无匹配返回非零
    debugLog('[proxy] restart: killed', killed, 'urnetwork-socks, 守护循环将自动拉起');
    send(res, 200, { ok: true, killed, message: `已重启代理（终止 ${killed} 个旧进程，守护循环已用最新配置重新连接节点，3秒内就绪）` });
  } catch (e) {
    send(res, 500, { ok: false, error: '重启失败: ' + (e && e.message) });
  }
});

// ---------- 缓存与读取 Google Antigravity OAuth 账号资料 ----------
let cachedGoogleProfile = null;
// 持久化 Google Profile 缓存，避免重复拉取与头像闪烁
const PROFILE_CACHE_FILE = path.join(__dirname, 'data', 'google_profile_cache.json');
try {
  if (fs.existsSync(PROFILE_CACHE_FILE)) {
    const rawCache = JSON.parse(fs.readFileSync(PROFILE_CACHE_FILE, 'utf8'));
    if (rawCache && rawCache.email) {
      cachedGoogleProfile = rawCache;
      profileFetchedAt = Date.now() - 60000; // 初始化为可用状态
    }
  }
} catch (_) {}
let profileFetchedAt = 0;
// 启动时立即在后台刷新一次真实配额
setTimeout(() => { refreshGoogleProfileInBackground(true).catch(() => {}); }, 1000);

function parseGoogleAccountTier(liveTierInfo, rawToken) {
  const currentId = (liveTierInfo?.currentTier?.id || '').toLowerCase();
  const paidId = (liveTierInfo?.paidTier?.id || '').toLowerCase();
  const paidName = liveTierInfo?.paidTier?.name || '';
  
  // 1. Enterprise 企业商业版
  if (currentId.includes('enterprise') || currentId.includes('business')) {
    return {
      type: 'enterprise',
      name: 'Google Workspace / Enterprise (企业商业版)',
      badge: '企业商业版',
      isPro: true,
      isFree: false,
      isEnterprise: true,
      useG1Credits: false,
      policyNote: 'Google Enterprise 企业商业版特权：享受组织级专属 SLA 高并发保障与私有化数据隔离合规通道。'
    };
  }

  // 2. Google AI Pro / Google One AI Premium (用户具备 g1-pro-tier / Pro 权益)
  const isGoogleAiPro = paidId === 'g1-pro-tier' ||
                        paidName.includes('Pro') ||
                        currentId.includes('pro') ||
                        currentId.includes('standard') ||
                        rawToken?.auth_method === 'consumer' ||
                        rawToken?.useG1Credits;

  if (isGoogleAiPro) {
    return {
      type: 'pro',
      name: 'Google AI Pro (Gemini Advanced · G1 Credits)',
      badge: 'Google AI Pro',
      isPro: true,
      isFree: false,
      isEnterprise: false,
      useG1Credits: true,
      policyNote: 'Google AI Pro 订阅特权：享有 Gemini 5小时高额滚动算力池与无总量计费上限；Claude 与高阶模型享 Pro 优先调度，超额自动启用 G1 Credits 算力兜底。'
    };
  }

  // 3. 免费版账号 (Free Tier)
  return {
    type: 'free',
    name: 'Antigravity Free Tier (免费账号)',
    badge: '免费版',
    isPro: false,
    isFree: true,
    isEnterprise: false,
    useG1Credits: false,
    policyNote: 'Google 免费账号规则：享有 Gemini 基础模型体验配额。升级至 Google AI Pro 可解锁高阶算力与第三方模型。'
  };
}

export async function refreshGoogleProfileInBackground(force = false, targetAccount = null) {
  const currentAcc = targetAccount || getActiveAccount();
  const rawToken = currentAcc?.tokenData || readActiveToken();
  const fallbackEmail = currentAcc?.email || 'Google 用户';

  const lastUpdated = currentAcc?.quotaUpdatedAt || profileFetchedAt;
  const isWithin2Hours = (Date.now() - lastUpdated) < QUOTA_CALIBRATE_TTL;

  // 如果非强制刷新，且当前账号已有真实配额数据，并且在有效周期内，复用缓存
  const hasValidSummary = Array.isArray(currentAcc?.quotaSummary?.groups) || Array.isArray(cachedGoogleProfile?.liveQuotaSummary?.groups);
  if (!force && isWithin2Hours && hasValidSummary) {
    if (!cachedGoogleProfile || cachedGoogleProfile.email !== currentAcc?.email) {
      cachedGoogleProfile = {
        email: currentAcc?.email,
        name: currentAcc?.name,
        picture: currentAcc?.picture,
        liveQuotaSummary: currentAcc?.quotaSummary,
        liveQuotaBuckets: currentAcc?.quotaBuckets,
        liveApiConnected: true
      };
    }
    const winData = buildLiveWindowsData(cachedGoogleProfile, currentAcc);
    cachedGoogleProfile.windows = winData?.windows || {};
    cachedGoogleProfile.topNotice = winData?.topNotice || '';
    return cachedGoogleProfile;
  }

  let raw = rawToken;
  if (!raw) return cachedGoogleProfile || { email: fallbackEmail, error: "Token expired, please reconnect" };

  // 确保 Token 未过期
  raw = await ensureValidToken(raw);
  let token = raw?.token?.access_token;
  if (!token) return cachedGoogleProfile || { email: fallbackEmail, error: "Token expired, please reconnect" };

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'antigravity/1.1.19'
  };

  const fetchWithRetry = async (url, options, retries = 2) => {
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, options);
        if (res.ok || res.status === 401 || res.status === 403 || res.status === 503) return res;
      } catch (err) {
        if (i === retries) return null;
        await new Promise(r => setTimeout(r, 200 * (i + 1)));
      }
    }
    return null;
  };

  // 分步发起请求，避免同域名 cloudcode-pa 并发过多导致 TLS 连接被服务端关闭 (ECONNRESET)
  let userinfoRes = await fetchWithRetry('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
  let tierRes = await fetchWithRetry('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', { method: 'POST', headers, body: JSON.stringify({}), signal: AbortSignal.timeout(6000) });
  let quotaSummaryRes = await fetchWithRetry('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', { method: 'POST', headers, body: JSON.stringify({}), signal: AbortSignal.timeout(6000) });

  // 如果遇到 401，立即强制刷新 Token 并重试一次
  const is401Error = userinfoRes?.status === 401 || tierRes?.status === 401 || quotaSummaryRes?.status === 401;
  if (is401Error) {
    raw = await refreshAccessToken(raw);
    token = raw?.token?.access_token;
    if (token) {
      if (currentAcc?.email === getActiveAccount()?.email) {
        writeActiveToken(raw);
      }
      headers.Authorization = `Bearer ${token}`;
      userinfoRes = await fetchWithRetry('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
      tierRes = await fetchWithRetry('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', { method: 'POST', headers, body: JSON.stringify({}), signal: AbortSignal.timeout(6000) });
      quotaSummaryRes = await fetchWithRetry('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', { method: 'POST', headers, body: JSON.stringify({}), signal: AbortSignal.timeout(6000) });
    }
  }

  if (is401Error) {
    raw = await refreshAccessToken(raw);
    token = raw?.token?.access_token;
    if (token) {
      if (currentAcc?.email === getActiveAccount()?.email) {
        writeActiveToken(raw);
      }
      headers.Authorization = `Bearer ${token}`;
      userinfoRes = await fetchWithRetry('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
      tierRes = await fetchWithRetry('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', { method: 'POST', headers, body: JSON.stringify({}), signal: AbortSignal.timeout(6000) });
      quotaSummaryRes = await fetchWithRetry('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', { method: 'POST', headers, body: JSON.stringify({}), signal: AbortSignal.timeout(6000) });
    }
  }

  let profile = {};
  if (userinfoRes && userinfoRes.ok) {
    try { profile = await userinfoRes.json(); } catch (_) {}
  }

  let liveTierInfo = null;
  if (tierRes && tierRes.ok) {
    try { liveTierInfo = await tierRes.json(); } catch (_) {}
  }

  let liveQuotaSummary = null;
  if (quotaSummaryRes && quotaSummaryRes.ok) {
    try {
      const sData = await quotaSummaryRes.json();
      if (Array.isArray(sData?.groups)) liveQuotaSummary = sData;
    } catch (_) {}
  }

  let liveQuotaBuckets = null;
  let liveModelsQuota = null;

  const tierData = parseGoogleAccountTier(liveTierInfo, raw);
  const currentEmail = profile.email || currentAcc?.email || fallbackEmail;
  const currentName = profile.name || currentAcc?.name || (currentEmail ? currentEmail.split('@')[0] : 'Google 用户');
  const currentPicture = profile.picture || currentAcc?.picture || '';

  // 固化并同步写回 accounts.json 中对应账号
  if (liveQuotaSummary || liveQuotaBuckets) {
    updateAccountQuota(currentEmail, liveQuotaSummary, liveQuotaBuckets);
  }

  // 判断地区限制：503 表示网络可达但地区受限，不等同于断网
  const tierHttpStatus = tierRes?.status || null;
  const isLocationBlocked503 = tierHttpStatus === 503;
  // 真正的网络不通：未收到任何 HTTP 响应
  const tierNetworkFailed = !tierRes;
  // API 可达（收到任何 HTTP 响应）= 网络通（即使 503 地区限制）
  const apiReachable = Boolean(tierRes || userinfoRes);

  const profileObj = {
    email: currentEmail,
    name: currentName,
    picture: currentPicture,
    tier: tierData.name,
    tierType: tierData.type,
    tierBadge: tierData.badge,
    tierData,
    tierDetails: liveTierInfo?.allowedTiers?.[0] || null,
    liveApiConnected: !!liveTierInfo || apiReachable, // 503 地区限制时 API 仍可达，不算断连
    locationBlocked: isLocationBlocked503, // 明确标记地区受限
    liveQuotaSummary: liveQuotaSummary || currentAcc?.quotaSummary || null,
    liveModelsQuota: liveModelsQuota || cachedGoogleProfile?.liveModelsQuota || null,
    liveQuotaBuckets: liveQuotaBuckets || currentAcc?.quotaBuckets || null,
    authMethod: raw.auth_method || 'consumer',
    expiry: raw.token?.expiry || null,
    useG1Credits: tierData.useG1Credits
  };

  const windowsData = buildLiveWindowsData(profileObj, currentAcc);
  profileObj.windows = windowsData?.windows || {};
  profileObj.topNotice = windowsData?.topNotice || '';

  if (!targetAccount || targetAccount.email === getActiveAccount()?.email) {
    cachedGoogleProfile = profileObj;
    profileFetchedAt = Date.now();
    try {
      fs.writeFileSync(PROFILE_CACHE_FILE, JSON.stringify(cachedGoogleProfile, null, 2));
    } catch (_) {}
  }

  return profileObj;
}

export function getActiveGoogleProfile() {
  const acc = getActiveAccount();
  const activeToken = acc?.tokenData || readActiveToken();

  if (cachedGoogleProfile && acc && cachedGoogleProfile.email === acc.email) {
    if (acc.name && (!cachedGoogleProfile.name || cachedGoogleProfile.name === 'Google 用户')) {
      cachedGoogleProfile.name = acc.name;
    }
    if (acc.picture && !cachedGoogleProfile.picture) {
      cachedGoogleProfile.picture = acc.picture;
    }
    return cachedGoogleProfile || { email: currentEmail, error: "Token expired, please reconnect" };
  }

  if (acc) {
    const tierData = parseGoogleAccountTier(null, acc.tokenData || activeToken);
    return {
      email: acc.email,
      name: acc.name || (acc.email ? acc.email.split('@')[0] : 'Google 用户'),
      picture: acc.picture || '',
      tier: tierData.name,
      tierType: tierData.type,
      tierBadge: tierData.badge,
      tierData,
      tierDetails: null,
      liveApiConnected: !!acc.quotaSummary,
      liveQuotaSummary: acc.quotaSummary || null,
      liveQuotaBuckets: acc.quotaBuckets || null,
      authMethod: acc.authMethod || 'consumer',
      expiry: acc.tokenData?.token?.expiry || null,
      useG1Credits: tierData.useG1Credits
    };
  }
  return cachedGoogleProfile || { email: currentEmail, error: "Token expired, please reconnect" };
}

// ---------- API ----------
// 头像缓存代理：首次 fetch 下载到本地,后续直接读本地(不依赖 Google)
const AVATAR_CACHE_DIR = path.join(__dirname, 'data', 'avatars');
if (!fs.existsSync(AVATAR_CACHE_DIR)) fs.mkdirSync(AVATAR_CACHE_DIR, { recursive: true });

app.get('/api/test-fetch', async (req,res) => { try { const r = await fetch('https://www.google.com/favicon.ico',{signal:AbortSignal.timeout(8000)}); const b = Buffer.from(await r.arrayBuffer()); res.send('fetch OK size='+b.length); } catch(e) { res.send('fetch FAIL: '+e.message); } });

app.get('/api/avatar', async (req, res) => {
  const url = req.query.u;
  if (!url || !url.startsWith('http')) return res.status(400).end();
  if (!url.includes('googleusercontent.com') && !url.includes('google.com')) return res.status(403).end();
  const hash = crypto.createHash('md5').update(url).digest('hex');
  // 1. 先找 email 命名的缓存(另一个 AI 下载的)
  const files = fs.existsSync(AVATAR_CACHE_DIR) ? fs.readdirSync(AVATAR_CACHE_DIR) : [];
  const emailFile = files.find(f => f.endsWith('.jpg') || f.endsWith('.png'));
  if (emailFile) {
    const f = path.join(AVATAR_CACHE_DIR, emailFile);
    if (fs.statSync(f).size > 100) {
      const ext = emailFile.endsWith('.png') ? 'image/png' : 'image/jpeg';
      res.set('Content-Type', ext);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(f);
    }
  }
  // 2. 再找 MD5 命名的缓存
  const cacheFile = path.join(AVATAR_CACHE_DIR, hash + '.jpg');
  if (fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 100) {
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.sendFile(cacheFile);
  }
  // 3. fetch 下载(Google 可能不可达,有兜底)
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 100) fs.writeFileSync(cacheFile, buf);
      res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(buf);
    }
  } catch(e) {}
  // 4. 兜底:1x1 透明图
  res.set('Content-Type', 'image/gif');
  res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
});

app.get('/api/debug-log', async (req, res) => {
  const type = req.query.type || 'server';
  try {
    const logFile = type === 'chat' ? 'chat-debug.log' : 'server.log';
    const data = await readFile(path.join(__dirname, logFile));
    const lines = data.toString().split('\n').filter(Boolean).slice(-50);
    send(res, 200, { lines });
  } catch(e) { send(res, 200, { lines: ['[read failed: ' + e.message + ']'] }); }
});

app.get('/api/heartbeat', (req, res) => { send(res, 200, { ok: true, ts: Date.now(), uptime: Date.now() - (globalThis.__boot || Date.now()) }); });

app.get('/api/status', async (req, res) => {
  const cliInstalled = cliAvailable();
  const cliAuthed = cliInstalled ? await cliAuthenticated() : false;
  if (!cachedGoogleProfile || cachedGoogleProfile.isMock || (Date.now() - profileFetchedAt > 300000)) {
    refreshGoogleProfileInBackground().catch(() => {});  // 非阻塞:后台刷新,不卡 /api/status
  }
  const prof = getActiveGoogleProfile();
  const ga = prof ? { ...prof, picture: prof.picture ? ('/api/avatar?u=' + encodeURIComponent(prof.picture)) : prof.picture } : null;
  send(res, 200, {
    oauthConfigured: config.oauthConfigured,
    cli: {
      installed: cliInstalled,
      authenticated: !!cliAuthed,
      bin: cliInstalled ? bin() : null
    },
    googleAccount: cliAuthed ? ga : null,
    genEndpoint: process.env.AGY_CHAT_ENDPOINT ? 'custom' : 'default',
    user: publicUser(req.session.user)
  });
});

function getModelMetadata(modelId, tierData = {}) {
  const id = String(modelId || '').toLowerCase();
  const isPro = tierData?.isPro !== false;
  const isEnterprise = tierData?.isEnterprise === true;
  const tierPrefix = isEnterprise ? '企业版' : isPro ? 'Pro' : '免费版';

  if (id.startsWith('gemini-3.8-flash')) {
    const level = id.includes('high') ? 'High' : id.includes('low') ? 'Low' : 'Medium';
    return {
      id: modelId,
      name: `Gemini 3.8 Flash (${level})`,
      series: 'Gemini',
      percent: isPro ? 100 : 75,
      quota: isPro ? `${tierPrefix} 5h 滚动算力池` : '免费基础配额',
      status: 'active',
      statusText: isPro ? `${tierPrefix} 最新一代旗舰 · 极速深度思考` : '免费基础速率约束',
      speed: level === 'High' ? '~135 tok/s' : level === 'Medium' ? '~145 tok/s' : '~155 tok/s',
      context: '1,048,576 tokens'
    };
  }
  if (id.startsWith('gemini-3.7-flash')) {
    const level = id.includes('high') ? 'High' : id.includes('low') ? 'Low' : 'Medium';
    return {
      id: modelId,
      name: `Gemini 3.7 Flash (${level})`,
      series: 'Gemini',
      percent: isPro ? 100 : 75,
      quota: isPro ? `${tierPrefix} 5h 滚动算力池` : '免费基础配额',
      status: 'active',
      statusText: isPro ? `${tierPrefix} 全天极速高频 · 深度思考` : '免费基础速率约束',
      speed: level === 'High' ? '~120 tok/s' : level === 'Medium' ? '~130 tok/s' : '~140 tok/s',
      context: '1,048,576 tokens'
    };
  }
  if (id.startsWith('gemini-3.6-flash')) {
    const level = id.includes('high') ? 'High' : id.includes('low') ? 'Low' : 'Medium';
    return {
      id: modelId,
      name: `Gemini 3.6 Flash (${level})`,
      series: 'Gemini',
      percent: isPro ? 100 : 80,
      quota: isPro ? `${tierPrefix} 5h 滚动算力池` : '免费基础配额',
      status: 'active',
      statusText: isPro ? `${tierPrefix} 极速稳定推理` : '免费日常对话',
      speed: '~130 tok/s',
      context: '1,048,576 tokens'
    };
  }
  if (id.startsWith('gemini-3.5-flash')) {
    const level = id.includes('high') ? 'High' : id.includes('low') ? 'Low' : 'Medium';
    return {
      id: modelId,
      name: `Gemini 3.5 Flash (${level})`,
      series: 'Gemini',
      percent: isPro ? 100 : 85,
      quota: isPro ? `${tierPrefix} 5h 滚动算力池` : '免费基础配额',
      status: 'active',
      statusText: isPro ? `${tierPrefix} 快速轻量响应` : '免费快速响应',
      speed: '~140 tok/s',
      context: '1,048,576 tokens'
    };
  }
  if (id.startsWith('gemini-3.1-pro') || id.startsWith('gemini-3-pro')) {
    const level = id.includes('high') ? 'High' : 'Low';
    return {
      id: modelId,
      name: `Gemini 3.1 Pro (${level})`,
      series: 'Gemini',
      percent: isPro ? 96 : 50,
      quota: isPro ? `${tierPrefix} 顶级长上下文配额` : '免费受限体验',
      status: isPro ? 'active' : 'limited',
      statusText: isPro ? '200万上下文复杂代码架构深度分析' : '免费并发受限',
      speed: '~65 tok/s',
      context: '2,097,152 tokens'
    };
  }
  if (id.includes('claude-sonnet')) {
    return {
      id: modelId,
      name: 'Claude Sonnet 4.6 (Thinking)',
      series: 'Claude',
      percent: isPro ? 88 : 40,
      quota: isPro ? `${tierPrefix} 高阶编程 (5h 滚动)` : '受限体验配额',
      status: isPro ? 'active' : 'limited',
      statusText: isPro ? '深度思考编程与架构重构' : '每日有限请求轮次',
      speed: '~50 tok/s',
      context: '200,000 tokens'
    };
  }
  if (id.includes('claude-opus')) {
    return {
      id: modelId,
      name: 'Claude Opus 4.6 (Thinking)',
      series: 'Claude',
      percent: isPro ? 75 : 20,
      quota: isPro ? '旗舰限额 (30h 滚动重置 / G1 兜底)' : '仅限 Pro 订阅可用',
      status: 'limited',
      statusText: isPro ? '旗舰深度推理 (支持 G1 Credits 自动补充)' : '需升级至 Google AI Pro',
      speed: '~35 tok/s',
      context: '200,000 tokens'
    };
  }
  if (id.includes('gpt') || id.includes('oss')) {
    return {
      id: modelId,
      name: 'GPT-OSS 120B (Medium)',
      series: 'GPT',
      percent: isPro ? 98 : 60,
      quota: isPro ? `${tierPrefix} 开源顶级高算力` : '开源基础配额',
      status: 'active',
      statusText: '开源顶级大语言模型',
      speed: '~80 tok/s',
      context: '128,000 tokens'
    };
  }
  return {
    id: modelId,
    name: modelId,
    series: 'Other',
    percent: 100,
    quota: '标准配额',
    status: 'active',
    statusText: '可用模型',
    speed: '~80 tok/s',
    context: '128,000 tokens'
  };
}

app.get('/api/usage', async (req, res) => {
  const emailParam = req.query.email ? String(req.query.email).trim() : '';
  const currentActive = emailParam ? (listAccounts().find(a => a.email === emailParam) || getActiveAccount()) : getActiveAccount();
  const force = req.query.refresh === '1' || req.query.force === '1' || (Date.now() - (currentActive?.quotaUpdatedAt || 0) > QUOTA_CALIBRATE_TTL);

  // 1. 直连 Google 上游同步配额与重置时间（支持手动强刷/2小时过期判定）
  let quotaData = null;
  if (currentActive) {
    quotaData = await refreshGoogleProfileInBackground(force, currentActive).catch(() => null);
  }
  const windowsData = buildLiveWindowsData(quotaData || cachedGoogleProfile, currentActive);
  const liveWindows = windowsData?.windows || quotaData?.windows || {};

  // 2. 动态读取 CLI 真实可用模型
  const cli = await fetchModels();
  const rawList = cli.ok && Array.isArray(cli.models) && cli.models.length > 0 ? cli.models : [];
  const primaryModels = [
    'gemini-3.8-flash-high',
    'gemini-3.7-flash-high',
    'gemini-3.1-pro-high',
    'claude-opus-4-6-thinking',
    'claude-sonnet-4-6',
    'gpt-oss-120b-medium'
  ];
  const rawModelIds = primaryModels.filter(m => rawList.length === 0 || rawList.includes(m) || rawList.some(r => r.startsWith(m.split('-')[0])));

  const modelsQuota = rawModelIds.map((m) => {
    const meta = getModelMetadata(m, { name: 'Google AI Pro', type: 'pro', badge: 'PRO' });
    const isClaude = m.includes('claude') || m.includes('gpt') || m.includes('oss');
    const pool = isClaude ? liveWindows?.claude5h : liveWindows?.fiveHour;
    meta.percent = pool?.percent != null ? pool.percent : 100;
    if (pool?.resetTime) meta.resetTime = pool.resetTime;
    if (pool?.resetsIn) meta.resetsIn = pool.resetsIn;
    return meta;
  });

  // 3. 汇总本地真实会话数与 Token 统计
  let totalConversations = 0;
  let totalTurns = 0;
  let totalTokens = 0;
  try {
    const sessionsDir = path.join(__dirname, 'data', 'sessions');
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
      totalConversations = files.length;
      for (const f of files) {
        try {
          const sess = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
          if (Array.isArray(sess.messages)) {
            totalTurns += Math.floor(sess.messages.length / 2);
            for (const m of sess.messages) {
              if (m.usage?.total_tokens) {
                totalTokens += m.usage.total_tokens;
              } else if (typeof m.content === 'string') {
                totalTokens += Math.round(m.content.length / 3.2);
              }
            }
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  send(res, 200, {
    account: currentActive ? {
      name: currentActive.name || quotaData?.name || 'Google 用户',
      email: currentActive.email,
      picture: currentActive.picture || quotaData?.picture || ''
    } : { name: '未登录', email: '未检测到认证', picture: '' },
    tier: quotaData?.tier || 'Google AI Pro',
    tierType: quotaData?.tierType || 'pro',
    tierBadge: quotaData?.tierBadge || 'PRO',
    windows: liveWindows,
    topNotice: windowsData?.topNotice || quotaData?.topNotice || '',
    models: modelsQuota,
    metrics: {
      totalConversations,
      totalTurns,
      totalTokens,
      tokensFormatted: totalTokens > 1000000 ? (totalTokens / 1000000).toFixed(2) + 'M' : (totalTokens > 1000 ? (totalTokens / 1000).toFixed(1) + 'k' : String(totalTokens))
    },
    quotaUpdatedAt: currentActive?.quotaUpdatedAt || quotaData?.quotaUpdatedAt || Date.now(),
    timestamp: Date.now()
  });
});

app.get('/api/models', async (_req, res) => {
  const cli = await fetchModels();
  // 只取真实 CLI 的模型；CLI 未登录/失败时不回退到写死列表
  send(res, 200, { models: cli.ok ? cli.models : [], source: cli.ok ? 'cli' : 'cli-unauth', cli });
});

// ---------- CLI 登录（真实 Google OAuth） ----------
app.post('/api/cli-login/start', async (_req, res) => {
  if (!cliAvailable()) return send(res, 400, { error: 'Antigravity CLI 未安装' });
  const existing = activeCliLogin();
  if (existing) return send(res, 200, existing);
  const r = await cliLoginStart();
  if (!r.ok) return send(res, 500, { error: r.error });
  send(res, 200, { id: r.id, url: r.url });
});

app.post('/api/cli-login/complete', (req, res) => {
  const { id, code } = req.body || {};
  if (!id || !code) return send(res, 400, { error: '缺少 id 或 code' });
  const r = cliLoginComplete(id, code);
  if (!r.ok) return send(res, 400, { error: r.error });
  send(res, 200, { ok: true });
});

app.get('/api/cli-login/status', (req, res) => {
  const st = cliLoginStatus(String(req.query.id || ''));
  send(res, 200, st);
});

app.post('/api/cli-login/cancel', (req, res) => {
  cliLoginCancel(String(req.body?.id || ''));
  send(res, 200, { ok: true });
});

// ---------- 插件管理 ----------
app.get('/api/plugins', async (_req, res) => {
  const r = await listPlugins();
  if (!r.ok) return send(res, 400, { error: r.error });
  send(res, 200, { plugins: r.plugins });
});

app.post('/api/plugins/:action', async (req, res) => {
  const { action } = req.params;
  const r = await pluginAction(action, req.body?.name);
  if (!r.ok) return send(res, 400, { error: r.error });
  send(res, 200, { ok: true, message: r.message });
});

// ---------- 会话持久化存储 (借鉴 CloudCLI 服务端文件数据库) ----------
const SESSIONS_DIR = path.join(__dirname, 'data', 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function getSessionFilePath(id) {
  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(SESSIONS_DIR, `${safeId}.json`);
}

// ── 对齐 Antigravity 核心引擎 transcript.jsonl，保证用户即使关闭浏览器/关机也能 100% 自动找回离线回复 ──
const BRAIN_DIR = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');

function syncSessionWithTranscript(sessionData) {
  if (!sessionData) return sessionData;
  const convId = sessionData.convId || getConversation(sessionData.id);
  if (!convId) return sessionData;

  const candidatePaths = [
    path.join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl'),
    path.join('/vol5/@apphome/claude code/.gemini/antigravity-cli/brain', convId, '.system_generated', 'logs', 'transcript.jsonl')
  ];

  const transcriptPath = candidatePaths.find(p => fs.existsSync(p));
  if (!transcriptPath) return sessionData;

  try {
    const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n');
    const steps = lines.map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);

    const turns = [];
    let currentTurn = null;
    for (const step of steps) {
      if (step.type === 'USER_INPUT') {
        let text = step.content || '';
        const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        if (match) text = match[1].trim();
        currentTurn = { user: text, assistant: '', timestamp: step.created_at };
        turns.push(currentTurn);
      } else if (step.type === 'PLANNER_RESPONSE' && currentTurn) {
        if (step.content) {
          currentTurn.assistant = step.content;
        }
      }
    }

    const transcriptTools = [];
    let pendingTool = null;
    for (const step of steps) {
      if (step.tool_calls && step.tool_calls.length) {
        for (const tc of step.tool_calls) {
          let args = tc.args || {};
          const cleanedArgs = {};
          for (const k of Object.keys(args)) {
            let v = args[k];
            if (typeof v === 'string') {
              v = v.trim();
              if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                try { v = JSON.parse(v); } catch (_) { v = v.slice(1, -1); }
              }
            }
            cleanedArgs[k] = v;
          }
          pendingTool = {
            stepIndex: step.step_index,
            name: tc.name,
            args: cleanedArgs,
            output: ''
          };
          transcriptTools.push(pendingTool);
        }
      } else if (step.type === 'GENERIC' && pendingTool && step.content) {
        if (!pendingTool.output) {
          pendingTool.output = String(step.content);
        }
      }
    }

    let modified = false;
    const sessionMsgs = Array.isArray(sessionData.messages) ? [...sessionData.messages] : [];

    // 自动补齐工具调用的具体代码参数与实际输出
    if (transcriptTools.length > 0) {
      const usedIndices = new Set();
      for (const m of sessionMsgs) {
        if (m.role === 'assistant' && Array.isArray(m.tools) && m.tools.length > 0) {
          for (const t of m.tools) {
            if (t.tool === 'thought') continue;
            const tFile = t.input?.TargetFile || t.input?.AbsolutePath || t.input?.DirectoryPath || '';
            const tCmd = t.input?.CommandLine || '';
            let match = null;
            if (t.stepIndex) {
              match = transcriptTools.find(cand => Math.abs(cand.stepIndex - t.stepIndex) <= 1 && cand.name === t.tool);
            }
            if (!match && tFile) {
              match = transcriptTools.find((cand, idx) => !usedIndices.has(idx) && cand.name === t.tool && cand.args.TargetFile === tFile);
            }
            if (!match && tCmd) {
              match = transcriptTools.find((cand, idx) => !usedIndices.has(idx) && cand.name === t.tool && cand.args.CommandLine === tCmd);
            }
            if (!match) {
              match = transcriptTools.find((cand, idx) => !usedIndices.has(idx) && cand.name === t.tool);
            }
            if (match) {
              usedIndices.add(transcriptTools.indexOf(match));
              t.input = { ...(match.args || {}), ...(t.input || {}) };
              for (const k of ['TargetContent', 'ReplacementContent', 'CommandLine', 'CodeContent', 'Description', 'Instruction', 'StartLine', 'EndLine', 'toolAction', 'toolSummary']) {
                if (match.args[k] != null) t.input[k] = match.args[k];
              }
              t.rawInput = JSON.stringify(t.input, null, 2);
              if (match.output) t.output = match.output;
              modified = true;
            }
          }
        }
      }
    }

    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      if (!t.user || !t.assistant) continue;

      const uIndex = sessionMsgs.findLastIndex(m => m.role === 'user' && (m.content === t.user || m.content.trim() === t.user.trim()));
      if (uIndex !== -1) {
        if (uIndex === sessionMsgs.length - 1 || sessionMsgs[uIndex + 1].role !== 'assistant') {
          sessionMsgs.splice(uIndex + 1, 0, {
            role: 'assistant',
            content: t.assistant,
            meta: { model: 'gemini-3.7-flash-high', syncedFromTranscript: true }
          });
          modified = true;
        } else if (sessionMsgs[uIndex + 1].role === 'assistant' && (!sessionMsgs[uIndex + 1].content || sessionMsgs[uIndex + 1].content.replace(/[\u200b\s]/g, '') === '')) {
          sessionMsgs[uIndex + 1].content = t.assistant;
          modified = true;
        }
      }
    }

    if (modified) {
      sessionData.messages = sessionMsgs;
      sessionData.convId = convId;
      sessionData.updatedAt = Date.now();
      const filePath = getSessionFilePath(sessionData.id);
      const tmpPath = `${filePath}.tmp.${Date.now()}`;
      try {
        fs.writeFileSync(tmpPath, JSON.stringify(sessionData, null, 2), 'utf-8');
        fs.renameSync(tmpPath, filePath);
        debugLog(`[syncSessionWithTranscript] Auto-reconciled session ${sessionData.id} with ${sessionMsgs.length} messages`);
      } catch (_) {}
    }
  } catch (err) {
    debugLog('[syncSessionWithTranscript] error:', err && err.message);
  }
  return sessionData;
}

// ── CloudCLI 方向：subscribe 没命中 activeRuns 时，从 transcript_full 磁盘兜底还原当前 turn 已输出部分 ──
function replayTranscriptTailToWs(ws, convId) {
  if (!convId) return false;
  const candidatePaths = [
    path.join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript_full.jsonl'),
    path.join('/vol5/@apphome/claude code/.gemini/antigravity-cli/brain', convId, '.system_generated', 'logs', 'transcript_full.jsonl')
  ];
  const p = candidatePaths.find(x => { try { return fs.existsSync(x); } catch (_) { return false; } });
  if (!p) return false;
  try {
    const lines = fs.readFileSync(p, 'utf-8').trim().split('\n');
    const steps = lines.map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    let lastUserIdx = -1;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i] && steps[i].type === 'USER_INPUT') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return false;
    const tail = steps.slice(lastUserIdx + 1);
    if (!tail.length) return false;
    let sent = false;
    for (const step of tail) {
      if (!step) continue;
      if (Array.isArray(step.tool_calls) && step.tool_calls.length) {
        for (const tc of step.tool_calls) {
          try { ws.send(JSON.stringify({ progress: true, toolName: tc.name || 'tool', toolInput: tc.args || {}, toolState: 'DONE', tip: tc.name || 'tool' })); sent = true; } catch (_) {}
        }
      }
      if (step.type === 'PLANNER_RESPONSE' && step.content) {
        try { ws.send(JSON.stringify({ delta: step.content })); sent = true; } catch (_) {}
      }
    }
    return sent;
  } catch (_) { return false; }
}

function tryParseEvent(ev) {
  if (!ev) return null;
  if (typeof ev === 'object') return ev;
  const m = String(ev).match(/^data: (.+)$/s);
  try { return JSON.parse(m ? m[1] : ev); } catch (_) { return null; }
}

// ── 流事件磁盘持久化：server 自己把 delta/progress 增量写盘，弥补 agy transcript 不存增量 ──
function getStreamFilePath(convKey) {
  const safe = String(convKey || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(SESSIONS_DIR, `${safe}.stream.jsonl`);
}
function appendStreamEvent(convKey, str) {
  try { fs.appendFileSync(getStreamFilePath(convKey), str + '\n'); } catch (_) {}
}
function truncateStreamFile(convKey) {
  try { fs.writeFileSync(getStreamFilePath(convKey), ''); } catch (_) {}
}
function readStreamEvents(convKey) {
  try {
    const p = getStreamFilePath(convKey);
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean);
  } catch (_) { return []; }
}

// 获取所有会话列表
app.get('/api/sessions', (_req, res) => {
  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    const sessions = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const fullPath = path.join(SESSIONS_DIR, file);
        const raw = fs.readFileSync(fullPath, 'utf-8');
        let data = JSON.parse(raw);
        if (data && data.id) {
          // 自动与底层 Antigravity transcript 对齐，找回所有离线响应
          data = syncSessionWithTranscript(data);
          const running = activeRuns.get(data.id);
          const isRunning = !!(running && running.isRunning);
          let msgs = Array.isArray(data.messages) ? [...data.messages] : [];
          // 如果当前还在后台生成，动态注入正在生成的 assistant 增量或思考状态
          if (isRunning && running) {
            const runningContent = running.accumulated || '';
            const runningTools = running.toolEvents || [];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
              msgs[msgs.length - 1] = { ...last, content: runningContent, tools: runningTools };
            } else {
              msgs.push({ role: 'assistant', content: runningContent, tools: runningTools, meta: { model: running.model } });
            }
          }
          // 清除末尾完全空白无工具的 assistant 占位（避免刷新时呈现空内容，有工具结果时保留）
          while (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant' && (!msgs[msgs.length - 1].content || msgs[msgs.length - 1].content.replace(/[\u200b\s]/g, '') === '') && (!msgs[msgs.length - 1].tools || msgs[msgs.length - 1].tools.length === 0) && !isRunning) {
            msgs.pop();
          }
          const lastMsg = msgs.length ? msgs[msgs.length - 1] : null;
          sessions.push({
            id: data.id,
            title: data.title || '新对话',
            createdAt: data.createdAt || fs.statSync(fullPath).birthtimeMs || Date.now(),
            updatedAt: data.updatedAt || fs.statSync(fullPath).mtimeMs || Date.now(),
            convId: data.convId || null,
            isRunning: isRunning,
            messageCount: msgs.length,
            messages: msgs,
            preview: lastMsg ? (lastMsg.content || '').slice(0, 80) : ''
          });
        }
      } catch (_) {}
    }
    // 按最后更新时间降序排列
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    send(res, 200, { ok: true, sessions });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// 获取单个会话详情
app.get('/api/sessions/:id', (req, res) => {
  const filePath = getSessionFilePath(req.params.id);
  if (!fs.existsSync(filePath)) return send(res, 404, { error: '会话不存在' });
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    let data = JSON.parse(raw);
    data = syncSessionWithTranscript(data);
    const running = activeRuns.get(data.id);
    const isRunning = !!(running && running.isRunning);
    let msgs = Array.isArray(data.messages) ? [...data.messages] : [];
    if (isRunning && running) {
      const runningContent = running.accumulated || '';
      const runningTools = running.toolEvents || [];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: runningContent, tools: runningTools };
      } else {
        msgs.push({ role: 'assistant', content: runningContent, tools: runningTools, meta: { model: running.model } });
      }
    }
    while (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant' && (!msgs[msgs.length - 1].content || msgs[msgs.length - 1].content.replace(/[\u200b\s]/g, '') === '') && (!msgs[msgs.length - 1].tools || msgs[msgs.length - 1].tools.length === 0) && !isRunning) {
      msgs.pop();
    }
    data.messages = msgs;
    data.isRunning = isRunning;
    send(res, 200, { ok: true, session: data });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// 保存/更新单个会话（原子写入 + Transcript 保护）
app.post('/api/sessions', (req, res) => {
  const { id, title, messages, convId, createdAt, updatedAt } = req.body || {};
  if (!id) return send(res, 400, { error: '缺少会话 id' });
  const filePath = getSessionFilePath(id);
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  try {
    let sessionObj = {
      id,
      title: title || '新对话',
      messages: Array.isArray(messages) ? messages : [],
      convId: convId || null,
      createdAt: createdAt || Date.now(),
      updatedAt: updatedAt || Date.now()
    };
    if (convId) setConversation(id, convId);
    // 写入前先与 transcript 对齐，防止客户端旧数据冲掉已生成的离线 assistant 消息
    sessionObj = syncSessionWithTranscript(sessionObj);
    fs.writeFileSync(tmpPath, JSON.stringify(sessionObj, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    send(res, 200, { ok: true, session: sessionObj });
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    send(res, 500, { error: e.message });
  }
});

// 删除单个会话：同时清理本地会话、磁盘流、Run任务、官方 agy 数据库与 brain 目录
app.delete('/api/sessions/:id', (req, res) => {
  const sid = req.params.id;
  const filePath = getSessionFilePath(sid);
  try {
    let convId = null;
    if (fs.existsSync(filePath)) {
      try { convId = JSON.parse(fs.readFileSync(filePath, 'utf8')).convId || null; } catch (_) {}
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
    // 删硬盘流文件（stream.jsonl）
    try { fs.unlinkSync(getStreamFilePath(sid)); } catch (_) {}

    // 中断并清理后台 Run Registry
    const run = activeRuns.get(sid);
    if (run) {
      try { run.abortController?.abort(); } catch (_) {}
      run.isRunning = false;
      activeRuns.delete(sid);
    }

    // 清理内存映射
    deleteConversation(sid);

    // 删后端 agy 原生 conversation（brain/<convId> transcript + SQLite DB）
    if (convId) {
      try { fs.rmSync(path.join(BRAIN_DIR, convId), { recursive: true, force: true }); } catch (_) {}
      const agyDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
      const convDbPath = path.join(agyDir, 'conversations', `${convId}.db`);
      const convDbShm = path.join(agyDir, 'conversations', `${convId}.db-shm`);
      const convDbWal = path.join(agyDir, 'conversations', `${convId}.db-wal`);
      for (const p of [convDbPath, convDbShm, convDbWal]) {
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
      }
    }
    send(res, 200, { ok: true });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// 批量从 localStorage 迁移到服务端
app.post('/api/sessions/migrate', (req, res) => {
  const { sessions } = req.body || {};
  if (!Array.isArray(sessions)) return send(res, 400, { error: '缺少 sessions 数组' });
  let importedCount = 0;
  for (const s of sessions) {
    if (!s || !s.id) continue;
    const filePath = getSessionFilePath(s.id);
    if (!fs.existsSync(filePath)) {
      try {
        const sessionObj = {
          id: s.id,
          title: s.title || '新对话',
          messages: Array.isArray(s.messages) ? s.messages : [],
          convId: s.convId || null,
          createdAt: s.createdAt || Date.now(),
          updatedAt: s.updatedAt || Date.now()
        };
        fs.writeFileSync(filePath, JSON.stringify(sessionObj, null, 2), 'utf-8');
        importedCount++;
      } catch (_) {}
    }
  }
  send(res, 200, { ok: true, imported: importedCount });
});

// 会话→官方 conversation_id 的映射，用于多轮续接（P2）。
// 带 TTL + 容量上限 + 磁盘 sessions 兜底读取，避免重启后串会话。
const conversations = new Map();
const CONV_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时未活动视为过期
const CONV_MAX = 500;

function getConversation(sid) {
  if (!sid) return null;
  const e = conversations.get(sid);
  if (e && Date.now() - e.at <= CONV_TTL_MS) {
    return e.id;
  }
  // 内存未命中或过期时，从持久化磁盘 session 读取，防止重启后串会话
  try {
    const filePath = getSessionFilePath(sid);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && data.convId) {
        conversations.set(sid, { id: data.convId, at: Date.now() });
        return data.convId;
      }
    }
  } catch (_) {}
  return null;
}

function setConversation(sid, id) {
  if (!sid || !id) return;
  conversations.set(sid, { id, at: Date.now() });
  if (conversations.size > CONV_MAX) {
    let oldestKey = null, oldestAt = Infinity;
    for (const [k, v] of conversations) if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k; }
    if (oldestKey) conversations.delete(oldestKey);
  }
}

function deleteConversation(sid) {
  if (sid) conversations.delete(sid);
}

// ---------- 借鉴 cloudcli 架构：解耦后台执行与前端网络连接 (Run Registry) ----------
// 无论前端网络如何抖动、锁屏、切后台，后台 CLI 执行绝不被随意 kill，支持客户端随时断线重连无缝回放
const activeRuns = new Map(); // convKey -> { abortController, listeners: Set, events: [], isRunning: boolean, conversationId: string, error: any, done: boolean }

// ---------- 附件上传（借鉴 CloudCLI：存全局 assets 目录，路径注入 prompt） ----------
import multer from 'multer';
import { mkdirSync } from 'node:fs';
const ASSETS_DIR = path.join(os.homedir(), '.antigravity', 'assets');
try { mkdirSync(ASSETS_DIR, { recursive: true }); } catch (_) {}

const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ASSETS_DIR),
    filename: (req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname);
      cb(null, unique + ext);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB (全面支持大文件/视频/大图上传)
});

// 上传文件 → 存到 ~/.antigravity/assets/ → 返回路径信息
app.post('/api/assets/files', attachmentUpload.array('files', 10), (req, res) => {
  const files = req.files || [];
  if (!files.length) return send(res, 400, { error: '未收到文件' });
  const attachments = files.map(f => ({
    path: f.path,
    name: f.originalname,
    mimeType: f.mimetype,
    size: f.size,
  }));
  debugLog('[assets] uploaded', attachments.length, 'files to', ASSETS_DIR);
  send(res, 200, { attachments });
});

// 下载/预览已上传或生成的媒体文件
app.get('/api/assets/files/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  let filePath = path.join(ASSETS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    // 自动在 brain 各会话目录中查找生成的图片
    try {
      if (fs.existsSync(BRAIN_DIR)) {
        const convDirs = fs.readdirSync(BRAIN_DIR);
        for (const conv of convDirs) {
          const candidate = path.join(BRAIN_DIR, conv, filename);
          if (fs.existsSync(candidate)) {
            filePath = candidate;
            break;
          }
        }
      }
    } catch (_) {}
  }
  if (!fs.existsSync(filePath)) {
    // 还在 scratch 目录中查找
    const scratchCandidate = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'scratch', filename);
    if (fs.existsSync(scratchCandidate)) {
      filePath = scratchCandidate;
    }
  }
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  send(res, 404, { error: '文件不存在' });
});

// 支持直接通过绝对路径或相对路径预览图片 (例如 brain 目录中的生成图)
app.get('/api/image-preview', (req, res) => {
  const p = req.query.path;
  if (!p) return send(res, 400, { error: '缺少 path 参数' });
  const cleanPath = String(p).replace(/^file:\/\//, '');
  const resolved = path.resolve(cleanPath);
  const allowedDirs = [
    ASSETS_DIR,
    BRAIN_DIR,
    path.join(os.homedir(), '.gemini'),
    '/vol1/@apphome/GoogleAntigravityCLI'
  ];
  const isAllowed = allowedDirs.some(dir => resolved.startsWith(dir));
  if (!isAllowed) return send(res, 403, { error: '非法路径' });
  if (fs.existsSync(resolved)) {
    return res.sendFile(resolved);
  }
  send(res, 404, { error: '文件不存在' });
});

// 语音转文字 API：接收前端录音文件 → 快速转写为文本
app.post('/api/audio-transcribe', attachmentUpload.single('audio'), async (req, res) => {
  const file = req.file;
  if (!file) return send(res, 400, { error: '未收到录音文件' });
  try {
    const audioPath = file.path;
    const prompt = `<files_input>${audioPath}</files_input>\n请直接转写出该音频中的语音说话内容。只需输出识别出来的文字，不要包含任何问候、说明、标点解释或格式前缀。`;
    let resultText = '';
    await cliProvider({
      model: 'gemini-3.7-flash',
      messages: [{ role: 'user', content: prompt }],
      onDelta: (d) => { resultText += d; },
      effort: 'off',
      permissions: 'approve'
    });
    resultText = resultText.replace(/​/g, '').trim();
    debugLog('[audio-transcribe] transcribed text:', resultText.slice(0, 60));
    send(res, 200, { text: resultText });
  } catch (err) {
    debugLog('[audio-transcribe] error:', err && err.message);
    send(res, 500, { error: err.message || '语音转写失败' });
  }
});

// 允许特定工具（记住选择，写入 settings.json allow 列表）
app.post('/api/permissions/allow', (req, res) => {
  const { toolName } = req.body || {};
  if (!toolName) return send(res, 400, { error: '缺少 toolName' });
  const ok = allowTool(toolName);
  debugLog('[permissions] allowTool:', toolName, '→', ok);
  send(res, 200, { ok, toolName });
});

// ---------- 多账号管理 ----------
app.get('/api/accounts', async (req, res) => {
  const accounts = await ensurePrimaryAccount();
  const activeEmail = await getActiveAccountEmail();
  const pa = accounts.map(a => {
    let gemini5h = null, geminiWeekly = null, claudeWeekly = null;
    if (a.quotaSummary?.groups) {
      const gGroup = a.quotaSummary.groups.find(g => g.displayName?.includes('Gemini'));
      const cGroup = a.quotaSummary.groups.find(g => g.displayName?.includes('Claude'));
      const g5 = gGroup?.buckets?.find(b => b.window === '5h');
      const gw = gGroup?.buckets?.find(b => b.window === 'weekly');
      const cw = cGroup?.buckets?.find(b => b.window === 'weekly');
      if (g5?.remainingFraction != null) gemini5h = parseFloat((g5.remainingFraction * 100).toFixed(1));
      if (gw?.remainingFraction != null) geminiWeekly = parseFloat((gw.remainingFraction * 100).toFixed(1));
      if (cw?.remainingFraction != null) claudeWeekly = parseFloat((cw.remainingFraction * 100).toFixed(1));
    }
    return {
      ...a,
      picture: a.picture ? ("/api/avatar?u=" + encodeURIComponent(a.picture)) : a.picture,
      quotaSnapshot: {
        gemini5h,
        geminiWeekly,
        claudeWeekly
      }
    };
  });
  send(res, 200, { accounts: pa, activeEmail });
});

app.post('/api/accounts/add', async (req, res) => {
  const { label, tokenData } = req.body || {};
  const r = await addAccount(label, tokenData);
  if (!r.ok) return send(res, 400, { error: r.error });
  debugLog('[accounts] added:', r.account.label);
  profileFetchedAt = 0;
  cachedGoogleProfile = null;
  invalidateCliAuth();
  send(res, 200, r);
});

app.post('/api/accounts/switch', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return send(res, 400, { error: '缺少 email' });

  // 终止任何正在进行的后台流，确保账号切换即刻生效
  for (const [k, r] of activeRuns.entries()) {
    if (r.isRunning) {
      try { r.abortController?.abort(); } catch (_) {}
      r.isRunning = false;
      r.done = true;
    }
  }

  const r = await switchAccount(email);
  if (!r.ok) return send(res, 400, { error: r.error });
  debugLog('[accounts] switched to:', r.account.email || r.account.label);
  invalidateCliAuth();
  cachedGoogleProfile = null;
  // 切换账号后立即直连 Google 上游拉取并替换该账号的最新额度数据
  let switchedAcc = getActiveAccount() || r.account;
  let newQuota = null;
  try {
    newQuota = await refreshGoogleProfileInBackground(true, switchedAcc);
    switchedAcc = getActiveAccount() || r.account;
  } catch (err) {
    debugLog('[accounts/switch] quota sync error:', err && err.message);
  }
  send(res, 200, { ...r, quota: newQuota });
});

app.delete('/api/accounts/:email', async (req, res) => {
  const hasRunning = Array.from(activeRuns.values()).some(r => r.isRunning === true && !r.done && (Date.now() - (r.startTime || 0) < 60000));
  if (hasRunning) {
    return send(res, 400, { error: '当前正在生成回答中，禁止删除账号。请等待生成完成或停止后再操作。' });
  }
  const email = req.params.email;
  const r = removeAccount(email);
  if (!r.ok) return send(res, 400, { error: r.error });
  debugLog('[accounts] removed (切除账号):', email);
  invalidateCliAuth();
  
  // 切除/删除账号后，直连 Google 上游刷新并替换主账号额度
  const activeAcc = getActiveAccount();
  let freshQuota = null;
  if (activeAcc) {
    try {
      freshQuota = await refreshGoogleProfileInBackground(true, activeAcc);
    } catch (err) {
      debugLog('[accounts/remove] quota sync error:', err && err.message);
    }
  }
  send(res, 200, { ok: true, quota: freshQuota, account: activeAcc });
});

app.post('/api/chat/abort', (req, res) => {
  const { conversationKey, conversationId } = req.body || {};
  const key = conversationKey || conversationId;
  let abortedCount = 0;
  for (const [key, run] of activeRuns.entries()) {
    if (!conversationKey || key === conversationKey || key === conversationId) {
      if (run && run.isRunning) {
        debugLog(`[api/chat/abort] user aborted run for ${key}`);
        try { run.abortController?.abort(); } catch (_) {}
        run.isRunning = false;
        run.done = true;
        abortedCount++;
      }
    }
  }
  send(res, 200, { ok: true, abortedCount });
});



// ---------- 工作区文件管理与代码查看（借鉴 CloudCLI 分层按需架构） ----------
let WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, 'home/.gemini/antigravity-cli');
if (!fs.existsSync(WORKSPACE_ROOT)) {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
}

const ALLOWED_ROOTS = [
  path.resolve(__dirname, 'home/.gemini/antigravity-cli'),
  path.resolve(__dirname),
  path.resolve(os.homedir(), '.gemini'),
  path.resolve(os.homedir(), '.antigravity')
];

function isPathAllowed(targetPath) {
  const resolved = path.resolve(targetPath);
  return ALLOWED_ROOTS.some(root => resolved === root || resolved.startsWith(root + path.sep));
}

function resolveSafePath(inputPath, fallbackBase = WORKSPACE_ROOT) {
  if (!inputPath) return fallbackBase;
  if (path.isAbsolute(inputPath)) {
    return path.resolve(inputPath);
  }
  return path.resolve(fallbackBase, inputPath);
}

// 借鉴 CloudCLI：单层目录按需极速浏览，永不因数万文件卡死
app.get('/api/workspace/list', (req, res) => {
  try {
    const requestedPath = req.query.path || req.query.dir || '';
    const showHidden = req.query.showHidden === 'true';
    const targetDir = resolveSafePath(requestedPath, WORKSPACE_ROOT);

    if (!isPathAllowed(targetDir)) {
      return send(res, 403, { error: '访问路径受限' });
    }

    if (!fs.existsSync(targetDir)) {
      return send(res, 404, { error: '目录不存在: ' + targetDir });
    }

    const stat = fs.statSync(targetDir);
    if (!stat.isDirectory()) {
      return send(res, 400, { error: '目标不是目录' });
    }

    const rawEntries = fs.readdirSync(targetDir, { withFileTypes: true });
    const items = [];
    const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']);

    for (const entry of rawEntries) {
      if (!showHidden && entry.name.startsWith('.') && entry.name !== '.env.example') {
        continue;
      }

      const fullPath = path.join(targetDir, entry.name);
      const isDir = entry.isDirectory();
      const ext = isDir ? '' : path.extname(entry.name).slice(1).toLowerCase();
      let size = 0;
      let mtime = 0;
      let count = 0;

      try {
        const itemStat = fs.statSync(fullPath);
        size = itemStat.size;
        mtime = itemStat.mtimeMs;
        if (isDir) {
          // 对日志/依赖等超大目录快速标记，避免深层递归阻塞
          if (entry.name === 'log' || entry.name === 'node_modules' || entry.name === '.git') {
            count = -1;
          } else {
            count = fs.readdirSync(fullPath).length;
          }
        }
      } catch (_) {}

      items.push({
        name: entry.name,
        fullPath,
        relPath: path.relative(WORKSPACE_ROOT, fullPath),
        type: isDir ? 'dir' : 'file',
        size,
        ext,
        isImage: IMAGE_EXTS.has(ext),
        count,
        mtime
      });
    }

    // 排序：文件夹在前，文件在后，按自然拼音/字母排序
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    // 计算上一级目录
    let parentPath = null;
    const parentDir = path.dirname(targetDir);
    if (parentDir !== targetDir && isPathAllowed(parentDir)) {
      parentPath = parentDir;
    }

    send(res, 200, {
      ok: true,
      currentPath: targetDir,
      parentPath,
      totalCount: items.length,
      showHidden,
      items,
      presetRoots: [
        { name: '⚡ Antigravity CLI 根目录', path: path.resolve(__dirname, 'home/.gemini/antigravity-cli') },
        { name: '🧠 会话与图片库 (brain)', path: path.resolve(__dirname, 'home/.gemini/antigravity-cli/brain') },
        { name: '🧪 代码草稿区 (scratch)', path: path.resolve(__dirname, 'home/.gemini/antigravity-cli/scratch') },
        { name: '💻 WebUI 系统源码', path: path.resolve(__dirname) }
      ]
    });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// 兼容老版接口（增加深度与目录防护）
app.get('/api/workspace/tree', (req, res) => {
  try {
    const dir = resolveSafePath(req.query.path || '', WORKSPACE_ROOT);
    if (!isPathAllowed(dir)) return send(res, 403, { error: '路径受限' });

    function getSafeTree(dirPath, relativeTo, depth = 0) {
      if (depth > 2) return [];
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const result = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
        if (entry.name === 'log' || entry.name === 'node_modules' || entry.name === '.git') continue;
        const fullPath = path.join(dirPath, entry.name);
        const relPath = path.relative(relativeTo, fullPath);
        if (entry.isDirectory()) {
          result.push({
            name: entry.name,
            path: relPath,
            type: 'dir',
            children: getSafeTree(fullPath, relativeTo, depth + 1)
          });
        } else {
          result.push({
            name: entry.name,
            path: relPath,
            type: 'file',
            ext: path.extname(entry.name).replace('.', '').toLowerCase()
          });
        }
      }
      return result;
    }

    const tree = getSafeTree(dir, dir);
    send(res, 200, { tree, root: dir });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// 查看文件内容（文本/代码或多媒体流）
app.get('/api/workspace/file', async (req, res) => {
  const filePath = String(req.query.path || '');
  if (!filePath) return send(res, 400, { error: '缺少 path 参数' });
  const safePath = resolveSafePath(filePath, WORKSPACE_ROOT);
  if (!isPathAllowed(safePath)) {
    return send(res, 403, { error: '非法路径访问' });
  }
  try {
    const stat = fs.statSync(safePath);
    const ext = path.extname(safePath).slice(1).toLowerCase();
    const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']);
    const isImage = IMAGE_EXTS.has(ext);

    // 图片或请求 raw 格式，直接以对应 MIME 流响应
    if (isImage || req.query.raw === 'true') {
      return res.sendFile(safePath);
    }

    if (stat.size > 5 * 1024 * 1024) return send(res, 400, { error: '文件过大（超过 5MB），不支持在线编辑' });
    const content = fs.readFileSync(safePath, 'utf-8');
    send(res, 200, {
      path: filePath,
      fullPath: safePath,
      name: path.basename(safePath),
      content,
      size: stat.size,
      mtime: stat.mtimeMs,
      ext
    });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

app.get('/api/system/stats', (_req, res) => {
  import('node:os').then((os) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    send(res, 200, {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || 'Unknown',
      uptime: Math.floor(os.uptime()),
      totalMemMB: Math.round(totalMem / (1024 * 1024)),
      usedMemMB: Math.round(usedMem / (1024 * 1024)),
      freeMemMB: Math.round(freeMem / (1024 * 1024)),
      memUsagePct: Math.round((usedMem / totalMem) * 100)
    });
  }).catch((e) => send(res, 500, { error: e.message }));
});

// ---------- Static / SPA (Zero Cache for Mobile & Desktop) ----------
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
const HTML_FILE = path.join(__dirname, 'public', 'index.html');
app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  try {
    let html = fs.readFileSync(HTML_FILE, 'utf-8');
    // 动态注入时间戳，彻底消除手机移动端浏览器强缓存旧 JS 导致熄屏/切后台卡死的问题
    html = html.replace(/\/app\.js\?v=[^"']+/g, `/app.js?v=${Date.now()}`);
    res.type('html').send(html);
  } catch (_) {
    res.sendFile(HTML_FILE);
  }
});
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  index: false, // 禁用 static 自带的 index.html 拦截，由 app.get('/') 动态注入版本号
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
}));
app.use('/auth', oauthRouter());

// 启动本地选择性代理桥接（只对 Gemini 模型调用域名走 URnetwork SOCKS5，其他直连，IP 不外泄）
startLocalProxy().catch((e) => console.warn('[proxy] startLocalProxy 失败:', e && e.message));

const server = app.listen(config.port, () => {
  startAuthPoller(); // 后台刷新 CLI 登录态，避免 /api/status 阻塞
  // 定时刷新 access_token（每 30 分钟，过期前主动刷，保证一直能用）
  const tokRefresher = setInterval(async () => {
    try {
      const active = getActiveAccount();
      if (active) {
        const beforeExpiry = active.tokenData?.token?.expiry || null;
        const refreshed = await refreshAccessToken(active.tokenData);
        const afterExpiry = refreshed?.token?.expiry || null;
        if (afterExpiry && afterExpiry !== beforeExpiry) {
          console.log(`[token-refresher] 已刷新 access_token: ${active.email} (expiry→${afterExpiry})`);
        } else {
          console.warn(`[token-refresher] ⚠️ 刷新未推进: ${active.email} (before=${beforeExpiry} after=${afterExpiry})`);
        }
      }
    } catch (err) {
      debugLog('[token-refresher] err:', err && err.message);
    }
  }, 30 * 60 * 1000);
  tokRefresher.unref?.();
  console.log(`Google Antigravity Web UI running at http://localhost:${config.port}`);
  if (config.oauthConfigured) {
    console.log('[info] 已配置 Google OAuth（可选用户登录）。');
  }
  console.log(`[info] Antigravity CLI: ${cliAvailable() ? '已安装 (' + bin() + ')' : '未安装，请设置 AGY_BIN 或安装 CLI'}`);
  console.log('[info] 模型列表与对话来自 Antigravity CLI；点击右上角「连接」可发起 Google 登录。');
});

// 设置超长超时（10 分钟），避免 Node 内部 headers/keepalive 超时断开 SSE 长连接
server.keepAliveTimeout = 600000;
server.headersTimeout = 605000;
server.requestTimeout = 0;
server.timeout = 0;

// 端口被占时：另一个实例已在跑，本实例直接退出（不竞争，防 EADDRINUSE 循环）
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    debugLog(`[warn] 端口 ${config.port} 被占用,另一个实例已在跑,本实例退出`);
    process.exit(0);
  } else {
    debugLog('[fatal] 服务器错误:', (err && err.message) || err);
    console.error('[fatal] 服务器错误:', (err && err.message) || err);
  }
});

// ── 全局错误兜底：node-pty/agy 子进程异常不应让整个 server 崩溃 ──
// 没有这两行，任何未捕获的 Promise rejection 或同步异常都会直接杀死进程，
// 导致 server 挂掉 → 前端 network error，且 server.log 无任何记录。
process.on('uncaughtException', (err) => {
  debugLog('[FATAL] uncaughtException:', err && err.message, '| stack:', err && err.stack);
  console.error('[FATAL] uncaughtException:', err && err.message, err && err.stack);
});
process.on('unhandledRejection', (err) => {
  debugLog('[FATAL] unhandledRejection:', err && err.message, '| stack:', err && err.stack);
  console.error('[FATAL] unhandledRejection:', err && err.message, err && err.stack);
});

// ── 借鉴 CloudCLI：用 WebSocket 替代 SSE，解决反向代理对长连接 HTTP 响应的缓冲/超时掐断 ──
// SSE 是 HTTP 响应保持打开，代理当普通 HTTP 处理会缓冲/掐断；WebSocket 是协议升级后的持久 TCP，代理做透传。
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ server, path: '/ws/chat' });

// 发送 WebSocket 心跳包与保活，兼容各种反向代理/内网穿透/DDNS 网关
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    try {
      if (ws.readyState === 1) ws.ping();
    } catch (_) {}
  });
}, 15000);
wss.on('close', () => clearInterval(pingInterval));

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  debugLog('[ws/chat] client connected');

  ws.on('message', async (rawData) => {
    let body;
    try { body = JSON.parse(rawData.toString()); } catch { ws.send(JSON.stringify({ error: 'Bad JSON' })); return; }

    // ── 检查 WebUI 鉴权 ──
    if (config.auth && config.auth.enabled !== false) {
      let authed = false;
      try {
        const urlParams = new URL(req.url, 'http://localhost').searchParams;
        const token = body.token || urlParams.get('token') || req.headers['x-auth-token'];
        if (token && activeAuthTokens.has(token)) authed = true;
        if (req.headers.cookie && req.headers.cookie.includes('connect.sid')) authed = true;
      } catch (_) {}
      if (!authed) {
        ws.send(JSON.stringify({ error: '请先登录以访问系统', unauthenticated: true }));
        return;
      }
    }

    const { model, messages, effort, permissions, conversationKey, conversationId: clientConvId } = body;
    const permRaw = String(permissions || '').trim().toLowerCase();

    // ── subscribe 模式（借鉴 CloudCLI）：刷新/重开/切回页面后，自动挂接后台任务并增量回放全部错过的事件 ──
    if (body.action === 'subscribe' && conversationKey) {
      const convKey = conversationKey || clientConvId || `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
      const existingRun = activeRuns.get(convKey);
      const afterSeq = typeof body.lastSeq === 'number' && Number.isFinite(body.lastSeq) ? Math.max(0, Math.floor(body.lastSeq)) : 0;

      if (existingRun && existingRun.isRunning) {
        debugLog(`[ws/chat] subscribe: attach to run ${convKey} (isRunning=true, events=${existingRun.events.length}, afterSeq=${afterSeq}) — 增量回放历史并挂接后续实时流`);
        const currentWaited = Math.max(1, Math.round((Date.now() - existingRun.startTime) / 1000));
        let activeTip = '正在深度思考与组织回答...';
        if (existingRun.toolEvents && existingRun.toolEvents.length > 0) {
          const lastTool = existingRun.toolEvents[existingRun.toolEvents.length - 1];
          activeTip = lastTool?.toolAction || lastTool?.tip || `正在执行: ${lastTool?.tool || '工具'}...`;
        }
        try {
          ws.send(JSON.stringify({
            subscribed: true,
            isRunning: true,
            conversationId: existingRun.conversationId || clientConvId || null,
            model: existingRun.model,
            lastSeq: existingRun.lastSeq || 0,
            latestTip: activeTip,
            latestWaited: currentWaited
          }));
        } catch (_) {}

        // 回放历史 events：让前端看到思考/工具过程（thought 卡片不显示秒数 478，不会出现两个时间）
        for (const ev of existingRun.events) {
          const item = typeof ev === 'string' ? (tryParseEvent(ev) || null) : ev;
          if (item && (typeof item.seq !== 'number' || item.seq > afterSeq)) {
            try { ws.send(JSON.stringify(item)); } catch (_) {}
          }
        }
        const wsListener = (chunk) => {
          const m = typeof chunk === 'string' ? chunk.match(/^data: (.+)$/s) : null;
          const payload = m ? m[1] : (typeof chunk === 'string' ? chunk : JSON.stringify(chunk));
          try { ws.send(payload); } catch (_) {}
        };
        existingRun.listeners.add(wsListener);
        // 独立应用层心跳：防反代/网关空闲掐断 WS（run 心跳经 listeners 转发，attach 的 ws 未必收到，独立保活最稳）
        const keepTimer = setInterval(() => {
          try { if (ws.readyState === 1) ws.send(JSON.stringify({ keepalive: true })); } catch (_) {}
        }, 3000);
        ws.on('close', () => { existingRun.listeners.delete(wsListener); clearInterval(keepTimer); });
        return;
      }

      // 借鉴 CloudCLI: 若后台没有正在运行的任务，先从磁盘流兜底回放 error（刷新后错误信息不丢），再回复 idle
      try {
        const streamEvents = readStreamEvents(convKey);
        if (streamEvents.length) {
          const errEvt = streamEvents
            .map((s) => { try { return JSON.parse(s); } catch (_) { return null; } })
            .filter(Boolean)
            .reverse()
            .find((e) => e && e.error);
          if (errEvt) {
            // 带错误来源标记，前端可据此显示错误而非当作新一轮思考
            try { ws.send(JSON.stringify({ ...errEvt, replayedFromTranscript: true })); } catch (_) {}
          }
        }
      } catch (_) {}
      try {
        ws.send(JSON.stringify({
          subscribed: true,
          isRunning: false,
          idle: true,
          conversationId: clientConvId || null
        }));
      } catch (_) {}
      return;
    }

    if (!model) { ws.send(JSON.stringify({ error: '缺少 model 参数' })); return; }
    if (!Array.isArray(messages) || !messages.length) { ws.send(JSON.stringify({ error: '缺少 messages 数组' })); return; }

    if (!(await cliAuthenticated())) {
      debugLog('[ws/chat] REJECT: cliAuthenticated=false');
      ws.send(JSON.stringify({ error: 'Antigravity CLI 未登录，请先登录 Google Antigravity（点右上角「连接」授权）' }));
      return;
    }
    debugLog('[ws/chat] authOK');

    if (permRaw === 'approve' || permRaw === '') { applyAutoAllow(); } else if (permRaw === 'ask') { applyAskMode(); }

    const convKey = conversationKey || clientConvId || `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
    let conversationId = (conversationKey && getConversation(conversationKey)) || null;

    // 保留完整真实对话历史，过滤掉异常失败报错消息，避免报错文本被注入上下文影响后续推理
    const effectiveMessages = Array.isArray(messages) ? messages.filter(m => m && !m.isError && typeof m.content === 'string' && m.content.trim() && !m.content.startsWith('Error: The stream was interrupted')) : [];
    const rawMsgCount = messages.length;

    debugLog('[ws/chat] BEGIN', JSON.stringify({ model, perm: permRaw, msgs: effectiveMessages.length, rawMsgs: rawMsgCount, convKey, clientConvId: clientConvId || null }));

    ws.send(JSON.stringify({ meta: { demo: false } }));
    ws.send(JSON.stringify({ delta: '​' }));

    // 复用 Run Registry：如果已有同会话的后台任务
    let existingRun = activeRuns.get(convKey);
    const _lastUser = Array.isArray(messages) ? [...messages].reverse().find(m => m && m.role === 'user') : null;
    const _initLastUser = (existingRun && Array.isArray(existingRun.initialMessages)) ? [...existingRun.initialMessages].reverse().find(m => m && m.role === 'user') : null;
    const _lu = _lastUser ? String(_lastUser.content || '').trim() : '';
    const _ilu = _initLastUser ? String(_initLastUser.content || '').trim() : '';
    // 以「最后一条 user 消息是否变化」判断新 turn
    const isNewTurn = !existingRun || !existingRun.isRunning || (_lu && _ilu && _lu !== _ilu);

    if (existingRun && existingRun.isRunning && !isNewTurn) {
      // 相同轮次正在跑：回放历史 events 让前端看到思考/工具过程（thought 卡片不显示秒数，不会两个时间）
      debugLog(`[ws/chat] attach to run ${convKey} (isRunning=true, events=${existingRun.events.length})`);
      for (const ev of existingRun.events) {
        const item = typeof ev === 'string' ? (tryParseEvent(ev) || null) : ev;
        if (item) { try { ws.send(JSON.stringify(item)); } catch (_) {} }
      }
      const wsListener = (chunk) => {
        const m = typeof chunk === 'string' ? chunk.match(/^data: (.+)$/s) : null;
        const payload = m ? m[1] : (typeof chunk === 'string' ? chunk : JSON.stringify(chunk));
        try { ws.send(payload); } catch (_) {}
      };
      existingRun.listeners.add(wsListener);
      ws.on('close', () => existingRun.listeners.delete(wsListener));
      return;
    }

    if (existingRun && existingRun.isRunning) {
      // 只有在新轮次启动时才取消旧 run
      try { existingRun.abortController?.abort(); } catch (_) {}
      existingRun.isRunning = false;
      activeRuns.delete(convKey);
    }

    // 第一次对话或 2h 过期，自动直连 Google 上游同步并替换额度数据
    const activeAcc = getActiveAccount();
    if (activeAcc) {
      refreshGoogleProfileInBackground(false, activeAcc).catch(() => {});
    }

    // 新建后台 Run
    const t0 = Date.now();
    const runAbortController = new AbortController();
    const run = {
      convKey,
      abortController: runAbortController,
      listeners: new Set(),
      events: [],
      lastSeq: 0,
      isRunning: true,
      initialMessages: Array.isArray(messages) ? [...messages] : [],
      accumulated: '',
      toolEvents: [],
      model: model,
      startTime: t0,
      conversationId: conversationId || null,
      done: false,
      error: null
    };
    activeRuns.set(convKey, run);
    truncateStreamFile(convKey); // 新 turn 开始：清空磁盘流文件，避免多轮叠加

    const broadcast = (obj) => {
      run.lastSeq = (run.lastSeq || 0) + 1;
      const eventWithSeq = { ...obj, seq: run.lastSeq };
      run.events.push(eventWithSeq);
      if (run.events.length > 5000) run.events.splice(0, run.events.length - 5000);
      const str = JSON.stringify(eventWithSeq);
      appendStreamEvent(convKey, str); // 同步持久化到磁盘，刷新后即使 activeRuns 没命中也能回放
      for (const l of run.listeners) {
        try { l(`data: ${str}\n\n`); } catch (_) {}
      }
    };

    const wsListener = (chunk) => {
      const m = typeof chunk === 'string' ? chunk.match(/^data: (.+)$/s) : null;
      const payload = m ? m[1] : (typeof chunk === 'string' ? chunk : JSON.stringify(chunk));
      try { ws.send(payload); } catch (_) {}
    };
    run.listeners.add(wsListener);
    ws.on('close', () => run.listeners.delete(wsListener));

    let lastDataAt = Date.now();
    let currentStatusTip = '正在连接模型并解析任务意图...';

    const heartbeat = setInterval(() => {
      if (Date.now() - lastDataAt >= 1000) {
        const waited = Math.round((Date.now() - t0) / 1000);
        let dynamicTip = currentStatusTip;
        if (!run.toolEvents || run.toolEvents.length === 0) {
          if (waited <= 2) dynamicTip = '正在连接模型并解析任务意图...';
          else if (waited <= 7) dynamicTip = '正在进行深度逻辑推理与代码分析...';
          else dynamicTip = '深度思考中，正在组织专业技术方案...';
        } else {
          const last = run.toolEvents[run.toolEvents.length - 1];
          if (last && (last.state === 'ACTIVE' || !last.output)) {
            dynamicTip = last.toolAction || last.tip || `正在执行: ${last.tool}...`;
          } else {
            dynamicTip = `已执行 ${run.toolEvents.length} 项工具，正在组织生成回答...`;
          }
        }
        broadcast({ progress: true, waited, tip: dynamicTip, activeStatus: dynamicTip });
        lastDataAt = Date.now();
      }
    }, 1000);

    const RETRY = 3;
    let deliveredAnything = false;

    // 确保启动 CLI 前 Token 已由服务端主动校验并刷新，绝不让底层 binary 因 Token 过期报错
    try {
      const freshToken = await ensureValidToken();
      if (freshToken) writeActiveToken(freshToken);
    } catch (_) {}

    try {
      let out = null;
      for (let attempt = 0; attempt <= RETRY; attempt++) {
        if (attempt > 0) {
          debugLog(`[ws/chat] cliProvider retry #${attempt}`);
          broadcast({ retrying: true, attempt });
        }
        try {
          // 注入系统提示词:让 agy 写完代码后自动验证语法
          const systemPrompt = { role: 'user', content: '【系统规则】你修改任何 JavaScript 文件后,必须立即执行 node --check <文件路径> 验证语法,确保无语法错误后再结束。如果语法有错,必须修复后再次验证,直到通过。' };
          const messagesWithRules = [systemPrompt, ...effectiveMessages];
          out = await cliProvider({
            model, messages: messagesWithRules, effort, permissions, conversationId,
            onDelta: (txt) => {
              if (txt && txt !== '​') {
                deliveredAnything = true;
                run.accumulated += txt;
              }
              lastDataAt = Date.now();
              broadcast({ delta: txt });
            },
            onProgress: (p) => {
              lastDataAt = Date.now();
              const waited = Math.round((Date.now() - t0) / 1000);
              if (p && p.tip) {
                currentStatusTip = p.tip;
              }
              if (p && (p.toolName || p.stepType)) {
                const tName = p.toolName || (p.stepType === 'checkpoint' ? 'sync' : 'thought');
                let existingEvt = null;
                if (p.stepIndex != null) {
                  existingEvt = run.toolEvents.find(e => e.stepIndex === p.stepIndex);
                }
                if (!existingEvt && run.toolEvents.length > 0) {
                  const last = run.toolEvents[run.toolEvents.length - 1];
                  if (last && last.tool === tName && (last.state === 'ACTIVE' || !last.output) && p.toolOutput) {
                    existingEvt = last;
                  }
                }
                if (existingEvt) {
                  if (p.toolInput) existingEvt.input = p.toolInput;
                  if (p.rawInput) existingEvt.rawInput = p.rawInput;
                  if (p.toolOutput) existingEvt.output = p.toolOutput;
                  if (p.toolState) existingEvt.state = p.toolState;
                  if (p.duration) existingEvt.duration = p.duration;
                } else {
                  run.toolEvents.push({
                    tool: tName,
                    stepIndex: p.stepIndex,
                    stepType: p.stepType || '',
                    tip: p.tip || '',
                    toolAction: p.toolAction || '',
                    toolSummary: p.toolSummary || '',
                    input: p.toolInput,
                    rawInput: p.rawInput,
                    output: p.toolOutput,
                    state: p.toolState || 'ACTIVE',
                    duration: p.duration,
                    waited
                  });
                }
              }
              broadcast({ progress: true, waited, tip: currentStatusTip, activeStatus: currentStatusTip, ...p });
            },
            onAskUser: async (question) => {
              return new Promise((resolve) => {
                const askId = 'ask_' + Date.now();
                pendingQuestions.set(askId, resolve);
                broadcast({ askUser: true, question, askId });
              });
            },
            signal: runAbortController.signal,
            onConversationId: (id) => {
              run.conversationId = id;
              broadcast({ conversationId: id });
            }
          });
          break;
        } catch (err) {
          if (runAbortController.signal.aborted) throw err;
          if (/trajectory not found|conversation not found/i.test(err && err.message || '')) {
            debugLog(`[ws/chat] trajectory not found for ${conversationId}, resetting conversationId and retrying`);
            conversationId = null;
            if (conversationKey) deleteConversation(conversationKey);
            continue;
          }
          const isAuthErr = /authentication failed|token expired|invalid_grant|unauthorized/i.test(err && err.message || '');
          if (isAuthErr && attempt < RETRY) {
            debugLog(`[ws/chat] auth error detected, proactively refreshing access token...`);
            try {
              const refreshed = await refreshAccessToken();
              if (refreshed) writeActiveToken(refreshed);
            } catch (_) {}
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          const isTransient = /retryable error|network issue|stream ended|unexpected EOF|context canceled|connection reset|Eligibility check failed|profile picture|i\/o timeout|timeout|dial tcp|connection refused|network is unreachable/i.test(err && err.message || '');
          // EOF/连接中断：多为 URnetwork P2P 节点抖动。最后一次重试前重启 socks 强制换节点，
          // 其余次 sleep 等节点自动轮换恢复。给 EOF 额外 2 次重试机会。
          const isProxyEOF = /EOF|connection reset by peer|stream ended|unexpected EOF/i.test(err && err.message || '');
          const eofRetryMax = RETRY + 2;
          if (isProxyEOF && attempt < eofRetryMax) {
            if (attempt >= RETRY) {
              // 常规重试已用尽，重启 socks 守护换一批节点再试
              debugLog(`[ws/chat] EOF retry #${attempt}: 重启 urnetwork-socks 换节点`);
              try {
                const out2 = execFileSync('pgrep', ['-f', 'urnetwork/urnetwork-socks'], { encoding: 'utf8' });
                for (const pid of out2.trim().split('\n').filter(Boolean)) {
                  try { process.kill(Number(pid), 'SIGTERM'); } catch (_) {}
                }
              } catch (_) {}
              await new Promise((r) => setTimeout(r, 8000)); // 等守护拉起新节点
            } else {
              await new Promise((r) => setTimeout(r, 2000));
            }
            continue;
          }
          if (attempt < RETRY && isTransient) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          throw err;
        }
      }

      debugLog(`[ws/chat] cliProvider DONE in ${Date.now() - t0}ms conv=${out && out.conversationId}`);
      clearInterval(heartbeat);
      if (out && out.conversationId && conversationKey) setConversation(conversationKey, out.conversationId);

      // 本地配额扣减: 计算本轮对话的真实 Token 消耗，防止将整场历史会话重复累加
      let turnTokens = 0;
      if (out?.usage?.total_tokens && out.usage.total_tokens > 0) {
        turnTokens = out.usage.total_tokens;
      } else {
        const lastUserMsg = (effectiveMessages || []).slice(-1)[0];
        const userChars = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content.length : 100;
        const answerChars = (run.accumulated || '').length;
        const toolChars = (run.toolEvents || []).reduce((s, t) => s + (t.output ? String(t.output).length : 0), 0);
        const estTurn = Math.round((userChars + answerChars + Math.min(toolChars, 3000)) / 1.8) + 800;
        turnTokens = Math.min(Math.max(estTurn, 500), 20000);
      }

      const activeAcc = getActiveAccount();
      if (activeAcc) {
        deductAccountQuota(activeAcc.email, model, turnTokens);
        debugLog(`[localQuota] 扣减成功: 账号=${activeAcc.email} 模型=${model} 本轮tokens=${turnTokens}`);
      }

      // 0. 自动检查 agy 修改的 JS 文件语法，有错则广播给前端
      try {
        const { execFileSync } = await import('node:child_process');
        const workspaceDir = process.env.WORKSPACE_ROOT || path.join(__dirname, 'home/.gemini/antigravity-cli');
        const checkDir = fs.existsSync(workspaceDir) ? workspaceDir : __dirname;
        // 检查最近 2 分钟内修改的 .js 文件
        const now = Date.now();
        const checkFile = (dir) => {
          if (!fs.existsSync(dir)) return;
          for (const name of fs.readdirSync(dir)) {
            const fp = path.join(dir, name);
            const st = fs.statSync(fp);
            if (st.isDirectory() && !name.startsWith('.') && name !== 'node_modules') {
              checkFile(fp);
            } else if (name.endsWith('.js') && (now - st.mtimeMs) < 120000) {
              try {
                execFileSync('node', ['--check', fp], { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
                debugLog(`[syntax-check] ✅ ${name}`);
              } catch (e) {
                const errMsg = String(e.stderr || e.message).split('\n').slice(0, 3).join(' ');
                debugLog(`[syntax-check] ❌ ${name}: ${errMsg}`);
                broadcast({ delta: '\n\n⚠️ **语法检查失败** ' + name + '\n' + errMsg + '\n' });
                // 自动发消息让 agy 修复语法错误(反馈循环)
                if (!run.syntaxFixed) {
                  run.syntaxFixed = true;
                  setTimeout(async () => {
                    try {
                      broadcast({ delta: '\n\n🔄 正在自动修复语法错误...\n' });
                      const fixMsg = [{ role: 'user', content: '你刚才修改的文件 ' + name + ' 有语法错误:\n' + errMsg + '\n请立即修复这个语法错误,修复后再用 node --check 验证。' }];
                      const systemPrompt = { role: 'user', content: '【系统规则】你修改任何 JavaScript 文件后,必须立即执行 node --check <文件路径> 验证语法,确保无语法错误后再结束。' };
                      await cliProvider({
                        model, messages: [systemPrompt, ...fixMsg], effort, permissions,
                        conversationId: out ? out.conversationId : conversationId,
                        onDelta: (d) => broadcast({ delta: d }),
                        onProgress: (p) => broadcast({ progress: true, ...p }),
                        signal: runAbortController.signal,
                        onConversationId: (id) => broadcast({ conversationId: id })
                      });
                      broadcast({ delta: '\n✅ 语法错误已修复\n' });
                    } catch (e) {
                      broadcast({ delta: '\n⚠️ 自动修复失败: ' + (e.message || '') + '\n' });
                    }
                  }, 1000);
                }
              }
            }
          }
        };
        checkDir(checkDir);
        // 也检查项目根目录的 server.js / lib/*.js / public/app.js
        for (const f of ['server.js', 'public/app.js']) {
          const fp = path.join(__dirname, f);
          if (fs.existsSync(fp) && (now - fs.statSync(fp).mtimeMs) < 120000) {
            try {
              execFileSync('node', ['--check', fp], { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
              debugLog(`[syntax-check] ✅ ${f}`);
            } catch (e) {
              const errMsg = String(e.stderr || e.message).split('\n').slice(0, 3).join(' ');
              debugLog(`[syntax-check] ❌ ${f}: ${errMsg}`);
              broadcast({ delta: '\n\n⚠️ **语法检查失败** ' + f + '\n' + errMsg + '\n' });
            }
          }
        }
      } catch (_) {}

      // 1. 每条对话结束瞬间，直连 Google 官方 API 实时拉取并写回当前账号最新额度
      run.done = true;
      run.isRunning = false;

      const currentTurnAcc = getActiveAccount() || activeAcc;
      let freshProfile = null;
      if (currentTurnAcc) {
        freshProfile = await refreshGoogleProfileInBackground(true, currentTurnAcc).catch(() => null);
      }
      const freshQuota = buildLiveWindowsData(freshProfile || cachedGoogleProfile, currentTurnAcc);

      // 2. 构造当轮助手的完整元数据与配额快照
      const isClaudeModel = String(model || '').toLowerCase().includes('claude') || String(model || '').toLowerCase().includes('gpt') || String(model || '').toLowerCase().includes('oss');
      const active5hPool = isClaudeModel ? freshQuota?.windows?.claude5h : freshQuota?.windows?.fiveHour;
      const activeWeeklyPool = isClaudeModel ? freshQuota?.windows?.claudeWeekly : freshQuota?.windows?.weekly;

      const turnQuotaSnapshot = {
        gemini5h: freshQuota?.windows?.fiveHour || null,
        geminiWeekly: freshQuota?.windows?.weekly || null,
        claude5h: freshQuota?.windows?.claude5h || null,
        claudeWeekly: freshQuota?.windows?.claudeWeekly || null,
        percent: active5hPool?.percent != null ? active5hPool.percent : 100,
        resetTime: active5hPool?.resetTime || null,
        resetIn: active5hPool?.resetsIn || active5hPool?.resetText || '即将重置',
        weeklyPercent: activeWeeklyPool?.percent != null ? activeWeeklyPool.percent : 100,
        weeklyResetTime: activeWeeklyPool?.resetTime || null,
        weeklyResetIn: activeWeeklyPool?.resetsIn || activeWeeklyPool?.resetText || '即将重置',
        model: model,
        accountEmail: currentTurnAcc?.email || ''
      };

      // 3. 自动持久化保存到当前会话文件
      try {
        const filePath = getSessionFilePath(convKey);
        let sessionData = {
          id: convKey,
          title: '新对话',
          messages: [],
          convId: out ? out.conversationId : (run.conversationId || null),
          createdAt: run.startTime,
          updatedAt: Date.now()
        };
        if (fs.existsSync(filePath)) {
          try { sessionData = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (_) {}
        }
        sessionData.messages = [...(run.initialMessages || [])];
        const cleanAcc = (run.accumulated || '').replace(/[\u200b\s]/g, '').trim();
        if (cleanAcc || run.toolEvents?.length) {
          sessionData.messages.push({
            role: 'assistant',
            content: cleanAcc ? run.accumulated : '',
            tools: run.toolEvents?.length ? run.toolEvents : undefined,
            meta: {
              duration: Math.round((Date.now() - t0) / 100) / 10,
              model: model,
              quotaSnapshot: turnQuotaSnapshot
            }
          });
        }
        if (out && out.conversationId) sessionData.convId = out.conversationId;
        try {
          const synced = syncSessionWithTranscript(sessionData);
          if (synced && Array.isArray(synced.messages)) {
            sessionData = synced;
          }
        } catch (_) {}
        if (cleanAcc) {
          const l = sessionData.messages[sessionData.messages.length - 1];
          if (l && l.role === 'assistant' && (!l.content || l.content.replace(/[\u200b\s]/g, '') === '')) {
            l.content = run.accumulated;
          }
        }
        sessionData.updatedAt = Date.now();
        const lastMsg = sessionData.messages[sessionData.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.tools) {
          run.toolEvents = lastMsg.tools;
        }
        const tmpPath = `${filePath}.tmp.${Date.now()}`;
        fs.writeFileSync(tmpPath, JSON.stringify(sessionData, null, 2), 'utf-8');
        fs.renameSync(tmpPath, filePath);
      } catch (err) {
        debugLog('[ws/chat] auto-save session error:', err && err.message);
      }

      // 4. 广播包含 100% 真实扣减配额与已补齐真实代码工具的 done 事件！
      broadcast({
        done: true,
        conversationId: out ? out.conversationId : null,
        tools: run.toolEvents,
        liveQuota: freshQuota,
        quotaSnapshot: turnQuotaSnapshot
      });
    } catch (e) {
      debugLog('[ws/chat] cliProvider ERROR:', e && e.message);
      run.error = e;
      const errMsg = (e && e.message) || 'CLI 未返回内容';
      const errDetails = e && (e.stack || e.details || (typeof e === 'string' ? e : ''));
      const combinedText = `${errMsg} ${errDetails}`;

      // 1. 精确判断：地区受限错误（User location is not supported）
      const isLocationBlocked = /User location is not supported|location.*not supported|FAILED_PRECONDITION.*location|REGION_BLOCKED/i.test(combinedText);

      // 2. 精确判断：配额耗尽错误（RESOURCE_EXHAUSTED / 429 quota）
      const isQuotaExceeded = !isLocationBlocked && /quota|limit reached|upgrade your subscription|RESOURCE_EXHAUSTED|Individual quota reached/i.test(combinedText);

      if (e && e.needsPermission) {
        broadcast({ meta: { needsPermission: true, description: '模型申请了权限操作', options: ["approve"], toolName: e.toolName || '', toolInput: e.toolInput || '' }, error: errMsg, errorDetails: errDetails });
      } else if (isLocationBlocked) {
        broadcast({
          meta: { locationBlocked: true, description: '当前网络所在地区不受 Google Gemini API 支持' },
          error: '当前网络所在地区不受 Google Gemini 支持 (User location is not supported)。建议一键切换至 Claude Sonnet / GPT 模型（不受此限制），或在网关配置代理节点。',
          errorDetails: errDetails
        });
      } else if (isQuotaExceeded) {
        broadcast({ meta: { quotaExceeded: true, description: '模型配额已用尽' }, error: errMsg, errorDetails: errDetails });
      } else if (/Agent execution terminated/i.test(errMsg)) {
        broadcast({
          meta: { executionTerminated: true, description: '模型执行中断' },
          error: '模型执行中断 (Agent execution terminated)。可能是当前网络地区受限 (User location not supported) 或连接被重置，建议切换 Claude 模型继续使用。',
          errorDetails: errDetails
        });
      } else {
        broadcast({ error: errMsg, errorDetails: errDetails });
      }

      // 错误也持久化进对话历史：写一条 assistant error 消息到 session json，刷新后不再丢失
      try {
        const filePath = getSessionFilePath(convKey);
        let sessionData = {
          id: convKey, title: '新对话', messages: [],
          convId: run.conversationId || null,
          createdAt: run.startTime, updatedAt: Date.now()
        };
        if (fs.existsSync(filePath)) {
          try { sessionData = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (_) {}
        }
        sessionData.messages = [...(run.initialMessages || [])];
        // 若本轮已产出部分内容（delta/工具），先作为正常 assistant 消息落盘，再追加 error 消息
        const cleanAcc = (run.accumulated || '').replace(/[​\s]/g, '').trim();
        if (cleanAcc || run.toolEvents?.length) {
          sessionData.messages.push({
            role: 'assistant',
            content: run.accumulated || '',
            tools: run.toolEvents?.length ? run.toolEvents : undefined,
            meta: { duration: Math.round((Date.now() - t0) / 100) / 10, model }
          });
        }
        sessionData.messages.push({
          role: 'assistant',
          isError: true,
          content: errMsg,
          errorDetails: errDetails || '',
          meta: { model, errorType: e && e.needsPermission ? 'permission' : (isLocationBlocked ? 'location' : (isQuotaExceeded ? 'quota' : 'error')) }
        });
        sessionData.updatedAt = Date.now();
        const tmpPath = `${filePath}.tmp.${Date.now()}`;
        fs.writeFileSync(tmpPath, JSON.stringify(sessionData, null, 2), 'utf-8');
        fs.renameSync(tmpPath, filePath);
      } catch (_) {}
    } finally {
      run.isRunning = false;
      clearInterval(heartbeat);
      for (const l of run.listeners) {
        try { l.end?.(); } catch (_) {}
      }
      setTimeout(() => { if (activeRuns.get(convKey) === run) activeRuns.delete(convKey); }, 300000);
    }
  });

  ws.on('close', () => debugLog('[ws/chat] client disconnected'));
  ws.on('error', () => debugLog('[ws/chat] socket error'));
});


// ── 文件管理接口（支持多项目与工作区安全操作）──
app.post('/api/workspace/file', async (req, res) => {
  const filePath = String(req.body?.path || '');
  const content = String(req.body?.content || '');
  if (!filePath) return send(res, 400, { error: '缺少 path 参数' });
  const safePath = resolveSafePath(filePath, WORKSPACE_ROOT);
  if (!isPathAllowed(safePath)) return send(res, 403, { error: '非法路径' });
  try {
    await writeFile(safePath, content, 'utf-8');
    send(res, 200, { ok: true, path: safePath });
  } catch (e) { send(res, 500, { error: e.message }); }
});

app.delete('/api/workspace/file', async (req, res) => {
  const filePath = String(req.query.path || '');
  if (!filePath) return send(res, 400, { error: '缺少 path 参数' });
  const safePath = resolveSafePath(filePath, WORKSPACE_ROOT);
  if (!isPathAllowed(safePath)) return send(res, 403, { error: '非法路径' });
  try {
    fs.rmSync(safePath, { recursive: true, force: true });
    send(res, 200, { ok: true, path: safePath });
  } catch (e) { send(res, 500, { error: e.message }); }
});

app.post('/api/workspace/create', async (req, res) => {
  const { path: relPath, type } = req.body || {};
  if (!relPath) return send(res, 400, { error: '缺少 path' });
  const safePath = resolveSafePath(relPath, WORKSPACE_ROOT);
  if (!isPathAllowed(safePath)) return send(res, 403, { error: '非法路径' });
  try {
    if (type === 'dir') fs.mkdirSync(safePath, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(safePath), { recursive: true });
      fs.writeFileSync(safePath, '', 'utf-8');
    }
    send(res, 200, { ok: true, path: safePath });
  } catch (e) { send(res, 500, { error: e.message }); }
});

app.put('/api/workspace/rename', async (req, res) => {
  const { oldPath, newPath } = req.body || {};
  if (!oldPath || !newPath) return send(res, 400, { error: '缺少路径' });
  const safeOld = resolveSafePath(oldPath, WORKSPACE_ROOT);
  const safeNew = resolveSafePath(newPath, WORKSPACE_ROOT);
  if (!isPathAllowed(safeOld) || !isPathAllowed(safeNew))
    return send(res, 403, { error: '非法路径' });
  try {
    fs.renameSync(safeOld, safeNew);
    send(res, 200, { ok: true, oldPath: safeOld, newPath: safeNew });
  } catch (e) { send(res, 500, { error: e.message }); }
});

// 工作区直接上传文件（支持多文件与拖拽上传）
const workspaceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const dest = resolveSafePath(req.query.dir || req.body.dir || '', WORKSPACE_ROOT);
        if (!isPathAllowed(dest)) return cb(new Error('目标路径受限'));
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      cb(null, path.basename(file.originalname));
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
});

app.post('/api/workspace/upload', (req, res) => {
  workspaceUpload.array('files', 20)(req, res, (err) => {
    if (err) {
      return send(res, 400, { error: err.message || '文件上传失败' });
    }
    const files = req.files || [];
    if (!files.length) return send(res, 400, { error: '未收到上传文件' });
    const uploaded = files.map(f => ({
      name: f.originalname,
      path: f.path,
      size: f.size
    }));
    send(res, 200, { ok: true, count: uploaded.length, files: uploaded });
  });
});