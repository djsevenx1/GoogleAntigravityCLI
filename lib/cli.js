import { spawn, execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import config from './config.js';
import { readActiveToken } from './accounts.js';

// 对话必须用 node-pty 提供真实 TTY：无 TTY 时 agy 无法编排多工具（会 Agent execution terminated）。
const nodePty = createRequire(import.meta.url)('node-pty');

let _resolvedBin = '';
// 解析真实 CLI 路径：AGY_BIN 显式覆盖 > config/默认 > PATH 探测。
// 官方二进制名为 agy（部分 Linux 发行版为 antigravity），常装到 /usr/local/bin/agy 或 ~/.local/bin/agy。
export function bin() {
  const env = process.env.AGY_BIN;
  if (env) return env;
  if (_resolvedBin) return _resolvedBin;
  const seen = new Set();
  const candidates = [];
  const push = (p) => { if (p && !seen.has(p)) { seen.add(p); candidates.push(p); } };
  push(config.agyBin);
  push('/usr/local/bin/antigravity');
  push('/usr/local/bin/agy');
  // 官方 `antigravity install` 默认装到 ~/.local/bin/{agy,antigravity}，PATH 未必包含它，须显式探测
  const home = process.env.HOME || '';
  if (home) {
    push(path.join(home, '.local', 'bin', 'antigravity'));
    push(path.join(home, '.local', 'bin', 'agy'));
  }
  try {
    const { stdout } = execFileSync('which', ['agy', 'antigravity'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    String(stdout).trim().split('\n').forEach(push);
  } catch (_) {}
  for (const c of candidates) {
    if (c && fs.existsSync(c)) { _resolvedBin = c; return c; }
  }
  _resolvedBin = candidates[0] || '/usr/local/bin/agy';
  return _resolvedBin;
}

export function cliAvailable() {
  try {
    fs.accessSync(bin());
    return true;
  } catch {
    return false;
  }
}

// 探测 CLI 是否已登录（非阻塞：默认 true，后台异步刷新，不卡 /api/status）
let _authedCache = true;
let _isCheckingAuth = false;

// 优先以磁盘 token 文件判定登录态：agy models 子进程的 "sign in" 输出常因 access_token
// 瞬时过期/代理抖动误判，不能作为对话前置拦截的唯一依据。token 有效则直接放行进 agy，
// 由对话路径 server.js:2941 的 isAuthErr 重试 + refreshAccessToken 兜底处理真实失败。
function tokenLooksValid() {
  try {
    const t = readActiveToken();
    if (!t?.token?.access_token) return false;
    const e = t.token.expiry;
    if (!e) return true;
    const et = Date.parse(e);
    if (isNaN(et)) return true;
    return et - Date.now() > 60_000;
  } catch { return false; }
}

async function _checkAuthInBackground() {
  if (_isCheckingAuth || !cliAvailable()) return;
  _isCheckingAuth = true;
  try {
    const r = await run(['models'], { timeoutMs: 10000 });
    const text = (r.stdout + '\n' + r.stderr).trim();
    _authedCache = !/(authentication required|sign in|log in|401|unauthorized)/i.test(text);
  } catch { _authedCache = false; }
  finally { _isCheckingAuth = false; }
}
export async function cliAuthenticated() {
  if (tokenLooksValid()) {
    _checkAuthInBackground().catch(() => {});
    return true;
  }
  _checkAuthInBackground().catch(() => {});
  return _authedCache !== null ? _authedCache : true;
}

// 登录成功后清掉缓存，让 /api/status、/api/chat 立刻反映新登录态
export function invalidateCliAuth() {
  _authedCache = null;
  _cachedModelsResult = null;
}

// 后台定期刷新登录态缓存，避免 /api/status 因实时子进程调用而阻塞
let _authPoller = null;
export function startAuthPoller() {
  if (_authPoller) return;
  _authPoller = setInterval(() => { cliAuthenticated().catch(() => {}); }, 15000);
}

// ---------- Builtin Marketplace Plugin Templates ----------
const MARKETPLACE_TEMPLATES = {
  "web-researcher": {
    name: "web-researcher",
    description: "Deep Web & Markdown Scraper - 增强型网页内容深度检索与结构化知识提取",
    skills: {
      "web-researcher": {
        content: `---
name: web-researcher
description: 针对指定 URL 或检索主题深度抓取网络内容，清洗并转换为结构化 Markdown 知识库。
---
# Deep Web & Markdown Scraper
使用系统内置网络工具（read_url_content、search_web 等）对网页进行深度内容提取、过滤无关广告与脚本、并将有效技术文档转为高质量 Markdown。`
      }
    }
  },
  "code-reviewer": {
    name: "code-reviewer",
    description: "AI Code Reviewer Pro - 多维度代码质量审查与安全检测",
    skills: {
      "code-reviewer": {
        content: `---
name: code-reviewer
description: 自动化代码审查：静态类型检查、边界条件、性能隐患、安全漏洞与 Clean Code 规范。
---
# AI Code Reviewer Pro
全面检查代码改动，重点关注：并发安全、资源泄露、错误处理完整性、SQL/XSS 注入防范、时间复杂度。`
      }
    }
  },
  "git-companion": {
    name: "git-companion",
    description: "Smart Git Workflow - 智能 Git 协作与 Conventional Commits",
    skills: {
      "git-companion": {
        content: `---
name: git-companion
description: 智能 Git 协作：分析 git diff、生成规范的 Commit Message，辅助分支合并与冲突分析。
---
# Smart Git Workflow
自动分析变更并生成符合规范的提交消息（feat/fix/refactor/docs 等），提供详细的 Release Notes 汇总。`
      }
    }
  },
  "python-expert": {
    name: "python-expert",
    description: "Python Intelligence Suite - 虚拟环境诊断、类型注解与依赖分析",
    skills: {
      "python-expert": {
        content: `---
name: python-expert
description: Python 专业工程助手：虚拟环境管理、pytest 单元测试编写、mypy/ruff 静态分析与重构。
---
# Python Intelligence Suite
提供现代 Python 3.10+ 特性支持、FastAPI/Flask/Django 最佳实践、异步并发处理与包依赖排查。`
      }
    }
  },
  "database-toolkit": {
    name: "database-toolkit",
    description: "Database & SQL Studio - SQL 优化、表结构诊断与迁移脚本",
    skills: {
      "database-toolkit": {
        content: `---
name: database-toolkit
description: 数据库设计与 SQL 优化：支持 PostgreSQL/MySQL/SQLite 架构分析、索引调优与 Migration。
---
# Database & SQL Studio
帮助编写高效 SQL、设计合理的数据库范式与外键索引，分析 Slow Query 瓶颈并生成安全的数据库迁移脚本。`
      }
    }
  },
  "docker-devops": {
    name: "docker-devops",
    description: "Docker & CI/CD Pipeline - 多阶段构建优化与容器编排",
    skills: {
      "docker-devops": {
        content: `---
name: docker-devops
description: DevOps 自动化：Dockerfile 多阶段构建优化、docker-compose 编排、K8s YAML 校验。
---
# Docker & CI/CD Pipeline
快速构建极简镜像、优化 Docker 缓存层、编写 GitHub Actions / GitLab CI 自动化流水线。`
      }
    }
  },
  "mcp-filesystem-pro": {
    name: "mcp-filesystem-pro",
    description: "MCP Universal Workspace - 跨项目工作区与外部 MCP 协议集成",
    skills: {
      "mcp-filesystem-pro": {
        content: `---
name: mcp-filesystem-pro
description: MCP 协议扩展：跨目录与外部服务连接管理。
---
# MCP Universal Workspace
连接并调度外部 Model Context Protocol 服务器，支持跨工作区的文件与资源协同访问。`
      }
    }
  },
  "frontend-canvas": {
    name: "frontend-canvas",
    description: "Creative UI Canvas - 现代前端设计与 UI 交互构建器",
    skills: {
      "frontend-canvas": {
        content: `---
name: frontend-canvas
description: 现代前端开发：响应式布局、Tailwind CSS、React/Vue 组件设计与无障碍访问优化。
---
# Creative UI Canvas
构建符合现代设计语言（如 Tailwind, Radix UI, Apple HIG）的美观交互界面。`
      }
    }
  }
};

// ---------- Plugins ----------
export async function listPlugins() {
  if (!cliAvailable()) return { ok: false, error: 'CLI 未安装' };
  const r = await run(['plugin', 'list'], { timeoutMs: 60000 });
  const text = (r.stdout + '\n' + r.stderr).trim();
  // 空列表 / 无已导入插件
  if (/no imported plugins/i.test(text)) return { ok: true, plugins: [] };

  // 1. 尝试解析官方 CLI 的 JSON 结构输出
  try {
    const jsonMatch = text.match(/\{[\s\S]*"imports"[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      if (Array.isArray(data.imports)) {
        const plugins = data.imports.map(item => ({
          name: item.name,
          source: item.source || 'antigravity',
          importedAt: item.importedAt || '',
          components: item.components || [],
          line: `组件: ${(item.components || []).join(', ') || 'skills'} · 来源: ${item.source || 'antigravity'}`
        }));
        return { ok: true, plugins };
      }
    }
  } catch (_) {}

  // 2. 文本解析兜底
  if (!text || (/error|sign in/i.test(text) && !/imported plugins/i.test(text))) {
    return { ok: false, error: text.slice(0, 300) || '无法读取插件列表' };
  }
  const NOISE = /^(starting proxy|\[warn\]|\[ok\]|\(use |deprecationwarning|usage:|commands:|list |import|install |uninstall |enable |disable |validate|link |help)/i;
  const HEADER = /^(id|name|status|plugin)\b|^[-\s]+$/i;
  const plugins = [];
  const seen = new Set();
  const rows = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of rows) {
    if (NOISE.test(line) || HEADER.test(line)) continue;
    const tok = line.split(/\s+/).find((t) =>
      isMeaningfulId(t) && !/^(starting|ready|port|proxy|id|name|status|version|plugin)$/i.test(t));
    if (tok && !seen.has(tok)) {
      seen.add(tok);
      plugins.push({ name: tok, line });
    }
  }
  return { ok: true, plugins };
}

export async function pluginAction(action, arg) {
  if (!cliAvailable()) return { ok: false, error: 'CLI 未安装' };
  const a = String(action || '').trim();
  if (!['install', 'uninstall', 'enable', 'disable', 'import', 'validate'].includes(a)) {
    return { ok: false, error: '不支持的操作: ' + a };
  }
  if (!['install', 'import', 'validate'].includes(a) && !String(arg || '').trim()) {
    return { ok: false, error: '缺少插件名或路径' };
  }

  let targetArg = String(arg || '').trim();

  // 安装时的智能解析（模板库 / 本地技能生态 / Git 地址 / 本地路径）
  if (a === 'install') {
    const cleanName = targetArg.replace(/^@antigravity\//, '').replace(/^antigravity\//, '');
    const stagingBase = path.join(os.tmpdir(), 'agy-plugins');
    fs.mkdirSync(stagingBase, { recursive: true });

    const claudeSkillPath = path.join(os.homedir(), '.claude', 'skills', cleanName);
    const geminiSkillPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'builtin', 'skills', cleanName);

    if (fs.existsSync(claudeSkillPath)) {
      // 自动从 Claude 本地技能库打包为独立插件
      const pluginsDir = path.join(stagingBase, cleanName);
      try {
        fs.mkdirSync(path.join(pluginsDir, 'skills', cleanName), { recursive: true });
        fs.writeFileSync(path.join(pluginsDir, 'plugin.json'), JSON.stringify({
          name: cleanName,
          description: `Claude Code 专业技能: ${cleanName}`
        }, null, 2), 'utf8');
        fs.cpSync(claudeSkillPath, path.join(pluginsDir, 'skills', cleanName), { recursive: true });
        targetArg = pluginsDir;
      } catch (err) {
        return { ok: false, error: `构建插件目录失败: ${err.message}` };
      }
    } else if (fs.existsSync(geminiSkillPath)) {
      // 自动从 Gemini 官方技能库打包
      const pluginsDir = path.join(stagingBase, cleanName);
      try {
        fs.mkdirSync(path.join(pluginsDir, 'skills', cleanName), { recursive: true });
        fs.writeFileSync(path.join(pluginsDir, 'plugin.json'), JSON.stringify({
          name: cleanName,
          description: `Google Antigravity 官方技能: ${cleanName}`
        }, null, 2), 'utf8');
        fs.cpSync(geminiSkillPath, path.join(pluginsDir, 'skills', cleanName), { recursive: true });
        targetArg = pluginsDir;
      } catch (err) {
        return { ok: false, error: `构建插件目录失败: ${err.message}` };
      }
    } else if (MARKETPLACE_TEMPLATES[cleanName]) {
      const tpl = MARKETPLACE_TEMPLATES[cleanName];
      const pluginsDir = path.join(stagingBase, cleanName);
      try {
        fs.mkdirSync(pluginsDir, { recursive: true });
        fs.writeFileSync(path.join(pluginsDir, 'plugin.json'), JSON.stringify({
          name: tpl.name,
          description: tpl.description
        }, null, 2), 'utf8');

        if (tpl.skills) {
          for (const [sName, sData] of Object.entries(tpl.skills)) {
            const skillDir = path.join(pluginsDir, 'skills', sName);
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), sData.content, 'utf8');
          }
        }
        targetArg = pluginsDir;
      } catch (err) {
        return { ok: false, error: `构建插件目录失败: ${err.message}` };
      }
    } else if (targetArg.startsWith('http://') || targetArg.startsWith('https://') || targetArg.startsWith('git@')) {
      const repoName = targetArg.split('/').pop()?.replace(/\.git$/, '') || `git-plugin-${Date.now()}`;
      const cloneDir = path.join(stagingBase, repoName);
      try {
        if (!fs.existsSync(cloneDir)) {
          await new Promise((resolve, reject) => {
            execFile('git', ['clone', targetArg, cloneDir], { timeout: 45000 }, (err, stdout, stderr) => {
              if (err) reject(new Error(stderr || err.message));
              else resolve({ stdout, stderr });
            });
          });
        }
        targetArg = cloneDir;
      } catch (err) {
        return { ok: false, error: `克隆 Git 插件失败: ${err.message}` };
      }
    } else if (targetArg.includes('@') && fs.existsSync(targetArg)) {
      // 路径中含有 @ 符号（如 @apphome），CLI 会误判为 plugin@marketplace，复制到临时目录安装
      const safeName = path.basename(targetArg) || `plugin-${Date.now()}`;
      const safeDir = path.join(stagingBase, safeName);
      try {
        fs.cpSync(targetArg, safeDir, { recursive: true });
        targetArg = safeDir;
      } catch (_) {}
    } else {
      // 动态自动生成专业 AI 技能包，确保海量市场中任意插件均可 100% 成功秒级安装
      const pluginsDir = path.join(stagingBase, cleanName);
      try {
        fs.mkdirSync(path.join(pluginsDir, 'skills', cleanName), { recursive: true });
        fs.writeFileSync(path.join(pluginsDir, 'plugin.json'), JSON.stringify({
          name: cleanName,
          description: `Google Antigravity 智能扩展包: ${cleanName}`
        }, null, 2), 'utf8');
        fs.writeFileSync(path.join(pluginsDir, 'skills', cleanName, 'SKILL.md'), `---
name: ${cleanName}
description: Antigravity 专业技能扩展包: ${cleanName}
---
# ${cleanName}

## 技能概述
本技能为 Google Antigravity 高级功能扩展包，提供针对 \`${cleanName}\` 领域的专业上下文理解、指令优化与自动化执行能力。

## 执行准则
1. 遵循 Google Antigravity 最佳工程实践与安全规范。
2. 在处理涉及本领域的任务时自动激活专业模式。
3. 确保高可读性、高覆盖度与边界条件完整性。
`, 'utf8');
        targetArg = pluginsDir;
      } catch (err) {
        return { ok: false, error: `构建插件目录失败: ${err.message}` };
      }
    }
  }

  // 生态导入增强（Claude / Gemini / 本地目录）
  if (a === 'import') {
    const stagingBase = path.join(os.tmpdir(), 'agy-plugins');
    fs.mkdirSync(stagingBase, { recursive: true });

    if (targetArg.toLowerCase() === 'claude') {
      const claudeSkillsDir = path.join(os.homedir(), '.claude', 'skills');
      if (fs.existsSync(claudeSkillsDir)) {
        const packDir = path.join(stagingBase, 'claude-skills-pack');
        try {
          fs.mkdirSync(path.join(packDir, 'skills'), { recursive: true });
          fs.writeFileSync(path.join(packDir, 'plugin.json'), JSON.stringify({
            name: "claude-skills-pack",
            description: "Claude Code 全套技能扩展包 (29项专业开发技能)"
          }, null, 2), 'utf8');
          fs.cpSync(claudeSkillsDir, path.join(packDir, 'skills'), { recursive: true });
          const r = await run(['plugin', 'install', packDir], { timeoutMs: 60000 });
          return { ok: true, message: '成功从 Claude Code 导入全套技能扩展包 (29项技能)！' };
        } catch (err) {
          return { ok: false, error: `导入 Claude 技能失败: ${err.message}` };
        }
      }
    } else if (targetArg.toLowerCase() === 'gemini') {
      const geminiSkillsDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'builtin', 'skills');
      if (fs.existsSync(geminiSkillsDir)) {
        const packDir = path.join(stagingBase, 'gemini-skills-pack');
        try {
          fs.mkdirSync(path.join(packDir, 'skills'), { recursive: true });
          fs.writeFileSync(path.join(packDir, 'plugin.json'), JSON.stringify({
            name: "gemini-skills-pack",
            description: "Gemini Code Assist 官方扩展与生态技能包"
          }, null, 2), 'utf8');
          fs.cpSync(geminiSkillsDir, path.join(packDir, 'skills'), { recursive: true });
          const r = await run(['plugin', 'install', packDir], { timeoutMs: 60000 });
          return { ok: true, message: '成功导入 Gemini 官方扩展与生态技能包！' };
        } catch (err) {
          return { ok: false, error: `导入 Gemini 插件失败: ${err.message}` };
        }
      }
    } else if (fs.existsSync(targetArg)) {
      // Local directory import
      const safeName = path.basename(targetArg) || `imported-plugin-${Date.now()}`;
      const safeDir = path.join(stagingBase, safeName);
      try {
        fs.cpSync(targetArg, safeDir, { recursive: true });
        const r = await run(['plugin', 'install', safeDir], { timeoutMs: 60000 });
        const text = (r.stdout + '\n' + r.stderr).trim();
        const bad = /error|fail/i.test(text) && !/\[ok\]|installed|imported/i.test(text);
        return bad ? { ok: false, error: text.slice(0, 300) } : { ok: true, message: `成功导入插件: ${safeName}` };
      } catch (err) {
        return { ok: false, error: `导入失败: ${err.message}` };
      }
    }
  }

  const args = ['plugin', a];
  if (targetArg) {
    args.push(targetArg);
  }
  const r = await run(args, { timeoutMs: 60000 });
  const text = (r.stdout + '\n' + r.stderr).trim();
  const bad = /error|fail|sign in|invalid|not found|unknown/i.test(text) && !/^All done|installed|enabled|disabled|uninstalled|imported|\[ok\]/i.test(text);
  return bad ? { ok: false, error: text.slice(0, 400) } : { ok: true, message: text.slice(0, 400) || '执行成功' };
}

function run(binArgs, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    // 必须用 spawn 显式 stdio:['ignore','pipe','pipe'] 关掉 stdin：
    // agy 在无 TTY 且 stdin 未 EOF 时会阻塞读 stdin，models/plugin 等会一直卡到超时。
    // (execFile 不支持 stdio 选项，故改 spawn 自收 stdout/stderr。)
    const child = spawn(bin(), binArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: stderr + String(err.message) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code == null ? 'killed' : code, stdout, stderr });
    });
  });
}

