import { exec, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import crossSpawn from 'cross-spawn';

import {
  appendFilesInputTag,
  appendImagesInputTag,
  normalizeAttachmentDescriptors,
} from '@/shared/image-attachments.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import {
  createCompleteMessage,
  createNormalizedMessage,
  generateMessageId,
} from '@/shared/utils.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';
import { resolveAntigravityBinary } from './antigravity-auth.provider.js';
import { getProxyToggle, resolveAntigravityProxyEnv } from './antigravity-proxy.js';
import { antigravityAccountsService } from './antigravity-accounts.service.js';
import { localizeEnglishThought, humanizeAntigravityError } from './antigravity-chinese-filter.js';
export { localizeEnglishThought, humanizeAntigravityError };

const spawnFunction = crossSpawn;
const activeAntigravityProcesses = new Map<string, ChildProcess>();
const activeAbortControllers = new Map<string, AbortController>();

let lastProxyRestartTime = 0;

/**
 * Kills Antigravity CLI processes left over from a previous server lifecycle.
 *
 * Each run is spawned with `--print-timeout`, so a CLI whose turn ended does
 * NOT exit on its own — it waits for the next stdin prompt. The runtime
 * SIGKILLs it ~4s after a turn resolves, but that safety timer lives in the
 * server's event loop. If the server crashes or is restarted mid-run (EADDRINUSE,
 * supervisor respawn, a deploy), the timer is lost and the child is reparented
 * to init, lingering for the full print-timeout. On every fresh boot this scans
 * /proc and reaps orphans spawned with THIS binary, so they can never pile up.
 * Safe because at boot the new server has not spawned anything yet — every
 * matching process is, by definition, an orphan.
 */
function reapOrphanedAntigravityProcesses(): void {
  const binPath = resolveAntigravityBinary();
  if (!binPath) return;
  const realBinPath = fs.existsSync(binPath) ? fs.realpathSync(binPath) : binPath;
  let reapedCount = 0;
  try {
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (pid === process.pid) continue;
      let cmdline = '';
      try { cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8'); } catch { continue; }
      // cmdline is NUL-separated; rebuild contains() works across the whole string.
      if ((cmdline.includes(binPath) || cmdline.includes(realBinPath)) && cmdline.includes('--input-format')) {
        try {
          process.kill(pid, 'SIGKILL');
          reapedCount++;
        } catch { /* already gone */ }
      }
    }
    if (reapedCount > 0) {
      console.log(`[Antigravity Runtime] 🧹 启动清理: 成功回收 ${reapedCount} 个上代遗留孤儿 CLI 进程`);
    }
  } catch { /* /proc not available (non-Linux) — no-op */ }
}

// 禁用模块加载时顶层无差别强杀：防止在多会话或长任务执行时，误杀当前活跃进程与后台子任务
// reapOrphanedAntigravityProcesses();

function resolveAntigravityPermissionArgs(permissionMode?: string, skipPermissions?: boolean): string[] {
  if (skipPermissions || permissionMode === 'bypassPermissions' || permissionMode === 'auto') {
    return ['--dangerously-skip-permissions'];
  }
  switch (permissionMode) {
    case 'plan':
      return ['--mode', 'plan'];
    case 'accept-edits':
    case 'acceptEdits':
      return ['--mode', 'accept-edits'];
    case 'sandbox':
      return ['--sandbox'];
    default:
      // In web streaming non-interactive mode, auto-approve commands and edits
      // so tools do not hang waiting for interactive TTY prompts that never arrive.
      return ['--dangerously-skip-permissions'];
  }
}

function resolveAntigravityModelAndEffort(
  model?: string,
  effort?: string,
): { resolvedModel?: string; resolvedEffort?: string } {
  if (!model || typeof model !== 'string') {
    return { resolvedModel: undefined, resolvedEffort: undefined };
  }

  let resolvedModel = model.trim();
  let resolvedEffort =
    effort && typeof effort === 'string' && effort.toLowerCase() !== 'default' && effort.trim() !== ''
      ? effort.toLowerCase().trim()
      : undefined;

  // Handle legacy suffixes like gemini-3.8-flash-high -> gemini-3.8-flash
  const legacyMatch = resolvedModel.match(/^(.+)-(high|medium|low)$/);
  if (legacyMatch) {
    resolvedModel = legacyMatch[1];
    if (!resolvedEffort) {
      resolvedEffort = legacyMatch[2];
    }
  }

  // Antigravity CLI only supports --effort for gemini-* models.
  // Passing --effort to claude-* or gpt-* models causes CLI to exit with an error.
  const supportsEffort = resolvedModel.startsWith('gemini-');
  if (supportsEffort) {
    // 关键修复：Antigravity CLI 对所有 gemini-* 模型强制要求 --effort (low/medium/high)
    // 如果前端未指定或传入了 'default' / 空值，默认设定为 'high' (深度思考)
    if (!resolvedEffort || !['low', 'medium', 'high'].includes(resolvedEffort)) {
      resolvedEffort = 'high';
    }
    // gemini-3.1-pro 仅支持 high 和 low
    if (resolvedModel === 'gemini-3.1-pro' && resolvedEffort === 'medium') {
      resolvedEffort = 'high';
    }
  } else {
    resolvedEffort = undefined;
  }

  return { resolvedModel, resolvedEffort };
}

const CHINESE_LANGUAGE_RULE_CONTENT = `# Antigravity 全局语言与思维规范 (Global Language & Reasoning Guidelines)

无论在任何场景、处理何种任务或项目，必须严格执行以下准则：

## 1. 深度思考过程 (Thinking Process / Chain-of-Thought)
- **必须全程使用中文思考**：模型内部的所有思维推理过程（包括 <thinking> 内部的逻辑分析、推导演进、工具调用规划、风险研判与反思），**一律且必须使用中文**。
- **严禁英文思考**：除代码标识符、系统指令、函数名称或错误原文字符串外，禁止在思考过程中使用英文组织语言。

## 2. 回复与交互 (Output & Responses)
- **始终使用中文回复用户**：所有对用户的解释、总结、方案陈述、执行汇报均使用规范、流畅、通俗易懂的中文。
- **工具调用摘要**：所有工具调用的 toolAction 与 toolSummary 尽可能使用规范中文表达。
- **技术名词规范**：常见行业标准词汇（如 Git, Docker, API, JSON, SOCKS5, Token 等）可保留英文原词，其余文本一律使用中文。
`;