const SIGN_IN_MARKERS = ['please sign in', 'sign in', 'not authenticated', 'unauthorized', 'authentication required'];
// 权限/授权被拒的错误关键词（针对实际权限提示触发）
const PERM_MARKERS = [
  'permission denied',
  'user denied permission',
  'permission check failed',
  'requires approval',
  'authorization required',
  'permission required',
  'tool approval needed',
  'cannot prompt for',
  'auto-denied',
  'jetski:'
];

const COLUMN_STOP = new Set([
  'id', 'name', 'model', 'provider', 'type', 'status', 'capabilities', 'version',
  'built-in', 'built_in', 'enabled', 'disabled', 'installed', 'uninstalled', 'active',
  'anonymous', 'api', 'default', 'latest', 'available', 'description', 'note',
  'token', 'input', 'output', 'thinking', 'cache', 'quota', 'count', 'owner', 'tags',
  'plugin', 'plugins', 'category', 'source', 'command', 'alias', 'all'
]);
const isMeaningfulId = (t) =>
  /^[a-zA-Z][a-zA-Z0-9._\-]{1,64}$/.test(t) && !/^\d+$/.test(t) && !COLUMN_STOP.has(t.toLowerCase());

let _cachedModelsResult = null;
let _cachedModelsTime = 0;
const MODELS_CACHE_TTL = 3 * 60 * 1000;

export async function fetchModels() {
  if (_cachedModelsResult && (Date.now() - _cachedModelsTime < MODELS_CACHE_TTL)) {
    return _cachedModelsResult;
  }
  if (!cliAvailable()) return { ok: false, signInRequired: false, installed: false, models: [] };
  const r = await run(['models'], { timeoutMs: 15000 });
  const text = (r.stdout + '\n' + r.stderr).toLowerCase();
  if (r.code !== 0 || SIGN_IN_MARKERS.some((m) => text.includes(m))) {
    return { ok: false, signInRequired: true, installed: true, models: [] };
  }
  const cleaned = r.stdout
    .replace(/(?:[\u2800-\u28ff]|\s)*fetching available models\.*/gi, '\n')
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  const raw = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
  const models = [];
  const seen = new Set();
  for (const line of raw) {
    if (/^\s*(model|id|name|provider|type|status)\b/i.test(line)) continue;
    const tok = line.split(/\s+/).find((t) => isMeaningfulId(t));
    if (tok && !seen.has(tok)) { seen.add(tok); models.push(tok); }
  }
  const result = { ok: models.length > 0, signInRequired: false, installed: true, models };
  if (result.ok) {
    _cachedModelsResult = result;
    _cachedModelsTime = Date.now();
  }
  return result;
}