export const CHINESE_ENFORCEMENT_PREFIX = '【系统要求：本轮交互所有思维推理(<thinking>)与任务执行分析必须全程100%使用中文撰写，严禁使用任何英文组织思路】\n\n';


export function ensureChineseRules(workingDir?: string) {
  try {
    const homeDir = process.env.AGY_HOME || process.env.HOME || '/tmp/agy-test/home';
    const targetDirs = [
      homeDir,
      path.join(homeDir, '.gemini', 'config'),
      path.join(homeDir, '.gemini', 'antigravity-cli'),
    ];

    if (workingDir) {
      targetDirs.push(workingDir);
    }

    for (const dir of targetDirs) {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (_) {}
      }

      for (const filename of ['GEMINI.md', 'AGENTS.md']) {
        const filePath = path.join(dir, filename);
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, CHINESE_LANGUAGE_RULE_CONTENT, 'utf8');
        } else {
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            if (!content.includes('必须全程使用中文思考') && !content.includes('必须 100% 始终使用中文')) {
              fs.appendFileSync(filePath, '\n\n' + CHINESE_LANGUAGE_RULE_CONTENT, 'utf8');
            }
          } catch (_) {}
        }
      }
    }
  } catch (err: any) {
    console.warn('[Antigravity Runtime] ensureChineseRules error:', err?.message);
  }
}

type TurnAttemptParams = {
  command: string;
  workingDir: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  skipPermissions?: boolean;
  images?: unknown;
  files?: unknown;
  capturedSessionId: string | null;
  accumulatedText: string;
  ws: ProviderRuntimeWriter;
  currentSessionKey: string;
  abortSignal: AbortSignal;
  onSessionDiscovered: (id: string) => void;
  onTextDelta: (delta: string) => void;
  onFullText: (full: string) => void;
  onProcessSpawned: (proc: ChildProcess) => void;
};

type TurnAttemptResult = {
  exitCode: number;
  conversationId: string | null;
  usage?: AnyRecord;
  spawnedSubagentsCount?: number;
  lastAssistantContent?: string;
};

class QuotaExhaustedError extends Error {
  public resetTimeMsg?: string;
  public rawText?: string;
  constructor(message: string, resetTimeMsg?: string, rawText?: string) {
    super(message);
    this.name = 'QuotaExhaustedError';
    this.resetTimeMsg = resetTimeMsg;
    this.rawText = rawText;
  }
}

const CHINESE_RULES_CONTENT = `# Antigravity 全局语言与思维规范 (Global Language & Reasoning Guidelines)

无论在任何场景、处理何种任务或项目，必须严格执行以下准则：

## 1. 深度思考过程 (Thinking Process / Chain-of-Thought)
- **必须全程使用中文思考**：模型内部的所有思维推理过程（包括 <thinking> 内部的逻辑分析、推导演进、工具调用规划、风险研判与反思），**一律且必须使用中文**。
- **严禁英文思考**：除代码标识符、系统指令、函数名称或错误原文字符串外，禁止在思考过程中使用英文组织语言。

## 2. 回复与交互 (Output & Responses)
- **始终使用中文回复用户**：所有对用户的解释、总结、方案陈述、执行汇报均使用规范、流畅、通俗易懂的中文。
- **技术名词规范**：常见行业标准词汇（如 Git, Docker, API, JSON, SOCKS5, Token 等）可保留英文原词，其余文本一律使用中文。
`;

function ensureAntigravityGlobalRules(workingDir?: string): void {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp/agy-test/home';
    const targetDirs = [
      homeDir,
      path.join(homeDir, '.gemini'),
      path.join(homeDir, '.gemini', 'config'),
      path.join(homeDir, '.gemini', 'antigravity-cli'),
    ];

    if (workingDir && fs.existsSync(workingDir)) {
      targetDirs.push(workingDir);
    }

    for (const dir of targetDirs) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const ruleFile = path.join(dir, 'GEMINI.md');
        if (!fs.existsSync(ruleFile)) {
          fs.writeFileSync(ruleFile, CHINESE_RULES_CONTENT, 'utf8');
        } else {
          const content = fs.readFileSync(ruleFile, 'utf8');
          if (!content.includes('必须全程使用中文思考')) {
            fs.appendFileSync(ruleFile, '\n\n' + CHINESE_RULES_CONTENT, 'utf8');
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[Antigravity Runtime] ensureAntigravityGlobalRules error:', err);
  }
}

/**
 * Executes a single Antigravity CLI process turn.
 * Implements delta deduplication against \`accumulatedText\` so any re-generated text
 * from retries is smoothly deduplicated without emitting redundant tokens to the client.
 */
function runAntigravityTurnOnce(params: TurnAttemptParams): Promise<TurnAttemptResult> {
  return new Promise((resolve, reject) => {
    const {
      command,
      workingDir,
      model,
      effort,
      permissionMode,
      skipPermissions,
      images,
      files,
      capturedSessionId,
      accumulatedText,
      ws,
      currentSessionKey,
      abortSignal,
      onSessionDiscovered,
      onTextDelta,
      onFullText,
      onProcessSpawned,
    } = params;

    if (abortSignal.aborted) {
      reject(new Error('context canceled'));
      return;
    }

    // Ensure Chinese reasoning rules are permanently present in workspace and user configs
    ensureAntigravityGlobalRules(workingDir);

    const baseArgs = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      // 单回合最大执行超时放宽至 24 小时，彻底支持过夜挂机、深度自动化分析与超大工程重构
      '--print-timeout', process.env.AGY_PRINT_TIMEOUT || '24h',
    ];

    const isBoostCommand = Boolean(command && /^\/boost\b/i.test(command.trim()));
    const effectiveEffort = isBoostCommand ? 'high' : effort;

    const { resolvedModel, resolvedEffort } = resolveAntigravityModelAndEffort(model, effectiveEffort);
    if (resolvedModel) {
      baseArgs.push('--model', resolvedModel);
    }

    if (resolvedEffort && ['low', 'medium', 'high'].includes(resolvedEffort)) {
      baseArgs.push('--effort', resolvedEffort);
    }

    if (capturedSessionId) {
      baseArgs.push('--conversation', capturedSessionId);
    }

    const permArgs = resolveAntigravityPermissionArgs(permissionMode, skipPermissions);
    baseArgs.push(...permArgs);

    const BOOST_MODE_INSTRUCTION = `【🚀 Antigravity Boost 极致攻坚模式已激活】
你当前正处于 Boost 深度推演与高精度攻坚模式，请严格执行以下准则：
1. 【全链路自主推进】：针对用户需求进行全链路深度思考与多维度推演，全自主调度工具完成方案设计、代码编写、边界排查与自检验证，严禁只做一半就停止等待用户。
2. 【严格自检与零报错】：修改后必须主动使用运行命令、测试或静态检查工具验证成果，确保高质量无回归。
3. 【持续攻坚不中断】：若遇到中间工具报错或异常，必须自主反思并连续自愈推进，直到任务目标完全达成。`;

    let prompt = command || '';
    if (prompt && !prompt.includes(CHINESE_ENFORCEMENT_PREFIX)) {
      if (prompt.startsWith('/')) {
        // 如果输入以斜杠命令开头（如 /boost、/plan 等），保留第一行命令头以便 CLI 正确识别斜杠扩展
        const firstLineEnd = prompt.indexOf('\n');
        if (firstLineEnd !== -1) {
          const firstLine = prompt.slice(0, firstLineEnd);
          const rest = prompt.slice(firstLineEnd + 1);
          const boostSection = isBoostCommand ? `${BOOST_MODE_INSTRUCTION}\n\n` : '';
          prompt = `${firstLine}\n\n${boostSection}${CHINESE_ENFORCEMENT_PREFIX}${rest}`;
        } else {
          const boostSection = isBoostCommand ? `\n\n${BOOST_MODE_INSTRUCTION}` : '';
          prompt = `${prompt}${boostSection}\n\n${CHINESE_ENFORCEMENT_PREFIX}`;
        }
      } else {
        prompt = CHINESE_ENFORCEMENT_PREFIX + prompt;
      }
    }
    const hasAttachments =
      normalizeAttachmentDescriptors(images).length > 0 ||
      normalizeAttachmentDescriptors(files).length > 0;
    if (hasAttachments) {
      prompt = appendFilesInputTag(appendImagesInputTag(prompt, images), files);
    }

    const binPath = resolveAntigravityBinary();
    const childEnv = resolveAntigravityProxyEnv({
      ...process.env,
      HOME: process.env.AGY_HOME || process.env.HOME,
    });

    let antigravityProcess: ChildProcess;
    try {
      antigravityProcess = spawnFunction(binPath, baseArgs, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv,
      });
    } catch (err: any) {
      reject(err);
      return;
    }

    onProcessSpawned(antigravityProcess);

    let isSettled = false;
    let watchdogTimer: NodeJS.Timeout | null = null;
    let turnConversationId = capturedSessionId;
    let turnUsage: AnyRecord | undefined = undefined;
    let spawnedSubagentsCount = 0;

    const onAbort = () => {
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
      if (isSettled) return;
      isSettled = true;
      try { antigravityProcess.kill('SIGTERM'); } catch (_) {}
      reject(new Error('context canceled'));
    };
    abortSignal.addEventListener('abort', onAbort, { once: true });

    const finishSuccess = () => {
      if (isSettled) return;
      isSettled = true;
      abortSignal.removeEventListener('abort', onAbort);

      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }

      // 注意：绝不强制关闭 stdin 或强杀子进程，以保证子代理与长程推演的生命周期完整
      resolve({
        exitCode: 0,
        conversationId: turnConversationId,
        usage: turnUsage,
        spawnedSubagentsCount,
        lastAssistantContent: turnEmitted,
      });
    };

    let stdoutLineBuffer = '';
    let turnEmitted = '';
    let turnHasSucceeded = false;
    let lastStderrError = '';
    let quotaErrorDetails: { message: string; resetMsg?: string; rawText?: string } | null = null;
    const seenToolCallIds = new Set<string>();

    const processOutputLine = (line: string) => {
      if (!line || !line.trim()) return;

      // Parse JSON stream event
      let obj: AnyRecord;
      try {
        obj = JSON.parse(line);
      } catch {
        // Non-JSON line from stdout: capture as potential error or diagnostic text
        if (line.includes('ERROR') || line.includes('error') || line.includes('failed') || line.includes('RESOURCE_EXHAUSTED')) {
          lastStderrError = line.trim();
        }
        return;
      }

      const activeSession = turnConversationId || currentSessionKey;

      // Handle top-level error event
      if (obj.event === 'error' || (obj.error && obj.event !== 'result')) {
        const errText = String(obj.error || obj.message || 'Antigravity error');
        lastStderrError = errText;
        return;
      }

      // Handle 'init' event
      if (obj.event === 'init') {
        const initData = obj.init as AnyRecord | undefined;
        const convId = (obj.conversation_id as string) || (initData?.conversation_id as string);
        if (convId) {
          turnConversationId = convId;
          onSessionDiscovered(convId);
        }
        return;
      }

      // Handle 'step_update' event
      if (obj.event === 'step_update' && obj.step_update) {
        const update = obj.step_update as AnyRecord;
        const convId = update.conversation_id as string;
        if (convId) {
          turnConversationId = convId;
          onSessionDiscovered(convId);
        }

        const stepType = String(update.step_type || '').toLowerCase();
        const errText = String(update.error || (stepType.includes('error') ? update.content : '') || '');
        if (errText) {
          lastStderrError = errText;
        }

        const isQuotaErr =
          errText.includes('RESOURCE_EXHAUSTED') ||
          errText.includes('Individual quota reached') ||
          (typeof update.content === 'string' &&
            (update.content.includes('RESOURCE_EXHAUSTED') || update.content.includes('Individual quota reached')));

        if (isQuotaErr) {
          const rawErr = errText || String(update.content || '');
          const match = rawErr.match(/Resets in ([^).]+)/i);
          const resetDuration = match ? match[1].trim() : '';
          const resetMsg = resetDuration ? `，将在约 ${resetDuration} 后自动恢复` : '';
          const activeEmail = antigravityAccountsService.getActiveEmail();
          const others = antigravityAccountsService.getOtherAvailableAccounts(activeEmail || '');
          let suggestion = '';
          if (others.length > 0) {
            suggestion = `。检测到已配置备用账号（如 ${others[0].email}），系统即将全自动无缝轮换继续推进`;
          } else {
            suggestion = '。系统即将自动启动智能退避自愈重试';
          }
          const formattedMsg = `⚠️ 当前账号（${activeEmail || '当前账号'}）的模型短期请求速率已达到 Google 上限 (RESOURCE_EXHAUSTED 429)${resetMsg}${suggestion}。`;
          quotaErrorDetails = { message: formattedMsg, resetMsg: resetDuration, rawText: rawErr };
          try { antigravityProcess.kill('SIGTERM'); } catch (_) {}
          return;
        }

        // Tool calls and tool execution results
        const toolInfo = update.tool_info as AnyRecord | undefined;
        if (toolInfo && toolInfo.name) {
          if (toolInfo.name === 'invoke_subagent' || toolInfo.name === 'manage_subagents' || toolInfo.name === 'define_subagent') {
            spawnedSubagentsCount++;
          }
          const toolId = (update.tool_call_id as string) || generateMessageId('call');
          let parsedInput = toolInfo.parameters || toolInfo.input || toolInfo.args || {};
          if (typeof parsedInput === 'string') {
            try { parsedInput = JSON.parse(parsedInput); } catch (_) {}
          }

          if (!seenToolCallIds.has(toolId)) {
            seenToolCallIds.add(toolId);
            ws.send(createNormalizedMessage({
              kind: 'tool_use',
              toolName: String(toolInfo.name),
              toolInput: parsedInput,
              toolId,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
          }

          if (toolInfo.output || update.output || toolInfo.error || update.error || update.status === 'ERROR' || update.media || toolInfo.media) {
            const isError = Boolean(toolInfo.error || update.error || update.status === 'ERROR');
            const rawContent = toolInfo.error || update.error || toolInfo.output || update.output || '';
            let outStr = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

            // 实时提取底层返回的媒体图片并在聊天框展示
            const rawMedia = update.media || toolInfo.media || (update.result && (update.result as any).media);
            if (Array.isArray(rawMedia) && rawMedia.length > 0) {
              for (const m of rawMedia) {
                if (m?.uri && typeof m.uri === 'string') {
                  const isImg = !m.mime_type || m.mime_type.startsWith('image/');
                  if (isImg) {
                    outStr += `\n\n![生成的图片](${m.uri})\n`;
                  }
                }
              }
            }

            ws.send(createNormalizedMessage({
              kind: 'tool_result',
              toolName: String(toolInfo.name),
              toolId,
              toolResult: { content: outStr, isError },
              content: outStr,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
          }
          return;
        }

        // Non-tool error steps (transient retry warnings, etc.) — do not stream as user messages
        if (stepType === 'error_message' || stepType === 'error') {
          return;
        }


        // Thought / reasoning
        const thought = update.thought || update.thinking;
        if (thought && typeof thought === 'string' && thought.trim()) {
          ws.send(createNormalizedMessage({
            kind: 'thinking',
            content: thought.trim(),
            sessionId: activeSession,
            provider: 'antigravity',
          }));
        }

        // Text delta streaming with delta deduplication
        if (typeof update.text_delta === 'string' && update.text_delta) {
          const delta = update.text_delta;
          ws.send(createNormalizedMessage({
            kind: 'stream_delta',
            content: delta,
            text: delta,
            sessionId: activeSession,
            provider: 'antigravity',
          }));
          turnEmitted += delta;
          onTextDelta(delta);
        } else if (
          (!stepType || stepType === 'agent_response' || stepType === 'planner_response') &&
          typeof update.content === 'string' &&
          update.content &&
          !update.tool_info
        ) {
          const content = update.content;
          if (content.startsWith(turnEmitted) && content.length > turnEmitted.length) {
            const delta = content.slice(turnEmitted.length);
            ws.send(createNormalizedMessage({
              kind: 'stream_delta',
              content: delta,
              text: delta,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
            turnEmitted = content;
            onTextDelta(delta);
          } else if (!content.startsWith(turnEmitted) && content.length > 0) {
            ws.send(createNormalizedMessage({
              kind: 'stream_delta',
              content,
              text: content,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
            turnEmitted += content;
            onTextDelta(content);
          }
        }
        return;
      }

      // Handle 'result' or 'done' event
      if (obj.event === 'result' || obj.event === 'done') {
        const resObj = (obj.result as AnyRecord) || obj;
        const convId = resObj.conversation_id as string;
        if (convId) {
          turnConversationId = convId;
          onSessionDiscovered(convId);
        }

        if (resObj.usage) {
          turnUsage = resObj.usage as AnyRecord;
        }

        // Check full response in result payload
        if (typeof resObj.response === 'string' && resObj.response) {
          const full = resObj.response;
          if (full.startsWith(turnEmitted) && full.length > turnEmitted.length) {
            const delta = full.slice(turnEmitted.length);
            ws.send(createNormalizedMessage({
              kind: 'stream_delta',
              content: delta,
              text: delta,
              sessionId: activeSession,
              provider: 'antigravity',
            }));
            turnEmitted = full;
            onTextDelta(delta);
          }
        }

        if (resObj.status === 'ERROR' || resObj.error) {
          const errText = String(resObj.error || (typeof resObj.result === 'string' ? resObj.result : '') || 'Antigravity execution failed');
          lastStderrError = errText;
        } else {
          turnHasSucceeded = true;
          // Immediately resolve the turn without waiting for process exit cleanup (saves 2-3s delay)
          finishSuccess();
        }
      }
    };

    // Send user prompt via stdin
    if (prompt && antigravityProcess.stdin) {
      antigravityProcess.stdin.write(
        JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n'
      );
    }

    // 动态看门狗超时：Boost 或深度模式下放宽到 300 秒（5分钟），通用模式放宽到 120 秒（2分钟）
    let lastActivityTime = Date.now();
    const isBoostMode = Boolean(
      (command && /^\/boost\b/i.test(command.trim())) ||
      (command && /\[🚀.*Boost/i.test(command))
    );
    const isLongRunningMode = Boolean(
      isBoostMode ||
      (command && /^\/(goal|plan|schedule)\b/i.test(command.trim())) ||
      effectiveEffort === 'high'
    );
    const INACTIVITY_TIMEOUT_MS = isLongRunningMode ? 300_000 : 120_000;

    watchdogTimer = setInterval(() => {
      if (isSettled) {
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = null;
        }
        return;
      }
      const idleMs = Date.now() - lastActivityTime;
      if (idleMs > INACTIVITY_TIMEOUT_MS) {
        console.warn(`[Antigravity Runtime] 🚨 流活跃看门狗触发: 连续 ${Math.round(idleMs / 1000)} 秒无输出（底层卡在内部重试或断流），强行破局拉起自愈...`);
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = null;
        }
        lastStderrError = `stream was interrupted: inactivity watchdog triggered after ${Math.round(INACTIVITY_TIMEOUT_MS / 1000)}s`;
        if (getProxyToggle() === 'yes') {
          try {
            exec('pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true');
          } catch (_) {}
        }
        try {
          antigravityProcess.kill('SIGTERM');
        } catch (_) {}
      }
    }, 5_000);

    const stdoutDecoder = new StringDecoder('utf8');
    antigravityProcess.stdout?.on('data', (chunk: Buffer) => {
      lastActivityTime = Date.now();
      stdoutLineBuffer += stdoutDecoder.write(chunk);
      const lines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = lines.pop() || '';
      for (const line of lines) {
        processOutputLine(line.trim());
      }
    });

    antigravityProcess.stderr?.on('data', (chunk: Buffer) => {
      lastActivityTime = Date.now();
      const text = chunk.toString();
      console.error('[Antigravity CLI stderr]:', text);

      if (text.includes('ERROR') || text.includes('error') || text.includes('failed') || text.includes('RESOURCE_EXHAUSTED')) {
        lastStderrError = text.trim();
      }

      if (text.includes('RESOURCE_EXHAUSTED') || text.includes('Individual quota reached')) {
        const match = text.match(/Resets in ([^).]+)/i);
        const resetDuration = match ? match[1].trim() : '';
        const resetMsg = resetDuration ? `，将在约 ${resetDuration} 后自动恢复` : '';
        const activeEmail = antigravityAccountsService.getActiveEmail();
        const others = antigravityAccountsService.getOtherAvailableAccounts(activeEmail || '');
        let suggestion = '';
        if (others.length > 0) {
          suggestion = `。检测到已配置备用账号（如 ${others[0].email}），系统即将全自动无缝轮换继续推进`;
        } else {
          suggestion = '。系统即将自动启动智能退避自愈重试';
        }
        const errMsg = `⚠️ 当前账号（${activeEmail || '当前账号'}）的模型短期请求速率已达到 Google 上限 (RESOURCE_EXHAUSTED 429)${resetMsg}${suggestion}。`;
        quotaErrorDetails = { message: errMsg, resetMsg: resetDuration, rawText: text };
        try { antigravityProcess.kill('SIGTERM'); } catch (_) {}
      }

      // Check for P2P socks5 node drop / EOF: rotate urnetwork-socks if in proxy mode
      if (text.includes('EOF') || text.includes('unexpected EOF') || text.includes('stream ended') || text.includes('connection reset')) {
        const now = Date.now();
        if (getProxyToggle() === 'yes' && now - lastProxyRestartTime > 8000) {
          lastProxyRestartTime = now;
          console.warn('[Antigravity Runtime] Detected proxy EOF in stderr, triggering urnetwork-socks node rotation...');
          try {
            exec('pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true');
          } catch (_) {}
        }
      }
    });

    antigravityProcess.on('close', (code: number | null) => {
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
      if (isSettled) return;
      isSettled = true;
      abortSignal.removeEventListener('abort', onAbort);

      stdoutLineBuffer += stdoutDecoder.end();
      if (stdoutLineBuffer.trim()) {
        processOutputLine(stdoutLineBuffer.trim());
        stdoutLineBuffer = '';
      }

      if (quotaErrorDetails) {
        reject(new QuotaExhaustedError(quotaErrorDetails.message, quotaErrorDetails.resetMsg, quotaErrorDetails.rawText));
        return;
      }

      if (turnHasSucceeded || code === 0) {
        resolve({
          exitCode: 0,
          conversationId: turnConversationId,
          usage: turnUsage,
          spawnedSubagentsCount,
          lastAssistantContent: turnEmitted,
        });
        return;
      }

      const errToThrow = lastStderrError || `Antigravity CLI exited with code ${code}`;
      reject(new Error(errToThrow));
    });

    antigravityProcess.on('error', (err: Error) => {
      if (isSettled) return;
      isSettled = true;
      abortSignal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

/**
 * Orchestrates Antigravity CLI execution with outer auto-retry loop,
 * transparent self-healing for EOF and trajectory errors, and delta deduplication.
 */
export async function spawnAntigravity(
  command: string,
  options: AnyRecord = {},
  ws: ProviderRuntimeWriter,
  context: ProviderRuntimeContext
): Promise<unknown> {
  const {
    sessionId,
    projectPath,
    cwd,
    model,
    effort,
    sessionSummary,
    images,
    files,
    permissionMode,
    skipPermissions,
  } = options;

  const providerSessionId = context.resolveProviderSessionId(sessionId);
  const workingDir = cwd || projectPath || process.cwd();
  const processKey = sessionId || Date.now().toString();

  // Enforce Chinese reasoning rules in both global config and active project workspace
  ensureChineseRules(workingDir);

  let capturedSessionId = providerSessionId;
  let sessionCreatedSent = false;
  let accumulatedText = '';
  let terminalNotificationSent = false;
  const turnStartTime = Date.now();

  const abortController = new AbortController();
  activeAbortControllers.set(processKey, abortController);
  if (sessionId && sessionId !== processKey) {
    activeAbortControllers.set(sessionId, abortController);
  }

  const registerSession = (nextSessionId: string) => {
    if (!nextSessionId || capturedSessionId === nextSessionId) return;
    capturedSessionId = nextSessionId;

    if (ws.setSessionId && typeof ws.setSessionId === 'function') {
      ws.setSessionId(capturedSessionId);
    }

    if (!providerSessionId && !sessionCreatedSent) {
      sessionCreatedSent = true;
      ws.send(createNormalizedMessage({
        kind: 'session_created',
        newSessionId: capturedSessionId,
        sessionId: capturedSessionId,
        provider: 'antigravity',
      }));
    }
  };

  const notifyTerminalState = ({ code = null, error = null }: { code?: number | null; error?: string | null } = {}) => {
    if (terminalNotificationSent) return;
    terminalNotificationSent = true;

    const finalSessionId = sessionId || capturedSessionId || processKey;
    if (code === 0 && !error) {
      notifyRunStopped({
        userId: ws?.userId || null,
        provider: 'antigravity',
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        stopReason: 'completed',
      });
      return;
    }

    notifyRunFailed({
      userId: ws?.userId || null,
      provider: 'antigravity',
      sessionId: finalSessionId,
      sessionName: sessionSummary,
      error: error || `Antigravity CLI exited with code ${code}`,
    });
  };

  const cleanupProcessTracking = () => {
    activeAbortControllers.delete(processKey);
    activeAntigravityProcesses.delete(processKey);
    if (sessionId) {
      activeAbortControllers.delete(sessionId);
      activeAntigravityProcesses.delete(sessionId);
    }
    if (capturedSessionId) {
      activeAbortControllers.delete(capturedSessionId);
      activeAntigravityProcesses.delete(capturedSessionId);
    }
  };

  const MAX_RETRIES = 6;
  const EOF_EXTRA_RETRIES = 3;
  const QUOTA_EXTRA_RETRIES = 3;
  const TOTAL_MAX_ATTEMPTS = MAX_RETRIES + EOF_EXTRA_RETRIES + QUOTA_EXTRA_RETRIES; // 12

  let lastError = '';
  let finalResult: TurnAttemptResult | null = null;
  const exhaustedAccountsInTurn = new Set<string>();

  // Proactively ensure the active account's token is synchronized to disk and not expired
  try {
    await antigravityAccountsService.ensureActiveTokenFresh();
  } catch (err: any) {
    console.warn('[Antigravity Runtime] Pre-flight token sync warning:', err?.message);
  }

  let currentPrompt = command;

  try {
    for (let attempt = 1; attempt <= TOTAL_MAX_ATTEMPTS; attempt++) {
      if (abortController.signal.aborted) {
        throw new Error('context canceled');
      }

      try {
        const turnResult = await runAntigravityTurnOnce({
          command: currentPrompt,
          workingDir,
          model,
          effort,
          permissionMode,
          skipPermissions,
          images,
          files,
          capturedSessionId,
          accumulatedText,
          ws,
          currentSessionKey: capturedSessionId || sessionId || processKey,
          abortSignal: abortController.signal,
          onSessionDiscovered: (id: string) => {
            registerSession(id);
          },
          onTextDelta: (delta: string) => {
            accumulatedText += delta;
          },
          onFullText: (full: string) => {
            accumulatedText = full;
          },
          onProcessSpawned: (proc: ChildProcess) => {
            const key = capturedSessionId || sessionId || processKey;
            activeAntigravityProcesses.set(key, proc);
            if (sessionId && sessionId !== key) {
              activeAntigravityProcesses.set(sessionId, proc);
            }
          },
        });

        finalResult = turnResult;
        if (turnResult.conversationId) registerSession(turnResult.conversationId);
        break; // Turn completed successfully!
      } catch (err: any) {
        if (abortController.signal.aborted) throw err;

        if (err instanceof QuotaExhaustedError) {
          const currentSessionId = capturedSessionId || sessionId || null;
          console.warn(`[Antigravity Runtime] 🚨 触发 429 速率/配额限制 (回合尝试 ${attempt}/${TOTAL_MAX_ATTEMPTS})，保持当前账号启动智能时间退避自愈...`);

          // 保持当前账号不变，启动智能指数退避等待
          if (attempt < TOTAL_MAX_ATTEMPTS) {
            let waitSeconds = 15;
            const resetMatch = (err.resetTimeMsg || err.message || err.rawText || '').match(/(\d+(?:\.\d+)?)\s*(s|sec|seconds?)/i);
            if (resetMatch) {
              waitSeconds = Math.min(Math.ceil(parseFloat(resetMatch[1])) + 2, 60);
            } else {
              waitSeconds = Math.min(15 + (attempt - 1) * 10, 45);
            }

            console.warn(`[Antigravity Runtime] ⏳ 429 频控退避：保持当前账号，等待 ${waitSeconds} 秒后自动自愈续跑 (尝试 ${attempt}/${TOTAL_MAX_ATTEMPTS})...`);

            ws.send(createNormalizedMessage({
              kind: 'text',
              role: 'assistant',
              content: `⏳ **【429 速率限制智能退避】** 当前账号触发 Google API 短时频控限制，系统正在智能等待 **${waitSeconds} 秒** 后自动续跑，保持当前账号不变，请稍候无需操作...`,
              sessionId: currentSessionId,
              provider: 'antigravity',
            }));

            await new Promise((r) => setTimeout(r, waitSeconds * 1000));
            try {
              await antigravityAccountsService.ensureActiveTokenFresh();
            } catch (_) {}

            if (capturedSessionId) {
              currentPrompt = '继续';
            }
            continue;
          }

          // 重试耗尽后的兜底提示
          ws.send(createNormalizedMessage({
            kind: 'error',
            content: err.message,
            sessionId: currentSessionId,
            provider: 'antigravity',
          }));
          const completeMsg = createCompleteMessage({
            provider: 'antigravity',
            sessionId: currentSessionId,
            exitCode: 1,
          });
          ws.send(completeMsg);
          notifyTerminalState({ code: 1, error: err.message });
          cleanupProcessTracking();
          return { conversationId: capturedSessionId, exitCode: 1 };
        }

        const errMsg = String(err?.message || err || '');
        lastError = errMsg;

        // 1. Trajectory not found / conversation not found
        if (/trajectory not found|conversation not found/i.test(errMsg)) {
          console.warn(`[Antigravity Runtime] Trajectory ${capturedSessionId} not found, resetting conversationId and retrying turn fresh`);
          capturedSessionId = null;
          currentPrompt = command;
          continue;
        }

        // 2. Proactive auth refresh
        const isAuthErr = /authentication failed|token expired|invalid_grant|unauthorized/i.test(errMsg);
        if (isAuthErr && attempt < TOTAL_MAX_ATTEMPTS) {
          console.warn(`[Antigravity Runtime] Auth error detected on attempt ${attempt}, refreshing access token...`);
          try {
            await antigravityAccountsService.refreshAccessToken();
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }

        // 3. Stream Interrupted / Proxy EOF / Connection reset / Stream drop / Subscriber stalled / Google 403 WAF
        const isGoogleWaf403 = /code 403|Forbidden|robot\.png/i.test(errMsg);
        if (isGoogleWaf403 && attempt < TOTAL_MAX_ATTEMPTS) {
          console.warn(`[Antigravity Runtime] Google 403 WAF / IP block detected (attempt ${attempt}/${TOTAL_MAX_ATTEMPTS}), rotating proxy node and retrying...`);
          try {
            exec('pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true');
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 5000));
          if (capturedSessionId) {
            currentPrompt = '继续';
          }
          continue;
        }

        const isStreamInterrupted = /stream was interrupted|please continue the task|subscriber fell behind updates|stalled for|interrupted before the response finished/i.test(errMsg);
        const isProxyEOF = /EOF|connection reset by peer|stream ended|unexpected EOF|stream was interrupted|please continue the task|subscriber fell behind updates|stalled for|interrupted before the response finished/i.test(errMsg);
        if (isProxyEOF && attempt < TOTAL_MAX_ATTEMPTS) {
          const isProxy = getProxyToggle() === 'yes';
          if (isStreamInterrupted) {
            console.warn(`[Antigravity Runtime] Stream interrupted / stalled (attempt ${attempt}/${TOTAL_MAX_ATTEMPTS}). Auto-resuming seamlessly with '继续'...`);
            if (capturedSessionId) {
              currentPrompt = '继续';
            }
          }
          if (isProxy) {
            if (attempt >= 2) {
              console.warn(`[Antigravity Runtime] EOF/Interrupted retry #${attempt}: restarting urnetwork-socks to rotate nodes...`);
              try {
                exec('pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true');
              } catch (_) {}
              await new Promise((r) => setTimeout(r, 4000));
            } else {
              console.warn(`[Antigravity Runtime] EOF/Interrupted retry #${attempt}: waiting 2s for recovery...`);
              await new Promise((r) => setTimeout(r, 2000));
            }
          } else {
            console.warn(`[Antigravity Runtime] Direct mode stream retry #${attempt}: waiting 2s...`);
            await new Promise((r) => setTimeout(r, 2000));
          }
          continue;
        }

        // 4. Transient network / TLS / DNS / Handshake / Eligibility check errors
        const isTransient = /retryable error|network issue|stream ended|unexpected EOF|context canceled|connection reset|Eligibility check failed|profile picture|i\/o timeout|timeout|dial tcp|connection refused|network is unreachable/i.test(errMsg);
        if (isTransient && attempt < TOTAL_MAX_ATTEMPTS) {
          console.warn(`[Antigravity Runtime] Transient network error (attempt ${attempt}/${TOTAL_MAX_ATTEMPTS}): ${errMsg.slice(0, 100)}, retrying...`);
          if (getProxyToggle() === 'yes' && attempt >= 2) {
            try {
              exec('pkill -f "urnetwork/urnetwork-socks" 2>/dev/null || true');
            } catch (_) {}
            await new Promise((r) => setTimeout(r, 4000));
          } else {
            await new Promise((r) => setTimeout(r, 2000));
          }
          continue;
        }

        // Non-retryable error
        throw err;
      }
    }

    if (!finalResult) {
      throw new Error(lastError || 'Antigravity CLI execution failed after all retry attempts');
    }

    // 🚀【核心突破】：Boost 攻坚模式与子代理长程连续推进循环
    // 彻底根除“智能体只输出了一段规划或委派话语就停下来”的缺陷
    const isBoostModeCommand = Boolean(command && /^\/boost\b/i.test(command.trim()));
    let autonomousStep = 0;
    const MAX_AUTONOMOUS_STEPS = 6;

    while (autonomousStep < MAX_AUTONOMOUS_STEPS) {
      const hasActiveSubagents = Boolean(finalResult?.spawnedSubagentsCount && finalResult.spawnedSubagentsCount > 0);
      const outputText = (accumulatedText || '').trim();
      
      const isExplicitlyFinished =
        /已全部完成|全部任务已完成|修改与验证均已完成|全部目标已达成|测试全部通过/i.test(outputText) &&
        !hasActiveSubagents;

      // 如果不是 Boost 模式且没有子代理派生，或者模型已明确确认全部完工，则结束推进
      if (!isBoostModeCommand && !hasActiveSubagents) {
        break;
      }
      if (isExplicitlyFinished) {
        break;
      }

      autonomousStep++;
      console.log(`[Antigravity Runtime] 🚀 Boost/子代理长程攻坚推进中 (第 ${autonomousStep}/${MAX_AUTONOMOUS_STEPS} 阶段)...`);

      ws.send(createNormalizedMessage({
        kind: 'text',
        role: 'assistant',
        content: `\n\n> 🚀 **【Boost 持续攻坚推进 · 第 ${autonomousStep} 阶段】** 检测到子代理或长程任务正在演进，系统正在自动接力推进下一步方案落地与严格验证，无需手动输入...`,
        sessionId: capturedSessionId || sessionId || processKey,
        provider: 'antigravity',
      }));

      // 等待 4 秒让子代理或后台任务完成推进
      await new Promise((r) => setTimeout(r, 4000));

      const continuePrompt = '【🚀 Boost 系统自主推进指令】：请检查已派生子代理与当前工作区所有改动的最新执行进展。若子代理已完成或有更新，请立即提取其工作成果并自主完成下一阶段的方案设计、代码编写、排错与严格自检验证，直到所有需求彻底达成；若全部任务已完成，请给出明确的最终汇报。';

      try {
        const nextTurnResult = await runAntigravityTurnOnce({
          command: continuePrompt,
          workingDir,
          model,
          effort,
          permissionMode,
          skipPermissions,
          images,
          files,
          capturedSessionId,
          accumulatedText,
          ws,
          currentSessionKey: capturedSessionId || sessionId || processKey,
          abortSignal: abortController.signal,
          onSessionDiscovered: (id: string) => {
            registerSession(id);
          },
          onTextDelta: (delta: string) => {
            accumulatedText += delta;
          },
          onFullText: (full: string) => {
            accumulatedText = full;
          },
          onProcessSpawned: (proc: ChildProcess) => {
            const key = capturedSessionId || sessionId || processKey;
            activeAntigravityProcesses.set(key, proc);
            if (sessionId && sessionId !== key) {
              activeAntigravityProcesses.set(sessionId, proc);
            }
          },
        });

        finalResult = nextTurnResult;
        if (nextTurnResult.conversationId) registerSession(nextTurnResult.conversationId);
      } catch (stepErr: any) {
        console.warn('[Antigravity Runtime] 自主推进回合遇到异常，进入安全结算:', stepErr?.message);
        break;
      }
    }

    const durationSec = Math.round((Date.now() - turnStartTime) / 100) / 10;
    const cleanAcc = (accumulatedText || '').replace(/[\u200b\s]/g, '').trim();
    // Calculate per-turn tokens (avoid entire multi-turn trajectory history accumulating into a single deduction)
    const rawTurnTokens =
      (finalResult.usage as any)?.turn_tokens ||
      (finalResult.usage as any)?.output_tokens ||
      Math.max(1, Math.round(cleanAcc.length / 3.2));
    const tokens = Math.min(Math.max(rawTurnTokens, 200), 25000);
    const finalSessionId = capturedSessionId || sessionId || processKey;

    // 🚀【核心优化】对话完成：立即按本次消耗 tokens 与模型权重执行高精度配额扣减
    const fastQuota = antigravityAccountsService.deductLocalQuota(model, tokens) || antigravityAccountsService.getLiveQuotaCached();
    const completeMessage = createCompleteMessage({
      provider: 'antigravity',
      sessionId: finalSessionId,
      exitCode: 0,
    });
    if (finalResult.usage) {
      (completeMessage as AnyRecord).usage = finalResult.usage;
    }
    if (fastQuota) {
      (completeMessage as AnyRecord).quotaSnapshot = fastQuota;
    }
    (completeMessage as AnyRecord).meta = {
      model,
      duration: durationSec,
      tokens,
      quotaSnapshot: fastQuota || undefined,
    };
    ws.send(completeMessage);

    notifyTerminalState({ code: 0 });
    cleanupProcessTracking();

    // 🚀【核心优化】对话完成后，在后台异步拉取最新 Google 额度，刷新完成后推送 quota_update
    void (async () => {
      try {
        const activeAccount = await antigravityAccountsService.getActiveAccount();
        const targetEmail = activeAccount?.email || antigravityAccountsService.getActiveEmail() || undefined;
        const freshSnapshot = await antigravityAccountsService.fetchLiveQuotaSummary(true, targetEmail);
        if (freshSnapshot) {
          const snapshotWithModel = {
            ...freshSnapshot,
            model,
            tokens,
            duration: durationSec,
            updatedAt: Date.now(),
          };
          ws.send(createNormalizedMessage({
            kind: 'quota_update' as any,
            provider: 'antigravity',
            sessionId: finalSessionId,
            quotaSnapshot: snapshotWithModel,
          }));
        }
      } catch (e) {
        console.warn('[Antigravity Runtime] Background quota sync failed:', e);
      }
    })();

    return { conversationId: capturedSessionId, exitCode: 0 };
  } catch (err: any) {
    const finalSessionId = capturedSessionId || sessionId || processKey;
    const rawErrMsg = String(err?.message || lastError || 'Antigravity execution failed');

    // The CLI's own recoverable resume signal — "The stream was interrupted.
    // Please continue the task you were working on." — is not a failure: the
    // turn paused mid-stream and the next user message picks it back up. Only
    // this exact signal is softened; genuine failures (connection reset,
    // auth/token timeout, proxy EOF) stay fatal red errors below.
    const isRecoverableStreamPause = /stream was interrupted.*please continue|please continue the task|stream was interrupted|subscriber fell behind updates|stalled for|interrupted before the response finished/i.test(rawErrMsg);

    if (isRecoverableStreamPause) {
      if (!abortController.signal.aborted) {
        ws.send(createNormalizedMessage({
          kind: 'text',
          role: 'assistant',
          content: '上游连接发生抖动，已自动尝试多次续接。回复“继续”即可接着处理。',
          sessionId: finalSessionId,
          provider: 'antigravity',
        }));
      }
      ws.send(createCompleteMessage({
        provider: 'antigravity',
        sessionId: finalSessionId,
        exitCode: 0,
      }));
      notifyTerminalState({ code: 0 });
      cleanupProcessTracking();
      return { conversationId: capturedSessionId, exitCode: 0 };
    }

    const humanizedMsg = humanizeAntigravityError(rawErrMsg);

    if (!abortController.signal.aborted) {
      ws.send(createNormalizedMessage({
        kind: 'error',
        content: humanizedMsg,
        sessionId: finalSessionId,
        provider: 'antigravity',
      }));
    }

    ws.send(createCompleteMessage({
      provider: 'antigravity',
      sessionId: finalSessionId,
      exitCode: 1,
    }));

    notifyTerminalState({ code: 1, error: humanizedMsg });
    cleanupProcessTracking();
    throw err;
  }
}

export const antigravityRuntime: IProviderRuntime = {
  run(command: string, options: AnyRecord, writer: ProviderRuntimeWriter, context: ProviderRuntimeContext) {
    return spawnAntigravity(command, options, writer, context);
  },
  abort(sessionId: string): boolean {
    const controller = activeAbortControllers.get(sessionId);
    if (controller) {
      controller.abort();
    }
    const proc = activeAntigravityProcesses.get(sessionId);
    if (proc) {
      try { proc.kill('SIGTERM'); } catch (_) {}
      activeAntigravityProcesses.delete(sessionId);
      return true;
    }
    return Boolean(controller);
  },
};