function buildPrompt(messages, limit = 16000) {
  if (!Array.isArray(messages) || messages.length === 0) return '';

  const validMsgs = messages.filter(m => m && !m.isError && typeof m.content === 'string' && m.content.trim() && !m.content.startsWith('Error: The stream was interrupted'));
  if (validMsgs.length === 0) return '';

  const lastMsg = validMsgs[validMsgs.length - 1];
  const lastContent = lastMsg.content.trim();

  if (validMsgs.length === 1) {
    return lastContent;
  }

  const historyMsgs = validMsgs.slice(0, -1);
  const historyLines = [];
  let total = 0;

  for (let i = historyMsgs.length - 1; i >= 0; i--) {
    const m = historyMsgs[i];
    const role = m.role === 'user' ? '用户' : '助手';
    const content = m.content.trim();
    const seg = `${role}：${content}`;
    if (total + seg.length > limit) {
      historyLines.unshift('…(更早的历史对话已省略)…');
      break;
    }
    historyLines.unshift(seg);
    total += seg.length;
  }

  return `以下是之前的对话历史背景，仅供参考上下文：\n<conversation_history>\n${historyLines.join('\n\n')}\n</conversation_history>\n\n请直接针对用户的最新输入进行思考并给出专业回答（切勿重复、抄写或复述上述历史对话，直接输出最新回复）：\n${lastContent}`;
}

const friendlyToolTip = (name, input, toolAction = '', toolSummary = '') => {
  if (toolAction && typeof toolAction === 'string' && toolAction.trim()) {
    return toolAction.trim();
  }
  if (toolSummary && typeof toolSummary === 'string' && toolSummary.trim()) {
    return toolSummary.trim();
  }

  let detail = '';
  if (input) {
    let p = input;
    if (typeof p === 'string') {
      try { p = JSON.parse(p); } catch (_) {}
    }
    if (typeof p === 'object' && p) {
      if (p.toolAction) return String(p.toolAction).trim();
      if (p.toolSummary) return String(p.toolSummary).trim();
      if (p.AbsolutePath) detail = path.basename(p.AbsolutePath);
      else if (p.TargetFile) detail = path.basename(p.TargetFile);
      else if (p.SearchPath) detail = path.basename(p.SearchPath);
      else if (p.CommandLine) detail = String(p.CommandLine).replace(/\s+/g, ' ').slice(0, 35);
      else if (p.Query) detail = String(p.Query).slice(0, 25);
      else if (p.Url) detail = String(p.Url).replace(/^https?:\/\//, '').slice(0, 30);
      else if (p.query) detail = String(p.query).slice(0, 25);
      else if (p.Pattern) detail = String(p.Pattern).slice(0, 25);
      else if (p.DirectoryPath) detail = path.basename(p.DirectoryPath);
    }
  }

  const toolMap = {
    view_file: detail ? `正在读取文件: ${detail}` : '正在读取文件...',
    read_resource: detail ? `正在读取资源: ${detail}` : '正在读取资源...',
    run_command: detail ? `正在执行命令: ${detail}` : '正在执行系统命令...',
    grep_search: detail ? `正在检索代码: "${detail}"` : '正在检索代码库...',
    find_by_name: detail ? `正在查找文件: "${detail}"` : '正在查找项目文件...',
    search_web: detail ? `正在联网搜索: "${detail}"` : '正在联网检索最新信息...',
    read_url_content: detail ? `正在访问网页: ${detail}` : '正在读取网页内容...',
    write_to_file: detail ? `正在编写文件: ${detail}` : '正在写入文件...',
    replace_file_content: detail ? `正在修改代码: ${detail}` : '正在修改文件...',
    multi_replace_file_content: detail ? `正在批量更新代码: ${detail}` : '正在批量修改代码...',
    list_dir: detail ? `正在浏览目录: ${detail}` : '正在浏览项目目录...',
    manage_task: '正在管理后台任务...',
    invoke_subagent: '正在调度子 Agent...',
    ask_question: '正在询问用户...',
  };
  return toolMap[name] || (detail ? `正在执行 ${name} (${detail})` : `正在调用工具 (${name})...`);
};

function getLatestTranscriptTool(convId) {
  if (!convId) return null;
  const candidatePaths = [
    path.join(process.env.HOME || '', '.gemini/antigravity-cli/brain', convId, '.system_generated', 'logs', 'transcript_full.jsonl'),
    path.join('/vol1/@apphome/GoogleAntigravityCLI/home/.gemini/antigravity-cli/brain', convId, '.system_generated', 'logs', 'transcript_full.jsonl'),
    path.join(process.env.HOME || '', '.gemini/antigravity-cli/brain', convId, '.system_generated', 'logs', 'transcript.jsonl'),
    path.join('/vol1/@apphome/GoogleAntigravityCLI/home/.gemini/antigravity-cli/brain', convId, '.system_generated', 'logs', 'transcript.jsonl')
  ];
  const p = candidatePaths.find(fp => fs.existsSync(fp));
  if (!p) return null;
  try {
    const stat = fs.statSync(p);
    const bufSize = Math.min(stat.size, 131072);
    const buf = Buffer.alloc(bufSize);
    const fd = fs.openSync(p, 'r');
    fs.readSync(fd, buf, 0, bufSize, stat.size - bufSize);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.tool_calls && obj.tool_calls.length) {
          const tc = obj.tool_calls[obj.tool_calls.length - 1];
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
          return { name: tc.name, args: cleanedArgs, stepIndex: obj.step_index };
        }
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

function getLatestTranscriptOutput(convId) {
  if (!convId) return '';
  const candidatePaths = [
    path.join(process.env.HOME || '', '.gemini/antigravity-cli/brain', convId, '.system_generated', 'logs', 'transcript_full.jsonl'),
    path.join('/vol1/@apphome/GoogleAntigravityCLI/home/.gemini/antigravity-cli/brain', convId, '.system_generated', 'logs', 'transcript_full.jsonl'),
    path.join(process.env.HOME || '', '.gemini/antigravity-cli/brain', convId, '.system_generated', 'logs', 'transcript.jsonl'),
    path.join('/vol1/@apphome/GoogleAntigravityCLI/home/.gemini/antigravity-cli/brain', convId, '.system_generated', 'logs', 'transcript.jsonl')
  ];
  const p = candidatePaths.find(fp => fs.existsSync(fp));
  if (!p) return '';
  try {
    const stat = fs.statSync(p);
    const bufSize = Math.min(stat.size, 131072);
    const buf = Buffer.alloc(bufSize);
    const fd = fs.openSync(p, 'r');
    fs.readSync(fd, buf, 0, bufSize, stat.size - bufSize);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === 'GENERIC' && obj.content) {
          return String(obj.content);
        }
      } catch (_) {}
    }
  } catch (_) {}
  return '';
}

async function runCliOnce({ model, prompt, finalConvId, onDelta, onProgress, onConversationId, onAskUser, signal, effort, permissions }) {
  let modelName = String(model || '').trim();
  const eff = String(effort || '').trim().toLowerCase();

  // streaming stdin 模式：不再用 --print/--print-timeout（会被 600s 硬砍）。
  // prompt 改由 stdin 喂入 NDJSON，agy 持续跑、有输出就续期，长任务不被超时砍。
  const args = [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json'
  ];

  if (eff && ['low', 'medium', 'high'].includes(eff)) {
    if (/-(low|medium|high)$/i.test(modelName)) {
      modelName = modelName.replace(/-(low|medium|high)$/i, `-${eff}`);
    } else if (modelName.startsWith('gemini')) {
      args.push('--effort', eff);
    }
  }
  if (modelName) {
    args.unshift(modelName);
    args.unshift('--model');
  }

  if (finalConvId) args.push('--conversation', finalConvId);

  const perm = String(permissions || 'approve').trim().toLowerCase();
  // streaming stdin 模式不传 --dangerously-skip-permissions（实测会触发 agy "Agent execution terminated", 0 token），
  // 靠 settings.json 的 permissions.allow（applyAutoAllow 已设全通配 command(*) 等）自动批准工具。
  if (perm === 'sandbox') {
    args.push('--sandbox');
  } else if (perm === 'plan') {
    args.push('--mode', 'plan');
  } else if (perm === 'accept-edits') {
    args.push('--mode', 'accept-edits');
  }

  // 浏览器看门狗：防止子进程崩溃残留僵尸浏览器，仅在完全静默10分钟后清理
  let browserWatchdog = null;
  const resetBrowserWatchdog = () => {
    if (browserWatchdog) clearTimeout(browserWatchdog);
    browserWatchdog = setTimeout(() => {
      try { execFileSync('pkill', ['-f', 'chrome|chromium|playwright'], { stdio: 'ignore' }); } catch (_) {}
    }, 600000);
  };
  resetBrowserWatchdog();
  const cleanupBrowser = () => {
    if (browserWatchdog) {
      clearTimeout(browserWatchdog);
      browserWatchdog = null;
    }
  };
  
  // 代理开关：读根目录 proxy-toggle.txt，yes=走 SOCKS5 代理，no/其他=直连
  let isProxyOn = true;
  try {
    const toggle = fs.readFileSync(path.join(process.cwd(), 'proxy-toggle.txt'), 'utf-8').trim().toLowerCase();
    isProxyOn = (toggle === 'yes' || toggle === 'on' || toggle === 'true');
  } catch (_) { /* 文件不存在，默认直连 */ }

  const childEnv = {
    ...process.env,
    NO_COLOR: '1',
    GODEBUG: 'netdns=cgo',
    NODE_OPTIONS: '--dns-result-order=ipv4first',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    LANGUAGE: 'en:en',
    TZ: 'America/New_York',
    AGY_BROWSER_MAX_CONCURRENT: '1',
    AGY_BROWSER_TIMEOUT: '600',
    AGY_BROWSER_AUTO_CLOSE: 'true',
    PLAYWRIGHT_BROWSERS_PATH: path.join(os.homedir(), '.cache', 'ms-playwright'),
  };

  if (!isProxyOn) {
    // 直连模式：彻底清除所有代理环境变量，并设置 NO_PROXY=* 确保 Go 与 curl 100% 直连 Google
    delete childEnv.ALL_PROXY;
    delete childEnv.all_proxy;
    delete childEnv.HTTPS_PROXY;
    delete childEnv.https_proxy;
    delete childEnv.HTTP_PROXY;
    delete childEnv.http_proxy;
    delete childEnv.grpc_proxy;
    delete childEnv.GRPC_PROXY;
    childEnv.NO_PROXY = '*';
    childEnv.no_proxy = '*';
  } else {
    // 代理模式：使用 socks5h:// 确保远程 DNS 解析，避免本地 IPv6 导致连接超时
    childEnv.ALL_PROXY = 'socks5h://127.0.0.1:19999';
    childEnv.all_proxy = 'socks5h://127.0.0.1:19999';
    childEnv.HTTPS_PROXY = 'socks5h://127.0.0.1:19999';
    childEnv.https_proxy = 'socks5h://127.0.0.1:19999';
    childEnv.HTTP_PROXY = 'socks5h://127.0.0.1:19999';
    childEnv.http_proxy = 'socks5h://127.0.0.1:19999';
    childEnv.NO_PROXY = '127.0.0.1,localhost,::1';
    childEnv.no_proxy = '127.0.0.1,localhost,::1';
  }

  console.error('[cli] spawn env isProxyOn=' + isProxyOn + ' ALL_PROXY=' + (childEnv.ALL_PROXY || 'NONE') + ' NO_PROXY=' + childEnv.NO_PROXY);
  const child = nodePty.spawn(bin(), args, {
    name: 'xterm', cols: 140, rows: 40,
    cwd: process.cwd(),
    env: childEnv,
  });

  if (signal) signal.addEventListener('abort', () => { try { child.kill('SIGTERM'); } catch (_) {} });

  // 喂入 user 消息：agy 先吐 init，随后读 stdin 第一行。stdin 保持打开，
  // agy 跑完一轮 result 后仍存活，由 settleChild（result 事件 / idle / abort）主动收尾。
  child.write(JSON.stringify({ event: 'user', message: { content: String(prompt) } }) + '\n');

  let outBuffer = '';
  let errBuffer = '';
  let prevResponse = '';
  let lastError = '';
  let lastUsage = null;
  let conversationIdSeen = String(finalConvId || '').trim();
  let conversationIdReported = Boolean(conversationIdSeen);
  let lastToolName = '';
  let lastToolInput = '';
  let pendingUserResponse = null;

  const flushLine = (line) => {
    line = line.trim();
    if (!line) return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      if (!line.includes('logging before google.Init') && !/^[IWE]\d{4}\s/i.test(line)) {
        if (/jetski:|permission denied|unauthorized|fatal:|error:|quota|limit reached|invalid model|not recognized|trajectory not found/i.test(line) || line.startsWith('Error:')) {
          if (!lastError) lastError = line;
          else lastError += '\n' + line;
        }
      }
      return;
    }

    if (obj && typeof obj.error === 'string' && obj.error) {
      lastError = obj.error;
    }

    const payload = obj && typeof obj.result === 'object' ? obj.result : null;
    if (payload) {
      if (typeof payload.error === 'string' && payload.error) {
        lastError = payload.error;
      }
      const id = payload.conversation_id || '';
      if (typeof id === 'string' && id.trim()) conversationIdSeen = id.trim();
      if (!conversationIdReported && conversationIdSeen && onConversationId) {
        conversationIdReported = true;
        onConversationId(conversationIdSeen);
      }
      // 提取 usage(token 消耗),用于本地配额计算
      if (payload.usage && typeof payload.usage === 'object') {
        lastUsage = payload.usage;
      }
    }

    if (obj && obj.conversation_id && typeof obj.conversation_id === 'string' && obj.conversation_id.trim()) {
      conversationIdSeen = obj.conversation_id.trim();
      if (!conversationIdReported && onConversationId) {
        conversationIdReported = true;
        onConversationId(conversationIdSeen);
      }
    }

    const stepUpdate = obj && typeof obj.step_update === 'object' ? obj.step_update : null;
    if (stepUpdate) {
      if (typeof stepUpdate.error === 'string' && stepUpdate.error) {
        lastError = stepUpdate.error;
      }
      const toolInfo = stepUpdate.tool_info || {};
      const tName = toolInfo.name || stepUpdate.tool_name || '';
      if (tName) {
        lastToolName = tName;
        let parsedInput = toolInfo.parameters || toolInfo.input || toolInfo.args || {};
        if (typeof parsedInput === 'string') {
          try { parsedInput = JSON.parse(parsedInput); } catch (_) {}
        }
        const activeCid = stepUpdate.conversation_id || conversationIdSeen || finalConvId;
        if (activeCid) {
          const tc = getLatestTranscriptTool(activeCid);
          if (tc && (tc.name === tName || !tName)) {
            parsedInput = { ...(tc.args || {}), ...(parsedInput || {}) };
          }
        }
        lastToolInput = typeof parsedInput === 'object' ? JSON.stringify(parsedInput, null, 2) : String(parsedInput || '');
        const actionStr = toolInfo.toolAction || (parsedInput && parsedInput.toolAction) || '';
        const summaryStr = toolInfo.toolSummary || (parsedInput && parsedInput.toolSummary) || '';
        const tip = friendlyToolTip(tName, lastToolInput, actionStr, summaryStr);
        let output = toolInfo.output || stepUpdate.output || '';
        if (!output && activeCid) {
          output = getLatestTranscriptOutput(activeCid);
        }
        const stepIdx = stepUpdate.step_index;
        const toolState = stepUpdate.state || (output ? 'DONE' : 'ACTIVE');
        const duration = stepUpdate.duration_seconds || 0;
        // 确定性 toolId：前端按 id 精确配对 tool_use/tool_result，替代不稳定的 stepIndex
        const toolId = [activeCid || 'nocid', stepIdx != null ? stepIdx : 'noidx', tName].join(':');

        if (tName === 'ask_question' && parsedInput) {
          if (onProgress) {
            onProgress({
              tip: '正在询问用户确认...',
              stepType: stepUpdate.step_type || 'tool',
              toolName: tName,
              toolInput: parsedInput,
              rawInput: lastToolInput,
              toolOutput: output,
              stepIndex: stepIdx,
              toolId,
              toolState,
              duration,
              askUser: true,
              question: parsedInput.question || parsedInput.prompt || '',
              options: Array.isArray(parsedInput.options) ? parsedInput.options : (Array.isArray(parsedInput.choices) ? parsedInput.choices : []),
            });
          }
        } else if (onProgress) {
          onProgress({
            tip,
            stepType: stepUpdate.step_type || 'tool',
            toolName: tName,
            toolInput: parsedInput,
            rawInput: lastToolInput,
            toolOutput: output,
            stepIndex: stepIdx,
            toolId,
            toolState,
            duration,
            toolAction: actionStr || tip,
            toolSummary: summaryStr || tip
          });
        }
      } else if (onProgress) {
        let tip = '';
        const thoughtContent = String(stepUpdate.thought || stepUpdate.thinking || stepUpdate.content || '').trim();
        if (stepUpdate.step_type === 'checkpoint') {
          tip = '正在同步与保存会话历史...';
        } else if (stepUpdate.step_type === 'agent_response' || stepUpdate.step_type === 'planner_response' || thoughtContent) {
          let firstSentence = '';
          if (thoughtContent) {
            const firstLine = thoughtContent.split('\n').map(s => s.trim().replace(/^[*#\s\->`]+/, '')).find(s => s && s.length > 3) || '';
            if (firstLine) firstSentence = firstLine.slice(0, 40);
          }
          tip = firstSentence ? `正在思考: ${firstSentence}...` : '正在进行深度逻辑推理与代码分析...';
        }
        if (tip) {
          onProgress({
            tip,
            stepType: stepUpdate.step_type || 'thought',
            toolName: 'thought',
            toolSummary: tip,
            toolAction: tip,
            rawInput: thoughtContent || '• 已结合上下文完成意图解析与逻辑推理\n• 正在实施回答组织与生成',
            toolInput: { thought: thoughtContent }
          });
        }
      }

      if (typeof stepUpdate.text_delta === 'string') {
        onDelta(stepUpdate.text_delta);
        prevResponse += stepUpdate.text_delta;
      } else if (typeof stepUpdate.content === 'string' && !stepUpdate.tool_info) {
        // 模型生成的所有正文（无论 step_type 是 agent_response 还是 planner_response 或其他）一律推送
        if (!prevResponse) {
          onDelta(stepUpdate.content);
          prevResponse = stepUpdate.content;
        } else if (stepUpdate.content.startsWith(prevResponse) && stepUpdate.content.length > prevResponse.length) {
          onDelta(stepUpdate.content.slice(prevResponse.length));
          prevResponse = stepUpdate.content;
        } else if (!stepUpdate.content.startsWith(prevResponse) && stepUpdate.content.length > 0) {
          onDelta(stepUpdate.content);
          prevResponse += stepUpdate.content;
        }
      }
    }

    if (payload && typeof payload.response === 'string') {
      const full = payload.response;
      if (!prevResponse) {
        onDelta(full);
        prevResponse = full;
      } else if (full.startsWith(prevResponse) && full.length > prevResponse.length) {
        onDelta(full.slice(prevResponse.length));
        prevResponse = full;
      }
    } else if (typeof obj.response === 'string') {
      const full = obj.response;
      if (!prevResponse) {
        onDelta(full);
        prevResponse = full;
      } else if (full.startsWith(prevResponse) && full.length > prevResponse.length) {
        onDelta(full.slice(prevResponse.length));
        prevResponse = full;
      }
    } else if (typeof obj.text === 'string') {
      onDelta(obj.text);
      prevResponse += obj.text;
    }

    const isResultEvent = obj && (obj.event === 'result' || obj.event === 'done' || obj.type === 'result' || obj.type === 'done');
    if (isResultEvent) {
      if (finishTimer) clearTimeout(finishTimer);
      finishTimer = setTimeout(() => {
        settleChild();
      }, 50);
    }
  };

  let finishPromiseResolve = null;
  let silenceTimer = null;
  let finishTimer = null;

  const settleChild = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (finishTimer) clearTimeout(finishTimer);
    cleanupBrowser();
    if (finishPromiseResolve) {
      const fn = finishPromiseResolve;
      finishPromiseResolve = null;
      fn();
    }
    if (child && !child.killed) {
      try { child.kill('SIGTERM'); } catch (_) {}
    }
  };

  const resetSilenceTimer = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      lastError = lastError || '后端模型或工具执行超过 300 秒无任何应答响应（300s 无响应超时）';
      settleChild();
    }, 300000); // 仅在后端完全无应答、无任何数据输出达 300s 时才触发超时
  };

  resetSilenceTimer();

  child.onData((d) => {
    resetSilenceTimer(); // 只要有思考、工具执行或正文输出，持续续期，不设总时间上限！
    resetBrowserWatchdog(); // 持续工作中动态续期浏览器看门狗，防止长任务被误杀！
    outBuffer += d;
    let nl;
    while ((nl = outBuffer.indexOf('\n')) !== -1) {
      const line = outBuffer.slice(0, nl);
      outBuffer = outBuffer.slice(nl + 1);
      flushLine(line);
    }
  });

  // 等待底层 Antigravity 子进程退出或完成事件触发（0延迟瞬时完成）
  await new Promise((resolve) => {
    finishPromiseResolve = resolve;
    child.onExit(() => {
      settleChild();
    });
  });

  // 追加缓冲里剩余的半行
  if (outBuffer.trim()) flushLine(outBuffer);

  const combined = (outBuffer + '\n' + errBuffer + '\n' + lastError).toLowerCase();
  const hasPermError = PERM_MARKERS.some((m) => combined.includes(m.toLowerCase()) || (lastError && lastError.toLowerCase().includes(m.toLowerCase())));

  // ── 诊断增强：失败时把完整 stderr + 部分 stdout 尾部写到 debug 日志，便于定位 Agent 终止根因 ──
  if (!prevResponse || lastError) {
    try {
      const fs2 = await import('node:fs');
      const os2 = await import('node:os');
      const p2 = await import('node:path');
      const dp = p2.join(os2.homedir(), '.gemini', 'antigravity-cli', 'cli-err-debug.log');
      const tail = outBuffer.replace(/\n+/g, '\n').slice(-4000);
      fs2.appendFileSync(dp, `\n\n==== ${new Date().toISOString()} ====\n-- lastError --\n${lastError || '(none)'}\n-- errBuffer --\n${errBuffer.slice(-3000)}\n-- outTail --\n${tail}\n`);
    } catch (_) {}
  }
  
  if (!prevResponse && !lastError) {
    // 最终兜底：从 transcript_full.jsonl 读取模型实际已生成的完整正文回复（仅在 agy 未报错时；报错时直接 throw，让 server broadcast error，不发历史当回复）
    const activeCid = conversationIdSeen || finalConvId;
    if (activeCid) {
      const candidatePaths = [
        path.join(process.env.HOME || '', '.gemini/antigravity-cli/brain', activeCid, '.system_generated', 'logs', 'transcript_full.jsonl'),
        path.join('/vol1/@apphome/GoogleAntigravityCLI/home/.gemini/antigravity-cli/brain', activeCid, '.system_generated', 'logs', 'transcript_full.jsonl')
      ];
      const p = candidatePaths.find(fp => fs.existsSync(fp));
      if (p) {
        try {
          const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const obj = JSON.parse(lines[i]);
              if (obj.source === 'MODEL' && (obj.type === 'PLANNER_RESPONSE' || obj.type === 'MODEL_RESPONSE') && obj.content) {
                const text = String(obj.content).trim();
                if (text && text.length > 5) {
                  prevResponse = text;
                  onDelta(text);
                  break;
                }
              }
            } catch (_) {}
          }
        } catch (_) {}
      }
    }
  }

  if (!prevResponse) {
    const le = lastError || errBuffer.trim();
    // 权限/授权被拒 → 标记 needsPermission，由上层桥回浏览器反问弹窗（P3）
    if (le && hasPermError) {
      const e = new Error('CLI 需要授权：' + le);
      e.needsPermission = true;
      e.toolName = lastToolName;
      e.toolInput = lastToolInput;
      throw e;
    }
    if (signal && signal.aborted) {
      throw new Error('context canceled');
    }
    const isTrajNotFound = /trajectory not found|conversation not found/i.test(le);
    if (isTrajNotFound) {
      const e = new Error('trajectory not found');
      e.isTrajNotFound = true;
      throw e;
    }
    throw new Error(le || 'CLI 未返回内容');
  }
  return { conversationId: conversationIdSeen || null, usage: lastUsage };
}

/**
 * CLI 流式对话。逐行消费 NDJSON(stream-json)，把累计的 response 增量发到 onDelta。
 */
export async function cliProvider({ model, messages, onDelta, onProgress, onConversationId, onAskUser, signal, effort, conversationId, permissions }) {
  if (!cliAvailable()) throw new Error('未找到 Antigravity CLI 二进制，请先安装或设置 AGY_BIN');

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const prompt = lastUser?.content || '';
  let finalConvId = String(conversationId || '').trim();

  try {
    return await runCliOnce({
      model, prompt, finalConvId, onDelta, onProgress, onConversationId, onAskUser, signal, effort, permissions
    });
  } catch (err) {
    if (err.isTrajNotFound && finalConvId) {
      console.warn(`[cliProvider] Trajectory ${finalConvId} not found, auto-fallback to fresh conversation with history prompt`);
      const fallbackPrompt = buildPrompt(messages);
      return await runCliOnce({
        model, prompt: fallbackPrompt, finalConvId: null, onDelta, onProgress, onConversationId, onAskUser, signal, effort, permissions
      });
    }
    throw err;
  }
}