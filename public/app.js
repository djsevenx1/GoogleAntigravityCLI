function formatDynamicCountdown(isoString, fallbackText) {
  if (isoString) {
    const target = new Date(isoString).getTime();
    if (!isNaN(target)) {
      const diff = target - Date.now();
      if (diff > 60 * 1000) {
        const d = Math.floor(diff / (24 * 3600 * 1000));
        const rem = diff % (24 * 3600 * 1000);
        const h = Math.floor(rem / (3600 * 1000));
        const m = Math.floor((rem % (3600 * 1000)) / (60 * 1000));
        if (d > 0) return `${d}天 ${h}小时`;
        if (h > 0) return `${h}小时 ${m}分钟`;
        return `${m}分钟`;
      } else if (diff > 0) {
        return '即将重置';
      }
    }
  }
  if (fallbackText && fallbackText !== '查询中' && fallbackText !== '计算中...' && fallbackText !== '计算中') {
    return fallbackText;
  }
  return '即将重置';
}

// ── 格式化高精度倒计时标签 (如 "1天13h", "4h 50m", "即将重置") ──
function formatPreciseTimeTag(str) {
  if (!str) return '即将重置';
  const s = String(str).trim();
  if (s === '即将重置' || s.includes('即将')) return '即将重置';
  const mDayHour = s.match(/(\d+)\s*天\s*(?:(\d+)\s*小时)?/);
  if (mDayHour) {
    const d = mDayHour[1];
    const h = mDayHour[2];
    return h && h !== '0' ? `${d}天${h}h` : `${d}天`;
  }
  const mHourMin = s.match(/(?:(\d+)\s*小时)?\s*(?:(\d+)\s*分钟)?/);
  if (mHourMin && (mHourMin[1] || mHourMin[2])) {
    const h = mHourMin[1];
    const m = mHourMin[2];
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    if (m) return `${m}m`;
  }
  return s;
}

// ── 生成每条助手对话底部的模型用量与实时双进度条组件 ──
function getMessageQuotaFooterHtml(contentStr, meta, currentModel) {
  const modelId = String(meta?.model || currentModel || state.selectedModel || '').toLowerCase();
  const isClaude = modelId.includes('claude');
  const isGpt = modelId.includes('gpt') || modelId.includes('oss');
  const isGemini = !isClaude && !isGpt;
  
  const seriesClass = isClaude ? 'claude' : isGpt ? 'gpt' : 'gemini';
  const seriesIcon = isClaude ? 'sparkles' : isGpt ? 'bot' : 'zap';
  const modelName = formatModelShortName(meta?.model || currentModel || state.selectedModel);
  const durText = meta?.duration ? `${meta.duration}s` : '';
  const cleanLen = (contentStr || '').replace(/[\u200b\s]/g, '').length;
  const tokens = meta?.tokens || Math.max(1, Math.round(cleanLen / 3.2));

  // 1. 优先读取已固化的当轮历史快照，并动态计算重置倒计时（严格分离 5h 与 Weekly 字段）
  const snap = meta?.quotaSnapshot;
  const pool5h = isGemini ? snap?.gemini5h : snap?.claude5h;
  const poolWeekly = isGemini ? snap?.geminiWeekly : snap?.claudeWeekly;

  let h5Pct = pool5h?.percent ?? snap?.percent;
  let h5ResetTime = pool5h?.resetTime ?? snap?.resetTime;
  let h5ResetFallback = pool5h?.resetsIn || pool5h?.resetText || pool5h?.resetIn || snap?.resetIn || snap?.resetText;
  let h5Reset = h5ResetTime ? formatDynamicCountdown(h5ResetTime, h5ResetFallback) : h5ResetFallback;

  let weeklyPct = poolWeekly?.percent ?? snap?.weeklyPercent;
  let weeklyResetTime = poolWeekly?.resetTime ?? snap?.weeklyResetTime;
  let weeklyResetFallback = poolWeekly?.resetsIn || poolWeekly?.resetText || poolWeekly?.resetIn || snap?.weeklyResetIn || snap?.weeklyResetText;
  let weeklyReset = weeklyResetTime ? formatDynamicCountdown(weeklyResetTime, weeklyResetFallback) : weeklyResetFallback;

  // 2. 实时从 state.latestUsageData 抓取真实最新数据补齐（若快照中缺失周度数据）
  const quota = state.latestUsageData?.windows || {};
  if (isGemini) {
    const w = quota.fiveHour;
    if (w && w.percent != null) {
      if (h5Pct == null) h5Pct = w.percent;
      if (!h5Reset || h5Reset === '即将重置') h5Reset = formatDynamicCountdown(w.resetTime, w.resetsIn || w.resetText);
    }
    const ww = quota.weekly;
    if (ww && ww.percent != null) {
      if (weeklyPct == null) weeklyPct = ww.percent;
      if (!weeklyReset || weeklyReset === '即将刷新' || weeklyReset === h5Reset) weeklyReset = formatDynamicCountdown(ww.resetTime, ww.resetsIn || ww.resetText);
    }
  } else {
    const w = quota.claude5h;
    if (w && w.percent != null) {
      if (h5Pct == null) h5Pct = w.percent;
      if (!h5Reset || h5Reset === '即将重置') h5Reset = formatDynamicCountdown(w.resetTime, w.resetsIn || w.resetText);
    }
    const ww = quota.claudeWeekly;
    if (ww && ww.percent != null) {
      if (weeklyPct == null) weeklyPct = ww.percent;
      if (!weeklyReset || weeklyReset === '即将刷新' || weeklyReset === h5Reset) weeklyReset = formatDynamicCountdown(ww.resetTime, ww.resetsIn || ww.resetText);
    }
  }

  // 3. 容错默认值
  if (h5Pct == null) h5Pct = 100;
  if (!h5Reset) h5Reset = '即将重置';
  if (weeklyPct == null) weeklyPct = 100;
  if (!weeklyReset) weeklyReset = '即将刷新';

  const h5FillClass = isClaude ? 'claude' : isGpt ? 'gpt' : 'gemini';
  const poolLabel = isGemini ? 'Gemini 5h' : 'Claude/GPT 5h';
  const h5ResetPrecise = formatPreciseTimeTag(h5Reset);
  const weeklyResetPrecise = formatPreciseTimeTag(weeklyReset);

  return `
    <div class="msg-usage-pill" title="点击打开 Google AI Pro 模型用量与配额中心">
      <div class="msg-usage-left">
        <span class="msg-model-tag ${seriesClass}">
          <i data-lucide="${seriesIcon}" style="width:11px;height:11px;"></i>
          <span>${escapeHtml(modelName)}</span>
        </span>
        <span>·</span>
        <span>${tokens} tokens</span>
        ${durText ? '<span>·</span><span>' + escapeHtml(durText) + '</span>' : ''}
      </div>
      <div class="msg-quota-bars-group" onclick="showUsageModal(false)" style="cursor:pointer;" title="点击查看完整 4 大算力池配额详情">
        <div class="msg-mini-bar-item" title="${poolLabel} 滚动算力: 剩余 ${h5Pct}% (${h5Reset} 后重置)">
          <span style="font-size:10.5px;color:var(--text-dim);">${poolLabel}</span>
          <div class="msg-bar-track">
            <div class="msg-bar-fill ${h5FillClass} ${h5Pct <= 10 ? 'danger' : ''}" style="width:${Math.max(4, h5Pct)}%;"></div>
          </div>
          <span style="font-weight:600;color:var(--text-primary);font-size:10.5px;">${h5Pct}%</span>
          <span style="font-size:9.5px;color:var(--text-dim);font-family:monospace;">(${h5ResetPrecise})</span>
        </div>
        <div class="msg-mini-bar-item" title="每周累计旗舰配额: 剩余 ${weeklyPct}% (${weeklyReset} 后刷新)">
          <span style="font-size:10.5px;color:var(--text-dim);">周度</span>
          <div class="msg-bar-track">
            <div class="msg-bar-fill weekly" style="width:${Math.max(4, weeklyPct)}%;"></div>
          </div>
          <span style="font-weight:600;color:var(--text-primary);font-size:10.5px;">${weeklyPct}%</span>
          <span style="font-size:9.5px;color:var(--text-dim);font-family:monospace;">(${weeklyResetPrecise})</span>
        </div>
      </div>
    </div>
  `;
}

// Google Antigravity Web UI - Modernized Frontend Application

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Global App State
const state = {
  status: null,
  models: [],
  selectedModel: null,
  conversations: [],     // [{id, title, messages:[{role, content}], convId, createdAt}]
  activeId: null,
  streaming: false,
  pendingQueue: [],
  searchQuery: "",
  showThinking: localStorage.getItem("agy-show-thinking") !== "false", // 默认常开 (true)
  codeFile: null
};

// 客户端多会话后台运行管理器：支持边生成边切走会话
const activeClientRuns = new Map();

const CONV_KEY = "agy-convs-v2";
const ACTIVE_KEY = "agy-active-conv-v2";

// Configure Marked & Highlight.js
if (typeof marked !== "undefined") {
  marked.setOptions({
    highlight: function(code, lang) {
      if (typeof hljs !== "undefined" && lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(code, { language: lang }).value; } catch (_) {}
      }
      if (typeof hljs !== "undefined") {
        try { return hljs.highlightAuto(code).value; } catch (_) {}
      }
      return code;
    },
    breaks: true,
    gfm: true
  });
}

let _iconRafId = null;
function refreshIcons(container = null) {
  if (typeof lucide === "undefined" || !lucide.createIcons) return;
  if (container && container !== document && container !== document.body) {
    try {
      lucide.createIcons({ root: container });
      return;
    } catch (_) {}
  }
  if (_iconRafId) return;
  _iconRafId = requestAnimationFrame(() => {
    _iconRafId = null;
    try { lucide.createIcons(); } catch (_) {}
  });
}

// ── 参数与代码清洗工具函数 ──
function cleanArgVal(v) {
  if (v == null) return '';
  if (typeof v !== 'string') return String(v);
  let s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
    try {
      const parsed = JSON.parse(s);
      if (typeof parsed === 'string') s = parsed;
      else s = s.slice(1, -1);
    } catch (_) {
      s = s.slice(1, -1);
    }
  }
  if (s.includes('\\n')) s = s.replace(/\\n/g, '\n');
  if (s.includes('\\t')) s = s.replace(/\\t/g, '\t');
  if (s.includes('\\"')) s = s.replace(/\\"/g, '"');
  return s;
}

function normalizeToolInput(raw) {
  if (!raw) return {};
  let input = raw;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch (_) { return { raw: input }; }
  }
  if (!input || typeof input !== 'object') return {};
  const res = {};
  for (const k of Object.keys(input)) {
    res[k] = cleanArgVal(input[k]);
  }
  return res;
}

// ── 用户手动展开/折叠状态持久化记忆（杜绝流式刷新、读秒 Ticker 或会话重绘导致自动收起）──
const _userExpandedDetailsKeys = new Set();
const _userCollapsedDetailsKeys = new Set();

function getToolCallStableKey(t, index, prefix = '') {
  if (!t) return `${prefix}tool_idx_${index}`;
  if (t._key) return `${prefix}${t._key}`;
  if (t.toolId) return `${prefix}tool_toolId_${t.toolId}`;
  if (t.id) return `${prefix}tool_id_${t.id}`;
  if (t.toolCallId) return `${prefix}tool_call_${t.toolCallId}`;
  if (t.callId) return `${prefix}tool_call_${t.callId}`;
  const tName = String(t.tool || t.toolName || t.name || t.stepType || 'tool').toLowerCase();
  const summaryPart = String(t.tip || t.toolAction || t.toolSummary || '').slice(0, 20).replace(/\s+/g, '_');
  const k = `tool_${index}_${tName}_${summaryPart}`;
  t._key = k;
  return `${prefix}${k}`;
}

function isDetailsExpanded(key, defaultOpen = false) {
  if (!key) return defaultOpen;
  if (_userCollapsedDetailsKeys.has(key)) return false;
  if (_userExpandedDetailsKeys.has(key)) return true;
  return defaultOpen;
}

// 全局捕获所有 details 的 toggle 行为（tool-call-card 与 thinking-block）
document.addEventListener('toggle', (e) => {
  const target = e.target;
  if (!target || target.tagName !== 'DETAILS') return;
  const key = target.getAttribute('data-tool-key') || target.getAttribute('data-thought-key') || target.getAttribute('data-details-key');
  if (!key) return;
  if (target.open) {
    _userExpandedDetailsKeys.add(key);
    _userCollapsedDetailsKeys.delete(key);
  } else {
    _userExpandedDetailsKeys.delete(key);
    _userCollapsedDetailsKeys.add(key);
  }
}, true);

// ── 格式化工具卡片：对照终端与 Claude/OpenCode 风格设计，纯净精致，精确到代码 ──
function formatToolCallCard(t, index, isRunning = false, prefix = '') {
  const toolName = String(t.tool || t.toolName || t.name || '').toLowerCase();
  const stepType = String(t.stepType || '').toLowerCase();
  const tip = t.tip || '';
  const waited = t.waited ? `${t.waited}s` : '';
  const input = normalizeToolInput(t.input || t.toolInput || t.args || t.parameters || {});
  let rawInput = t.rawInput || (typeof input === 'object' && Object.keys(input).length ? JSON.stringify(input, null, 2) : (typeof input === 'string' ? input : ''));
  if (rawInput === '{}' || rawInput === '""') rawInput = '';
  if (Object.keys(input).length === 0 && rawInput && rawInput.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawInput);
      if (parsed && typeof parsed === 'object') {
        for (const k of Object.keys(parsed)) {
          input[k] = cleanArgVal(parsed[k]);
        }
      }
    } catch (_) {}
  }
  const output = cleanArgVal(t.output || input.output || '');

  let typeClass = 'type-generic';
  let badgeText = 'Tool';
  let iconHtml = '<i data-lucide="wrench" style="width:12px;height:12px;"></i>';
  let summaryText = tip || toolName;
  let subtitleText = '';
  let detailCode = '';
  let copyText = '';
  let linesBadge = '';

  if (toolName.includes('command') || toolName === 'bash') {
    typeClass = 'type-bash';
    badgeText = 'Bash';
    iconHtml = '<span style="font-family:monospace;font-weight:700;font-size:12.5px;">$</span>';
    const cmd = cleanArgVal(input.CommandLine || input.command || (rawInput && !rawInput.startsWith('{') ? rawInput : ''));
    const cwd = cleanArgVal(input.Cwd || input.cwd || '');
    summaryText = cmd ? cmd.split('\n')[0] : (tip || '执行系统终端命令');
    subtitleText = t.toolAction || t.toolSummary || (cwd ? `Cwd: ${cwd}` : (cmd ? '终端命令调用' : tip));
    if (subtitleText === summaryText) subtitleText = '';
    copyText = cmd ? (output ? `${cmd}\n\n=== Output ===\n${output}` : cmd) : summaryText;
    detailCode = `
      ${cwd ? `<div class="tool-file-header"><span class="file-path">📁 ${escapeHtml(cwd)}</span><span class="line-range">bash</span></div>` : ''}
      <div style="font-family:monospace;line-height:1.5;white-space:pre-wrap;word-break:break-all;">
        <span style="color:#10b981;font-weight:700;">$ </span><span style="color:#f8fafc;">${escapeHtml(cmd || summaryText)}</span>
      </div>
      ${subtitleText ? `<div style="color:var(--text-dim);font-style:italic;font-size:11px;margin:6px 0 4px 0;">${escapeHtml(subtitleText)}</div>` : ''}
      ${output ? `
        <div class="tool-output-section">
          <div class="tool-output-tag">Execution Output</div>
          <pre class="tool-output-content">${escapeHtml(output.trim())}</pre>
        </div>
      ` : (isRunning ? `<div style="font-size:11px;color:#38bdf8;margin-top:6px;">⚡ 指令正在后台执行中...</div>` : '')}
    `;
    const lines = (cmd || '').split('\n').length;
    linesBadge = lines > 1 ? `${lines} lines` : (waited || 'bash');
  } else if (toolName.includes('view') || toolName.includes('read') || toolName === 'list_dir') {
    typeClass = 'type-read';
    badgeText = toolName === 'list_dir' ? 'List' : 'Read';
    iconHtml = '<i data-lucide="file-text" style="width:12px;height:12px;"></i>';
    const filePath = cleanArgVal(input.AbsolutePath || input.TargetFile || input.DirectoryPath || input.path || '');
    const startLine = input.StartLine || input.start_line || null;
    const endLine = input.EndLine || input.end_line || null;
    const fn = filePath ? filePath.split('/').pop() : '';
    summaryText = fn || (filePath ? filePath.slice(-35) : (tip || '读取文件内容'));
    subtitleText = t.toolAction || t.toolSummary || (filePath ? filePath : (tip || '文件上下文读取'));
    copyText = output || filePath || summaryText;
    detailCode = `
      <div class="tool-file-header">
        <span class="file-path">📄 ${escapeHtml(filePath || summaryText)}</span>
        ${startLine ? `<span class="line-range">L${startLine} - ${endLine || 'EOF'}</span>` : ''}
      </div>
      ${subtitleText ? `<div style="color:var(--text-dim);font-style:italic;font-size:11px;margin-bottom:6px;">${escapeHtml(subtitleText)}</div>` : ''}
      ${output ? `
        <div class="tool-output-section">
          <pre class="tool-output-content">${escapeHtml(output.trim())}</pre>
        </div>
      ` : `
        <div style="font-family:monospace;color:var(--text-secondary);font-size:11.5px;line-height:1.6;">
          <div style="color:var(--accent);font-weight:600;">📄 读取目标: ${escapeHtml(filePath || summaryText)}</div>
          ${startLine ? `<div style="color:var(--text-dim);">行号范围: 第 ${startLine} 行 至 第 ${endLine || '结束'} 行</div>` : ''}
          <div style="color:#38bdf8;margin-top:4px;">⚡ 已完成文件读取并送入模型推理</div>
        </div>
      `}
    `;
    linesBadge = (startLine && endLine) ? `L${startLine}-${endLine}` : (waited || 'read');
  } else if (toolName.includes('replace') || toolName.includes('write') || toolName.includes('edit')) {
    typeClass = toolName.includes('write') ? 'type-write' : 'type-edit';
    badgeText = toolName.includes('write') ? 'Write' : 'Edit';
    iconHtml = '<i data-lucide="pen-tool" style="width:12px;height:12px;"></i>';
    const filePath = cleanArgVal(input.TargetFile || input.AbsolutePath || input.path || '');
    const startLine = input.StartLine ? parseInt(input.StartLine) : null;
    const endLine = input.EndLine ? parseInt(input.EndLine) : null;
    const targetContent = cleanArgVal(input.TargetContent || '');
    const replacementContent = cleanArgVal(input.ReplacementContent || input.CodeContent || '');
    const fn = filePath ? filePath.split('/').pop() : '';
    summaryText = fn || (filePath ? filePath.slice(-35) : '修改文件代码');
    subtitleText = cleanArgVal(input.Description || input.Instruction || t.toolAction || t.toolSummary || tip || '代码文件局部变更');
    copyText = replacementContent || targetContent || filePath || summaryText;

    let diffLinesHtml = '';
    if (output && output.includes('[diff_block_start]')) {
      const diffMatch = output.match(/\[diff_block_start\]([\s\S]*?)\[diff_block_end\]/);
      if (diffMatch) {
        const block = diffMatch[1].trim();
        diffLinesHtml = block.split('\n').map(l => {
          if (l.startsWith('-')) return `<div class="diff-line-del"><span class="diff-sign">-</span><span class="diff-text">${escapeHtml(l.slice(1))}</span></div>`;
          if (l.startsWith('+')) return `<div class="diff-line-add"><span class="diff-sign">+</span><span class="diff-text">${escapeHtml(l.slice(1))}</span></div>`;
          if (l.startsWith('@@')) return `<div class="diff-line-header" style="color:var(--text-dim);font-size:11px;padding:2px 0;">${escapeHtml(l)}</div>`;
          return `<div class="diff-line-context" style="color:var(--text-dim);padding-left:14px;"><span class="diff-text">${escapeHtml(l)}</span></div>`;
        }).join('');
      }
    }
    if (!diffLinesHtml && (targetContent || replacementContent)) {
      const targetLines = targetContent ? targetContent.split('\n').map((l) => 
        `<div class="diff-line-del"><span class="diff-sign">-</span><span class="diff-text">${escapeHtml(l)}</span></div>`
      ).join('') : '';
      const replaceLines = replacementContent ? replacementContent.split('\n').map((l) => 
        `<div class="diff-line-add"><span class="diff-sign">+</span><span class="diff-text">${escapeHtml(l)}</span></div>`
      ).join('') : '';
      diffLinesHtml = `${targetLines}${replaceLines}`;
    }

    if (diffLinesHtml) {
      detailCode = `
        <div class="tool-file-header">
          <span class="file-path">✏️ ${escapeHtml(filePath || summaryText)}</span>
          ${startLine ? `<span class="line-range">L${startLine} - ${endLine || ''}</span>` : ''}
        </div>
        ${subtitleText ? `<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px;font-style:italic;">${escapeHtml(subtitleText)}</div>` : ''}
        <div class="diff-wrapper">${diffLinesHtml}</div>
        ${output && !output.includes('[diff_block_start]') ? `
          <div class="tool-output-section">
            <pre class="tool-output-content" style="color:#34d399;">${escapeHtml(output.trim())}</pre>
          </div>
        ` : ''}
      `;
    } else {
      const codeToShow = replacementContent || targetContent || (output ? output.trim() : '');
      detailCode = `
        <div class="tool-file-header">
          <span class="file-path">✏️ ${escapeHtml(filePath || summaryText)}</span>
          ${startLine ? `<span class="line-range">L${startLine} - ${endLine || ''}</span>` : ''}
        </div>
        ${subtitleText ? `<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px;font-style:italic;">${escapeHtml(subtitleText)}</div>` : ''}
        ${codeToShow ? `
          <div class="tool-output-section">
            <pre class="tool-output-content" style="color:#e2e8f0;font-size:11.5px;margin:0;">${escapeHtml(codeToShow)}</pre>
          </div>
        ` : `
          <div style="font-family:monospace;color:#38bdf8;font-size:11.5px;padding:6px 0;">
            ⚡ 正在精准更新代码: <code>${escapeHtml(filePath || summaryText)}</code>
          </div>
        `}
      `;
    }
    const lines = (replacementContent || targetContent || '').split('\n').length;
    linesBadge = lines > 1 ? `${lines} lines` : (waited || 'edit');
  } else if (toolName.includes('search') || toolName.includes('grep') || toolName.includes('find')) {
    typeClass = 'type-search';
    badgeText = 'Search';
    iconHtml = '<i data-lucide="search" style="width:12px;height:12px;"></i>';
    const q = cleanArgVal(input.Query || input.Pattern || input.query || '');
    const p = cleanArgVal(input.SearchPath || input.SearchDirectory || '');
    summaryText = q || tip || '检索代码与文件';
    subtitleText = p ? `Scope: ${p}` : (t.toolAction || t.toolSummary || '项目代码全文检索');
    copyText = output || q || summaryText;
    detailCode = `
      <div class="tool-file-header">
        <span class="file-path">🔍 "${escapeHtml(q || summaryText)}"</span>
        ${p ? `<span class="line-range">${escapeHtml(p)}</span>` : ''}
      </div>
      ${output ? `
        <div class="tool-output-section">
          <pre class="tool-output-content">${escapeHtml(output.trim())}</pre>
        </div>
      ` : `
        <div style="font-family:monospace;color:var(--text-dim);font-size:11.5px;line-height:1.6;">
          <div># 检索内容: ${escapeHtml(q || summaryText)}</div>
          ${p ? `<div># 检索路径: ${escapeHtml(p)}</div>` : ''}
          <div style="color:#a78bfa;margin-top:4px;"># 状态：检索已完成，已注入分析上下文</div>
        </div>
      `}
    `;
    linesBadge = waited || 'search';
  } else if (toolName.includes('image')) {
    typeClass = 'type-image';
    badgeText = 'Image';
    iconHtml = '<i data-lucide="image" style="width:12px;height:12px;"></i>';
    const prompt = cleanArgVal(input.Prompt || input.prompt || '');
    const imgName = cleanArgVal(input.ImageName || input.name || '');
    summaryText = prompt ? `生成图片: ${prompt.slice(0, 36)}...` : (tip || 'AI 图像生成');
    subtitleText = t.toolAction || t.toolSummary || (imgName ? `名称: ${imgName}` : 'AI 图像生成完成');
    copyText = output || prompt || summaryText;

    let imageSrc = '';
    const imgMatch = (output || '').match(/(?:\/vol[^\s"']+\.(?:jpg|jpeg|png|webp|gif)|\/home[^\s"']+\.(?:jpg|jpeg|png|webp|gif)|[^\s"']+\.(?:jpg|jpeg|png|webp|gif))/i);
    if (imgMatch) {
      const fullPath = imgMatch[0];
      const fn = fullPath.split('/').pop();
      imageSrc = `/api/assets/files/${encodeURIComponent(fn)}`;
    }

    detailCode = `
      <div class="tool-file-header">
        <span class="file-path">🎨 ${escapeHtml(imgName || '生成的图片')}</span>
        ${input.AspectRatio ? `<span class="line-range">${escapeHtml(input.AspectRatio)}</span>` : ''}
      </div>
      ${prompt ? `<div style="font-size:12px;color:var(--text-secondary);margin:6px 0 10px 0;line-height:1.5;"><strong>Prompt:</strong> ${escapeHtml(prompt)}</div>` : ''}
      ${imageSrc ? `
        <div style="margin:10px 0;text-align:center;background:rgba(0,0,0,0.25);padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
          <img src="${imageSrc}" style="max-width:100%;max-height:360px;border-radius:6px;cursor:pointer;object-fit:contain;box-shadow:0 4px 14px rgba(0,0,0,0.3);" onclick="openImageLightbox(this.src)" title="点击全屏查看大图" />
          <div style="margin-top:6px;font-size:11px;color:var(--text-dim);">点击图片可全屏放大查看</div>
        </div>
      ` : (isRunning ? `<div style="font-size:11px;color:#38bdf8;margin-top:6px;">⚡ 正在生成图片并渲染中...</div>` : '')}
      ${output ? `
        <div class="tool-output-section">
          <pre class="tool-output-content">${escapeHtml(output.trim())}</pre>
        </div>
      ` : ''}
    `;
    linesBadge = waited || 'image';
  } else {
    typeClass = 'type-thought';
    badgeText = 'Thought';
    iconHtml = '<i data-lucide="brain" style="width:12px;height:12px;"></i>';
    summaryText = 'Thought for a few seconds';
    subtitleText = tip && tip !== 'Thought for a few seconds' ? tip : '深度推理与上下文思考';
    const thoughtText = cleanArgVal(input.thought || rawInput || '');
    copyText = thoughtText || subtitleText;
    detailCode = `
      <div style="font-size:12px;line-height:1.6;color:var(--text-primary);white-space:pre-wrap;">${escapeHtml(thoughtText || '• 意图解析：全面理解用户当前指令并结合上下文\n• 方案规划：制定最佳回答结构与实施逻辑\n• 推理完成：准备生成高质量回复内容')}</div>
    `;
    // thought 卡片不显示秒数（避免与思考 indicator 的累计秒重复成两个时间）
    linesBadge = 'thought';
  }

  const rawCopyEscaped = escapeHtml(copyText || summaryText);
  const toolKey = getToolCallStableKey(t, index, prefix);
  const isOpen = isDetailsExpanded(toolKey, Boolean(t.open));

  return `
    <details class="tool-call-card ${typeClass} ${isRunning ? 'is-running' : ''}" data-tool-key="${escapeHtml(toolKey)}" ${isOpen ? 'open' : ''}>
      <summary>
        <div class="tool-call-header-row">
          <span class="tool-chevron"><i data-lucide="chevron-right" style="width:13px;height:13px;"></i></span>
          <span class="tool-icon-badge">${iconHtml}</span>
          <span class="tool-main-summary" title="${escapeHtml(summaryText)}">${escapeHtml(summaryText)}</span>
          ${linesBadge ? `<span class="tool-meta-badge">${escapeHtml(linesBadge)}</span>` : ''}
        </div>
        ${subtitleText ? `<div class="tool-subtitle-row" title="${escapeHtml(subtitleText)}">${escapeHtml(subtitleText)}</div>` : ''}
      </summary>
      <div class="tool-call-body">
        <button class="tool-copy-btn" onclick="event.stopPropagation(); navigator.clipboard.writeText(this.getAttribute('data-copy')); showToast('已复制内容');" data-copy="${rawCopyEscaped}" title="复制详情">
          <i data-lucide="copy" style="width:11px;height:11px;margin-right:4px;"></i>复制
        </button>
        <div class="tool-code-box">${detailCode}</div>
      </div>
    </details>
  `;
}

function renderToolsTimeline(tools, activeIndex = -1, prefix = '') {
  let list = Array.isArray(tools) && tools.length > 0 ? tools : [
    {
      tool: 'thought',
      stepType: 'thought',
      tip: 'Thought for a few seconds',
      toolAction: '深度推理与上下文分析',
      rawInput: '• 已结合对话上下文完成意图解析与逻辑推理\n• 规划高准确度解答方案与实施步骤\n• 状态：回答已顺利生成'
    }
  ];
  return `<div class="tools-timeline-container">${list.map((t, idx) => formatToolCallCard(t, idx, idx === activeIndex, prefix)).join('')}</div>`;
}

// ── 智能贴底平滑滚动逻辑 ──
let _scrollRafId = null;
function scrollToBottom(force = false) {
  const feed = $("#chat-feed");
  if (!feed) return;
  const distFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
  if (force || distFromBottom < 300) {
    feed.scrollTop = feed.scrollHeight;
    if (!_scrollRafId) {
      _scrollRafId = requestAnimationFrame(() => {
        _scrollRafId = null;
        if (feed) feed.scrollTop = feed.scrollHeight;
      });
    }
  }
}

// 统一助手气泡内容更新器：彻底杜绝 toolsHtml 遗漏或被覆盖的问题！
// 统一助手气泡内容更新器：支持实时工作状态提示与精确耗时秒数，且严格保留用户展开的工具卡片与思考折叠状态
function updateAssistantBubble(targetNode, acc, toolEvents, isStreaming, meta = null, activeTip = null, waited = 0) {
  if (!targetNode || !targetNode.bubble) return;

  // 1. 同步当前 bubble 内已处于展开状态的 details 元素，防止快速重刷时遗漏
  targetNode.bubble.querySelectorAll('details[open]').forEach(d => {
    const key = d.getAttribute('data-tool-key') || d.getAttribute('data-thought-key') || d.getAttribute('data-details-key');
    if (key) {
      _userExpandedDetailsKeys.add(key);
      _userCollapsedDetailsKeys.delete(key);
    }
  });

  // 2. 保证 bubble 具有独立的工具包裹区与正文包裹区（避免文本流式输出时重绘工具卡片 DOM）
  let toolsWrap = targetNode.bubble.querySelector(':scope > .bubble-tools-wrap');
  let bodyWrap = targetNode.bubble.querySelector(':scope > .bubble-body-wrap');

  if (!toolsWrap || !bodyWrap) {
    const tDiv = document.createElement('div');
    tDiv.className = 'bubble-tools-wrap';
    const bDiv = document.createElement('div');
    bDiv.className = 'bubble-body-wrap';
    targetNode.bubble.innerHTML = '';
    targetNode.bubble.appendChild(tDiv);
    targetNode.bubble.appendChild(bDiv);
    toolsWrap = tDiv;
    bodyWrap = bDiv;
  }

  // 3. 计算工具状态指纹（只有在工具新增、输出变化或执行状态变化时才重绘工具卡片，其余文本流式输出绝不触动工具 DOM）
  const activeIdx = isStreaming && toolEvents && toolEvents.length ? toolEvents.length - 1 : -1;
  const toolsFingerprint = `${toolEvents ? toolEvents.length : 0}#${activeIdx}#${(toolEvents || []).map(e => `${e.tool || e.name || ''}:${e.state || ''}:${(e.output || '').length}:${e.waited || 0}`).join(';')}`;

  if (toolsWrap.getAttribute('data-fingerprint') !== toolsFingerprint) {
    const toolsHtml = renderToolsTimeline(toolEvents, activeIdx);
    toolsWrap.innerHTML = toolsHtml;
    toolsWrap.setAttribute('data-fingerprint', toolsFingerprint);
    refreshIcons(toolsWrap);
  }

  // 4. 构建正文 HTML（思考动效或 Markdown 内容）
  const cleanAcc = (acc || "").replace(/[\u200b\s]/g, "");
  let bodyHtml = "";
  if (isStreaming && !cleanAcc) {
    let displayTip = activeTip;
    if (!displayTip) {
      if (toolEvents && toolEvents.length > 0) {
        const last = toolEvents[toolEvents.length - 1];
        if (last && (last.state === 'ACTIVE' || !last.output)) {
          displayTip = last.toolAction || last.tip || `正在执行: ${last.tool}`;
        } else {
          displayTip = `已执行 ${toolEvents.length} 项工具，正在组织回答`;
        }
      } else {
        displayTip = "正在思考与组织回答";
      }
    }
    const waitSuffix = waited > 0 ? ` (${waited}s)` : "";
    bodyHtml = `
      <div class="thinking-active-indicator" style="display:flex;align-items:center;gap:7px;">
        <span class="thinking-dots"><i></i><i></i><i></i></span>
        <span class="thinking-status-text" style="font-size:12.5px;color:var(--text-muted);font-weight:500;transition:all 0.2s ease;">
          ${escapeHtml(displayTip)}${waitSuffix}
        </span>
      </div>
    `;
  } else {
    bodyHtml = formatMarkdown(acc, isStreaming);
    if (!isStreaming && cleanAcc) {
      bodyHtml += getMessageQuotaFooterHtml(cleanAcc, meta, meta?.model || state.selectedModel);
    }
  }

  // 5. 仅当正文内容改变时才更新 bodyWrap
  if (bodyWrap.innerHTML !== bodyHtml) {
    bodyWrap.querySelectorAll('details[open]').forEach(d => {
      const k = d.getAttribute('data-thought-key') || d.getAttribute('data-tool-key');
      if (k) { _userExpandedDetailsKeys.add(k); _userCollapsedDetailsKeys.delete(k); }
    });
    bodyWrap.innerHTML = bodyHtml;
    refreshIcons(bodyWrap);
  }

  // 6. 不强制下拉：用户上滑（距底部>300px）时停止自动滚，不打断阅读；滑回底部附近才继续跟最新
  scrollToBottom(false);
}

// ---------- Web UI Authentication & Login Gate Control ----------
let authToken = localStorage.getItem("agy-auth-token") || sessionStorage.getItem("agy-auth-token") || "";

// 全局 Fetch 拦截器：自动携带鉴权 Token 并捕获 401 未认证状态
const _origFetch = window.fetch;
window.fetch = async function(url, options = {}) {
  const opts = { ...options };
  opts.headers = new Headers(opts.headers || {});
  if (authToken && !opts.headers.has("x-auth-token")) {
    opts.headers.set("x-auth-token", authToken);
  }
  const response = await _origFetch(url, opts);
  if (response.status === 401) {
    try {
      const cloned = response.clone();
      const data = await cloned.json();
      if (data.unauthenticated) {
        showLoginGate();
      }
    } catch (_) {}
  }
  return response;
};

window.showLoginGate = function() {
  const overlay = $("#login-gate-overlay");
  if (overlay) {
    overlay.classList.remove("hidden");
    const err = $("#login-error-alert");
    if (err) err.style.display = "none";
    setTimeout(() => {
      $("#login-username")?.focus();
    }, 100);
    refreshIcons();
  }
};

window.hideLoginGate = function() {
  const overlay = $("#login-gate-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
  }
};

window.togglePasswordVisibility = function() {
  const input = $("#login-password");
  const eye = $("#icon-pwd-eye");
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    eye?.setAttribute("data-lucide", "eye-off");
  } else {
    input.type = "password";
    eye?.setAttribute("data-lucide", "eye");
  }
  refreshIcons();
};

window.handleWebLogin = async function(event) {
  if (event) event.preventDefault();
  const username = $("#login-username")?.value.trim();
  const password = $("#login-password")?.value.trim();
  const errorAlert = $("#login-error-alert");
  const card = $("#login-card");
  const submitBtn = $("#btn-submit-login");
  const btnText = $("#login-btn-text");

  if (!username || !password) {
    if (errorAlert) {
      errorAlert.textContent = "请输入管理账号与访问密码";
      errorAlert.style.display = "flex";
    }
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (btnText) btnText.textContent = "正在验证身份...";

  try {
    const res = await _origFetch("/api/web-auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const d = await res.json();
    if (!res.ok || !d.ok) {
      throw new Error(d.error || "用户名或密码错误，请检查后重试");
    }

    authToken = d.token || "";
    if ($("#login-remember")?.checked) {
      localStorage.setItem("agy-auth-token", authToken);
    } else {
      sessionStorage.setItem("agy-auth-token", authToken);
    }

    toast(`欢迎进入 Antigravity，${d.username || 'DJSeven'}！`);
    hideLoginGate();
    await initApp();
  } catch (err) {
    if (errorAlert) {
      errorAlert.textContent = err.message || "登录失败，请检查账号密码";
      errorAlert.style.display = "flex";
    }
    if (card) {
      card.classList.remove("shake");
      void card.offsetWidth; // force reflow
      card.classList.add("shake");
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (btnText) btnText.textContent = "安全登入系统";
    refreshIcons();
  }
};

window.handleWebLogout = async function() {
  if (!confirm("确定要退出当前的私有访问权限吗？")) return;
  try {
    await fetch("/api/web-auth/logout", {
      method: "POST",
      headers: { "x-auth-token": authToken }
    });
  } catch (_) {}
  authToken = "";
  localStorage.removeItem("agy-auth-token");
  sessionStorage.removeItem("agy-auth-token");
  toast("已安全退出登录");
  showLoginGate();
};

async function checkWebAuthStatus() {
  try {
    const token = localStorage.getItem("agy-auth-token") || sessionStorage.getItem("agy-auth-token") || "";
    authToken = token;
    const res = await _origFetch("/api/web-auth/status", {
      headers: token ? { "x-auth-token": token } : {}
    });
    const d = await res.json();
    if (d.enabled && !d.authenticated) {
      showLoginGate();
      return false;
    }
    hideLoginGate();
    return true;
  } catch (_) {
    return true;
  }
}

function activeConv() {
  return state.conversations.find((c) => c.id === state.activeId) || null;
}

let _saveTimeout = null;
let _localSaveTimeout = null;
function saveConversations(immediate = false) {
  const syncLocal = () => {
    try {
      localStorage.setItem(ACTIVE_KEY, state.activeId || "");
    } catch (_) {}
    try {
      const slim = state.conversations.map((c) => ({
        id: c.id,
        title: c.title,
        messages: c.messages,
        convId: c.convId,
        createdAt: c.createdAt || Date.now(),
        updatedAt: c.updatedAt || Date.now()
      }));
      localStorage.setItem(CONV_KEY, JSON.stringify(slim));
    } catch (e) {
      // 达到 localStorage 存储上限时进行数据裁剪保护，保留关键会话及最新消息
      try {
        const topSlim = state.conversations.slice(0, 5).map(c => ({
          id: c.id,
          title: c.title,
          convId: c.convId,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          messages: (c.messages || []).slice(-30).map(m => ({
            role: m.role,
            content: m.content,
            meta: m.meta,
            tools: (m.tools || []).slice(-5)
          }))
        }));
        localStorage.setItem(CONV_KEY, JSON.stringify(topSlim));
      } catch (_) {}
    }
  };

  if (immediate) {
    if (_localSaveTimeout) clearTimeout(_localSaveTimeout);
    syncLocal();
  } else {
    if (_localSaveTimeout) clearTimeout(_localSaveTimeout);
    _localSaveTimeout = setTimeout(syncLocal, 300);
  }

  const conv = activeConv();
  if (!conv) return;

  const doSync = async () => {
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: conv.id,
          title: conv.title,
          messages: conv.messages,
          convId: conv.convId,
          createdAt: conv.createdAt,
          updatedAt: Date.now()
        })
      });
    } catch (_) {}
  };

  if (immediate) {
    if (_saveTimeout) clearTimeout(_saveTimeout);
    doSync();
  } else {
    if (_saveTimeout) clearTimeout(_saveTimeout);
    _saveTimeout = setTimeout(doSync, 500);
  }
}

async function loadConversations() {
  // 1. 先尝试读取本地缓存以达到 0 延迟秒开页面
  try {
    const raw = localStorage.getItem(CONV_KEY) || localStorage.getItem("agy-convs");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) state.conversations = arr;
    }
    const last = localStorage.getItem(ACTIVE_KEY) || localStorage.getItem("agy-active-conv") || "";
    if (last && state.conversations.some((c) => c.id === last)) {
      state.activeId = last;
    } else if (state.conversations.length) {
      state.activeId = state.conversations[0].id;
    }
  } catch (_) {}

  // 2. 从服务端（文件数据库）拉取完整会话历史并同步
  try {
    const res = await fetch("/api/sessions");
    const data = await res.json();
    if (data && data.ok && Array.isArray(data.sessions) && data.sessions.length > 0) {
      // 深度双向对齐：防止刷新页面时丢失本地较新的消息或尚未落盘的新对话
      const localRaw = localStorage.getItem(CONV_KEY) || localStorage.getItem("agy-convs");
      if (localRaw) {
        try {
          const localConvs = JSON.parse(localRaw);
          if (Array.isArray(localConvs)) {
            const serverMap = new Map(data.sessions.map(s => [s.id, s]));
            for (const localConv of localConvs) {
              const serverConv = serverMap.get(localConv.id);
              if (!serverConv) {
                // 服务端尚未收录的本地新会话，完整保留
                data.sessions.push(localConv);
              } else if (Array.isArray(localConv.messages) && Array.isArray(serverConv.messages)) {
                if (localConv.messages.length > serverConv.messages.length) {
                  // 本地消息数量更多，说明本地有最新提交或生成的回答，以本地为准
                  serverConv.messages = localConv.messages;
                }
              }
            }
          }
        } catch (_) {}
      }

      // 清除末尾完全空白且无任何工具记录的 assistant 占位（避免刷新页面时展示空卡片；只要有工具结果就保留）
      data.sessions.forEach(conv => {
        if (Array.isArray(conv.messages)) {
          while (
            conv.messages.length > 0 &&
            conv.messages[conv.messages.length - 1].role === 'assistant' &&
            (!conv.messages[conv.messages.length - 1].content || conv.messages[conv.messages.length - 1].content.replace(/[\u200b\s]/g, '') === '') &&
            (!conv.messages[conv.messages.length - 1].tools || conv.messages[conv.messages.length - 1].tools.length === 0)
          ) {
            conv.messages.pop();
          }
        }
      });

      state.conversations = data.sessions;
      if (!state.activeId || !state.conversations.some((c) => c.id === state.activeId)) {
        state.activeId = state.conversations[0].id;
      }
      saveConversations(true);
      renderConvList();
      const curServerSession = data.sessions.find(s => s.id === state.activeId);
      const isRemoteRunning = !!(curServerSession && curServerSession.isRunning);
      if (!state.streaming && !activeClientRuns.has(state.activeId) && !isRemoteRunning) {
        paintActiveConv();
      }
    } else if (data && data.unauthenticated) {
      showLoginGate();
      return;
    } else {
      // 服务端为空时，把当前本地可能存在的会话自动迁移上传到服务端
      const localRaw = localStorage.getItem(CONV_KEY) || localStorage.getItem("agy-convs");
      if (localRaw) {
        const localArr = JSON.parse(localRaw);
        if (Array.isArray(localArr) && localArr.length > 0) {
          await fetch("/api/sessions/migrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessions: localArr })
          });
        }
      }
    }
  } catch (_) {}

  if (!state.conversations.length) {
    newChat(true);
  } else {
    renderConvList();
    const curActive = state.conversations.find(s => s.id === state.activeId);
    const isRemoteRunning = !!(curActive && curActive.isRunning);
    if (!state.streaming && !activeClientRuns.has(state.activeId) && !isRemoteRunning) {
      paintActiveConv();
    }
  }
}

// Toast Notifications
let toastTimer = null;
function toast(msg, ms = 2800) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

// Modal Control
function openModal(title, bodyHTML, isLarge = false, modalClass = '') {
  $("#modal-title").innerHTML = title;
  $("#modal-body").innerHTML = bodyHTML;
  const dialog = $("#modal-dialog");
  dialog.className = "modal-dialog" + (isLarge ? " large" : "") + (modalClass ? " " + modalClass : "");
  $("#modal-root").classList.remove("hidden");
  const bodyEl = $("#modal-body");
  if (bodyEl) bodyEl.scrollTop = 0;
  refreshIcons();
}

function closeModal() {
  $("#modal-root").classList.add("hidden");
  const dialog = $("#modal-dialog");
  dialog.className = "modal-dialog";
}

$("#modal-close").addEventListener("click", closeModal);
$("#modal-root").addEventListener("click", (e) => {
  if (e.target === $("#modal-root")) closeModal();
});

// === 系统设置面板：webui 登录账号密码 + 代理(SOCKS5)凭据与节点 ===
async function showSettingsModal() {
  let countryList = [{"name":"United States","code":"us","zh":"美国","flag":"🇺🇸","count":36948,"stable":true,"privacy":false},{"name":"Germany","code":"de","zh":"德国","flag":"🇩🇪","count":11537,"stable":true,"privacy":true},{"name":"Canada","code":"ca","zh":"加拿大","flag":"🇨🇦","count":3265,"stable":true,"privacy":true},{"name":"Vietnam","code":"vn","zh":"越南","flag":"🇻🇳","count":1489,"stable":true,"privacy":false},{"name":"United Kingdom","code":"gb","zh":"英国","flag":"🇬🇧","count":1376,"stable":true,"privacy":false},{"name":"Netherlands","code":"nl","zh":"荷兰","flag":"🇳🇱","count":444,"stable":true,"privacy":true},{"name":"France","code":"fr","zh":"法国","flag":"🇫🇷","count":344,"stable":true,"privacy":true},{"name":"Australia","code":"au","zh":"澳大利亚","flag":"🇦🇺","count":304,"stable":true,"privacy":false},{"name":"Singapore","code":"sg","zh":"新加坡","flag":"🇸🇬","count":261,"stable":true,"privacy":true},{"name":"Russia","code":"ru","zh":"俄罗斯","flag":"🇷🇺","count":214,"stable":true,"privacy":false},{"name":"Malaysia","code":"my","zh":"马来西亚","flag":"🇲🇾","count":135,"stable":true,"privacy":false},{"name":"Japan","code":"jp","zh":"日本","flag":"🇯🇵","count":122,"stable":true,"privacy":true},{"name":"Italy","code":"it","zh":"意大利","flag":"🇮🇹","count":118,"stable":true,"privacy":true},{"name":"South Korea","code":"kr","zh":"韩国","flag":"🇰🇷","count":108,"stable":true,"privacy":true},{"name":"India","code":"in","zh":"印度","flag":"🇮🇳","count":95,"stable":true,"privacy":false},{"name":"Spain","code":"es","zh":"西班牙","flag":"🇪🇸","count":84,"stable":true,"privacy":true},{"name":"Finland","code":"fi","zh":"芬兰","flag":"🇫🇮","count":75,"stable":true,"privacy":true},{"name":"Hong Kong","code":"hk","zh":"中国香港","flag":"🇭🇰","count":71,"stable":true,"privacy":false},{"name":"Romania","code":"ro","zh":"罗马尼亚","flag":"🇷🇴","count":60,"stable":true,"privacy":false},{"name":"Sweden","code":"se","zh":"瑞典","flag":"🇸🇪","count":49,"stable":true,"privacy":true},{"name":"Mexico","code":"mx","zh":"墨西哥","flag":"🇲🇽","count":45,"stable":true,"privacy":false},{"name":"Turkey","code":"tr","zh":"土耳其","flag":"🇹🇷","count":43,"stable":true,"privacy":false},{"name":"China","code":"cn","zh":"中国大陆","flag":"🇨🇳","count":41,"stable":true,"privacy":false},{"name":"Ukraine","code":"ua","zh":"乌克兰","flag":"🇺🇦","count":38,"stable":true,"privacy":false},{"name":"Switzerland","code":"ch","zh":"瑞士","flag":"🇨🇭","count":38,"stable":true,"privacy":true},{"name":"Bulgaria","code":"bg","zh":"保加利亚","flag":"🇧🇬","count":37,"stable":true,"privacy":false},{"name":"Morocco","code":"ma","zh":"摩洛哥","flag":"🇲🇦","count":36,"stable":true,"privacy":false},{"name":"Brazil","code":"br","zh":"巴西","flag":"🇧🇷","count":36,"stable":true,"privacy":true},{"name":"Portugal","code":"pt","zh":"葡萄牙","flag":"🇵🇹","count":34,"stable":true,"privacy":true},{"name":"Poland","code":"pl","zh":"波兰","flag":"🇵🇱","count":33,"stable":true,"privacy":false},{"name":"Indonesia","code":"id","zh":"印度尼西亚","flag":"🇮🇩","count":29,"stable":true,"privacy":false},{"name":"Czechia","code":"cz","zh":"捷克","flag":"🇨🇿","count":27,"stable":true,"privacy":true},{"name":"Hungary","code":"hu","zh":"匈牙利","flag":"🇭🇺","count":25,"stable":true,"privacy":false},{"name":"Latvia","code":"lv","zh":"拉脱维亚","flag":"🇱🇻","count":22,"stable":true,"privacy":false},{"name":"Ireland","code":"ie","zh":"爱尔兰","flag":"🇮🇪","count":21,"stable":true,"privacy":true},{"name":"Belgium","code":"be","zh":"比利时","flag":"🇧🇪","count":19,"stable":true,"privacy":true},{"name":"Taiwan","code":"tw","zh":"中国台湾","flag":"🇹🇼","count":18,"stable":true,"privacy":false},{"name":"Austria","code":"at","zh":"奥地利","flag":"🇦🇹","count":18,"stable":true,"privacy":true},{"name":"South Africa","code":"za","zh":"南非","flag":"🇿🇦","count":17,"stable":true,"privacy":false},{"name":"Lithuania","code":"lt","zh":"立陶宛","flag":"🇱🇹","count":13,"stable":true,"privacy":true},{"name":"Philippines","code":"ph","zh":"菲律宾","flag":"🇵🇭","count":12,"stable":true,"privacy":false},{"name":"Greece","code":"gr","zh":"希腊","flag":"🇬🇷","count":11,"stable":true,"privacy":false},{"name":"Slovakia","code":"sk","zh":"斯洛伐克","flag":"🇸🇰","count":11,"stable":true,"privacy":false},{"name":"Cambodia","code":"kh","zh":"柬埔寨","flag":"🇰🇭","count":10,"stable":true,"privacy":false},{"name":"Norway","code":"no","zh":"挪威","flag":"🇳🇴","count":8,"stable":true,"privacy":true},{"name":"Serbia","code":"rs","zh":"塞尔维亚","flag":"🇷🇸","count":8,"stable":true,"privacy":false},{"name":"Croatia","code":"hr","zh":"克罗地亚","flag":"🇭🇷","count":8,"stable":true,"privacy":false},{"name":"Bangladesh","code":"bd","zh":"孟加拉国","flag":"🇧🇩","count":8,"stable":false,"privacy":false},{"name":"United Arab Emirates","code":"ae","zh":"阿联酋","flag":"🇦🇪","count":8,"stable":true,"privacy":false},{"name":"Slovenia","code":"si","zh":"斯洛文尼亚","flag":"🇸🇮","count":7,"stable":true,"privacy":false},{"name":"Thailand","code":"th","zh":"泰国","flag":"🇹🇭","count":6,"stable":true,"privacy":false},{"name":"Saudi Arabia","code":"sa","zh":"沙特阿拉伯","flag":"🇸🇦","count":6,"stable":true,"privacy":false},{"name":"Estonia","code":"ee","zh":"爱沙尼亚","flag":"🇪🇪","count":6,"stable":false,"privacy":true},{"name":"Iraq","code":"iq","zh":"伊拉克","flag":"🇮🇶","count":6,"stable":false,"privacy":false},{"name":"Moldova","code":"md","zh":"摩尔多瓦","flag":"🇲🇩","count":6,"stable":true,"privacy":false},{"name":"Cyprus","code":"cy","zh":"塞浦路斯","flag":"🇨🇾","count":6,"stable":true,"privacy":false},{"name":"Denmark","code":"dk","zh":"丹麦","flag":"🇩🇰","count":5,"stable":false,"privacy":true},{"name":"Macao","code":"mo","zh":"中国澳门","flag":"🇲🇴","count":4,"stable":false,"privacy":false},{"name":"North Macedonia","code":"mk","zh":"北马其顿","flag":"🇲🇰","count":4,"stable":true,"privacy":false},{"name":"Bosnia and Herzegovina","code":"ba","zh":"波斯尼亚和黑塞哥维那","flag":"🇧🇦","count":3,"stable":false,"privacy":false},{"name":"Kazakhstan","code":"kz","zh":"哈萨克斯坦","flag":"🇰🇿","count":3,"stable":false,"privacy":false},{"name":"Puerto Rico","code":"pr","zh":"波多黎各","flag":"🇵🇷","count":3,"stable":false,"privacy":false},{"name":"Albania","code":"al","zh":"阿尔巴尼亚","flag":"🇦🇱","count":3,"stable":false,"privacy":false},{"name":"Argentina","code":"ar","zh":"阿根廷","flag":"🇦🇷","count":3,"stable":false,"privacy":true},{"name":"Israel","code":"il","zh":"以色列","flag":"🇮🇱","count":3,"stable":false,"privacy":false},{"name":"Uruguay","code":"uy","zh":"乌拉圭","flag":"🇺🇾","count":3,"stable":false,"privacy":false},{"name":"Georgia","code":"ge","zh":"格鲁吉亚","flag":"🇬🇪","count":3,"stable":false,"privacy":false},{"name":"Nigeria","code":"ng","zh":"尼日利亚","flag":"🇳🇬","count":2,"stable":false,"privacy":false},{"name":"Peru","code":"pe","zh":"秘鲁","flag":"🇵🇪","count":2,"stable":false,"privacy":false},{"name":"Luxembourg","code":"lu","zh":"卢森堡","flag":"🇱🇺","count":1,"stable":false,"privacy":true},{"name":"Afghanistan","code":"af","zh":"阿富汗","flag":"🇦🇫","count":1,"stable":false,"privacy":false},{"name":"Andorra","code":"ad","zh":"安道尔","flag":"🇦🇩","count":1,"stable":false,"privacy":false},{"name":"Dominican Republic","code":"do","zh":"多米尼加","flag":"🇩🇴","count":1,"stable":false,"privacy":false},{"name":"Kyrgyzstan","code":"kg","zh":"吉尔吉斯斯坦","flag":"🇰🇬","count":1,"stable":false,"privacy":false},{"name":"Lebanon","code":"lb","zh":"黎巴嫩","flag":"🇱🇧","count":1,"stable":false,"privacy":false},{"name":"Cayman Islands","code":"ky","zh":"开曼群岛","flag":"🇰🇾","count":1,"stable":false,"privacy":false},{"name":"Chile","code":"cl","zh":"智利","flag":"🇨🇱","count":1,"stable":false,"privacy":false},{"name":"Costa Rica","code":"cr","zh":"哥斯达黎加","flag":"🇨🇷","count":1,"stable":false,"privacy":false},{"name":"New Zealand","code":"nz","zh":"新西兰","flag":"🇳🇿","count":1,"stable":false,"privacy":true},{"name":"Uzbekistan","code":"uz","zh":"乌兹别克斯坦","flag":"🇺🇿","count":1,"stable":false,"privacy":false},{"name":"Bahrain","code":"bh","zh":"巴林","flag":"🇧🇭","count":1,"stable":false,"privacy":false},{"name":"Laos","code":"la","zh":"老挝","flag":"🇱🇦","count":1,"stable":false,"privacy":false},{"name":"Colombia","code":"co","zh":"哥伦比亚","flag":"🇨🇴","count":1,"stable":false,"privacy":false},{"name":"Qatar","code":"qa","zh":"卡塔尔","flag":"🇶🇦","count":1,"stable":false,"privacy":false},{"name":"Oman","code":"om","zh":"阿曼","flag":"🇴🇲","count":1,"stable":false,"privacy":false},{"name":"Venezuela","code":"ve","zh":"委内瑞拉","flag":"🇻🇪","count":1,"stable":false,"privacy":false}];
  const HOT_CODES = new Set(["us", "jp", "sg", "hk", "tw", "kr", "gb", "de", "ca", "au", "nl", "fr"]);

  function formatCountryLabel(c) {
    const countStr = typeof c.count === "number" ? (c.count.toLocaleString() + " 个可用节点") : "";
    const tags = [];
    if (c.stable) tags.push("固定IP");
    if (c.privacy) tags.push("强化匿名");
    const tagStr = tags.length ? (" · [" + tags.join("/") + "]") : "";
    return (c.flag || "🌐") + " " + (c.zh || c.name) + " (" + c.name + ") — " + countStr + tagStr;
  }

  function renderCountryOptions(list, currentVal) {
    const cur = (currentVal || "").trim().toLowerCase();
    const allSorted = [...list].sort((a,b) => (b.count || 0) - (a.count || 0));

    let html = "";
    allSorted.forEach(c => {
      const isSel = cur && (c.name.toLowerCase() === cur || c.code.toLowerCase() === cur);
      html += "<option value=\"" + c.name + "\" " + (isSel ? "selected" : "") + ">" + formatCountryLabel(c) + "</option>";
    });
    html += "<option value=\"__custom__\" " + (cur === "__custom__" ? "selected" : "") + ">✏️ 自定义手动输入国家名称...</option>";

    return html;
  }

  const body = `
    <div class="settings-panel">
      <div class="settings-group">
        <h3 class="settings-group-title">🌐 Web 访问登录</h3>
        <p class="settings-hint">访问本 Web UI 的账号密码，保存后立即生效，可自由更改。</p>
        <label class="settings-label">用户名</label>
        <input id="set-web-user" class="settings-input" type="text" autocomplete="username" placeholder="admin">
        <label class="settings-label">新密码 <span class="settings-muted">(留空表示不修改)</span></label>
        <input id="set-web-pass" class="settings-input" type="password" autocomplete="new-password" placeholder="留空保持不变">
      </div>
      <div class="settings-group">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
          <div>
            <h3 class="settings-group-title" style="margin: 0 0 2px;">🔒 URnetwork SOCKS5 代理</h3>
            <p class="settings-hint" style="margin: 0;">配置文件 <code>proxy-toggle.txt</code> (yes=走代理，no=直连)</p>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span id="set-proxy-toggle-badge" style="font-size: 12px; font-weight: 600; color: var(--success, #22c55e);">开启代理 (yes)</span>
            <label class="toggle-switch">
              <input type="checkbox" id="set-proxy-toggle" checked />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
        <div id="set-proxy-status" class="settings-proxy-status">加载状态中…</div>
        <div id="set-proxy-fields" style="transition: opacity 0.2s;">
          <label class="settings-label">代理账号 (URN_USER_AUTH)</label>
          <input id="set-urn-user" class="settings-input" type="text" autocomplete="off" placeholder="如 123456@qq.com">
          <label class="settings-label">代理密码 <span class="settings-muted">(留空表示不修改)</span></label>
          <input id="set-urn-pass" class="settings-input" type="password" autocomplete="off" placeholder="留空保持不变">
          <label class="settings-label">出口节点 — 国家 (COUNTRY)</label>
          <div class="settings-select-wrap">
            <select id="set-urn-country-select" class="settings-select">
              ${renderCountryOptions(countryList, "United States")}
            </select>
            <i data-lucide="chevron-down" class="settings-select-arrow"></i>
          </div>
          <div id="set-country-meta" class="settings-country-meta" style="display:none;"></div>
          <input id="set-urn-country" class="settings-input" style="margin-top: 8px; display: none;" type="text" autocomplete="off" placeholder="输入自定义国家英文名，如 United States">
          <div style="margin-top: 10px; padding: 12px; background: var(--bg-secondary, #1e2025); border: 1px solid var(--border-color); border-radius: 8px;">
            <div style="font-size: 12px; font-weight: 600; color: var(--text-main, #e5e7eb); margin-bottom: 8px;">🛡️ 连接特性模式 (匹配客户端功能)</div>

            <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
              <div>
                <div style="font-size: 13px; font-weight: 500;">固定 IP / 稳定连接</div>
                <div id="set-stable-desc" style="font-size: 11px; color: var(--text-muted, #888);">锁定稳定出口 IP，避免频繁漂移导致安全风控检测</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-urn-stable" />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06);">
              <div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 13px; font-weight: 500;">强匿名化</span>
                  <span id="set-privacy-badge" class="meta-badge badge-purple" style="display:none;">当前国家支持</span>
                </div>
                <div style="font-size: 11px; color: var(--text-muted, #888);">多跳混淆伪装链路，严格阻断真实出口 IP 关联</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-urn-privacy" checked />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0;">
              <div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 13px; font-weight: 500;">后量子加密</span>
                  <span class="meta-badge badge-info">ML-KEM-1024</span>
                </div>
                <div style="font-size: 11px; color: var(--text-muted, #888);">NIST 标准 Kyber 抗量子密码算法，抵御未来量子破译</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="set-urn-quantum" checked />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div style="margin-top: 10px; padding: 10px; background: var(--bg-secondary, #1e2025); border: 1px solid var(--border-color); border-radius: 8px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <label class="settings-label" style="margin: 0; font-weight: 600;">Provider 节点调度</label>
              <button id="set-rotate-node" type="button" class="btn btn-xs btn-ghost" style="padding: 2px 8px; font-size: 11.5px;">🔄 自动换一个节点</button>
            </div>
            <div id="set-provider-display" style="font-size: 12px; color: var(--success, #22c55e); margin-bottom: 6px;">🟢 自动优选健康节点池（节点故障毫秒级自动切换）</div>
            <details style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
              <summary style="cursor: pointer; user-select: none;">高级选项: 指定地区/城市或手动锁定 Provider ID</summary>
              <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">
                <div>
                  <label class="settings-label" style="margin-bottom: 2px;">地区 (REGION) <span class="settings-muted">可选</span></label>
                  <input id="set-urn-region" class="settings-input" type="text" autocomplete="off" placeholder="如 California">
                </div>
                <div>
                  <label class="settings-label" style="margin-bottom: 2px;">城市 (CITY) <span class="settings-muted">可选</span></label>
                  <input id="set-urn-city" class="settings-input" type="text" autocomplete="off" placeholder="如 Los Angeles">
                </div>
                <div>
                  <label class="settings-label" style="margin-bottom: 2px;">Provider ID <span class="settings-muted">可选，留空自动选择</span></label>
                  <input id="set-urn-pid" class="settings-input" type="text" autocomplete="off" placeholder="留空则按国家/地区自动负载均衡与容灾切换">
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
      <div class="settings-actions">
        <button id="set-save" class="btn btn-primary">保存设置</button>
        <button id="set-proxy-restart" class="btn btn-ghost">重启代理</button>
        <span id="set-status" class="settings-status"></span>
      </div>
    </div>`;
  openModal("系统设置", body, false, "settings-modal");

  const $ = (s) => document.querySelector(s);
  const statusEl = $("#set-status");
  const countrySelect = $("#set-urn-country-select");
  const countryInput = $("#set-urn-country");
  const countryMeta = $("#set-country-meta");
  const proxyToggle = $("#set-proxy-toggle");
  const proxyToggleBadge = $("#set-proxy-toggle-badge");
  const proxyFields = $("#set-proxy-fields");

  function setProxyToggleState(enabled) {
    if (proxyToggle) proxyToggle.checked = enabled;
    if (proxyToggleBadge) {
      proxyToggleBadge.textContent = enabled ? "开启代理 (yes)" : "直连模式 (no)";
      proxyToggleBadge.style.color = enabled ? "var(--success, #22c55e)" : "var(--text-muted, #888)";
    }
    if (proxyFields) {
      proxyFields.style.opacity = enabled ? "1" : "0.5";
    }
  }

  if (proxyToggle) {
    proxyToggle.addEventListener("change", () => {
      setProxyToggleState(proxyToggle.checked);
    });
  }

  function updateCountryMeta(countryVal) {
    if (!countryMeta) return;
    if (!countryVal || countryVal === "__custom__") {
      countryMeta.style.display = "none";
      return;
    }
    const c = countryList.find(item =>
      item.name.toLowerCase() === countryVal.toLowerCase() ||
      item.code.toLowerCase() === countryVal.toLowerCase()
    );
    if (!c) {
      countryMeta.style.display = "none";
      return;
    }
    countryMeta.style.display = "flex";
    const countDisplay = typeof c.count === "number" ? (c.count.toLocaleString() + " 个") : "探测中";
    const stableBadge = c.stable
      ? "<span class=\"meta-badge badge-success\">✓ 支持固定IP/稳定</span>"
      : "<span class=\"meta-badge\" style=\"background:rgba(255,255,255,0.06); color:var(--text-muted);\">标准动态IP</span>";
    const privacyBadge = c.privacy
      ? "<span class=\"meta-badge badge-purple\">✓ 强化匿名</span>"
      : "<span class=\"meta-badge\" style=\"background:rgba(255,255,255,0.06); color:var(--text-muted);\">标准匿名</span>";
    const quantumBadge = "<span class=\"meta-badge badge-info\">✓ 后量子加密 (ML-KEM-1024)</span>";

    countryMeta.innerHTML =
      "<div class=\"meta-item\"><span>可用节点:</span> <span class=\"meta-value\">" + countDisplay + "</span></div>" +
      "<div class=\"meta-item\"><span>节点属性:</span> " + stableBadge + "</div>" +
      "<div class=\"meta-item\"><span>隐私级别:</span> " + privacyBadge + "</div>" +
      "<div class=\"meta-item\"><span>量子安全:</span> " + quantumBadge + "</div>";

    const stableDescEl = $("#set-stable-desc");
    if (stableDescEl) {
      stableDescEl.innerHTML = c.stable
        ? "<span style=\"color:var(--success, #22c55e); font-weight: 500;\">✓ 该国家已就绪稳定固定IP节点池</span>"
        : "<span style=\"color:var(--text-muted, #888);\">该国家当前为标准动态节点池</span>";
    }
    const privacyBadgeEl = $("#set-privacy-badge");
    if (privacyBadgeEl) {
      privacyBadgeEl.style.display = c.privacy ? "inline-block" : "none";
    }
  }

  function syncCountryUI(countryVal) {
    const raw = (countryVal || "").trim();
    const matchedItem = countryList.find(c =>
      c.name.toLowerCase() === raw.toLowerCase() ||
      c.code.toLowerCase() === raw.toLowerCase()
    );
    if (matchedItem) {
      countrySelect.value = matchedItem.name;
      countryInput.style.display = "none";
      countryInput.value = matchedItem.name;
      updateCountryMeta(matchedItem.name);
    } else if (raw) {
      countrySelect.value = "__custom__";
      countryInput.style.display = "block";
      countryInput.value = raw;
      updateCountryMeta(null);
    } else {
      countrySelect.value = "United States";
      countryInput.style.display = "none";
      countryInput.value = "United States";
      updateCountryMeta("United States");
    }
  }

  if (countrySelect) {
    countrySelect.addEventListener("change", () => {
      if (countrySelect.value === "__custom__") {
        countryInput.style.display = "block";
        countryInput.focus();
        updateCountryMeta(null);
      } else {
        countryInput.style.display = "none";
        countryInput.value = countrySelect.value;
        updateCountryMeta(countrySelect.value);
      }
    });
  }

  // 异步拉取 BringYour 后端 86+ 国家的实时节点数量与属性
  fetch("/api/proxy/locations")
    .then(r => r.json())
    .then(d => {
      if (d.ok && Array.isArray(d.locations) && d.locations.length > 0) {
        countryList = d.locations;
        const currentSelected = countrySelect.value === "__custom__" ? countryInput.value : countrySelect.value;
        countrySelect.innerHTML = renderCountryOptions(countryList, currentSelected);
        if (currentSelected && currentSelected !== "__custom__") {
          countrySelect.value = currentSelected;
          updateCountryMeta(currentSelected);
        }
      }
    })
    .catch(() => {});

  async function loadProxyStatus() {
    try {
      const r = await fetch("/api/proxy/status");
      const d = await r.json();
      const nodeDesc = [d.country, d.region, d.city].filter(Boolean).join(" / ") || "未配置";
      const isEnabled = d.enabled !== false && d.mode !== "no";
      setProxyToggleState(isEnabled);

      if (!isEnabled) {
        $("#set-proxy-status").innerHTML = "<span style=\"color:var(--text-muted,#888);\">🚫 <b>直连模式 (proxy-toggle.txt: no)</b><br>已关闭代理，agy 将直接连接 Google 官方接口（不走 SOCKS5）</span>";
      } else {
        const sock = d.socksListening ? "✅ SOCKS5 代理运行中 (:19999)" : "❌ 未监听 (:19999)";
        const countStr = d.activeProviderCount ? (" · 活跃节点池: <b>" + Number(d.activeProviderCount).toLocaleString() + "</b> 个节点") : "";
        const curCountry = d.activeCountry || d.country || "United States";
        $("#set-proxy-status").innerHTML = 
          "⚡ <b>代理已开启 (proxy-toggle: yes)</b><br>" +
          "状态: " + sock + "<br>" +
          "当前实际出口: <b>" + curCountry + "</b>" + countStr;
      }
    } catch (e) { $("#set-proxy-status").textContent = "状态获取失败: " + (e && e.message); }
  }

  const rotateNodeBtn = $("#set-rotate-node");
  if (rotateNodeBtn) {
    rotateNodeBtn.addEventListener("click", async () => {
      rotateNodeBtn.disabled = true;
      rotateNodeBtn.textContent = "切换中…";
      try {
        const r = await fetch("/api/proxy/restart", { method: "POST" });
        const d = await r.json();
        statusEl.textContent = d.message || "已自动切换新节点并重启代理";
        statusEl.style.color = "var(--success, #22c55e)";
        setTimeout(() => loadProxyStatus(), 2000);
      } catch (e) {
        statusEl.textContent = "切换失败: " + e.message;
        statusEl.style.color = "var(--danger, #ef4444)";
      } finally {
        setTimeout(() => {
          rotateNodeBtn.disabled = false;
          rotateNodeBtn.textContent = "🔄 自动换一个节点";
        }, 3000);
      }
    });
  }

  try {
    const r = await fetch('/api/system/settings');
    const d = await r.json();
    if (d.webAuth) {
      $("#set-web-user").value = d.webAuth.username || '';
      if (d.webAuth.hasPassword) $("#set-web-pass").placeholder = '已设置，留空保持不变';
    }
    if (d.proxy) {
      const isEnabled = d.proxy.enabled !== false && d.proxy.mode !== 'no';
      setProxyToggleState(isEnabled);
      $("#set-urn-user").value = d.proxy.userAuth || '';
      if (d.proxy.hasPassword) $("#set-urn-pass").placeholder = '已设置，留空保持不变';
      syncCountryUI(d.proxy.country || 'United States');
      $("#set-urn-region").value = d.proxy.region || '';
      $("#set-urn-city").value = d.proxy.city || '';
      $("#set-urn-pid").value = d.proxy.providerId || '';
      if ($("#set-urn-stable")) $("#set-urn-stable").checked = Boolean(d.proxy.stable);
      if ($("#set-urn-privacy")) $("#set-urn-privacy").checked = d.proxy.privacy !== false;
      if ($("#set-urn-quantum")) $("#set-urn-quantum").checked = d.proxy.quantum !== false;
    }
  } catch (e) { statusEl.textContent = '加载失败: ' + (e && e.message); }
  loadProxyStatus();

  $("#set-save").addEventListener("click", async () => {
    statusEl.textContent = '保存中…';
    statusEl.style.color = '';
    const selectedCountry = countrySelect.value === '__custom__'
      ? countryInput.value.trim()
      : countrySelect.value;

    const isProxyEnabled = proxyToggle ? proxyToggle.checked : true;

    const payload = {
      webAuth: { username: $("#set-web-user").value.trim() },
      proxy: {
        enabled: isProxyEnabled,
        mode: isProxyEnabled ? 'yes' : 'no',
        userAuth: $("#set-urn-user").value.trim(),
        country: selectedCountry || 'United States',
        region: $("#set-urn-region").value.trim(),
        city: $("#set-urn-city").value.trim(),
        providerId: $("#set-urn-pid").value.trim(),
        stable: $("#set-urn-stable") ? $("#set-urn-stable").checked : false,
        privacy: $("#set-urn-privacy") ? $("#set-urn-privacy").checked : true,
        quantum: $("#set-urn-quantum") ? $("#set-urn-quantum").checked : true
      }
    };
    const wp = $("#set-web-pass").value;
    const up = $("#set-urn-pass").value;
    if (wp) payload.webAuth.password = wp;
    if (up) payload.proxy.password = up;
    try {
      const r = await fetch('/api/system/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (d.ok) {
        statusEl.textContent = '✓ ' + (d.message || '已保存');
        statusEl.style.color = 'var(--success, #22c55e)';
        $("#set-web-pass").value = '';
        $("#set-urn-pass").value = '';
        $("#set-web-pass").placeholder = '已设置，留空保持不变';
        $("#set-urn-pass").placeholder = '已设置，留空保持不变';
      } else {
        statusEl.textContent = '✗ ' + (d.error || '保存失败');
        statusEl.style.color = 'var(--danger, #ef4444)';
      }
    } catch (e) {
      statusEl.textContent = '✗ ' + (e && e.message);
      statusEl.style.color = 'var(--danger, #ef4444)';
    }
  });

  $("#set-proxy-restart").addEventListener("click", async () => {
    const btn = $("#set-proxy-restart");
    btn.disabled = true;
    btn.textContent = '重启中…';
    statusEl.textContent = '正在强力重启代理并建立新连接…';
    statusEl.style.color = 'var(--accent, #3b82f6)';
    try {
      const r = await fetch('/api/proxy/restart', { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        statusEl.textContent = '✓ ' + (d.message || '已重启代理');
        statusEl.style.color = 'var(--success, #22c55e)';
        setTimeout(loadProxyStatus, 1500);
        setTimeout(loadProxyStatus, 3500);
      } else {
        statusEl.textContent = '✗ ' + (d.error || '重启失败');
        statusEl.style.color = 'var(--danger, #ef4444)';
      }
    } catch (e) {
      statusEl.textContent = '✗ ' + (e && e.message);
      statusEl.style.color = 'var(--danger, #ef4444)';
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '重启代理';
      }, 3000);
    }
  });
}
window.showSettingsModal = showSettingsModal;

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#modal-root").classList.contains("hidden")) {
    closeModal();
  }
  // Ctrl+K / Cmd+K for new chat
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    newChat();
  }
  // Ctrl+F / Cmd+F for search conversations
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    const isEditingCode = document.activeElement && (document.activeElement.classList.contains("monaco-editor") || document.activeElement.id === "code-editor-area");
    if (!isEditingCode) {
      const searchInput = $("#session-search");
      if (searchInput) {
        e.preventDefault();
        openSidebar();
        searchInput.focus();
        searchInput.select();
      }
    }
  }
});

// Escape HTML
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightMatch(text, query) {
  if (!text) return "";
  if (!query) return escapeHtml(text);
  const q = String(query).trim();
  if (!q) return escapeHtml(text);
  const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "gi");
  const parts = String(text).split(regex);
  return parts.map((part) => {
    if (part.toLowerCase() === q.toLowerCase()) {
      return `<mark class="search-highlight">${escapeHtml(part)}</mark>`;
    }
    return escapeHtml(part);
  }).join("");
}

function findSnippetMatch(messages, query) {
  if (!messages || !query) return null;
  const q = String(query).trim().toLowerCase();
  if (!q) return null;
  for (const m of messages) {
    const raw = String(m.content || "").replace(/<(?:thought|thinking)>[\s\S]*?<\/(?:thought|thinking)>/gi, "");
    const lower = raw.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx !== -1) {
      const start = Math.max(0, idx - 12);
      const end = Math.min(raw.length, idx + q.length + 22);
      let snippet = raw.substring(start, end).replace(/[\r\n\t]+/g, " ").trim();
      if (start > 0) snippet = "..." + snippet;
      if (end < raw.length) snippet = snippet + "...";
      return snippet;
    }
  }
  return null;
}

// Theme Toggle
function applyTheme(t) {
  const root = document.documentElement;
  root.setAttribute("data-theme", t);
  const icon = $("#theme-icon");
  if (icon) {
    icon.setAttribute("data-lucide", t === "dark" ? "sun" : "moon");
    refreshIcons();
  }
  const hljsTheme = $("#hljs-theme");
  if (hljsTheme) {
    hljsTheme.href = t === "dark"
      ? "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css"
      : "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css";
  }
  try { localStorage.setItem("agy-theme", t); } catch (_) {}
}

function initTheme() {
  let t = "light";
  try { t = localStorage.getItem("agy-theme") || "light"; } catch (_) {}
  applyTheme(t);
}

// Thinking & Tools Visibility Mode
function applyThinkingVisibility(show, withToast = false) {
  state.showThinking = !!show;
  document.body.classList.toggle("hide-thinking-tools", !state.showThinking);
  const toggleInput = $("#toggle-thinking");
  if (toggleInput) {
    toggleInput.checked = state.showThinking;
  }
  try {
    localStorage.setItem("agy-show-thinking", state.showThinking ? "true" : "false");
  } catch (_) {}
  refreshIcons();
  if (withToast) {
    showToast(state.showThinking ? "已开启工具调用显示" : "已隐藏工具调用详情");
  }
}

function initThinkingToggle() {
  if (localStorage.getItem("agy-show-thinking") == null) {
    try { localStorage.setItem("agy-show-thinking", "true"); } catch (_) {}
    state.showThinking = true;
  }
  applyThinkingVisibility(state.showThinking);
  const toggleRow = $("#toggle-thinking-row");
  const toggleInput = $("#toggle-thinking");
  if (toggleInput) {
    toggleInput.addEventListener("change", (e) => {
      applyThinkingVisibility(e.target.checked, true);
    });
  }
  if (toggleRow) {
    toggleRow.addEventListener("click", (e) => {
      if (e.target !== toggleInput) {
        if (toggleInput) {
          toggleInput.checked = !toggleInput.checked;
          applyThinkingVisibility(toggleInput.checked, true);
        }
      }
    });
  }
}

// Render Sidebar & Usage Summary
function updateUsageSummary(quotaData = null) {
  if (quotaData) {
    state.latestUsageData = quotaData;
    try { localStorage.setItem("agy-cached-usage", JSON.stringify(quotaData)); } catch (_) {}
  }
  const current = quotaData || state.latestUsageData;
  const applyQuotaDisplay = (data) => {
    if (!data || !data.windows || !data.windows.fiveHour) return;
    const w = data.windows.fiveHour;
    const tierBadge = data.tierBadge || 'AI Pro';
    const badgeEl = $("#usage-sidebar-badge");
    if (badgeEl) {
      badgeEl.textContent = `${tierBadge} ${w.percent}%`;
      badgeEl.title = `${data.tier || '账号配额'}: ${w.percent}% (${w.resetsIn || ''}后重置)`;
    }
  };

  if (current && current.windows && current.windows.fiveHour) {
    applyQuotaDisplay(current);
  } else {
    fetch("/api/usage").then((r) => r.json()).then((d) => {
      state.latestUsageData = d;
      try { localStorage.setItem("agy-cached-usage", JSON.stringify(d)); } catch (_) {}
      applyQuotaDisplay(d);
    }).catch(() => {});
  }
}

function renderLoginArea() {
  const area = $("#login-area");
  area.innerHTML = "";
  const st = state.status;
  const authed = Boolean(st && st.cli && st.cli.installed && st.cli.authenticated);

  updateUsageSummary();

  const googleAcc = st && st.googleAccount;
  if (googleAcc) {
    const userWrap = el("div", "flex items-center gap-2");
    userWrap.style.cssText = "cursor:pointer;padding:2px 8px 2px 4px;border-radius:18px;background:var(--bg-secondary);border:1px solid var(--border-color);display:inline-flex;align-items:center;";
    userWrap.title = `Google 授权账号: ${googleAcc.name || ''} (${googleAcc.email})\n[${googleAcc.tier || 'Google AI Pro'}]\n点击打开模型用量与配额中心`;
    userWrap.onclick = () => showAccountSwitcher();

    const tierType = googleAcc.tierType || (googleAcc.tier?.includes('Pro') ? 'pro' : googleAcc.tier?.includes('Enterprise') ? 'enterprise' : 'free');
    const badgeText = tierType === 'pro' ? 'PRO' : tierType === 'enterprise' ? 'ENT' : 'FREE';

    const frame = el("div", `header-avatar-frame ${tierType}`);
    if (tierType === 'pro') {
      const crown = el("span", "header-avatar-crown", "👑");
      frame.append(crown);
    }
    if (googleAcc.picture) {
      const img = el("img", "");
      img.src = googleAcc.picture;
      frame.append(img);
    } else {
      const initial = (googleAcc.name || googleAcc.email || "G").charAt(0).toUpperCase();
      const textAvatar = el("div", "", initial);
      textAvatar.style.cssText = "width:100%;height:100%;border-radius:50%;background:var(--accent);color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;";
      frame.append(textAvatar);
    }
    const badge = el("span", `header-avatar-badge ${tierType}`, badgeText);
    frame.append(badge);
    userWrap.append(frame);

    const nameSpan = el("span", "", googleAcc.name || googleAcc.email);
    nameSpan.style.cssText = "font-size:12px;color:var(--text-primary);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;";
    userWrap.append(nameSpan);

    if (tierType) {
      const pillText = tierType === 'pro' ? 'PRO' : tierType === 'enterprise' ? 'ENT' : 'FREE';
      const pillBg = tierType === 'pro' ? 'linear-gradient(135deg,#f59e0b,#8b5cf6)' : tierType === 'enterprise' ? 'linear-gradient(135deg,#06b6d4,#3b82f6)' : '#64748b';
      const tierPill = el("span", "", pillText);
      tierPill.style.cssText = `font-size:9.5px;font-weight:800;background:${pillBg};color:white;padding:1px 5px;border-radius:10px;line-height:1.2;box-shadow:0 1px 3px rgba(0,0,0,0.2);`;
      userWrap.append(tierPill);
    }

    area.append(userWrap);

    const sidebarUserCard = $("#sidebar-user-card");
    if (sidebarUserCard) {
      sidebarUserCard.style.display = "flex";
      sidebarUserCard.className = `sidebar-user-card ${tierType}`;
      sidebarUserCard.onclick = () => showUsageModal();
      sidebarUserCard.title = "点击查看 Google AI Pro 配额与用量详情";
      sidebarUserCard.innerHTML = `
        <div class="header-avatar-frame ${tierType}" style="width:28px;height:28px;">
          ${tierType === 'pro' ? '<span class="header-avatar-crown">👑</span>' : ''}
          <img src="${escapeHtml(googleAcc.picture)}" />
          <span class="header-avatar-badge ${tierType}">${badgeText}</span>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(googleAcc.name || 'Google 用户')}</div>
          <div style="font-size:10.5px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(googleAcc.tier || 'Google AI Pro')}</div>
        </div>
        <i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--text-dim);"></i>
      `;
    }

    refreshIcons();
    return;
  }

  if (st && st.user) {
    const userWrap = el("div", "flex items-center gap-2");
    if (st.user.picture) {
      const img = el("img", "avatar");
      img.src = st.user.picture;
      img.style.cssText = "width:26px;height:26px;border-radius:50%;object-fit:cover;";
      userWrap.append(img);
    }
    const nameSpan = el("span", "", st.user.name || st.user.email);
    nameSpan.style.cssText = "font-size:12px;color:var(--text-muted);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    userWrap.append(nameSpan);

    const logoutBtn = el("button", "btn btn-ghost btn-icon");
    logoutBtn.title = "退出登录";
    logoutBtn.innerHTML = `<i data-lucide="log-out" style="width:15px;height:15px;"></i>`;
    logoutBtn.onclick = async () => {
      await fetch("/auth/logout", { method: "POST" });
      location.reload();
    };
    userWrap.append(logoutBtn);
    area.append(userWrap);
    refreshIcons();
    return;
  }

  if (st && st.cli && st.cli.installed) {
    const connectBtn = el("button", "btn " + (authed ? "btn-ghost" : "btn-primary"));
    connectBtn.style.padding = "4px 10px";
    connectBtn.style.fontSize = "12px";
    connectBtn.innerHTML = authed
      ? `<i data-lucide="shield-check" style="width:14px;height:14px;color:var(--success);"></i><span>已认证</span>`
      : `<i data-lucide="key-round" style="width:14px;height:14px;"></i><span>Google 登录</span>`;
    connectBtn.onclick = () => showCliLogin();
    area.append(connectBtn);
    refreshIcons();
    return;
  }

  const oauthBtn = el("button", "btn btn-primary");
  oauthBtn.textContent = "Google 登录";
  oauthBtn.onclick = () => {
    if (!state.status || !state.status.oauthConfigured) {
      toast("请先安装 Antigravity CLI 或配置 clientId");
      return;
    }
    location.href = "/auth/login";
  };
  area.append(oauthBtn);
}

// Conversation List
function renderConvList() {
  const list = $("#conv-list");
  list.innerHTML = "";
  const rawQuery = (state.searchQuery || "").trim();
  const query = rawQuery.toLowerCase();

  // Search stats & clear button state
  const clearBtn = $("#btn-clear-search");
  const kbdHint = $("#search-kbd-hint");
  const searchStats = $("#search-stats");
  const searchCountText = $("#search-count-text");

  if (clearBtn && kbdHint) {
    if (rawQuery) {
      clearBtn.style.display = "flex";
      kbdHint.style.display = "none";
    } else {
      clearBtn.style.display = "none";
      kbdHint.style.display = "inline-block";
    }
  }

  const filtered = state.conversations.filter((c) => {
    if (!query) return true;
    const titleMatch = (c.title || "").toLowerCase().includes(query);
    if (titleMatch) return true;
    return (c.messages || []).some(m => String(m.content || "").toLowerCase().includes(query));
  });

  if (searchStats && searchCountText) {
    if (rawQuery) {
      searchStats.style.display = "flex";
      searchCountText.textContent = `共 ${filtered.length} 条匹配`;
    } else {
      searchStats.style.display = "none";
    }
  }

  if (filtered.length === 0) {
    if (rawQuery) {
      const emptyCard = el("div", "search-empty-card");
      emptyCard.innerHTML = `
        <div class="search-empty-icon-wrap">
          <i data-lucide="search-x" style="width: 20px; height: 20px;"></i>
        </div>
        <div class="search-empty-text">未找到相关会话</div>
        <div class="search-empty-sub">没有与「${escapeHtml(rawQuery)}」匹配的内容</div>
        <button class="search-empty-btn" id="btn-empty-clear">清空搜索</button>
      `;
      const emptyClearBtn = emptyCard.querySelector("#btn-empty-clear");
      if (emptyClearBtn) {
        emptyClearBtn.onclick = clearSessionSearch;
      }
      list.append(emptyCard);
    } else {
      const empty = el("div", "", "暂无历史会话");
      empty.style.cssText = "padding:28px 12px;text-align:center;color:var(--text-dim);font-size:12px;";
      list.append(empty);
    }
    refreshIcons();
    return;
  }

  filtered.forEach((c) => {
    const isCur = c.id === state.activeId;
    const isRunning = activeClientRuns.has(c.id);
    const item = el("div", "session-item" + (isCur ? " active" : "") + (isRunning ? " running" : ""));
    
    // Top row
    const row = el("div", "session-row");
    const main = el("div", "session-main");
    
    // Icon
    const icon = document.createElement("i");
    if (isRunning) {
      icon.setAttribute("data-lucide", "loader-2");
      icon.className = "session-icon spin-icon";
    } else {
      icon.setAttribute("data-lucide", isCur ? "message-square-dot" : "message-square");
      icon.className = "session-icon";
    }
    
    // Title
    const titleSpan = el("span", "session-title");
    if (rawQuery) {
      titleSpan.innerHTML = highlightMatch(c.title || "新对话", rawQuery);
    } else {
      titleSpan.textContent = c.title || "新对话";
    }
    titleSpan.title = c.title || "新对话";

    main.append(icon);
    main.append(titleSpan);
    row.append(main);

    // Actions
    const actions = el("div", "session-actions");
    
    // Rename button
    const renameBtn = el("button", "session-action-btn");
    renameBtn.title = "重命名";
    renameBtn.innerHTML = `<i data-lucide="edit-3" style="width:13px;height:13px;"></i>`;
    renameBtn.onclick = (e) => {
      e.stopPropagation();
      promptRenameConv(c.id);
    };

    // Delete button
    const delBtn = el("button", "session-action-btn");
    delBtn.title = "删除会话";
    delBtn.innerHTML = `<i data-lucide="trash-2" style="width:13px;height:13px;"></i>`;
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteConv(c.id);
    };

    actions.append(renameBtn);
    actions.append(delBtn);
    row.append(actions);
    item.append(row);

    // If searching, check for message match snippet
    if (rawQuery) {
      const snippet = findSnippetMatch(c.messages, rawQuery);
      if (snippet) {
        const snippetEl = el("div", "session-snippet");
        snippetEl.innerHTML = highlightMatch(snippet, rawQuery);
        item.append(snippetEl);
      }
    }

    item.onclick = () => selectConv(c.id);
    list.append(item);
  });
  refreshIcons();
}

function clearSessionSearch() {
  const input = $("#session-search");
  if (input) {
    input.value = "";
    state.searchQuery = "";
    renderConvList();
    input.focus();
  }
}

function promptRenameConv(id) {
  const c = state.conversations.find((x) => x.id === id);
  if (!c) return;
  const newName = prompt("请输入会话新名称：", c.title);
  if (newName && newName.trim()) {
    c.title = newName.trim();
    saveConversations(true);
    renderConvList();
  }
}

function selectConv(id) {
  state.activeId = id;
  state.streaming = activeClientRuns.has(id);
  renderConvList();
  paintActiveConv();
  closeSidebar();
  updateSendButton();
  if (!activeClientRuns.has(id)) {
    tryReconnectToOngoingRun();
  }
}

async function deleteConv(id) {
  const running = activeClientRuns.get(id);
  if (running) {
    if (running.ws) { try { running.ws.close(); } catch (_) {} }
    if (running.abortCtrl) { running.abortCtrl.abort(); }
    activeClientRuns.delete(id);
  }
  const idx = state.conversations.findIndex((c) => c.id === id);
  if (idx === -1) return;
  state.conversations.splice(idx, 1);
  if (state.activeId === id) {
    const next = state.conversations[idx] || state.conversations[idx - 1];
    state.activeId = next ? next.id : null;
  }
  try {
    await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (_) {}
  saveConversations(true);
  renderConvList();
  paintActiveConv();
  updateSendButton();
}

function newChat(silent = false) {
  const c = {
    id: "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: "新对话",
    messages: [],
    convId: "",
    createdAt: Date.now()
  };
  state.conversations.unshift(c);
  state.activeId = c.id;
  state.streaming = false;
  saveConversations();
  // 同步到服务器：新建对话立即落盘 data/sessions/<id>.json，不只存浏览器
  try {
    fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, title: c.title, messages: c.messages, convId: c.convId, createdAt: c.createdAt, updatedAt: c.createdAt })
    }).catch(() => {});
  } catch (_) {}
  renderConvList();
  paintActiveConv();
  updateSendButton();
  if (!silent) closeSidebar();
  $("#input").focus();
}

// Sidebar Drawer (Mobile)
function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#sidebar-backdrop").classList.remove("hidden");
}
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebar-backdrop").classList.add("hidden");
}

$("#btn-menu").addEventListener("click", () => {
  const s = $("#sidebar");
  s.classList.contains("open") ? closeSidebar() : openSidebar();
});
$("#sidebar-backdrop").addEventListener("click", closeSidebar);

// Session search
const sessionSearchInput = $("#session-search");
if (sessionSearchInput) {
  sessionSearchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderConvList();
  });
  sessionSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (sessionSearchInput.value) {
        clearSessionSearch();
      } else {
        sessionSearchInput.blur();
      }
    }
  });
}

$("#btn-clear-search")?.addEventListener("click", (e) => {
  e.preventDefault();
  clearSessionSearch();
});

$("#btn-cancel-search")?.addEventListener("click", (e) => {
  e.preventDefault();
  clearSessionSearch();
});



// Markdown & Code Highlighting Parser with Continuous Streaming Thinking Support
function formatMarkdown(text, isStreaming = false) {
  if (!text) return "";
  let processed = text.replace(/\u200b/g, "");
  
  // 1. Handle complete <thought>...</thought> OR <thinking>...</thinking> blocks (默认收纳折叠，用户点击展开后永久记忆状态，流式刷新不自动收起)
  let thoughtBlockIdx = 0;
  processed = processed.replace(/<(?:thought|thinking)>([\s\S]*?)<\/(?:thought|thinking)>/gi, (match, p1) => {
    const tKey = `thought_block_${thoughtBlockIdx++}_${p1.trim().slice(0, 20).replace(/\s+/g, '_')}`;
    const isOpen = isDetailsExpanded(tKey, false);
    return `<details class="thinking-block" data-thought-key="${escapeHtml(tKey)}" ${isOpen ? 'open' : ''}><summary class="thinking-summary"><span style="display:flex;align-items:center;gap:6px;"><span>💭</span><span style="font-weight:500;">深度思考过程</span></span><span style="font-size:11px;opacity:0.6;">▾</span></summary><div class="thinking-content">${escapeHtml(p1.trim())}</div></details>`;
  });

  // 2. Handle ACTIVE / UNCLOSED <thought> or <thinking> (流式中展开打印，非流式安全闭合折叠)
  let activeThinkingHtml = "";
  const thoughtMatch = processed.match(/<(?:thought|thinking)>([\s\S]*)$/i);
  if (thoughtMatch) {
    const idx = thoughtMatch.index;
    const beforeThought = processed.substring(0, idx);
    const currentThought = thoughtMatch[1];
    if (isStreaming) {
      activeThinkingHtml = `<details class="thinking-block active" data-thought-key="active_streaming_thought" open><summary class="thinking-summary"><span style="display:flex;align-items:center;gap:6px;"><span class="thinking-dots"><i></i><i></i><i></i></span><span style="color:var(--accent);font-weight:600;">正在实时深度思考中...</span></span><span style="font-size:11px;opacity:0.6;">▾</span></summary><div class="thinking-content">${escapeHtml(currentThought)}<span class="streaming-cursor"></span></div></details>`;
      processed = beforeThought;
    } else {
      const tKey = `thought_closed_${currentThought.trim().slice(0, 20).replace(/\s+/g, '_')}`;
      const isOpen = isDetailsExpanded(tKey, false);
      const closedThought = `<details class="thinking-block" data-thought-key="${escapeHtml(tKey)}" ${isOpen ? 'open' : ''}><summary class="thinking-summary"><span style="display:flex;align-items:center;gap:6px;"><span>💭</span><span style="font-weight:500;">深度思考过程</span></span><span style="font-size:11px;opacity:0.6;">▾</span></summary><div class="thinking-content">${escapeHtml(currentThought.trim())}</div></details>`;
      processed = beforeThought + closedThought;
    }
  }

  let finalHtml = "";
  if (processed.trim()) {
    if (typeof marked !== "undefined") {
      try {
        // Fix unclosed code fences during streaming so markdown AST doesn't break
        let textToParse = processed;
        if (isStreaming) {
          const fenceCount = (textToParse.match(/```/g) || []).length;
          if (fenceCount % 2 !== 0) {
            textToParse += "\n```";
          }
        }

        let rawHtml = marked.parse(textToParse);
        // Wrap code blocks with modern collapsible details structure (默认收纳折叠)
        rawHtml = rawHtml.replace(/<pre><code class="language-([^">]+)">([\s\S]*?)<\/code><\/pre>/gi, (match, lang, code) => {
          const lineCount = code.split(/\r\n|\r|\n/).length;
          return `
            <details class="code-block-wrapper">
              <summary class="code-block-header">
                <div class="code-header-left">
                  <span class="code-toggle-arrow">▾</span>
                  <span class="code-tag-badge">${escapeHtml(lang)}</span>
                  <span class="code-line-info">${lineCount} 行代码</span>
                </div>
                <div class="code-header-right" onclick="event.stopPropagation()">
                  <button class="copy-code-btn" onclick="copyCodeFromBlock(this)" title="复制全部代码">
                    <i data-lucide="copy" style="width:12px;height:12px;"></i> 复制
                  </button>
                </div>
              </summary>
              <div class="code-content-body">
                <pre><code class="language-${lang}">${code}</code></pre>
              </div>
            </details>
          `;
        });
        rawHtml = rawHtml.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, (match, code) => {
          const lineCount = code.split(/\r\n|\r|\n/).length;
          return `
            <details class="code-block-wrapper">
              <summary class="code-block-header">
                <div class="code-header-left">
                  <span class="code-toggle-arrow">▾</span>
                  <span class="code-tag-badge">CODE</span>
                  <span class="code-line-info">${lineCount} 行代码</span>
                </div>
                <div class="code-header-right" onclick="event.stopPropagation()">
                  <button class="copy-code-btn" onclick="copyCodeFromBlock(this)" title="复制全部代码">
                    <i data-lucide="copy" style="width:12px;height:12px;"></i> 复制
                  </button>
                </div>
              </summary>
              <div class="code-content-body">
                <pre><code>${code}</code></pre>
              </div>
            </details>
          `;
        });

        // 自动将 Markdown 中的本地图片路径（如 /vol1/...、file://...、brain/...、scratch/...）转换为 Web 可直接渲染的图片 URL 并绑定点击放大
        rawHtml = rawHtml.replace(/<img\s+([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi, (match, prefix, src, suffix) => {
          let finalSrc = src;
          if (src.startsWith('file://') || src.startsWith('/vol1/') || src.startsWith('/home/') || src.includes('/brain/') || src.includes('/scratch/')) {
            const fn = src.split('/').pop().split('?')[0];
            finalSrc = `/api/assets/files/${encodeURIComponent(fn)}`;
          }
          return `<div class="chat-embedded-image-wrap" style="margin:10px 0;max-width:100%;"><img ${prefix}src="${finalSrc}"${suffix} style="max-width:100%;max-height:480px;border-radius:10px;cursor:pointer;display:block;box-shadow:0 4px 18px rgba(0,0,0,0.25);transition:transform 0.2s ease;" onclick="openImageLightbox(this.src)" title="点击全屏查看大图" onmouseover="this.style.opacity='0.92'" onmouseout="this.style.opacity='1'" /><span style="display:inline-block;margin-top:4px;font-size:11px;color:var(--text-dim);">🔍 点击图片可放大全屏预览</span></div>`;
        });

        finalHtml = rawHtml;
      } catch (_) {
        finalHtml = escapeHtml(processed).replace(/\n/g, "<br/>");
      }
    } else {
      finalHtml = escapeHtml(processed).replace(/\n/g, "<br/>");
    }
  }

  let result = activeThinkingHtml ? (activeThinkingHtml + finalHtml) : finalHtml;
  if (isStreaming && !activeThinkingHtml && result) {
    result += `<span class="streaming-cursor"></span>`;
  }
  return result || (isStreaming ? `
    <div class="thinking-active-indicator"><span class="thinking-dots"><i></i><i></i><i></i></span><span style="font-size:12.5px;color:var(--text-muted);">正在思考中...</span></div>
  ` : "");
}

window.copyCodeFromBlock = function(btn) {
  const wrapper = btn.closest(".code-block-wrapper");
  if (!wrapper) return;
  const code = wrapper.querySelector("code");
  if (!code) return;
  const text = code.innerText || code.textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = `<i data-lucide="check" style="width:12px;height:12px;color:var(--success);"></i> 已复制`;
    refreshIcons();
    setTimeout(() => {
      btn.innerHTML = `<i data-lucide="copy" style="width:12px;height:12px;"></i> 复制`;
      refreshIcons();
    }, 2000);
  }).catch(() => toast("复制失败"));
};

// Paint Active Conversation
function paintActiveConv() {
  const c = activeConv();
  const feed = $("#chat-feed");
  const empty = $("#chat-empty");
  feed.innerHTML = "";

  const running = c ? activeClientRuns.get(c.id) : null;
  const isConvRunning = !!(running || c?.isRunning);

  if (!c || !c.messages || c.messages.length === 0) {
    if (!isConvRunning) {
      empty.classList.remove("hidden");
      feed.classList.add("hidden");
      state.streaming = false;
      updateSendButton();
      return;
    }
  }

  empty.classList.add("hidden");
  feed.classList.remove("hidden");

  if (c && c.messages) {
    // 关键防重叠与防闪烁：如果当前会话后台在运行中，末尾正在生成的 assistant 消息由下方 liveNode 流式接管
    const msgsToPaint = (isConvRunning && c.messages.length > 0 && c.messages[c.messages.length - 1].role === 'assistant')
      ? c.messages.slice(0, -1)
      : c.messages;
    msgsToPaint.forEach((m) => {
      appendMsgRow(m.role, m.content, false, m.meta, m.tools);
    });
  }

  if (c) {
    if (running) {
      const liveNode = appendMsgRow("assistant", running.acc || "", true, null, running.toolEvents);
      running.asstNode = liveNode;
      state.streaming = true;
      if (typeof updateAssistantBubble === 'function') {
        updateAssistantBubble(liveNode, running.acc, running.toolEvents, true, null, running.latestTip, running.latestWaited);
      }
    } else if (c.isRunning) {
      // 服务端仍在生成，但 WebSocket 重连还在建立途中：立即展示流式思考指示器，杜绝空白或闪烁！
      const lastMsg = c.messages && c.messages[c.messages.length - 1];
      const initialTools = (lastMsg?.role === 'assistant' && Array.isArray(lastMsg.tools)) ? lastMsg.tools : [];
      const initialAcc = (lastMsg?.role === 'assistant') ? (lastMsg.content || '') : '';
      const liveNode = appendMsgRow("assistant", initialAcc, true, null, initialTools);
      state.streaming = true;
      if (typeof updateAssistantBubble === 'function') {
        updateAssistantBubble(liveNode, initialAcc, initialTools, true, null, "正在进行深度逻辑推理与代码分析...", 0);
      }
    } else {
      state.streaming = false;
    }
  }
  scrollToBottom(true);
  setTimeout(() => scrollToBottom(true), 60);
  setTimeout(() => scrollToBottom(true), 200);
  refreshIcons();
  updateSendButton();
}

function appendMsgRow(role, content, isStreaming = false, meta = null, tools = null) {
  const feed = $("#chat-feed");
  const row = el("div", "message-row " + role + (isStreaming ? " streaming" : ""));
  
  const avatar = el("div", "message-avatar");
  if (role === "user") {
    const googleAcc = state.status?.googleAccount;
    const tierType = googleAcc?.tierType || (googleAcc?.tier?.includes('Pro') ? 'pro' : googleAcc?.tier?.includes('Enterprise') ? 'enterprise' : 'free');
    const badgeText = tierType === 'pro' ? 'PRO' : tierType === 'enterprise' ? 'ENT' : 'FREE';

    avatar.className = `message-avatar user-chat-avatar-frame ${tierType}`;
    if (googleAcc && googleAcc.picture) {
      avatar.innerHTML = `
        ${tierType === 'pro' ? '<span class="header-avatar-crown">👑</span>' : ''}
        <img src="${escapeHtml(googleAcc.picture)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />
        <span class="header-avatar-badge ${tierType}">${badgeText}</span>
      `;
    } else {
      const initial = (googleAcc?.name || googleAcc?.email || "U").charAt(0).toUpperCase();
      avatar.innerHTML = `
        ${tierType === 'pro' ? '<span class="header-avatar-crown">👑</span>' : ''}
        <div style="width:100%;height:100%;border-radius:50%;background:var(--accent);color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${initial}</div>
        <span class="header-avatar-badge ${tierType}">${badgeText}</span>
      `;
    }
  } else if (role === "error") {
    avatar.innerHTML = `<i data-lucide="alert-triangle" style="width:16px;height:16px;"></i>`;
  } else {
    avatar.className = "message-avatar assistant-chat-avatar-frame";
    avatar.innerHTML = `
      <div style="width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#080b12;color:white;box-shadow:0 0 8px rgba(249,115,22,0.4);">
        <svg viewBox="0 0 113 113" height="20" width="20" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-left: 2px;">
          <path d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z" fill="#3186FF"/>
          <mask id="mask_appjs" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="13" y="18" width="85" height="78">
            <path d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z" fill="black"/>
          </mask>
          <g mask="url(#mask_appjs)">
            <ellipse cx="22.7873" cy="26.8098" rx="22.7873" ry="26.8098" transform="matrix(-0.112784 0.99362 -0.99362 -0.112781 66.2473 -15.5344)" fill="#FFE432"/>
            <ellipse cx="96.491" cy="35.1231" rx="29.5007" ry="30.1492" transform="rotate(76.9243 96.491 35.1231)" fill="#FC413D"/>
            <ellipse cx="9.02988" cy="41.6647" rx="30.832" ry="39.9417" transform="rotate(74.1257 9.02988 41.6647)" fill="#00B95C"/>
            <ellipse cx="11.2212" cy="42.8915" rx="30.22" ry="33.2695" transform="rotate(45.6065 11.2212 42.8915)" fill="#00B95C"/>
            <ellipse cx="75.7546" cy="104.822" rx="29.0177" ry="27.943" transform="rotate(76.9243 75.7546 104.822)" fill="#3186FF"/>
            <ellipse cx="33.5661" cy="35.4043" rx="33.5661" ry="35.4043" transform="matrix(-0.409539 0.912293 -0.912294 -0.409537 101.25 -15.1674)" fill="#FBBC04"/>
            <path d="M2.56802 149.695C-15.8116 142.48 15.5987 83.1163 23.4093 63.2203C31.22 43.3244 52.4514 33.0447 70.831 40.26C89.2107 47.4753 110.996 87.2162 103.185 107.112C95.3742 127.008 20.9477 156.91 2.56802 149.695Z" fill="#3186FF"/>
            <path d="M113.934 75.8079C109.013 81.5509 96.1724 78.6224 85.253 69.2667C74.3335 59.911 69.4704 47.6711 74.391 41.928C79.3116 36.185 92.1525 39.1136 103.072 48.4692C113.991 57.8249 118.855 70.0648 113.934 75.8079Z" fill="#749BFF"/>
            <ellipse cx="92.611" cy="23.7962" rx="44.2411" ry="27.5016" transform="rotate(34.0763 92.611 23.7962)" fill="#FC413D"/>
            <ellipse cx="23.4949" cy="29.5887" rx="23.7071" ry="13.7869" transform="rotate(112.516 23.4949 29.5887)" fill="#FFEE48"/>
          </g>
        </svg>
      </div>
      <span class="header-avatar-badge pro" style="bottom:-2px;right:-3px;font-size:7px;background:linear-gradient(135deg,#8b5cf6,#ec4899);">AI</span>
    `;
  }

  const contentCol = el("div", "message-content");
  
  const header = el("div", "message-header");
  header.textContent = role === "user" ? "You" : (state.selectedModel || "Antigravity Agent");
  contentCol.append(header);

  let bubble;
  if (role === "assistant") {
    bubble = el("div", "message-bubble markdown-body");
    const clean = String(content || "").replace(/[\u200b\s]/g, "");
    const toolsHtml = renderToolsTimeline(tools, -1);
    const toolsFingerprint = `${tools ? tools.length : 0}#-1#${(tools || []).map(e => `${e.tool || e.name || ''}:${e.state || ''}:${(e.output || '').length}:${e.waited || 0}`).join(';')}`;
    let bodyHtml = "";
    if (isStreaming && !clean) {
      bodyHtml = `<div class="thinking-active-indicator" style="display:flex;align-items:center;gap:7px;"><span class="thinking-dots"><i></i><i></i><i></i></span><span class="thinking-status-text" style="font-size:12.5px;color:var(--text-muted);font-weight:500;">正在连接模型并解析任务意图 (0s)...</span></div>`;
    } else {
      bodyHtml = formatMarkdown(content);
      if (!isStreaming && clean) {
        bodyHtml += getMessageQuotaFooterHtml(clean, meta, meta?.model || state.selectedModel);
      }
    }
    bubble.innerHTML = `
      <div class="bubble-tools-wrap" data-fingerprint="${escapeHtml(toolsFingerprint)}">${toolsHtml}</div>
      <div class="bubble-body-wrap">${bodyHtml}</div>
    `;
  } else {
    bubble = el("div", "message-bubble");
    let raw = String(content || "");
    let images = [];
    let files = [];

    raw = raw.replace(/<images_input>([\s\S]*?)<\/images_input>/g, (_, paths) => {
      paths.split('\n').map(p => p.trim()).filter(Boolean).forEach(p => images.push(p));
      return '';
    });
    raw = raw.replace(/<files_input>([\s\S]*?)<\/files_input>/g, (_, paths) => {
      paths.split('\n').map(p => p.trim()).filter(Boolean).forEach(p => files.push(p));
      return '';
    });
    raw = raw.trim();

    let html = "";
    if (images.length) {
      html += `<div class="user-msg-images" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:${raw ? '8px' : '0'};">`;
      images.forEach(imgPath => {
        const fn = imgPath.split('/').pop();
        html += `<img src="/api/assets/files/${encodeURIComponent(fn)}" style="max-width:240px;max-height:180px;border-radius:8px;cursor:pointer;border:1px solid rgba(255,255,255,0.2);object-fit:cover;background:rgba(0,0,0,0.2);" onclick="openImageLightbox(this.src)" title="点击查看大图" />`;
      });
      html += `</div>`;
    }
    if (files.length) {
      html += `<div class="user-msg-files" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${raw ? '8px' : '0'};">`;
      files.forEach(filePath => {
        const fn = filePath.split('/').pop();
        html += `<a href="/api/assets/files/${encodeURIComponent(fn)}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:6px;background:rgba(0,0,0,0.15);font-size:12px;color:inherit;text-decoration:none;">📎 ${escapeHtml(fn)}</a>`;
      });
      html += `</div>`;
    }
    if (raw) {
      html += `<div style="white-space:pre-wrap;">${escapeHtml(raw)}</div>`;
    }
    bubble.innerHTML = html || `<span style="font-style:italic;opacity:0.8;">[发送了附件]</span>`;
  }
  contentCol.append(bubble);

  row.append(avatar);
  row.append(contentCol);
  feed.append(row);
  scrollToBottom(true);
  refreshIcons();

  return { row, bubble };
}

// Models & Controls
async function refreshModels() {
  try {
    const r = await fetch("/api/models");
    const data = await r.json();
    state.models = data.models || [];
    renderModelSelect();
  } catch (_) {
    state.models = [];
  }
}

function formatModelDisplayName(m) {
  if (!m) return "";
  if (m.startsWith("gemini-3.8-flash")) return "Gemini 3.8 Flash";
  if (m.startsWith("gemini-3.7-flash")) return "Gemini 3.7 Flash";
  if (m.startsWith("gemini-3.6-flash")) return "Gemini 3.6 Flash";
  if (m.startsWith("gemini-3.5-flash")) return "Gemini 3.5 Flash";
  if (m.startsWith("gemini-3.1-pro")) return "Gemini 3.1 Pro";
  if (m.includes("claude-sonnet")) return "Claude Sonnet 4.6";
  if (m.includes("claude-opus")) return "Claude Opus 4.6 (Thinking)";
  if (m.includes("gpt-oss")) return "GPT-OSS 120B";
  return m;
}

function formatModelShortName(m) {
  if (!m) return "";
  if (m.startsWith("gemini-3.8")) return "Gemini 3.8";
  if (m.startsWith("gemini-3.7")) return "Gemini 3.7";
  if (m.startsWith("gemini-3.6")) return "Gemini 3.6";
  if (m.startsWith("gemini-3.5")) return "Gemini 3.5";
  if (m.startsWith("gemini-3.1")) return "Gemini 3.1 Pro";
  if (m.includes("claude-sonnet")) return "Claude Sonnet";
  if (m.includes("claude-opus")) return "Claude Opus";
  if (m.includes("gpt-oss")) return "GPT-OSS";
  return m;
}

function getBaseModels(rawModels) {
  const cleanList = [];
  const seen = new Set();
  
  const predefined = [
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)" },
    { id: "gpt-oss-120b", label: "GPT-OSS 120B" }
  ];

  predefined.forEach((p) => {
    const matched = (rawModels || []).some((m) => m.startsWith(p.id) || m === p.id);
    if (matched || !rawModels || rawModels.length === 0) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        cleanList.push(p);
      }
    }
  });

  // 加入其他 CLI 发现的模型
  (rawModels || []).forEach((m) => {
    // 忽略带后缀的模型名称, 归类为基础模型
    const baseId = m.replace(/-(low|medium|high|off)$/i, "");
    if (!seen.has(baseId)) {
      seen.add(baseId);
      cleanList.push({ id: baseId, label: formatModelDisplayName(baseId) });
    }
  });

  return cleanList;
}

function resolveActualModelName(baseModel, effort) {
  if (!baseModel) return "gemini-3.8-flash-high";
  const eff = String(effort || "").trim().toLowerCase();
  
  if (baseModel.startsWith("gemini-3.8-flash")) {
    if (eff === "high") return "gemini-3.8-flash-high";
    if (eff === "medium") return "gemini-3.8-flash-medium";
    if (eff === "low") return "gemini-3.8-flash-low";
    if (eff === "off") return "gemini-3.8-flash-low";
    return "gemini-3.8-flash-high";
  }
  if (baseModel.startsWith("gemini-3.7-flash")) {
    if (eff === "high") return "gemini-3.7-flash-high";
    if (eff === "medium") return "gemini-3.7-flash-medium";
    if (eff === "low") return "gemini-3.7-flash-low";
    if (eff === "off") return "gemini-3.7-flash-low";
    return "gemini-3.7-flash-high";
  }
  if (baseModel.startsWith("gemini-3.6-flash")) {
    if (eff === "low") return "gemini-3.6-flash-low";
    if (eff === "medium") return "gemini-3.6-flash-medium";
    return "gemini-3.6-flash-high";
  }
  if (baseModel.startsWith("gemini-3.5-flash")) {
    if (eff === "low") return "gemini-3.5-flash-low";
    if (eff === "medium") return "gemini-3.5-flash-medium";
    return "gemini-3.5-flash-high";
  }
  if (baseModel.startsWith("gemini-3.1-pro")) {
    if (eff === "low") return "gemini-3.1-pro-low";
    return "gemini-3.1-pro-high";
  }
  return baseModel;
}

function updateEffortDropdown(baseModel) {
  const effortWrap = $("#effort-wrap");
  const effortSelect = $("#effort");
  if (!effortWrap || !effortSelect) return;

  const currentModels = state.models || [];
  const availableEfforts = [];

  if (baseModel.startsWith("gemini-3.8-flash") || baseModel.startsWith("gemini-3.7-flash")) {
    availableEfforts.push(
      { value: "high", label: "思考: 高" },
      { value: "medium", label: "思考: 中" },
      { value: "low", label: "思考: 低" },
      { value: "off", label: "思考: 关" }
    );
  } else if (baseModel.startsWith("gemini-3.1-pro")) {
    availableEfforts.push(
      { value: "high", label: "思考: 高" },
      { value: "low", label: "思考: 低" }
    );
  } else if (baseModel.startsWith("gemini-3.6-flash") || baseModel.startsWith("gemini-3.5-flash")) {
    availableEfforts.push(
      { value: "high", label: "思考: 高" },
      { value: "medium", label: "思考: 中" },
      { value: "low", label: "思考: 低" }
    );
  } else {
    const hasHigh = currentModels.some((m) => m === `${baseModel}-high` || m.includes(`${baseModel}-high`));
    const hasMedium = currentModels.some((m) => m === `${baseModel}-medium` || m.includes(`${baseModel}-medium`));
    const hasLow = currentModels.some((m) => m === `${baseModel}-low` || m.includes(`${baseModel}-low`));

    if (hasHigh) availableEfforts.push({ value: "high", label: "思考: 高" });
    if (hasMedium) availableEfforts.push({ value: "medium", label: "思考: 中" });
    if (hasLow) availableEfforts.push({ value: "low", label: "思考: 低" });
  }

  if (availableEfforts.length === 0) {
    effortWrap.style.display = "none";
  } else {
    effortWrap.style.display = "inline-flex";
    const oldVal = effortSelect.value || localStorage.getItem("agy-effort") || "high";
    effortSelect.innerHTML = "";
    availableEfforts.forEach((opt) => {
      const o = el("option", "", opt.label);
      o.value = opt.value;
      effortSelect.append(o);
    });

    if (availableEfforts.some((o) => o.value === oldVal)) {
      effortSelect.value = oldVal;
    } else {
      effortSelect.value = availableEfforts[0].value;
    }
  }
}

function renderModelSelect() {
  const sel = $("#model-select");
  sel.innerHTML = "";
  const baseModels = getBaseModels(state.models);
  
  if (!baseModels.length) {
    const o = el("option", "", "无可用模型");
    o.value = "";
    sel.append(o);
    updateEffortDropdown("");
    return;
  }
  
  baseModels.forEach((m) => {
    const o = el("option", "", m.label);
    o.value = m.id;
    sel.append(o);
  });

  let saved = localStorage.getItem("agy-model") || state.selectedModel;
  if (saved) {
    saved = saved.replace(/-(low|medium|high)$/i, "");
  }
  if (!saved || !baseModels.some((m) => m.id === saved)) {
    saved = baseModels[0].id;
  }
  state.selectedModel = saved;
  sel.value = saved;
  updateEffortDropdown(saved);
}

$("#model-select").addEventListener("change", (e) => {
  state.selectedModel = e.target.value;
  try { localStorage.setItem("agy-model", state.selectedModel); } catch (_) {}
  updateEffortDropdown(state.selectedModel);
});


// ── Slash Commands 智能联想菜单系统 ──
const SLASH_COMMANDS = [
  { cmd: '/compact', title: '智能压缩上下文', tag: '省额度必备', tagBg: 'rgba(16,185,129,0.12)', tagColor: '#10b981', tagBorder: 'rgba(16,185,129,0.25)', desc: '【功能说明】自动提炼长对话核心记忆，剔除冗余日志，立省 75%+ Token 算力开销', icon: '⚡', action: 'send' },
  { cmd: '/clear', title: '清空上下文记忆', tag: '开局重置', tagBg: 'rgba(245,158,11,0.12)', tagColor: '#f59e0b', tagBorder: 'rgba(245,158,11,0.25)', desc: '【功能说明】彻底清空当前会话所有历史，恢复 100% 满血轻量状态', icon: '🧹', action: 'newChat' },
  { cmd: '/quota', title: '打开配额中心', tag: '实时监控', tagBg: 'rgba(59,130,246,0.12)', tagColor: '#3b82f6', tagBorder: 'rgba(59,130,246,0.25)', desc: '【功能说明】直连 Google 官方接口查看 4 大核心算力池百分比与精准倒计时', icon: '📊', action: 'quotaModal' },
  { cmd: '/plan', title: '架构计划模式 (Plan)', tag: '安全审查', tagBg: 'rgba(168,85,247,0.12)', tagColor: '#a855f7', tagBorder: 'rgba(168,85,247,0.25)', desc: '【功能说明】让模型在写代码前，先出分步设计方案与验证清单供你审批', icon: '📝', action: 'insert' },
  { cmd: '/goal', title: '自治目标模式 (Goal)', tag: '全自动执行', desc: '【功能说明】设定最终目标，模型自动循环调度与调试直至彻底完成', icon: '🎯', action: 'insert' },
  { cmd: '/undo', title: '一键回滚撤销改动', tag: '代码回滚', tagBg: 'rgba(239,68,68,0.12)', tagColor: '#ef4444', tagBorder: 'rgba(239,68,68,0.25)', desc: '【功能说明】快速回滚模型上一步对工作区和文件所做的代码修改', icon: '↩️', action: 'send' },
  { cmd: '/init', title: '初始化项目架构文档', tag: '规范生成', desc: '【功能说明】扫描当前项目结构，自动生成 AGENTS.md 协作规范与知识库', icon: '🚀', action: 'send' },
  { cmd: '/help', title: '命令与操作指南', tag: '使用帮助', desc: '【功能说明】查看 Antigravity 所有快捷键、操作指南与功能说明', icon: '❓', action: 'help' }
];

let slashPopupEl = null;
let activeSlashIdx = 0;
let filteredSlashCommands = [];

function getSlashPopup() {
  if (!slashPopupEl) {
    slashPopupEl = document.createElement('div');
    slashPopupEl.className = 'slash-popup-container hidden';
    slashPopupEl.style.cssText = "position:absolute; bottom:calc(100% + 12px); left:0; right:0; width:100%; max-height:480px; background:#ffffff !important; border:1.5px solid #cbd5e1 !important; border-radius:18px !important; box-shadow:0 25px 60px -12px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.06) !important; overflow-y:auto; z-index:999999 !important; padding:10px !important; display:flex; flex-direction:column; gap:5px; box-sizing:border-box;";
    const composerBox = document.querySelector('.composer-box') || document.querySelector('.composer-wrap') || document.querySelector('.composer-input-row');
    if (composerBox) composerBox.appendChild(slashPopupEl);
  }
  return slashPopupEl;
}

function hideSlashPopup() {
  if (slashPopupEl && !slashPopupEl.classList.contains('hidden')) {
    slashPopupEl.classList.add('hidden');
    activeSlashIdx = 0;
    filteredSlashCommands = [];
  }
}

function updateSlashHighlight() {
  if (!slashPopupEl || slashPopupEl.classList.contains('hidden')) return;
  slashPopupEl.querySelectorAll('.slash-item').forEach((el, idx) => {
    const isActive = idx === activeSlashIdx;
    if (isActive) {
      el.classList.add('active');
      el.style.background = '#eff6ff';
      el.style.border = '1.5px solid #2563eb';
      el.style.boxShadow = '0 4px 14px rgba(37,99,235,0.18)';
      el.scrollIntoView({ block: 'nearest' });
    } else {
      el.classList.remove('active');
      el.style.background = '#ffffff';
      el.style.border = '1px solid #e2e8f0';
      el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
    }
  });
}

function executeSlashCommand(item) {
  if (!item) return;
  hideSlashPopup();
  if (item.action === 'quotaModal') {
    inputArea.value = '';
    autoResizeInput();
    showUsageModal();
  } else if (item.action === 'newChat') {
    inputArea.value = '';
    autoResizeInput();
    newChat();
  } else if (item.action === 'help') {
    inputArea.value = '';
    autoResizeInput();
    showAbout();
  } else if (item.action === 'refresh') {
    location.reload();
  } else if (item.action === 'toggleDark') {
    toggleTheme();
  } else if (item.action === 'clearInput') {
    inputArea.value = '';
    autoResizeInput();
  } else if (item.action === 'toggleThinking') {
    const toggleInput = $("#toggle-thinking");
    if (toggleInput) {
      toggleInput.checked = !toggleInput.checked;
      applyThinkingVisibility(toggleInput.checked, true);
    }
    inputArea.value = '';
    autoResizeInput();
  } else if (item.action === 'insert') {
    inputArea.value = item.cmd + ' ';
    inputArea.focus();
    autoResizeInput();
  } else if (item.action === 'send') {
    inputArea.value = item.cmd;
    autoResizeInput();
    handleSend();
  } else if (item.prompt) {
    inputArea.value = item.prompt + ' ';
    autoResizeInput();
    inputArea.focus();
  }
}

function renderSlashPopup() {
  const popup = getSlashPopup();
  if (!popup) return;
  if (!filteredSlashCommands.length) {
    hideSlashPopup();
    return;
  }
  popup.classList.remove('hidden');

  const headerHtml = `
    <div class="slash-popup-header" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f8fafc;border-radius:10px;margin-bottom:6px;border:1px solid #e2e8f0;font-size:12.5px;color:#334155;">
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;color:#0f172a;">
        <span>⌨️ 快捷斜杠指令</span>
        <span style="font-size:11px;font-weight:normal;color:#64748b;">(${filteredSlashCommands.length} 个可用)</span>
      </div>
      <div style="font-size:11px;color:#64748b;">
        按 <kbd style="background:#ffffff;padding:1px 5px;border-radius:4px;border:1px solid #cbd5e1;font-size:10.5px;font-weight:600;color:#0f172a;">↑</kbd> <kbd style="background:#ffffff;padding:1px 5px;border-radius:4px;border:1px solid #cbd5e1;font-size:10.5px;font-weight:600;color:#0f172a;">↓</kbd> 切换 · <kbd style="background:#ffffff;padding:1px 5px;border-radius:4px;border:1px solid #cbd5e1;font-size:10.5px;font-weight:600;color:#0f172a;">Enter</kbd> 执行
      </div>
    </div>
  `;

  const itemsHtml = filteredSlashCommands.map((item, idx) => {
    const isActive = idx === activeSlashIdx;
    const itemBg = isActive ? '#eff6ff' : '#ffffff';
    const itemBorder = isActive ? '1.5px solid #2563eb' : '1px solid #e2e8f0';
    const itemShadow = isActive ? '0 4px 14px rgba(37,99,235,0.18)' : '0 1px 3px rgba(0,0,0,0.04)';
    return `
      <div class="slash-item ${isActive ? 'active' : ''}" data-idx="${idx}" style="display:flex;align-items:flex-start;gap:12px;padding:10px 14px;border-radius:12px;cursor:pointer;background:${itemBg} !important;border:${itemBorder} !important;box-shadow:${itemShadow} !important;transition:all 0.15s ease;margin-bottom:2px;">
        <div class="slash-icon" style="font-size:20px;width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:#f1f5f9;border:1px solid #e2e8f0;flex-shrink:0;margin-top:1px;">${item.icon}</div>
        <div class="slash-content" style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;">
          <div class="slash-header-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="slash-cmd" style="font-size:15px;font-weight:700;color:#2563eb;font-family:monospace;">${item.cmd}</span>
              <span class="slash-title" style="font-size:14px;font-weight:600;color:#0f172a;">${item.title}</span>
            </div>
            <span class="slash-badge" style="font-size:11px;padding:2px 8px;border-radius:6px;font-weight:600;background:${item.tagBg || 'rgba(59,130,246,0.12)'};color:${item.tagColor || '#2563eb'};border:1px solid ${item.tagBorder || 'rgba(59,130,246,0.25)'};">${item.tag || '常用'}</span>
          </div>
          <div class="slash-desc" style="font-size:12.5px;color:#475569;line-height:1.45;word-break:break-word;">${item.desc}</div>
        </div>
      </div>
    `;
  }).join('');

  popup.innerHTML = headerHtml + itemsHtml;

  popup.querySelectorAll('.slash-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      activeSlashIdx = parseInt(el.dataset.idx);
      updateSlashHighlight();
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      executeSlashCommand(filteredSlashCommands[parseInt(el.dataset.idx)]);
    });
  });
}

function checkSlashAutocomplete() {
  const val = inputArea.value;
  if (val.startsWith('/')) {
    const query = val.slice(1).toLowerCase().trim();
    filteredSlashCommands = SLASH_COMMANDS.filter(s => 
      s.cmd.slice(1).toLowerCase().includes(query) || 
      s.title.toLowerCase().includes(query) ||
      s.desc.toLowerCase().includes(query)
    );
    activeSlashIdx = 0;
    renderSlashPopup();
  } else {
    hideSlashPopup();
  }
}

// Auto-grow Input
const inputArea = $("#input");
let _resizeRaf = null;
function autoResizeInput() {
  if (_resizeRaf) return;
  _resizeRaf = requestAnimationFrame(() => {
    _resizeRaf = null;
    if (!inputArea) return;
    inputArea.style.height = "auto";
    const newH = Math.min(inputArea.scrollHeight, 160);
    inputArea.style.height = (newH > 40 ? newH : 40) + "px";
  });
}

inputArea.addEventListener("input", () => {
  autoResizeInput();
  checkSlashAutocomplete();
});

inputArea.addEventListener("keydown", (e) => {
  const popup = getSlashPopup();
  const isPopupOpen = popup && !popup.classList.contains('hidden');

  if (isPopupOpen) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeSlashIdx = (activeSlashIdx + 1) % filteredSlashCommands.length;
      updateSlashHighlight();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeSlashIdx = (activeSlashIdx - 1 + filteredSlashCommands.length) % filteredSlashCommands.length;
      updateSlashHighlight();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (filteredSlashCommands[activeSlashIdx]) {
        executeSlashCommand(filteredSlashCommands[activeSlashIdx]);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideSlashPopup();
      return;
    }
  }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    hideSlashPopup();
    handleSend();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.composer-input-row')) {
    hideSlashPopup();
  }
});

// Starter Prompts Click
$$(".starter-card").forEach((card) => {
  card.addEventListener("click", () => {
    const p = card.getAttribute("data-prompt");
    if (p) {
      inputArea.value = p;
      autoResizeInput();
      handleSend();
    }
  });
});

let abortCtrl = null;
let currentWs = null;
let pendingAttachments = null; // 待发送的附件 [{path, name, mimeType, size}]
function updateSendButton() {
  const btn = $("#btn-send");
  if (!btn) return;
  if (state.streaming) {
    btn.classList.add("stop");
    btn.title = "停止生成";
    btn.innerHTML = '<i data-lucide="square" id="send-icon" style="width:16px;height:16px;"></i>';
    btn.disabled = false;
  } else {
    btn.classList.remove("stop");
    btn.title = "发送 (Enter)";
    btn.innerHTML = '<i data-lucide="arrow-up" id="send-icon" style="width:16px;height:16px;"></i>';
    btn.disabled = !state.selectedModel;
  }
  refreshIcons();
}

function stopGenerating() {
  state.streaming = false;
  state.isUserAborted = true;
  updateSendButton();

  // 1. 立即强制关断前端所有的 WebSocket 连接
  if (currentWs) {
    try {
      currentWs.onclose = null;
      currentWs.onerror = null;
      currentWs.onmessage = null;
      currentWs.close();
    } catch (_) {}
    currentWs = null;
  }
  if (abortCtrl) {
    try { abortCtrl.abort(); } catch (_) {}
  }

  // 2. 立即通知后端 kill 进程并释放连接
  const conv = activeConv();
  if (conv) {
    fetch("/api/chat/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationKey: conv.id, conversationId: conv.convId })
    }).catch(() => {});
  }

  // 3. 立即清理前端正在思考指示器和气泡状态
  if (conv && activeClientRuns.has(conv.id)) {
    const clientRun = activeClientRuns.get(conv.id);
    const targetNode = clientRun?.asstNode;
    if (targetNode) {
      if (targetNode.row) targetNode.row.classList.remove("streaming");
      if (targetNode.bubble) {
        const cleanAcc = (clientRun.acc || "").replace(/[\u200b]/g, "").trim();
        updateAssistantBubble(targetNode, cleanAcc ? cleanAcc + "\n\n*(已停止生成)*" : "(已停止生成)", clientRun.toolEvents || [], false);
      }
    }
  }
  activeClientRuns.clear();
  updateSendButton();
}

async function handleSend() {
  if (state.streaming) {
    stopGenerating();
    return;
  }
  const text = inputArea.value.trim();
  const currentAttachments = pendingAttachments && pendingAttachments.length ? [...pendingAttachments] : [];
  // 没文本也没附件 → 不发
  if (!text && !currentAttachments.length) return;
  if (!state.selectedModel) return toast("请先选择模型");

  inputArea.value = "";
  autoResizeInput();

  // 立即清空输入框内的附件暂存与 UI 预览
  pendingAttachments = null;
  renderAttachmentPreview();

  let conv = activeConv();
  if (!conv) {
    newChat(true);
    conv = activeConv();
  }

  // 组装用户消息正文（包含图片/文件路径标签）
  let fullUserContent = text;
  if (currentAttachments.length) {
    const imgPaths = currentAttachments.filter(a => a.mimeType?.startsWith('image/')).map(a => a.path);
    const filePaths = currentAttachments.filter(a => !a.mimeType?.startsWith('image/')).map(a => a.path);
    if (imgPaths.length) fullUserContent += (fullUserContent ? '\n' : '') + '<images_input>' + imgPaths.join('\n') + '</images_input>';
    if (filePaths.length) fullUserContent += (fullUserContent ? '\n' : '') + '<files_input>' + filePaths.join('\n') + '</files_input>';
  }

  // Auto Title
  if (conv.title === "新对话") {
    conv.title = (text || "图片/文件分析").slice(0, 20) + ((text || "").length > 20 ? "..." : "");
    renderConvList();
  }

  await runConversationTurn(fullUserContent, true);
}

async function runConversationTurn(text, appendUserMsg = true) {
  const conv = activeConv();
  if (!conv) return;

  if (appendUserMsg) {
    conv.messages.push({ role: "user", content: text });
    saveConversations();
    const empty = $("#chat-empty");
    if (empty) empty.classList.add("hidden");
    const feed = $("#chat-feed");
    if (feed) feed.classList.remove("hidden");
    appendMsgRow("user", text);
  }
  let userMsgPushed = appendUserMsg; // 重试时不再重复 push 用户消息

  const empty = $("#chat-empty");
  if (empty) empty.classList.add("hidden");
  const feed = $("#chat-feed");
  if (feed) feed.classList.remove("hidden");

  const asstNode = appendMsgRow("assistant", "", true);
  scrollToBottom(true);

  state.streaming = true;
  state.isUserAborted = false;
  abortCtrl = new AbortController();
  updateSendButton();

  let acc = "";
  let newConvId = null;
  let toolEvents = []; // 收集工具执行事件，刷新后可恢复

  const t0 = Date.now();
  const clientRun = {
    convId: conv.id,
    acc: "",
    toolEvents: toolEvents,
    asstNode: asstNode,
    abortCtrl: abortCtrl,
    ws: null,
    t0: Date.now(),
    model: state.selectedModel,
    latestTip: '正在连接模型并解析任务意图...',
    latestWaited: 0,
    statusTicker: null
  };
  activeClientRuns.set(conv.id, clientRun);
  renderConvList();

  // 启动前端实时状态秒级刷新定时器：保证每秒精准刷新耗时与当前工作状态
  clientRun.statusTicker = setInterval(() => {
    if (!state.streaming || (clientRun.acc && clientRun.acc.replace(/[\u200b\s]/g, '').length > 0)) {
      if (clientRun.statusTicker) { clearInterval(clientRun.statusTicker); clientRun.statusTicker = null; }
      return;
    }
    const sec = Math.round((Date.now() - clientRun.t0) / 1000);
    clientRun.latestWaited = sec;
    let tip = clientRun.latestTip;
    if (!tip || tip.startsWith('正在思考')) {
      if (!toolEvents || toolEvents.length === 0) {
        if (sec <= 2) tip = '正在连接模型并解析任务意图...';
        else if (sec <= 7) tip = '正在进行深度逻辑推理与代码分析...';
        else tip = '深度思考中，正在组织专业技术方案...';
      }
    }
    const targetNode = clientRun.asstNode || asstNode;
    if (targetNode && targetNode.bubble && state.activeId === conv.id) {
      updateAssistantBubble(targetNode, clientRun.acc, toolEvents, true, null, tip, sec);
    }
  }, 1000);

  let hasError = false;
  let wakeLock = null;
  try {
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then((wl) => { wakeLock = wl; }).catch(() => {});
    }
  } catch (_) {}

  const MAX_NET_RETRIES = 15;
  let netRetryCount = 0;
  let currentSeq = 0;

  try {
    while (true) {
      let streamError = null;
      let needsPerm = false;
      let permMsg = "";
      let permToolName = "";
      let permToolInput = "";
      let receivedDone = false;

    try {
      // ── WebSocket 替代 SSE：解决反向代理对长连接 HTTP 响应的缓冲/超时掐断 ──
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${location.host}/ws/chat`;
      const ws = new WebSocket(wsUrl);
      currentWs = ws;
      clientRun.ws = ws;

      await new Promise((resolve, reject) => {
        let settled = false;
        let inactivityWatchdog = null;

        const done = (fn) => {
          if (!settled) {
            settled = true;
            if (clientRun.statusTicker) {
              clearInterval(clientRun.statusTicker);
              clientRun.statusTicker = null;
            }
            if (inactivityWatchdog) clearTimeout(inactivityWatchdog);
            if (currentWs) {
              try { currentWs.close(); } catch (_) {}
              currentWs = null;
            }
            clientRun.ws = null;
            fn();
          }
        };

        // 300 秒（5分钟）静默守护看门狗：为深度思考（Thinking: High）和慢速网络操作预留充足时间
        const resetInactivityWatchdog = () => {
          if (inactivityWatchdog) clearTimeout(inactivityWatchdog);
          inactivityWatchdog = setTimeout(async () => {
            if (!settled) {
              try {
                const checkRes = await fetch("/api/sessions");
                const checkData = await checkRes.json();
                if (checkData && Array.isArray(checkData.sessions)) {
                  const s = checkData.sessions.find(item => item.id === conv.id);
                  // 服务器还在跑 → 长时间思考不应报错，续期继续等
                  if (s && s.isRunning) { resetInactivityWatchdog(); return; }
                  if (s && Array.isArray(s.messages) && s.messages.length > 0) {
                    const last = s.messages[s.messages.length - 1];
                    if (last && last.role === 'assistant' && last.content && last.content.replace(/[\u200b\s]/g, '')) {
                      conv.messages = s.messages;
                      saveConversations();
                      paintActiveConv();
                      receivedDone = true;
                      done(() => resolve());
                      return;
                    }
                  }
                }
              } catch (_) {}

              // 兜底也不报错：长时间思考/慢操作不应弹错误，续期继续等服务器
              resetInactivityWatchdog();
            }
          }, 300000); // 300s 静默守护（不报错，仅续期/同步）
        };

        resetInactivityWatchdog();

        ws.onopen = () => {
          acc = ""; // 每次连接重放时从头构建，防止重连造成文本重复叠加
          clientRun.acc = "";
          const effortVal = $("#effort")?.value || "";
          const actualModel = resolveActualModelName(state.selectedModel, effortVal);
          
          ws.send(JSON.stringify({
            token: authToken,
            model: actualModel,
            messages: conv.messages,
            effort: effortVal,
            permissions: $("#permissions")?.value || "",
            conversationKey: conv.id,
            conversationId: conv.convId || newConvId || undefined
          }));
        };

        ws.onmessage = (event) => {
          let data;
          try { data = JSON.parse(event.data); } catch (_) { return; }
          if (data.seq != null && typeof data.seq === 'number') currentSeq = Math.max(currentSeq, data.seq);
          resetInactivityWatchdog(); // 只要有任何数据、心跳或思考进度到达，立即给 300s 看门狗续期

          if (data.unauthenticated) { showLoginGate(); done(() => reject(new Error("请先登录"))); return; }
          if (data.idle) { receivedDone = true; done(() => resolve()); return; } // 后台没在跑，当 done 处理
          if (data.meta && data.meta.autoCompacted) {
            // 静默同步前端消息数组，完全不弹 toast 或横条打扰用户
            if (data.meta.compactedMessages && conv) {
              conv.messages = data.meta.compactedMessages;
              saveConversations();
            }
          }
          if (data.meta && data.meta.needsPermission) { needsPerm = true; permMsg = data.error || "CLI 需要授权"; permToolName = data.meta.toolName || ''; permToolInput = data.meta.toolInput || ''; return; }
          if (data.meta && data.meta.locationBlocked) { streamError = Object.assign(new Error(data.error || "当前地区不受 Google 支持"), { locationBlocked: true, errorDetails: data.errorDetails }); done(() => reject(streamError)); return; }
          if (data.meta && data.meta.quotaExceeded) { streamError = Object.assign(new Error(data.error || "模型配额已用尽"), { quotaExceeded: true, errorDetails: data.errorDetails }); done(() => reject(streamError)); return; }
          if (data.error) { streamError = Object.assign(new Error(data.error), { errorDetails: data.errorDetails }); done(() => reject(streamError)); return; }
          
          if (data.progress) {
            const tipText = data.tip || "正在思考…";
            clientRun.latestTip = tipText;
            const waitedSec = data.waited != null ? data.waited : Math.round((Date.now() - clientRun.t0)/1000);
            clientRun.latestWaited = waitedSec;
            // 收集工具执行事件
            if (data.toolName) {
              let existing = null;
              if (data.toolId) {
                existing = toolEvents.find(e => e.toolId === data.toolId);
              }
              if (!existing && data.stepIndex != null) {
                existing = toolEvents.find(e => e.stepIndex === data.stepIndex);
              }
              if (!existing && toolEvents.length > 0) {
                const last = toolEvents[toolEvents.length - 1];
                if (last && last.tool === data.toolName && (last.state === 'ACTIVE' || !last.output) && data.toolOutput) {
                  existing = last;
                }
              }
              if (existing) {
                if (data.toolId) existing.toolId = data.toolId;
                if (data.toolInput && Object.keys(data.toolInput).length) existing.input = data.toolInput;
                if (data.rawInput) existing.rawInput = data.rawInput;
                if (data.toolOutput) existing.output = data.toolOutput;
                if (data.toolState) existing.state = data.toolState;
                if (data.duration) existing.duration = data.duration;
                if (data.waited) existing.waited = data.waited;
                if (data.toolAction) existing.toolAction = data.toolAction;
                if (data.toolSummary) existing.toolSummary = data.toolSummary;
              } else {
                toolEvents.push({
                  tool: data.toolName,
                  stepType: data.stepType || '',
                  tip: tipText,
                  input: data.toolInput || null,
                  rawInput: data.rawInput || '',
                  output: data.toolOutput || '',
                  state: data.toolState || 'ACTIVE',
                  duration: data.duration || 0,
                  stepIndex: data.stepIndex,
                  toolId: data.toolId || '',
                  toolAction: data.toolAction || '',
                  toolSummary: data.toolSummary || '',
                  waited: data.waited || 0
                });
              }
            }
            const targetNode = clientRun.asstNode || asstNode;
            if (targetNode && targetNode.bubble && state.activeId === conv.id) {
              updateAssistantBubble(targetNode, acc, toolEvents, true, null, clientRun.latestTip, clientRun.latestWaited);
              scrollToBottom(false);
            }
            return;
          }
          
          if (data.delta != null) {
            if (clientRun.statusTicker) {
              clearInterval(clientRun.statusTicker);
              clientRun.statusTicker = null;
            }
            acc += data.delta;
            clientRun.acc = acc;
            if (state.activeId === conv.id) {
              const targetNode = clientRun.asstNode || asstNode;
              if (targetNode && targetNode.bubble) {
                updateAssistantBubble(targetNode, acc, toolEvents, true);
                scrollToBottom(false);
              }
            }
          }
          if (data.conversationId) {
            newConvId = data.conversationId;
            conv.convId = data.conversationId;
            saveConversations();
          }
          if (data.liveQuotaUpdate && data.liveQuota) {
            state.latestUsageData = data.liveQuota;
            try { localStorage.setItem("agy-cached-usage", JSON.stringify(data.liveQuota)); } catch (_) {}
            updateUsageSummary(data.liveQuota);
            if (document.getElementById("usage-account-card")) {
              renderUsageModalContent(data.liveQuota);
            }
            if (data.quotaSnapshot) clientRun.lastQuotaSnapshot = data.quotaSnapshot;
            const targetNode = clientRun.asstNode || asstNode;
            if (targetNode && targetNode.bubble && state.activeId === conv.id) {
              const metaSnapshot = {
                duration: ((Date.now() - t0)/1000).toFixed(1),
                model: state.selectedModel,
                quotaSnapshot: data.quotaSnapshot
              };
              updateAssistantBubble(targetNode, acc, toolEvents, false, metaSnapshot);
            }
            if (conv && conv.messages && conv.messages.length > 0) {
              const lastMsg = conv.messages[conv.messages.length - 1];
              if (lastMsg && lastMsg.role === 'assistant' && lastMsg.meta) {
                lastMsg.meta.quotaSnapshot = data.quotaSnapshot;
                saveConversations();
              }
            }
            return;
          }
          if (data.done) {
            if (data.liveQuota) {
              state.latestUsageData = data.liveQuota;
              try { localStorage.setItem("agy-cached-usage", JSON.stringify(data.liveQuota)); } catch (_) {}
              updateUsageSummary(data.liveQuota);
              if (document.getElementById("usage-account-card")) {
                renderUsageModalContent(data.liveQuota);
              }
            }
            if (data.quotaSnapshot) clientRun.lastQuotaSnapshot = data.quotaSnapshot;
            if (Array.isArray(data.tools) && data.tools.length > 0) {
              toolEvents = data.tools;
            }
            receivedDone = true;
            state.streaming = false;
            updateSendButton();
            const targetNode = clientRun.asstNode || asstNode;
            if (targetNode) {
              if (targetNode.row) targetNode.row.classList.remove("streaming");
              if (state.activeId === conv.id && targetNode.bubble) {
                const metaSnapshot = {
                  duration: ((Date.now() - t0)/1000).toFixed(1),
                  model: state.selectedModel,
                  quotaSnapshot: data.quotaSnapshot || clientRun.lastQuotaSnapshot
                };
                updateAssistantBubble(targetNode, acc, toolEvents, false, metaSnapshot);
              }
            }
            done(() => resolve());
          }
        };

        ws.onerror = async () => {
          const cleanText = (acc || '').replace(/[\u200b\s]/g, '');
          if (cleanText.length > 0 || receivedDone) {
            receivedDone = true;
            done(() => resolve());
            return;
          }
          try {
            const checkRes = await fetch("/api/sessions");
            const checkData = await checkRes.json();
            if (checkData && Array.isArray(checkData.sessions)) {
              const s = checkData.sessions.find(item => item.id === conv.id);
              if (s && Array.isArray(s.messages) && s.messages.length > 0) {
                const last = s.messages[s.messages.length - 1];
                if (last && last.role === 'assistant' && last.content && last.content.replace(/[\u200b\s]/g, '')) {
                  conv.messages = s.messages;
                  saveConversations();
                  paintActiveConv();
                  receivedDone = true;
                  done(() => resolve());
                  return;
                }
              }
            }
          } catch (_) {}
          done(() => reject(new Error('network error')));
        };
        ws.onclose = async () => {
          if (state.isUserAborted || (abortCtrl && abortCtrl.signal.aborted)) {
            receivedDone = true;
            done(() => resolve());
            return;
          }
          // 如果已收到 done 或已经有完整的回答文本，直接圆满结束当前轮次，绝不无限挂起等待！
          if (receivedDone) { done(() => resolve()); return; }
          if (streamError) { done(() => reject(streamError)); return; }
          if (needsPerm) { done(() => reject(Object.assign(new Error(permMsg), { needsPermission: true, toolName: permToolName, toolInput: permToolInput }))); return; }
          
          // 检查远端服务端是否已经完成落盘（例如正好在关闭瞬间服务端生成完毕）
          try {
            const checkRes = await fetch("/api/sessions");
            const checkData = await checkRes.json();
            if (checkData && Array.isArray(checkData.sessions)) {
              const s = checkData.sessions.find(item => item.id === conv.id);
              if (s && Array.isArray(s.messages) && s.messages.length > 0) {
                const last = s.messages[s.messages.length - 1];
                if (last && last.role === 'assistant' && last.content && last.content.replace(/[\u200b\s]/g, '') && !s.isRunning) {
                  conv.messages = s.messages;
                  saveConversations();
                  paintActiveConv();
                  receivedDone = true;
                  done(() => resolve());
                  return;
                }
                // server \u8fd8\u5728\u8dd1\uff08isRunning\uff09\uff1aWS \u65ad\u4e0d\u91cd\u53d1\u65b0 BEGIN\uff08\u5426\u5219\u91cd\u590d\u8dd1\u540c\u4e00 turn\uff09\uff0c
                // resolve \u672c\u8f6e\uff0c\u4ea4\u7ed9 subscribe/tryReconnectToOngoingRun \u7eed\u63a5\u663e\u793a\u5b9e\u65f6\u6d41
                if (s.isRunning) {
                  receivedDone = true;
                  done(() => resolve());
                  return;
                }
              }
            }
          } catch (_) {}

          // 核心修复（借鉴 CloudCLI）：连接异常断开且未收到明确的 done，绝不草率提前结束，而是触发自动增量重连！
          done(() => reject(new Error('connection closed prematurely')));
        };
      });

      currentWs = null;
      clientRun.ws = null;
      if (streamError) throw streamError;
      if (needsPerm) throw Object.assign(new Error(permMsg), { needsPermission: true, toolName: permToolName, toolInput: permToolInput });
      break;
    } catch (e) {
      const isAbort = state.isUserAborted || (e && e.name === "AbortError") || (abortCtrl && abortCtrl.signal.aborted);
      if (isAbort) {
        hasError = false;
        receivedDone = true;
        state.streaming = false;
        updateSendButton();
        const targetNode = clientRun.asstNode || asstNode;
        if (targetNode) {
          if (targetNode.row) targetNode.row.classList.remove("streaming");
          if (targetNode.bubble) {
            const cleanAcc = (acc || "").replace(/[\u200b]/g, "").trim();
            updateAssistantBubble(targetNode, cleanAcc ? cleanAcc + "\n\n*(已停止生成)*" : "(已停止生成)", toolEvents, false);
          }
        }
        break; // 立即退出，绝不重试
      }

      const errMsg = (e && e.message) || "请求失败（未知错误）";
      const isNetErr = /network|failed to fetch|load failed|closed prematurely|socket error/i.test(errMsg);

      if (isNetErr && !isAbort && netRetryCount < MAX_NET_RETRIES) {
        netRetryCount++;
        // 重试前稍作等待（1.2s），允许网络波动或服务端热重启完成
        await new Promise(r => setTimeout(r, 1200));
        // 重试时不再追加用户消息（已 push 过），防止 msgs 滚雪球增长
        userMsgPushed = true;
        // 核心修复（借鉴 CloudCLI）：重连必须携带 authToken 与 lastSeq，实现零丢字增量续接
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsRetry = new WebSocket(`${proto}//${location.host}/ws/chat`);
        currentWs = wsRetry;
        clientRun.ws = wsRetry;
        try {
          await new Promise((resolve, reject) => {
            let settled2 = false;
            const done2 = (fn) => { if (!settled2) { settled2 = true; fn(); } };
            wsRetry.onopen = () => {
              wsRetry.send(JSON.stringify({
                token: authToken,
                action: 'subscribe',
                lastSeq: currentSeq,
                model: state.selectedModel || 'gemini-3.7-flash-high',
                messages: conv.messages,
                conversationKey: conv.id,
                conversationId: conv.convId || newConvId || undefined
              }));
            };
            wsRetry.onmessage = (event) => {
              let data;
              try { data = JSON.parse(event.data); } catch (_) { return; }
              if (data.seq != null && typeof data.seq === 'number') currentSeq = Math.max(currentSeq, data.seq);

              if (data.idle) {
                // 后台已结束生成，立即从服务端拉取最新的会话持久化数据，回填可能因连接切换遗漏的正文回答
                fetch('/api/sessions').then(r => r.json()).then(sData => {
                  if (sData && Array.isArray(sData.sessions)) {
                    const cur = sData.sessions.find(item => item.id === conv.id);
                    if (cur && Array.isArray(cur.messages) && cur.messages.length > 0) {
                      conv.messages = cur.messages;
                      saveConversations();
                      paintActiveConv();
                    }
                  }
                }).catch(() => {});
                done2(() => resolve());
                return;
              }
              if (data.error) { streamError = new Error(data.error); done2(() => reject(streamError)); return; }
              if (data.progress) {
                if (data.toolName) toolEvents.push({ tool: data.toolName, stepType: data.stepType || '', tip: data.tip || '', waited: data.waited || 0, input: data.toolInput, output: data.toolOutput, state: data.toolState, toolId: data.toolId || '', stepIndex: data.stepIndex });
                const targetNode = clientRun.asstNode || asstNode;
                if (state.activeId === conv.id && targetNode && targetNode.bubble) {
                  updateAssistantBubble(targetNode, acc, toolEvents, true);
                  scrollToBottom(false);
                }
                return;
              }
              if (data.delta != null && data.delta !== '​') {
                acc += data.delta;
                clientRun.acc = acc;
                if (state.activeId === conv.id) {
                  const targetNode = clientRun.asstNode || asstNode;
                  if (targetNode && targetNode.bubble) {
                    updateAssistantBubble(targetNode, acc, toolEvents, true);
                    scrollToBottom(false);
                  }
                }
              }
              if (data.conversationId) { newConvId = data.conversationId; conv.convId = data.conversationId; saveConversations(); }
              if (data.done) {
                receivedDone = true;
                state.streaming = false;
                updateSendButton();
                done2(() => resolve());
              }
            };
            wsRetry.onerror = () => { done2(() => reject(new Error('network error'))); };
            wsRetry.onclose = () => {
              if (state.isUserAborted || receivedDone || (acc && acc.replace(/[\u200b\s]/g, '').length > 0)) {
                receivedDone = true;
                done2(() => resolve());
                return;
              }
              done2(() => reject(new Error('network error')));
            };
          });
        } catch (e2) {
          // subscribe 也失败了，继续外层 while 循环
        }
        currentWs = null;
        clientRun.ws = null;
        if (streamError) throw streamError;
        if (receivedDone) break;
        continue;
      }

      try {
        await fetch("/api/debug-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "chat", name: e && e.name, message: e && e.message, isAbort, url: location.href, model: state.selectedModel, accLen: acc ? acc.length : 0, retries: netRetryCount, ts: Date.now() })
        });
      } catch (_) {}

      hasError = true;
      const targetNode = clientRun.asstNode || asstNode;
      if (isAbort) {
        if (targetNode && targetNode.bubble) {
          const cleanAcc = (acc || "").replace(/[\u200b]/g, "").trim();
          updateAssistantBubble(targetNode, cleanAcc ? cleanAcc + "\n\n*(已停止生成)*" : "(已停止生成)", toolEvents, false);
        }
      } else {
        if (isNetErr) {
          try {
            const checkRes = await fetch("/api/sessions");
            const checkData = await checkRes.json();
            if (checkData && Array.isArray(checkData.sessions)) {
              const s = checkData.sessions.find(item => item.id === conv.id);
              if (s && Array.isArray(s.messages) && s.messages.length > 0) {
                const last = s.messages[s.messages.length - 1];
                if (last && last.role === 'assistant' && last.content && last.content.replace(/[\u200b\s]/g, '')) {
                  conv.messages = s.messages;
                  saveConversations();
                  paintActiveConv();
                  hasError = false;
                  state.streaming = false;
                  updateSendButton();
                  return;
                }
              }
            }
          } catch (_) {}
        }
        const isLocationErr = e.locationBlocked || /User location is not supported|location.*not supported|FAILED_PRECONDITION.*location/i.test(errMsg);
        const isQuotaErr = !isLocationErr && (e.quotaExceeded || /quota|limit reached|upgrade your subscription/i.test(errMsg));
        const errDetails = e.errorDetails || e.details || (e.stack && e.stack !== errMsg ? e.stack : '');
        const detailsBlock = (errDetails && errDetails !== errMsg) 
          ? `<div class="chat-error-details" style="margin-top:8px;padding:8px 12px;background:rgba(0,0,0,0.35);border:1px solid rgba(239,68,68,0.25);border-radius:6px;font-family:monospace;font-size:12px;color:#fca5a5;white-space:pre-wrap;word-break:break-all;max-height:220px;overflow-y:auto;text-align:left;">${escapeHtml(errDetails)}</div>`
          : '';

        let errorHtml = "";
        if (isLocationErr) {
          errorHtml = `<div class="chat-error-card location-error" style="border-left: 4px solid #f59e0b; background: rgba(245, 158, 11, 0.08); padding: 14px 16px; border-radius: 8px;"><div class="chat-error-title" style="color: #fbbf24; font-weight: 600; display: flex; align-items: center; gap: 6px;"><i data-lucide="globe-2" style="width:16px;height:16px;"></i> ⚠️ 所在地区不受 Google Gemini 支持 (User location is not supported)</div><div class="chat-error-desc" style="margin-top:6px; color: var(--text-secondary, #cbd5e1); font-size: 13px; line-height: 1.5;">当前服务器网络出口 IP 所在地区未在 Google Gemini API 开放列表中。由于 <b>Claude / GPT</b> 模型不受此地区限制，您可以点击下方按钮一键切换模型继续对话。</div>${detailsBlock}<div class="chat-error-actions" style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;"><button class="btn btn-primary btn-sm" onclick="switchModelAndRetry('claude-sonnet-4-6')"><i data-lucide="sparkles" style="width:13px;height:13px;"></i> 切换至 Claude Sonnet 4.6 并重试</button><button class="btn btn-outline btn-sm" onclick="retryLastConversationTurn()"><i data-lucide="refresh-cw" style="width:13px;height:13px;"></i> 重试</button></div></div>`;
        } else if (isQuotaErr) {
          const m = errMsg.match(/Resets in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
          if (m) {
            const resetAt = Date.now() + ((parseInt(m[1]||0)*3600) + (parseInt(m[2]||0)*60) + parseInt(m[3]||0))*1000;
            localStorage.setItem('claudeResetAt', resetAt);
          }
          errorHtml = `<div class="chat-error-card quota-error"><div class="chat-error-title">⚠️ 当前模型配额已用尽</div><div class="chat-error-desc">${escapeHtml(errMsg)}</div>${detailsBlock}<div class="chat-error-actions"><button class="btn btn-primary btn-sm" onclick="switchModelAndRetry('gemini-3.7-flash-high')"><i data-lucide="zap" style="width:13px;height:13px;"></i> 切换至 Gemini 3.7 Flash 并重试</button></div></div>`;
        } else if (isNetErr) {
          errorHtml = `<div class="chat-error-card network-error"><div class="chat-error-title">⚠️ 网络连接中断 (Network Error)</div><div class="chat-error-desc">连接被网络或反向代理超时重置（已自动尝试重连 ${netRetryCount} 次）。会话状态已保留，点击下方按钮可立即继续生成。</div>${detailsBlock}<div class="chat-error-actions"><button class="btn btn-primary btn-sm" onclick="retryLastConversationTurn()"><i data-lucide="refresh-cw" style="width:13px;height:13px;"></i> 续接 / 重试</button></div></div>`;
        } else {
          errorHtml = `<div class="chat-error-card general-error"><div class="chat-error-title">⚠️ 请求发生错误 (后端返回详情)</div><div class="chat-error-desc" style="font-weight:500;">${escapeHtml(errMsg)}</div>${detailsBlock}<div class="chat-error-actions"><button class="btn btn-primary btn-sm" onclick="retryLastConversationTurn()"><i data-lucide="refresh-cw" style="width:13px;height:13px;"></i> 重试</button></div></div>`;
        }
        if (targetNode && targetNode.bubble) {
          if (acc && acc.replace(/[​\s]/g, "")) {
            targetNode.bubble.innerHTML = formatMarkdown(acc, false) + errorHtml;
          } else {
            targetNode.bubble.innerHTML = errorHtml;
          }
          if (targetNode.row) targetNode.row.className = "message-row error";
          refreshIcons();
        }
        if (e.needsPermission) openPermissionModal(errMsg, text, e.toolName, e.toolInput);
      }
      break;
    }
  }
  } finally {
    if (clientRun && clientRun.statusTicker) {
      clearInterval(clientRun.statusTicker);
      clientRun.statusTicker = null;
    }
    if (wakeLock) {
      try { wakeLock.release().catch(() => {}); } catch (_) {}
      wakeLock = null;
    }
    activeClientRuns.delete(conv.id);
    abortCtrl = null;
    state.streaming = activeClientRuns.has(state.activeId);
    updateSendButton(); // 无论正常结束、中止或异常，第一时间将按钮恢复为发送箭头状态！
    const targetNode = clientRun.asstNode || asstNode;
    if (targetNode && targetNode.row) targetNode.row.classList.remove("streaming");
    if (conv) {
      if (newConvId) conv.convId = newConvId;
      const cleanAcc = (acc || "").replace(/[\u200b]/g, "").trim();
      if (cleanAcc || toolEvents.length) {
        const durSec = ((Date.now() - t0)/1000).toFixed(1);
        const tokenEst = Math.max(1, Math.round(cleanAcc.length / 3.2));
        
        // 固化当前模型在本次对话结束时刻从 Google 拉取到的精准配额与重置时间快照
        const modelId = String(state.selectedModel || '').toLowerCase();
        const isClaude = modelId.includes('claude') || modelId.includes('gpt') || modelId.includes('oss');
        const liveQuota = state.latestUsageData || {};
        const poolWindow = isClaude ? liveQuota?.windows?.claude5h : liveQuota?.windows?.fiveHour;
        const weeklyWindow = isClaude ? liveQuota?.windows?.claudeWeekly : liveQuota?.windows?.weekly;

        const quotaSnapshot = (clientRun.lastQuotaSnapshot) || {
          percent: poolWindow?.percent != null ? poolWindow.percent : null,
          resetIn: poolWindow?.resetsIn || poolWindow?.resetText || '',
          resetTime: poolWindow?.resetTime || null,
          weeklyPercent: weeklyWindow?.percent != null ? weeklyWindow.percent : null,
          weeklyResetIn: weeklyWindow?.resetsIn || weeklyWindow?.resetText || '',
          weeklyResetTime: weeklyWindow?.resetTime || null,
          model: state.selectedModel
        };

        const msgMeta = {
          model: state.selectedModel,
          duration: durSec,
          tokens: tokenEst,
          quotaSnapshot
        };

        conv.messages.push({
          role: "assistant",
          content: acc,
          tools: toolEvents.length ? toolEvents : undefined,
          meta: msgMeta
        });

        if (!hasError && state.activeId === conv.id && targetNode && targetNode.bubble) {
          updateAssistantBubble(targetNode, acc, toolEvents, false, msgMeta);
        }
      } else {
        // 如果客户端内存累积为空（例如熄屏切后台期间后端已完成生成），无感从服务端抓取已写盘数据回填
        await silentSyncActiveConversation();
      }
    }
    saveConversations();
    refreshIcons();
  }
}

window.retryLastConversationTurn = function() {
  const lastRow = $("#chat-feed")?.lastElementChild;
  if (lastRow && lastRow.classList.contains("error")) {
    lastRow.remove();
  }
  runConversationTurn("", false);
};

window.switchModelAndRetry = function(modelName) {
  const baseModel = (modelName || "").replace(/-(low|medium|high)$/i, "");
  const effMatch = (modelName || "").match(/-(low|medium|high)$/i);
  if ($("#model-select")) {
    $("#model-select").value = baseModel;
  }
  if (effMatch && $("#effort")) {
    $("#effort").value = effMatch[1].toLowerCase();
  }
  state.selectedModel = baseModel;
  try { localStorage.setItem("agy-model", baseModel); } catch (_) {}
  window.retryLastConversationTurn();
};

function openPermissionModal(message, retryPrompt, toolName, toolInput, backendOptions) {
  const toolNameMap = {
    'run_command': { title: '执行系统终端命令', icon: 'terminal', color: '#f59e0b', tag: '高危命令' },
    'write_to_file': { title: '创建 / 覆写文件', icon: 'file-plus', color: '#3b82f6', tag: '文件写入' },
    'replace_file_content': { title: '局部编辑修改代码', icon: 'file-edit', color: '#10b981', tag: '代码编辑' },
    'define_subagent': { title: '定义新子代理', icon: 'bot', color: '#a855f7', tag: '子代理' },
    'invoke_subagent': { title: '调度执行子代理', icon: 'cpu', color: '#a855f7', tag: '代理调度' },
    'delete_file': { title: '删除文件 / 目录', icon: 'trash-2', color: '#ef4444', tag: '高危删除' }
  };
  const tInfo = toolNameMap[toolName] || { title: toolName ? `工具调用: ${toolName}` : '系统操作权限申请', icon: 'shield-alert', color: '#f59e0b', tag: '权限验证' };

  let formattedInput = toolInput || '';
  try {
    if (typeof formattedInput === 'string' && (formattedInput.startsWith('{') || formattedInput.startsWith('['))) {
      formattedInput = JSON.stringify(JSON.parse(formattedInput), null, 2);
    }
  } catch (_) {}

  const inputBlock = formattedInput ? `
    <div style="margin-top:10px;">
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;display:flex;align-items:center;gap:6px;">
        <i data-lucide="code" style="width:13px;height:13px;"></i> 操作参数 / 输入详情:
      </div>
      <pre style="background:var(--bg-primary);border:1px solid var(--border-color);padding:10px 12px;border-radius:6px;font-family:monospace;font-size:12px;max-height:220px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;color:var(--text-primary);margin:0;">${escapeHtml(formattedInput)}</pre>
    </div>` : '';

  openModal("🛡️ 询问模式 · 操作授权确认", `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="display:inline-flex;padding:4px;border-radius:6px;background:rgba(245,158,11,0.18);color:${tInfo.color};">
            <i data-lucide="${tInfo.icon}" style="width:16px;height:16px;"></i>
          </span>
          <span style="font-weight:600;font-size:13.5px;color:var(--text-primary);">${escapeHtml(tInfo.title)}</span>
        </div>
        <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:12px;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);">
          🟡 询问模式
        </span>
      </div>

      <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">
        ${escapeHtml(message || "当前处于【询问模式】，模型正在申请执行上述敏感操作，请确认是否允许：")}
      </div>

      ${inputBlock}

      <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px;">
        <button class="btn btn-primary" id="btn-perm-approve-once" style="justify-content:center;padding:9px 14px;font-size:13px;font-weight:600;">
          <i data-lucide="check" style="width:15px;height:15px;"></i> 单次允许本次操作 (保持询问模式)
        </button>

        ${toolName ? `
        <button class="btn btn-ghost" id="btn-perm-allow-remember" style="justify-content:center;padding:8px 14px;font-size:12.5px;border:1px solid var(--border-color);background:var(--bg-secondary);">
          <i data-lucide="shield-check" style="width:14px;height:14px;color:#10b981;"></i> 允许并记住该工具 (${escapeHtml(toolName)})
        </button>` : ''}

        <button class="btn btn-ghost" id="btn-perm-switch-auto" style="justify-content:center;padding:8px 14px;font-size:12.5px;border:1px solid var(--border-color);background:var(--bg-secondary);color:#10b981;">
          <i data-lucide="zap" style="width:14px;height:14px;"></i> 切换至【🟢 自动批准模式】并执行
        </button>

        <button class="btn btn-ghost" data-cancel style="justify-content:center;padding:8px 14px;font-size:12.5px;color:var(--danger);border:1px solid rgba(239,68,68,0.2);">
          <i data-lucide="x" style="width:14px;height:14px;"></i> 拒绝执行 (Deny)
        </button>
      </div>
    </div>
  `);

  refreshIcons();

  $("#modal-root").querySelector("[data-cancel]").onclick = closeModal;

  // 1. 单次允许：重发消息，但不修改用户当前选择的【询问模式】配置
  const btnApproveOnce = $("#btn-perm-approve-once");
  if (btnApproveOnce) {
    btnApproveOnce.onclick = () => {
      closeModal();
      const lastRow = $("#chat-feed")?.lastElementChild;
      if (lastRow && lastRow.classList.contains("error")) lastRow.remove();
      runConversationTurn(retryPrompt, false);
    };
  }

  // 2. 允许并记住工具：白名单化该工具，保持询问模式
  const btnRemember = $("#btn-perm-allow-remember");
  if (btnRemember) {
    btnRemember.onclick = async () => {
      try {
        await fetch("/api/permissions/allow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolName })
        });
      } catch (_) {}
      closeModal();
      const lastRow = $("#chat-feed")?.lastElementChild;
      if (lastRow && lastRow.classList.contains("error")) lastRow.remove();
      runConversationTurn(retryPrompt, false);
    };
  }

  // 3. 切换至自动批准模式：更改下拉选项并保存
  const btnSwitchAuto = $("#btn-perm-switch-auto");
  if (btnSwitchAuto) {
    btnSwitchAuto.onclick = () => {
      if ($("#permissions")) {
        $("#permissions").value = "approve";
        localStorage.setItem("agy-permissions", "approve");
      }
      closeModal();
      const lastRow = $("#chat-feed")?.lastElementChild;
      if (lastRow && lastRow.classList.contains("error")) lastRow.remove();
      runConversationTurn(retryPrompt, false);
    };
  }
}

// Google OAuth / CLI Connect Modal
async function showCliLogin(onSuccess) {
  openModal("🔑 Google Antigravity CLI 登录", `
    <div id="cli-login-container">
      <div style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg-primary);border-radius:var(--radius-md);margin-bottom:16px;">
        <i data-lucide="loader-2" class="spin" style="width:20px;height:20px;color:var(--accent);"></i>
        <span>正在发起 Google OAuth 授权链接...</span>
      </div>
    </div>
  `);

  let loginData;
  try {
    const r = await fetch("/api/cli-login/start", { method: "POST" });
    loginData = await r.json();
    if (!r.ok) throw new Error(loginData.error || "启动登录流程失败");
  } catch (e) {
    $("#cli-login-container").innerHTML = `
      <div style="color:var(--danger);padding:12px;background:rgba(239,68,68,0.1);border-radius:var(--radius-sm);border:1px solid rgba(239,68,68,0.3);">
        ${escapeHtml(e.message)}
      </div>
    `;
    return;
  }

  $("#cli-login-container").innerHTML = `
    <div class="form-item">
      <label class="form-label">步骤 1：打开下方授权链接，使用 Google 账号登录并确认权限</label>
      <div style="display:flex;gap:8px;">
        <input class="form-input" readonly value="${escapeHtml(loginData.url)}" onclick="this.select()" />
        <a class="btn btn-primary" href="${escapeHtml(loginData.url)}" target="_blank" rel="noopener" style="text-decoration:none;white-space:nowrap;">
          打开链接 ↗
        </a>
      </div>
    </div>
    <div class="form-item">
      <label class="form-label">步骤 2：授权成功后浏览器跳转页面，将完整地址或 <code>code=</code> 复制粘贴到这里</label>
      <textarea id="login-auth-code" class="form-textarea" rows="2" placeholder="粘贴跳转后的完整 URL 或 code..."></textarea>
    </div>
    <div id="login-feedback" style="font-size:12.5px;margin-bottom:12px;"></div>
    <div class="modal-footer" style="margin:-18px;margin-top:10px;padding:12px 18px;">
      <button class="btn btn-ghost" id="login-cancel-btn">取消</button>
      <button class="btn btn-primary" id="login-submit-btn">提交授权 Code</button>
    </div>
  `;
  refreshIcons();

  $("#login-cancel-btn").onclick = () => {
    fetch("/api/cli-login/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: loginData.id })
    });
    closeModal();
  };

  const submitCode = async () => {
    const codeVal = $("#login-auth-code").value.trim();
    if (!codeVal) return toast("请先粘贴授权 Code");
    const fb = $("#login-feedback");
    fb.innerHTML = `<span style="color:var(--accent);">正在提交 Code 到 Antigravity CLI...</span>`;

    try {
      const res = await fetch("/api/cli-login/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: loginData.id, code: codeVal })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "提交验证失败");
      fb.innerHTML = `<span style="color:var(--success);">已提交，等待 CLI 完成令牌交换...</span>`;
    } catch (err) {
      fb.innerHTML = `<span style="color:var(--danger);">${escapeHtml(err.message)}</span>`;
    }
  };

  $("#login-submit-btn").onclick = submitCode;

  const pollTimer = setInterval(async () => {
    try {
      const resp = await fetch("/api/cli-login/status?id=" + loginData.id);
      const st = await resp.json();
      if (st.status === "pending") return;
      clearInterval(pollTimer);
      if (st.status === "success") {
        toast("Google 授权成功！");
        closeModal();
        try {
          await fetch("/api/accounts/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label: "", tokenData: st.tokenData })
          });
        } catch (_) {}
        await refreshSystemStatus();
        await refreshModels();
        renderLoginArea();
        renderConvList();
        if (onSuccess) {
          await onSuccess(st.tokenData);
        } else {
          showAccountSwitcher();
        }
      } else if (st.status === "error") {
        $("#login-feedback").innerHTML = `<span style="color:var(--danger);">登录失败: ${escapeHtml(st.error || "未知错误")}</span>`;
      }
    } catch (_) {}
  }, 1500);
}

// Plugins Modal & Mega Marketplace Engine (Loaded from /marketplace-plugins.js with 205+ plugins)
const MARKETPLACE_CATEGORIES = (window.MARKETPLACE_CATEGORIES && window.MARKETPLACE_CATEGORIES.length > 0)
  ? window.MARKETPLACE_CATEGORIES
  : [
      { id: "all", label: "全部", icon: "sparkles" },
      { id: "hot", label: "🔥 热门推荐", icon: "flame" },
      { id: "frontend", label: "🎨 前端设计", icon: "palette" },
      { id: "backend", label: "🗄️ 后端架构", icon: "database" },
      { id: "code", label: "💻 语言与质量", icon: "code-2" },
      { id: "agent", label: "🤖 智能体与自动化", icon: "bot" },
      { id: "devops", label: "🚀 云原生运维", icon: "server" },
      { id: "security", label: "🛡️ 安全与渗透", icon: "shield-alert" },
      { id: "docs", label: "📊 办公与科研", icon: "file-text" },
      { id: "ai", label: "🧠 AI算法微调", icon: "cpu" },
      { id: "data", label: "🌐 爬虫与量化", icon: "line-chart" },
      { id: "git", label: "🌿 版本与协作", icon: "git-branch" }
    ];

const MARKETPLACE_PLUGINS = (window.MARKETPLACE_PLUGINS && window.MARKETPLACE_PLUGINS.length > 0)
  ? window.MARKETPLACE_PLUGINS
  : [];


let currentPluginTab = "market";
let currentMarketCategory = "all";
let installedPluginsCache = [];

async function showPlugins(initialTab = "market") {
  currentPluginTab = initialTab;

  openModal("🧩 Antigravity 插件与扩展中心", `
    <div class="plugin-modal-wrap">
      <!-- Tabs Header -->
      <div class="plugin-tabs">
        <button class="plugin-tab-btn ${currentPluginTab === 'market' ? 'active' : ''}" onclick="switchPluginTab('market')">
          <i data-lucide="compass" style="width:14px;height:14px;"></i> 推荐市场 <span id="market-total-badge" style="background:rgba(255,255,255,0.2);padding:1px 6px;border-radius:10px;font-size:10px;">${MARKETPLACE_PLUGINS.length}</span>
        </button>
        <button class="plugin-tab-btn ${currentPluginTab === 'installed' ? 'active' : ''}" onclick="switchPluginTab('installed')">
          <i data-lucide="package" style="width:14px;height:14px;"></i> 已安装插件 <span id="installed-count-badge" style="background:rgba(255,255,255,0.2);padding:1px 6px;border-radius:10px;font-size:10px;">0</span>
        </button>
        <button class="plugin-tab-btn ${currentPluginTab === 'import' ? 'active' : ''}" onclick="switchPluginTab('import')">
          <i data-lucide="download-cloud" style="width:14px;height:14px;"></i> 生态导入
        </button>
        <button class="plugin-tab-btn ${currentPluginTab === 'custom' ? 'active' : ''}" onclick="switchPluginTab('custom')">
          <i data-lucide="plus-circle" style="width:14px;height:14px;"></i> 自定义安装
        </button>
      </div>

      <!-- Tab 1: Marketplace -->
      <div id="plugin-tab-market" class="plugin-tab-content" style="display:${currentPluginTab === 'market' ? 'block' : 'none'};">
        <div class="plugin-search-bar">
          <input id="market-search-input" class="form-input" placeholder="🔍 搜索热门插件、工具或 MCP 服务..." oninput="filterMarketPlugins(this.value)" />
          <button class="btn btn-ghost" style="white-space:nowrap;font-size:12px;gap:5px;" onclick="triggerMarketRefresh(true)" title="下拉或点击刷新市场">
            <i data-lucide="rotate-cw" id="market-refresh-icon" style="width:13px;height:13px;"></i> 刷新
          </button>
        </div>

        <!-- Category Filter Pills -->
        <div class="plugin-categories-bar" id="market-cat-bar">
          ${renderCategoryPills()}
        </div>

        <!-- Pull Down Indicator -->
        <div id="pull-refresh-indicator" class="pull-refresh-indicator">
          <span class="thinking-dots"><i></i><i></i><i></i></span>
          <span id="pull-refresh-text">正在同步最新市场插件...</span>
        </div>

        <div id="market-plugins-grid" class="plugin-grid"></div>
      </div>

      <!-- Tab 2: Installed -->
      <div id="plugin-tab-installed" class="plugin-tab-content" style="display:${currentPluginTab === 'installed' ? 'block' : 'none'};">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <span style="font-size:12.5px;color:var(--text-dim);">当前已由 Antigravity CLI 成功加载的插件与扩展</span>
          <button class="btn btn-ghost" style="padding:4px 8px;font-size:12px;" onclick="loadInstalledPlugins()"><i data-lucide="rotate-cw" style="width:12px;height:12px;"></i> 刷新列表</button>
        </div>
        <div id="plugin-items-wrap">
          <div style="color:var(--text-dim);font-size:12.5px;padding:24px;text-align:center;">
            <span class="thinking-dots"><i></i><i></i><i></i></span> 正在读取 CLI 插件环境...
          </div>
        </div>
      </div>

      <!-- Tab 3: Ecosystem Import -->
      <div id="plugin-tab-import" class="plugin-tab-content" style="display:${currentPluginTab === 'import' ? 'block' : 'none'};">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:14px;line-height:1.6;">
          Antigravity 原生兼容多平台 AI 插件体系。您可以一键将已有环境中的插件生态同步导入至当前工作区：
        </div>
        <div class="plugin-ecosystem-grid">
          <div class="plugin-market-card" style="padding:14px;">
            <div class="plugin-market-header">
              <div class="plugin-market-icon">✨</div>
              <div class="plugin-market-title">
                <h4>Gemini Code Assist</h4>
                <span class="plugin-market-badge">Google 官方生态</span>
              </div>
            </div>
            <div class="plugin-market-desc" style="margin:8px 0;">自动同步并加载 Gemini 官方扩展及开发环境配置。</div>
            <button class="btn btn-primary" style="width:100%;font-size:12.5px;margin-top:6px;" onclick="handlePluginOp('import', 'gemini')">
              <i data-lucide="download" style="width:14px;height:14px;"></i> 一键导入 Gemini 插件
            </button>
          </div>

          <div class="plugin-market-card" style="padding:14px;">
            <div class="plugin-market-header">
              <div class="plugin-market-icon">⚡</div>
              <div class="plugin-market-title">
                <h4>Claude Code 插件</h4>
                <span class="plugin-market-badge" style="background:rgba(249,115,22,0.15);color:#fb923c;">跨生态扩展</span>
              </div>
            </div>
            <div class="plugin-market-desc" style="margin:8px 0;">一键从 Claude Code 目录导入全部 29 项自定义技能包。</div>
            <button class="btn btn-primary" style="width:100%;font-size:12.5px;margin-top:6px;" onclick="handlePluginOp('import', 'claude')">
              <i data-lucide="download" style="width:14px;height:14px;"></i> 一键导入 Claude 插件
            </button>
          </div>
        </div>

        <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:12px;">
          <div class="form-label" style="margin-bottom:6px;">从本地目录或特定源导入</div>
          <div class="plugin-import-input-row">
            <input id="import-source-path" class="form-input" placeholder="输入本地文件夹路径或特定插件源" />
            <button class="btn btn-ghost" onclick="const p = $('#import-source-path').value.trim(); if(!p) return toast('请输入源路径'); handlePluginOp('import', p);">导入</button>
          </div>
        </div>
      </div>

      <!-- Tab 4: Custom Install -->
      <div id="plugin-tab-custom" class="plugin-tab-content" style="display:${currentPluginTab === 'custom' ? 'block' : 'none'};">
        <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:14px;margin-bottom:14px;">
          <div class="form-label" style="font-weight:600;margin-bottom:6px;">安装自定义插件包 / Git 仓库</div>
          <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">
            支持直接输入插件包标识、Git 仓库地址或本地插件路径。
          </div>
          <div class="plugin-import-input-row">
            <input id="new-plugin-name" class="form-input" placeholder="例如: web-researcher 或 https://github.com/..." />
            <button id="btn-install-plugin" class="btn btn-primary" style="white-space:nowrap;">
              <i data-lucide="download" style="width:14px;height:14px;"></i> 立即安装
            </button>
          </div>
        </div>

        <div style="background:var(--bg-secondary);border-radius:var(--radius-md);padding:12px;font-size:12px;color:var(--text-dim);line-height:1.6;">
          <div style="font-weight:600;color:var(--text-main);margin-bottom:4px;">💡 插件安装说明：</div>
          <div>• 插件可包含专属 <code>SKILL.md</code> 技能执行链、<code>GEMINI.md</code> 行为规则及 MCP 外部服务器。</div>
          <div>• 安装完成后，系统会自动注册并在执行任务时代劳调用，无需手动重启。</div>
        </div>
      </div>
    </div>
  `);

  refreshIcons();
  setupPullToRefresh();
  renderMarketPlugins();
  loadInstalledPlugins();

  const installBtn = $("#btn-install-plugin");
  if (installBtn) {
    installBtn.onclick = async () => {
      const name = $("#new-plugin-name").value.trim();
      if (!name) return toast("请输入插件包名或路径");
      await handlePluginOp("install", name);
    };
  }
}

function renderCategoryPills() {
  return MARKETPLACE_CATEGORIES.map(cat => {
    let count = 0;
    if (cat.id === "all") count = MARKETPLACE_PLUGINS.length;
    else if (cat.id === "hot") count = MARKETPLACE_PLUGINS.filter(p => p.hot).length;
    else count = MARKETPLACE_PLUGINS.filter(p => p.category === cat.id).length;

    const isActive = currentMarketCategory === cat.id;
    return `
      <button class="plugin-cat-pill ${isActive ? 'active' : ''}" onclick="switchMarketCategory('${cat.id}')">
        <span>${cat.label}</span>
        <span class="plugin-cat-count">${count}</span>
      </button>
    `;
  }).join("");
}

window.switchMarketCategory = function(catId) {
  currentMarketCategory = catId;
  const bar = $("#market-cat-bar");
  if (bar) bar.innerHTML = renderCategoryPills();
  renderMarketPlugins($("#market-search-input")?.value || "");
};

window.triggerMarketRefresh = async function(manualToast = false) {
  const indicator = $("#pull-refresh-indicator");
  const icon = $("#market-refresh-icon");
  if (indicator) indicator.classList.add("visible");
  if (icon) icon.classList.add("animate-spin");

  await new Promise(r => setTimeout(r, 450));
  await loadInstalledPlugins();
  renderMarketPlugins($("#market-search-input")?.value || "");

  if (indicator) indicator.classList.remove("visible");
  if (icon) icon.classList.remove("animate-spin");
  if (manualToast) toast(`已刷新市场插件库 (共 ${MARKETPLACE_PLUGINS.length} 款)`);
};

function setupPullToRefresh() {
  const grid = $("#market-plugins-grid");
  const indicator = $("#pull-refresh-indicator");
  if (!grid || !indicator) return;

  let startY = 0;
  let isPulling = false;

  grid.addEventListener("touchstart", (e) => {
    if (grid.scrollTop <= 0) {
      startY = e.touches[0].clientY;
      isPulling = true;
    }
  }, { passive: true });

  grid.addEventListener("touchmove", (e) => {
    if (!isPulling) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY;
    if (diff > 40 && grid.scrollTop <= 0) {
      indicator.classList.add("visible");
    }
  }, { passive: true });

  grid.addEventListener("touchend", async (e) => {
    if (isPulling && indicator.classList.contains("visible")) {
      isPulling = false;
      await triggerMarketRefresh(true);
    }
    isPulling = false;
  });
}

window.switchPluginTab = function(tab) {
  currentPluginTab = tab;
  document.querySelectorAll(".plugin-tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".plugin-tab-content").forEach(c => c.style.display = "none");
  
  const targetBtn = Array.from(document.querySelectorAll(".plugin-tab-btn")).find(b => b.getAttribute("onclick")?.includes(`'${tab}'`));
  if (targetBtn) targetBtn.classList.add("active");
  const targetContent = $(`#plugin-tab-${tab}`);
  if (targetContent) targetContent.style.display = "block";
  refreshIcons();
};

window.renderMarketPlugins = function(filter = "") {
  const grid = $("#market-plugins-grid");
  if (!grid) return;

  const q = (filter || "").toLowerCase().trim();
  const list = MARKETPLACE_PLUGINS.filter(p => {
    // 1. 分类匹配
    if (currentMarketCategory === "hot" && !p.hot) return false;
    if (currentMarketCategory !== "all" && currentMarketCategory !== "hot" && p.category !== currentMarketCategory) return false;
    // 2. 搜索词匹配
    if (q) {
      return p.name.toLowerCase().includes(q) ||
        p.desc.toLowerCase().includes(q) ||
        (p.categoryLabel || "").toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q);
    }
    return true;
  });

  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;color:var(--text-dim);font-size:12.5px;padding:36px;text-align:center;">没有找到与 "${escapeHtml(filter || currentMarketCategory)}" 相关的插件</div>`;
    return;
  }

  grid.innerHTML = list.map(p => {
    const isInstalled = installedPluginsCache.some(ip => ip.name === p.id || ip.name.includes(p.id.split('/')[1] || p.id));
    return `
      <div class="plugin-market-card">
        <div>
          <div class="plugin-market-header">
            <div class="plugin-market-icon">${p.icon}</div>
            <div class="plugin-market-title">
              <h4>${escapeHtml(p.name)}</h4>
              <span class="plugin-market-badge">${escapeHtml(p.categoryLabel || p.category)} · ${escapeHtml(p.badge)}</span>
            </div>
          </div>
          <div class="plugin-market-desc" style="margin-top:8px;">${escapeHtml(p.desc)}</div>
        </div>
        <div class="plugin-market-footer">
          <div class="plugin-market-meta">
            <span>📦 ${p.version}</span>
            <span>⬇️ ${p.downloads}</span>
          </div>
          ${isInstalled ? `
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:11.5px;color:var(--success);border-color:rgba(16,185,129,0.3);" disabled>
              <i data-lucide="check" style="width:12px;height:12px;"></i> 已安装
            </button>
          ` : `
            <button class="btn btn-primary" style="padding:4px 12px;font-size:12px;" onclick="handlePluginOp('install','${escapeHtml(p.id)}')">
              安装
            </button>
          `}
        </div>
      </div>
    `;
  }).join("");

  refreshIcons();
};

window.filterMarketPlugins = function(val) {
  renderMarketPlugins(val);
};

window.loadInstalledPlugins = async function() {
  const wrap = $("#plugin-items-wrap");
  const countBadge = $("#installed-count-badge");
  if (!wrap) return;

  try {
    const r = await fetch("/api/plugins");
    const d = await r.json();
    const list = d.plugins || [];
    installedPluginsCache = list;
    if (countBadge) countBadge.innerText = String(list.length);

    if (!list.length) {
      wrap.innerHTML = `
        <div style="background:var(--bg-primary);border:1px dashed var(--border-color);border-radius:var(--radius-md);padding:32px;text-align:center;">
          <div style="font-size:28px;margin-bottom:8px;">📦</div>
          <div style="color:var(--text-main);font-size:13.5px;font-weight:600;margin-bottom:4px;">当前暂未安装任何插件</div>
          <div style="color:var(--text-dim);font-size:12px;margin-bottom:14px;">您可以前往【推荐市场】一键挑选安装，或从 Claude/Gemini 生态一键导入。</div>
          <button class="btn btn-primary" style="font-size:12px;" onclick="switchPluginTab('market')">
            <i data-lucide="compass" style="width:13px;height:13px;"></i> 探索推荐市场
          </button>
        </div>
      `;
    } else {
      wrap.innerHTML = list.map((p) => {
        const isEnabled = !/disabled|inactive/i.test(p.line || "");
        return `
          <div class="plugin-card">
            <div class="plugin-info">
              <strong>
                <span class="plugin-status-dot ${isEnabled ? '' : 'disabled'}"></span>
                ${escapeHtml(p.name)}
              </strong>
              <span>${escapeHtml(p.line || (isEnabled ? "🟢 已激活并运行中" : "⚪ 已停用"))}</span>
            </div>
            <div style="display:flex;gap:6px;">
              ${isEnabled ? `
                <button class="btn btn-ghost" style="padding:4px 8px;font-size:12px;" onclick="handlePluginOp('disable','${escapeHtml(p.name)}')">禁用</button>
              ` : `
                <button class="btn btn-ghost" style="padding:4px 8px;font-size:12px;" onclick="handlePluginOp('enable','${escapeHtml(p.name)}')">启用</button>
              `}
              <button class="btn btn-danger" style="padding:4px 8px;font-size:12px;" onclick="handlePluginOp('uninstall','${escapeHtml(p.name)}')">卸载</button>
            </div>
          </div>
        `;
      }).join("");
    }
  } catch (e) {
    wrap.innerHTML = `<div style="color:var(--danger);padding:14px;background:rgba(239,68,68,0.1);border-radius:var(--radius-md);">加载插件失败: ${escapeHtml(e.message)}</div>`;
  }

  refreshIcons();
  renderMarketPlugins($("#market-search-input")?.value || "");
};

window.handlePluginOp = async function(op, name) {
  const opLabels = {
    install: "安装插件",
    uninstall: "卸载插件",
    enable: "启用插件",
    disable: "禁用插件",
    import: "导入插件生态",
    validate: "校验插件"
  };
  const label = opLabels[op] || op;
  toast(`正在执行 ${label} [${name || ''}]...`);

  try {
    const res = await fetch("/api/plugins/" + op, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "操作失败");
    toast(d.message || `${label} 执行成功`);
    await loadInstalledPlugins();
  } catch (e) {
    toast(`执行失败: ${e.message}`);
  }
};

// Google Antigravity Model Usage & Quota Modal
function renderUsageModalContent(d) {
  if (!d) return;
  const acc = d.account || (state.status?.googleAccount) || {};
  const isPro = d.tierType === 'pro' || d.tierType === 'enterprise';
  const isFree = d.tierType === 'free';
  const tierType = d.tierType || (isPro ? 'pro' : isFree ? 'free' : 'unauthed');
  const badgeText = tierType === 'pro' ? 'PRO' : tierType === 'enterprise' ? 'ENT' : tierType === 'free' ? 'FREE' : '';

  const frameEl = $("#usage-avatar-frame-wrap");
  const cornerBadgeEl = $("#usage-avatar-corner-badge");
  if (frameEl) frameEl.className = `usage-avatar-frame ${tierType}`;
  if (cornerBadgeEl) {
    cornerBadgeEl.className = `usage-avatar-corner-badge ${tierType}`;
    cornerBadgeEl.textContent = badgeText;
    cornerBadgeEl.style.display = badgeText ? "block" : "none";
  }
  const crownEl = $("#usage-avatar-crown");
  if (crownEl) crownEl.style.display = tierType === 'pro' ? 'block' : 'none';

  if (acc && (acc.email || acc.name)) {
    if ($("#usage-user-name")) $("#usage-user-name").textContent = acc.name || "Google 用户";
    if ($("#usage-user-email")) $("#usage-user-email").textContent = acc.email || "已认证";
    if (acc.picture && $("#usage-avatar-box")) {
      $("#usage-avatar-box").innerHTML = `<img src="${escapeHtml(acc.picture)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
    }
    const badgeStyle = isPro 
      ? "background:linear-gradient(135deg,rgba(59,130,246,0.18),rgba(147,51,234,0.18));border:1px solid rgba(147,51,234,0.4);color:#a78bfa;font-weight:600;"
      : isFree 
      ? "background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);color:#fbbf24;font-weight:600;"
      : "background:var(--bg-secondary);border:1px solid var(--border-color);color:var(--text-muted);";
    
    const badgeEl = $("#usage-tier-badge");
    if (badgeEl) {
      badgeEl.textContent = d.tier || acc.tier || "Google AI Pro";
      badgeEl.style.cssText = badgeStyle;
    }
  }

  if (d.quotaResetPolicy && $("#quota-policy-text")) {
    $("#quota-policy-text").innerHTML = escapeHtml(d.quotaResetPolicy);
  }

  // 1. Google 5h 算力
  const win = d.windows || {};
  const win5h = win.fiveHour || { percent: 100, resetsIn: "即将重置" };
  const color5h = win5h.percent > 70 ? "#10b981" : win5h.percent > 30 ? "#3b82f6" : "#f59e0b";
  const reset5hText = formatDynamicCountdown(win5h.resetTime, win5h.resetsIn || win5h.resetText);
  if ($("#win-percent-5h")) {
    $("#win-percent-5h").textContent = `${win5h.percent}% 可用`;
    $("#win-percent-5h").style.color = color5h;
  }
  if ($("#win-bar-5h")) {
    $("#win-bar-5h").style.width = `${Math.max(2, win5h.percent)}%`;
    $("#win-bar-5h").style.background = color5h;
  }
  if ($("#win-reset-5h")) {
    $("#win-reset-5h").textContent = reset5hText === '即将重置' ? '即将重置' : `${reset5hText} 后重置`;
  }

  // 2. Gemini 每周旗舰算力
  const winWeekly = win.weekly || { percent: 100, resetsIn: "即将重置" };
  const colorWeekly = winWeekly.percent > 70 ? "#10b981" : winWeekly.percent > 30 ? "#3b82f6" : "#f59e0b";
  const resetWeeklyText = formatDynamicCountdown(winWeekly.resetTime, winWeekly.resetsIn || winWeekly.resetText);
  if ($("#win-percent-weekly")) {
    $("#win-percent-weekly").textContent = `${winWeekly.percent}% 可用`;
    $("#win-percent-weekly").style.color = colorWeekly;
  }
  if ($("#win-bar-weekly")) {
    $("#win-bar-weekly").style.width = `${Math.max(2, winWeekly.percent)}%`;
    $("#win-bar-weekly").style.background = colorWeekly;
  }
  if ($("#win-reset-weekly")) {
    $("#win-reset-weekly").textContent = resetWeeklyText === '即将重置' ? '即将刷新' : `${resetWeeklyText} 后刷新`;
  }

  // 3. Claude 5h 滚动算力
  const winClaude5h = win.claude5h || { percent: 100, resetsIn: "即将重置" };
  const colorClaude5h = winClaude5h.percent > 60 ? "#10b981" : winClaude5h.percent > 20 ? "#3b82f6" : "#f59e0b";
  const resetClaude5hText = formatDynamicCountdown(winClaude5h.resetTime, winClaude5h.resetsIn || winClaude5h.resetText);
  if ($("#win-percent-claude5h")) {
    $("#win-percent-claude5h").textContent = `${winClaude5h.percent}% 算力`;
    $("#win-percent-claude5h").style.color = colorClaude5h;
  }
  if ($("#win-bar-claude5h")) {
    $("#win-bar-claude5h").style.width = `${Math.max(2, winClaude5h.percent)}%`;
    $("#win-bar-claude5h").style.background = colorClaude5h;
  }
  if ($("#win-reset-claude5h")) {
    $("#win-reset-claude5h").textContent = resetClaude5hText === '即将重置' ? '即将重置' : `${resetClaude5hText} 后重置`;
  }

  // 4. 每周 Claude 旗舰配额
  const winClaudeWeekly = win.claudeWeekly || { percent: 100, resetsIn: "即将重置" };
  const colorClaudeWeekly = winClaudeWeekly.percent > 60 ? "#10b981" : winClaudeWeekly.percent > 20 ? "#eab308" : "#f59e0b";
  const resetClaudeWeeklyText = formatDynamicCountdown(winClaudeWeekly.resetTime, winClaudeWeekly.resetsIn || winClaudeWeekly.resetText);
  if ($("#win-percent-claudeweekly")) {
    $("#win-percent-claudeweekly").textContent = `${winClaudeWeekly.percent}% 旗舰配额`;
    $("#win-percent-claudeweekly").style.color = colorClaudeWeekly;
  }
  if ($("#win-bar-claudeweekly")) {
    $("#win-bar-claudeweekly").style.width = `${Math.max(2, winClaudeWeekly.percent)}%`;
    $("#win-bar-claudeweekly").style.background = colorClaudeWeekly;
  }
  if ($("#win-reset-claudeweekly")) {
    $("#win-reset-claudeweekly").textContent = resetClaudeWeeklyText === '即将重置' ? '即将刷新' : `${resetClaudeWeeklyText} 后刷新`;
  }

  // Fill Metrics
  const stats = d.stats || {};
  const convs = state.conversations || [];
  let totalMsgs = 0;
  convs.forEach((c) => {
    if (Array.isArray(c.messages)) totalMsgs += c.messages.length;
  });
  const convCount = stats.conversations || convs.length;
  const turnCount = stats.turns || Math.floor(totalMsgs / 2);
  const totalTokens = stats.tokens || 0;
  const tokenDisplay = totalTokens > 1000000 
    ? `${(totalTokens / 1000000).toFixed(2)}M` 
    : totalTokens > 1000 
    ? `${(totalTokens / 1000).toFixed(1)}k` 
    : totalTokens;

  if ($("#metric-conv-count")) $("#metric-conv-count").textContent = `${convCount} 组 (${turnCount} 轮)`;
  if ($("#metric-token-count")) $("#metric-token-count").textContent = tokenDisplay;
  refreshIcons();
}

async function showUsageModal(manualRefresh = false) {
  const googleAcc = state.status?.googleAccount || {};
  const tierType = googleAcc.tierType || (googleAcc.tier?.includes('Pro') ? 'pro' : googleAcc.tier?.includes('Enterprise') ? 'enterprise' : 'free');
  const badgeText = tierType === 'pro' ? 'PRO' : tierType === 'enterprise' ? 'ENT' : 'FREE';

  openModal("📊 Google AI Pro 模型用量与配额中心", `
    <div class="usage-modal-wrap">
      <!-- 账号信息卡片 -->
      <div id="usage-account-card" class="usage-account-card">
        <div style="display:flex;align-items:center;gap:14px;">
          <div id="usage-avatar-frame-wrap" class="usage-avatar-frame ${tierType}">
            <span id="usage-avatar-crown" class="modal-avatar-crown" style="display:${tierType === 'pro' ? 'block' : 'none'}">👑</span>
            <div id="usage-avatar-box" class="usage-avatar-box">
              <span class="usage-default-avatar">◇</span>
            </div>
            <span id="usage-avatar-corner-badge" class="usage-avatar-corner-badge ${tierType}">${badgeText}</span>
          </div>
          <div>
            <div id="usage-user-name" style="font-weight:600;font-size:14.5px;color:var(--text-primary);">${googleAcc.name || '加载中...'}</div>
            <div id="usage-user-email" style="font-size:12px;color:var(--text-muted);">${googleAcc.email || '正在连接 Google AI Pro 云端服务...'}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div id="usage-tier-badge" class="usage-tier-pill" style="background:linear-gradient(135deg,rgba(59,130,246,0.15),rgba(147,51,234,0.15));border:1px solid rgba(147,51,234,0.3);color:#818cf8;font-weight:600;">Google AI Pro</div>
          <button id="btn-sync-ai-pro" class="btn btn-sm btn-ghost" style="padding:4px 10px;font-size:12px;display:flex;align-items:center;gap:5px;color:var(--accent);cursor:pointer;border-radius:12px;background:var(--bg-secondary);border:1px solid var(--border-color);" onclick="showUsageModal(true)">
            <i data-lucide="refresh-cw" style="width:12px;height:12px;"></i>
            <span>实时刷新</span>
          </button>
        </div>
      </div>

      <!-- 5小时与每周全量配额周期 (2x2 网格) -->
      <div class="quota-windows-grid">
        <!-- 1. Google 5h 算力 -->
        <div class="window-card">
          <div class="window-card-header">
            <div class="window-title">
              <i data-lucide="zap" style="width:14px;height:14px;color:var(--accent);"></i>
              <span>Google / Gemini 5小时算力</span>
            </div>
            <div class="window-percent" id="win-percent-5h">--</div>
          </div>
          <div class="window-bar-wrap">
            <div class="window-bar-fill" id="win-bar-5h" style="width:0%;"></div>
          </div>
          <div class="window-subtext">
            <span>速率限制重置</span>
            <span id="win-reset-5h">计算中...</span>
          </div>
        </div>

        <!-- 2. Gemini 每周旗舰算力 -->
        <div class="window-card">
          <div class="window-card-header">
            <div class="window-title">
              <i data-lucide="shield-check" style="width:14px;height:14px;color:var(--accent);"></i>
              <span>每周 Gemini 旗舰算力</span>
            </div>
            <div class="window-percent" id="win-percent-weekly">--</div>
          </div>
          <div class="window-bar-wrap">
            <div class="window-bar-fill" id="win-bar-weekly" style="width:0%;"></div>
          </div>
          <div class="window-subtext">
            <span>周刷新周期</span>
            <span id="win-reset-weekly">计算中...</span>
          </div>
        </div>

        <!-- 3. Claude 5h 滚动算力 -->
        <div class="window-card" style="border:1px solid rgba(168,85,247,0.25);background:linear-gradient(180deg, rgba(168,85,247,0.03) 0%, transparent 100%);">
          <div class="window-card-header">
            <div class="window-title">
              <i data-lucide="sparkles" style="width:14px;height:14px;color:#c084fc;"></i>
              <span style="color:#c084fc;font-weight:600;">Claude 5 小时滚动算力</span>
            </div>
            <div class="window-percent" id="win-percent-claude5h" style="color:#c084fc;">--</div>
          </div>
          <div class="window-bar-wrap">
            <div class="window-bar-fill" id="win-bar-claude5h" style="width:0%;background:linear-gradient(90deg, #a855f7, #c084fc);"></div>
          </div>
          <div class="window-subtext">
            <span>速率限制重置</span>
            <span id="win-reset-claude5h" style="color:#c084fc;">计算中...</span>
          </div>
        </div>

        <!-- 4. 每周 Claude 旗舰配额 -->
        <div class="window-card" style="border:1px solid rgba(234,179,8,0.25);background:linear-gradient(180deg, rgba(234,179,8,0.03) 0%, transparent 100%);">
          <div class="window-card-header">
            <div class="window-title">
              <i data-lucide="crown" style="width:14px;height:14px;color:#eab308;"></i>
              <span style="color:#eab308;font-weight:600;">每周 Claude 旗舰配额</span>
            </div>
            <div class="window-percent" id="win-percent-claudeweekly" style="color:#eab308;">--</div>
          </div>
          <div class="window-bar-wrap">
            <div class="window-bar-fill" id="win-bar-claudeweekly" style="width:0%;background:linear-gradient(90deg, #eab308, #ca8a04);"></div>
          </div>
          <div class="window-subtext">
            <span>周刷新周期</span>
            <span id="win-reset-claudeweekly" style="color:#eab308;">计算中...</span>
          </div>
        </div>
      </div>

      <!-- Quick Metrics Grid -->
      <div class="usage-metrics-grid">
        <div class="metric-card">
          <div class="metric-label">本地会话 / 轮次</div>
          <div class="metric-val" id="metric-conv-count">--</div>
          <div class="metric-sub">历史总会话</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">累计消耗 Tokens</div>
          <div class="metric-val" id="metric-token-count">--</div>
          <div class="metric-sub">双向文本吞吐</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">G1 Credits 状态</div>
          <div class="metric-val" style="color:#10b981;font-size:16px;">已激活</div>
          <div class="metric-sub">自动抵扣保障</div>
        </div>
      </div>

      <!-- Quota Policy Note -->
      <div class="quota-policy-note">
        <div style="font-weight:600;font-size:12px;margin-bottom:4px;color:var(--text-primary);display:flex;align-items:center;gap:5px;">
          <i data-lucide="info" style="width:13px;height:13px;color:var(--accent);"></i>
          <span>Google AI Pro 模型配额与权益说明</span>
        </div>
        <div id="quota-policy-text" style="font-size:11.5px;color:var(--text-muted);line-height:1.5;">
          • <strong>Gemini 3.7 / 3.6 / 3.5 Flash</strong>：享有 Google AI Pro 5 小时高额滚动算力池（无总 Token 计费上限），适合日常高并发代码编写与长文本分析。<br/>
          • <strong>Claude / GPT 系列</strong>：享有 Pro 优先通道与 5 小时滚动配额，若高阶模型触达速率限制，系统将自动使用 G1 Credits 算力点数无缝补充。
        </div>
      </div>
    </div>
  `, true);

  refreshIcons();

  // 如果本地已有固化数据且非手动强制刷新，先立即以固化数据秒开渲染
  if (state.latestUsageData && !manualRefresh) {
    renderUsageModalContent(state.latestUsageData);
  }

  const syncBtn = $("#btn-sync-ai-pro");
  if (manualRefresh && syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = `<span class="thinking-dots"><i></i><i></i><i></i></span> <span style="font-size:11px;">直连 Google 上游中...</span>`;
  }

  try {
    const targetEmail = googleAcc.email ? encodeURIComponent(googleAcc.email) : '';
    const query = [
      manualRefresh ? 'refresh=1' : '',
      targetEmail ? `email=${targetEmail}` : ''
    ].filter(Boolean).join('&');
    const url = '/api/usage' + (query ? '?' + query : '');
    const res = await fetch(url);
    const d = await res.json();
    state.latestUsageData = d;
    try { localStorage.setItem("agy-cached-usage", JSON.stringify(d)); } catch (_) {}
    renderUsageModalContent(d);
    updateUsageSummary(d);
    if (manualRefresh) toast("已成功从 Google 上游直连拉取最新配额！");
  } catch (e) {
    console.error("加载用量失败", e);
    if (manualRefresh) toast("从 Google 上游同步配额失败: " + e.message);
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = `<i data-lucide="refresh-cw" style="width:12px;height:12px;"></i><span>实时刷新</span>`;
      refreshIcons();
    }
  }
}

// Settings & About Modal
function showAbout() {
  const st = state.status;
  const authed = Boolean(st && st.cli && st.cli.installed && st.cli.authenticated);
  openModal("⚙️ Antigravity 控制台设置与信息", `
    <div class="form-item">
      <label class="form-label">CLI 运行状态</label>
      <div style="padding:8px 12px;background:var(--bg-primary);border-radius:var(--radius-sm);border:1px solid var(--border-color);display:flex;align-items:center;gap:8px;">
        <span class="status-dot" style="background:${authed ? 'var(--success)' : 'var(--warning)'};"></span>
        <span>${authed ? '已连接并已通过 Google 授权认证' : '未登录或未完成 Google 授权'}</span>
      </div>
    </div>
    <div class="form-item">
      <label class="form-label">Antigravity CLI 二进制位置</label>
      <div style="padding:8px 12px;background:var(--bg-primary);border-radius:var(--radius-sm);border:1px solid var(--border-color);font-family:monospace;font-size:12.5px;">
        ${escapeHtml(st && st.cli ? (st.cli.bin || '未找到二进制') : '未知')}
      </div>
    </div>
    <div class="form-item">
      <label class="form-label">网络出口与节点设置</label>
      <button class="btn btn-outline" id="btn-modal-open-settings" style="width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 12px;">
        🛡️ 打开系统与代理设置 (固定IP / 强匿名 / 86国节点)
      </button>
    </div>
    <div class="form-item">
      <label class="form-label">快捷操作</label>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" id="btn-modal-clear-history">清空本地会话缓存</button>
        <button class="btn btn-primary" id="btn-modal-relogin">重新连接 / 授权</button>
      </div>
    </div>
    <div style="font-size:12px;color:var(--text-dim);line-height:1.6;margin-top:14px;border-top:1px solid var(--border-color);padding-top:12px;">
      Google Antigravity Web UI 直接对接本机 <code>antigravity</code> 命令行工具，支持流式输出、官方会话接续、Gemini 3.7 思考推理折叠以及多端自适应交互。
    </div>
  `);

  const btnOpenSettings = $("#btn-modal-open-settings");
  if (btnOpenSettings) {
    btnOpenSettings.onclick = () => {
      closeModal();
      showSettingsModal();
    };
  }

  $("#btn-modal-clear-history").onclick = () => {
    if (confirm("确定要清空全部会话历史吗？")) {
      state.conversations = [];
      state.activeId = null;
      saveConversations();
      renderConvList();
      paintActiveConv();
      closeModal();
      toast("已清空全部会话");
    }
  };

  $("#btn-modal-relogin").onclick = () => {
    closeModal();
    showCliLogin();
  };
}

function exportCurrentChat() {
  const conv = activeConv();
  if (!conv || !conv.messages || !conv.messages.length) {
    return toast("当前对话没有内容可导出");
  }
  let md = `# ${conv.title || "Antigravity 对话记录"}\n\n`;
  md += `> 导出时间: ${new Date().toLocaleString()}\n\n---\n\n`;
  conv.messages.forEach((m) => {
    const roleName = m.role === "user" ? "🧑 **User**" : "🤖 **Antigravity Agent**";
    md += `### ${roleName}\n\n${m.content}\n\n---\n\n`;
  });

  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(conv.title || "chat").replace(/[\\/:*?"<>|]/g, "_")}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("已成功导出为 Markdown 文件");
}

// Wire Event Listeners
$("#btn-new").addEventListener("click", () => newChat());
$("#btn-export")?.addEventListener("click", exportCurrentChat);
$("#btn-usage")?.addEventListener("click", showUsageModal);
$("#btn-usage-sidebar")?.addEventListener("click", showUsageModal);
$("#btn-theme").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(cur === "dark" ? "light" : "dark");
});
$("#btn-send").addEventListener("click", handleSend);
$("#btn-plugins").addEventListener("click", () => showPlugins("market"));
$("#btn-about").addEventListener("click", showAbout);

// ── 快速回到底部悬浮按钮 ──
const chatFeedEl = $("#chat-feed");
const btnScrollBottomEl = $("#btn-scroll-bottom");

function checkScrollBottom() {
  if (!chatFeedEl || !btnScrollBottomEl) return;
  const distFromBottom = chatFeedEl.scrollHeight - chatFeedEl.scrollTop - chatFeedEl.clientHeight;
  if (distFromBottom > 120) {
    btnScrollBottomEl.classList.remove("hidden");
  } else {
    btnScrollBottomEl.classList.add("hidden");
  }
}

if (chatFeedEl) {
  chatFeedEl.addEventListener("scroll", checkScrollBottom, { passive: true });
}
if (btnScrollBottomEl) {
  btnScrollBottomEl.addEventListener("click", () => {
    if (chatFeedEl) {
      chatFeedEl.scrollTo({ top: chatFeedEl.scrollHeight, behavior: "smooth" });
      setTimeout(() => btnScrollBottomEl.classList.add("hidden"), 300);
    }
  });
}

// ── 浏览器切后台/熄屏回前台处理（借鉴 CloudCLI 的自动重连策略）──
// 手机熄屏切后台会挂起网页并断开 WebSocket 省电，但服务端 Run Registry 在后台继续执行并落盘。
// 无论熄屏 10 分钟还是半小时，切回前台时无感拉取服务端最新数据，自动补齐完整回复并解除假死转圈。
['visibilitychange', 'focus', 'pageshow'].forEach(evt => {
  window.addEventListener(evt, async () => {
    if (document.visibilityState === "visible") {
      const recovered = await silentSyncActiveConversation();
      if (!recovered && state.streaming) {
        if (currentWs && currentWs.readyState !== WebSocket.OPEN) {
          try { currentWs.close(); } catch (_) {}
          state.streaming = false;
          updateSendButton();
          tryReconnectToOngoingRun();
        }
      }
      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen').catch(() => {});
      }
    }
  });
});

// Export Conversation to Markdown
function exportActiveConversation() {
  const conv = activeConv();
  if (!conv || !conv.messages || !conv.messages.length) {
    return toast("当前对话没有内容可导出");
  }
  let md = `# ${conv.title || "Antigravity 对话记录"}\n\n`;
  md += `*导出时间：${new Date().toLocaleString()}*\n\n---\n\n`;
  conv.messages.forEach((m) => {
    const role = m.role === "user" ? "🧑 **User**" : "🤖 **Antigravity**";
    md += `### ${role}\n\n${m.content}\n\n---\n\n`;
  });
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(conv.title || "conversation").replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, "_")}.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast("已导出 Markdown 文件");
}
const exportBtn = $("#btn-export");
if (exportBtn) exportBtn.addEventListener("click", exportActiveConversation);

// Quick Prompt Pills
$$(".quick-pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    const insertText = pill.getAttribute("data-insert") || "";
    if (insertText) {
      inputArea.value = insertText.replace(/\\n/g, "\n") + inputArea.value;
      autoResizeInput();
      inputArea.focus();
    }
  });
});

function updateUserAvatarsInFeed() {
  const googleAcc = state.status?.googleAccount;
  if (!googleAcc) return;
  const tierType = googleAcc.tierType || (googleAcc.tier?.includes('Pro') ? 'pro' : googleAcc.tier?.includes('Enterprise') ? 'enterprise' : 'free');
  const badgeText = tierType === 'pro' ? 'PRO' : tierType === 'enterprise' ? 'ENT' : 'FREE';

  document.querySelectorAll(".message-row.user .message-avatar").forEach(avatar => {
    avatar.className = `message-avatar user-chat-avatar-frame ${tierType}`;
    if (googleAcc.picture) {
      avatar.innerHTML = `
        ${tierType === 'pro' ? '<span class="header-avatar-crown">👑</span>' : ''}
        <img src="${escapeHtml(googleAcc.picture)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />
        <span class="header-avatar-badge ${tierType}">${badgeText}</span>
      `;
    } else {
      const initial = (googleAcc.name || googleAcc.email || "U").charAt(0).toUpperCase();
      avatar.innerHTML = `
        ${tierType === 'pro' ? '<span class="header-avatar-crown">👑</span>' : ''}
        <div style="width:100%;height:100%;border-radius:50%;background:var(--accent);color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${initial}</div>
        <span class="header-avatar-badge ${tierType}">${badgeText}</span>
      `;
    }
  });
}

async function refreshSystemStatus() {
  try {
    const res = await fetch("/api/status");
    state.status = await res.json();
    renderLoginArea();
    updateUserAvatarsInFeed();
  } catch (_) {}
}

// Application Bootstrap (Instant zero-latency paint)
async function initApp() {
  initTheme();
  initThinkingToggle();

  // 1. 先从 localStorage 秒加载会话历史 + 模型(不阻塞,立即渲染界面)
  try {
    const raw = localStorage.getItem("agy-convs-v2") || localStorage.getItem("agy-convs");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) state.conversations = arr;
    }
    const last = localStorage.getItem("agy-active-conv-v2") || localStorage.getItem("agy-active-conv") || "";
    if (last && state.conversations.some(c => c.id === last)) state.activeId = last;
    else if (state.conversations.length) state.activeId = state.conversations[0].id;
  } catch(_) {}

  if (!state.models || !state.models.length) {
    try {
      const cached = JSON.parse(localStorage.getItem("agy-cached-models") || "[]");
      state.models = cached.length ? cached : ["gemini-3.8-flash-high", "gemini-3.7-flash-high", "gemini-3.1-pro-high", "claude-sonnet-4-6"];
    } catch(_) {
      state.models = ["gemini-3.8-flash-high", "gemini-3.7-flash-high", "gemini-3.1-pro-high", "claude-sonnet-4-6"];
    }
    renderModelSelect();
  }

  // 2. 立即渲染界面(秒开,不等网络)
  if (state.conversations.length && state.activeId) {
    renderConvList();
    paintActiveConv();
  } else {
    newChat(true);
  }
  renderLoginArea();
  updateSendButton();
  refreshIcons();

  // 3. 后台异步:认证检查 + 服务器数据拉取(不阻塞 UI)
  checkWebAuthStatus().then(isAuthed => {
    if (!isAuthed) return;
    refreshSystemStatus();
    loadConversations();
    refreshModels().then(() => {
      if (state.models?.length) try { localStorage.setItem("agy-cached-models", JSON.stringify(state.models)); } catch(_){}
    });
  });

  // Restore saved permissions & effort preferences
  const permSel = $("#permissions");
  if (permSel) {
    const savedPerm = localStorage.getItem("agy-permissions") || "approve";
    permSel.value = savedPerm;
    const syncPermIcon = () => {
      const icon = permSel.parentElement?.querySelector("i");
      if (icon) {
        if (permSel.value === "ask") {
          icon.setAttribute("data-lucide", "shield-alert");
          icon.style.color = "#f59e0b";
        } else {
          icon.setAttribute("data-lucide", "shield-check");
          icon.style.color = "#10b981";
        }
        refreshIcons();
      }
    };
    syncPermIcon();
    permSel.addEventListener("change", (e) => {
      localStorage.setItem("agy-permissions", e.target.value);
      syncPermIcon();
    });
  }

  const effortSel = $("#effort");
  if (effortSel) {
    const savedEffort = localStorage.getItem("agy-effort") || "";
    effortSel.value = savedEffort;
    effortSel.addEventListener("change", (e) => {
      localStorage.setItem("agy-effort", e.target.value);
    });
  }

  updateSendButton();
  refreshIcons();

  // ── 借鉴 CloudCLI：刷新/重开页面后，如果该对话后台还在跑，自动重连并实时显示 ──
  tryReconnectToOngoingRun();

  // Non-blocking parallel background sync
  // 启动时读取当前账号的固化配额数据
  fetch("/api/usage")
    .then(r => r.json())
    .then(d => {
      if (d && d.windows) {
        state.latestUsageData = d;
        try { localStorage.setItem("agy-cached-usage", JSON.stringify(d)); } catch (_) {}
        updateUsageSummary(d);
        // 如果当前会话有未固化的旧消息气泡，顺带补齐真实进度条
        const conv = activeConv();
        if (conv && conv.messages) {
          let updated = false;
          conv.messages.forEach(m => {
            if (m.role === 'assistant' && (!m.meta || !m.meta.quotaSnapshot)) {
              if (!m.meta) m.meta = {};
              const modelLower = String(m.meta.model || state.selectedModel || '').toLowerCase();
              const isClaudeOrGpt = modelLower.includes('claude') || modelLower.includes('gpt') || modelLower.includes('oss');
              const pool = isClaudeOrGpt ? d.windows.claude5h : d.windows.fiveHour;
              const weekly = isClaudeOrGpt ? d.windows.claudeWeekly : d.windows.weekly;
              m.meta.quotaSnapshot = {
                percent: pool?.percent != null ? pool.percent : 100,
                resetIn: pool?.resetsIn || pool?.resetText || '5h',
                weeklyPercent: weekly?.percent != null ? weekly.percent : 90,
                model: m.meta.model || state.selectedModel
              };
              updated = true;
            }
          });
          if (updated) {
            saveConversations();
            if (!state.streaming && !activeClientRuns.has(state.activeId) && !conv?.isRunning) {
              paintActiveConv();
            }
          }
        }
      }
    })
    .catch(() => {});

  Promise.all([
    refreshSystemStatus(),
    refreshModels().then(() => {
      if (state.models && state.models.length) {
        try { localStorage.setItem("agy-cached-models", JSON.stringify(state.models)); } catch (_) {}
      }
    })
  ]).catch(() => {});
}

initApp();

// ── 无论熄屏多久，回到前台时无感静默同步服务端最新已落盘的消息记录 ──
async function silentSyncActiveConversation() {
  const conv = activeConv();
  if (!conv) return false;
  // 若当前正在流式接收中且 WS 正常连接，切勿打断活跃的 WebSocket 和 liveNode 思考动画
  if (state.streaming && activeClientRuns.has(conv.id)) {
    const r = activeClientRuns.get(conv.id);
    if (r && r.ws && (r.ws.readyState === WebSocket.OPEN || r.ws.readyState === WebSocket.CONNECTING)) {
      return false;
    }
  }
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) return false;
    const data = await res.json();
    if (data && Array.isArray(data.sessions)) {
      const s = data.sessions.find(item => item.id === conv.id);
      if (s && Array.isArray(s.messages) && s.messages.length > 0) {
        // 如果远端仍在生成中 (s.isRunning === true)，绝不可销毁 activeClientRuns 或设置 streaming = false！
        if (s.isRunning) {
          const running = activeClientRuns.get(conv.id);
          if (running) {
            const lastMsg = s.messages[s.messages.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              if (Array.isArray(lastMsg.tools) && lastMsg.tools.length > (running.toolEvents?.length || 0)) {
                running.toolEvents = lastMsg.tools;
              }
              if (lastMsg.content && lastMsg.content.length > (running.acc?.length || 0)) {
                running.acc = lastMsg.content;
              }
              if (running.asstNode) {
                updateAssistantBubble(running.asstNode, running.acc, running.toolEvents, true, null, running.latestTip, running.latestWaited);
              }
            }
          }
          return true;
        }

        const lastRemote = s.messages[s.messages.length - 1];
        // 只有在服务端任务已彻底完成 (!s.isRunning) 且远端具备完整助手回答时，才对齐落盘
        const shouldSync = s.messages.length > conv.messages.length || 
          (state.streaming && lastRemote && lastRemote.role === 'assistant' && !s.isRunning);
        if (shouldSync) {
          conv.messages = s.messages;
          if (s.convId) conv.convId = s.convId;
          saveConversations();
          state.streaming = false;
          activeClientRuns.delete(conv.id);
          updateSendButton();
          paintActiveConv();
          return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

// ── 借鉴 CloudCLI：刷新/重开页面后自动重连到正在运行的后台任务，实时显示思考/工具执行/文本流 ──
// 服务端 Run Registry 一直在跑（不因前端断开而 kill），重连后回放所有错过的事件并继续接收实时流。
function tryReconnectToOngoingRun() {
  const conv = activeConv();
  if (!conv) return;
  if (state.streaming) return; // 正在发消息时不要干扰

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${location.host}/ws/chat`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    // 发送 subscribe 请求：携带 lastSeq: 0 以重放该 turn 所有的历史进度和流式输出
    ws.send(JSON.stringify({
      token: authToken,
      action: 'subscribe',
      lastSeq: 0,
      model: state.selectedModel || 'gemini-3.7-flash-high',
      messages: conv.messages || [{ role: 'user', content: '' }],
      conversationKey: conv.id,
      conversationId: conv.convId || undefined
    }));
  };

  let reconnected = false;
  let acc = '';
  const feed = $("#chat-feed");
  let asstNode = null;
  let toolEvents = [];
  const t0 = Date.now();
  let latestTip = '正在进行深度逻辑推理与代码分析...';

  const ensureAsstNode = () => {
    // 关键防脱离：若 asstNode 已被外部 DOM 刷新清除，重置为 null 重新挂载
    if (asstNode && asstNode.row && !document.body.contains(asstNode.row)) {
      asstNode = null;
    }
    if (!asstNode) {
      const lastMsgRow = feed?.querySelector(".message-row:last-child");
      if (lastMsgRow && lastMsgRow.classList.contains("assistant") && lastMsgRow.classList.contains("streaming")) {
        const bubble = lastMsgRow.querySelector(".message-bubble");
        asstNode = { row: lastMsgRow, bubble };
      } else {
        asstNode = appendMsgRow('assistant', acc || '', true, null, toolEvents);
      }
      const clientRun = activeClientRuns.get(conv.id);
      if (clientRun) clientRun.asstNode = asstNode;
    }
    return asstNode;
  };

  // 启动重连状态实时读秒定时器：保持思考状态平滑计数，防止刷新后停滞或闪烁
  let statusTicker = setInterval(() => {
    if (!state.streaming || (acc && acc.replace(/[\u200b\s]/g, '').length > 0)) {
      if (statusTicker) { clearInterval(statusTicker); statusTicker = null; }
      return;
    }
    const node = ensureAsstNode();
    if (node && state.activeId === conv.id) {
      const waited = Math.max(1, Math.round((Date.now() - t0) / 1000));
      updateAssistantBubble(node, acc, toolEvents, true, null, latestTip, waited);
    }
  }, 1000);

  ws.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (_) { return; }

    // 应用层心跳：忽略，仅用于保活防反代空闲掐断 WS
    if (data.keepalive) return;

    if (data.unauthenticated) {
      showLoginGate();
      return;
    }

    if (data.subscribed && data.isRunning) {
      reconnected = true;
      state.streaming = true;
      if (data.accumulated) acc = data.accumulated;
      if (Array.isArray(data.toolEvents) && data.toolEvents.length) toolEvents = [...data.toolEvents];
      if (data.latestTip) latestTip = data.latestTip;
      const waited = data.latestWaited || Math.max(1, Math.round((Date.now() - t0) / 1000));

      let clientRun = activeClientRuns.get(conv.id);
      if (!clientRun) {
        clientRun = {
          convId: conv.id,
          acc: acc,
          toolEvents: toolEvents,
          asstNode: null,
          ws: ws,
          t0: t0,
          model: data.model || state.selectedModel,
          latestTip: latestTip,
          latestWaited: waited,
          statusTicker: null
        };
        activeClientRuns.set(conv.id, clientRun);
      } else {
        clientRun.acc = acc;
        clientRun.toolEvents = toolEvents;
        clientRun.latestTip = latestTip;
        clientRun.latestWaited = waited;
      }
      updateSendButton();
      $("#chat-empty")?.classList.add("hidden");
      $("#chat-feed")?.classList.remove("hidden");
      const node = ensureAsstNode();
      if (node) {
        updateAssistantBubble(node, acc, toolEvents, true, null, latestTip, waited);
      }
      return;
    }

    if (data.idle) {
      if (statusTicker) { clearInterval(statusTicker); statusTicker = null; }
      activeClientRuns.delete(conv.id);
      try { ws.close(); } catch (_) {}
      silentSyncActiveConversation();
      return;
    }

    // 第一次收到非 idle 事件 = 后台确实有任务在跑或刚完成
    if (!reconnected && (data.progress || data.delta || data.error)) {
      reconnected = true;
      state.streaming = true;
      let clientRun = activeClientRuns.get(conv.id);
      if (!clientRun) {
        clientRun = {
          convId: conv.id,
          acc: acc,
          toolEvents: toolEvents,
          asstNode: null,
          ws: ws,
          t0: t0,
          model: state.selectedModel,
          latestTip: latestTip,
          latestWaited: 0,
          statusTicker: null
        };
        activeClientRuns.set(conv.id, clientRun);
      }
      updateSendButton();
      $("#chat-empty")?.classList.add("hidden");
      $("#chat-feed")?.classList.remove("hidden");
      ensureAsstNode();
    }

    if (data.error) {
      if (statusTicker) { clearInterval(statusTicker); statusTicker = null; }
      activeClientRuns.delete(conv.id);
      const node = ensureAsstNode();
      if (node) {
        node.bubble.innerHTML = formatMarkdown(data.error, false);
        node.row.className = 'message-row error';
      }
      state.streaming = false;
      updateSendButton();
      return;
    }

    if (data.progress) {
      const node = ensureAsstNode();
      if (data.tip) latestTip = data.tip;
      if (data.toolName) {
        let existing = null;
        if (data.toolId) {
          existing = toolEvents.find(e => e.toolId === data.toolId);
        }
        if (!existing && data.stepIndex != null) {
          existing = toolEvents.find(e => e.stepIndex != null && e.stepIndex === data.stepIndex);
        }
        if (!existing && toolEvents.length > 0) {
          const last = toolEvents[toolEvents.length - 1];
          if (last && last.tool === data.toolName && (last.state === 'ACTIVE' || !last.output) && data.toolOutput) {
            existing = last;
          }
        }
        if (existing) {
          if (data.toolId) existing.toolId = data.toolId;
          if (data.toolInput) existing.input = data.toolInput;
          if (data.toolOutput) existing.output = data.toolOutput;
          if (data.toolState) existing.state = data.toolState;
          if (data.duration) existing.duration = data.duration;
        } else {
          toolEvents.push({
            tool: data.toolName,
            stepIndex: data.stepIndex,
            toolId: data.toolId || '',
            stepType: data.stepType || '',
            tip: data.tip || '',
            waited: data.waited || 0,
            input: data.toolInput,
            output: data.toolOutput,
            state: data.toolState || 'DONE'
          });
        }
      }
      const clientRun = activeClientRuns.get(conv.id);
      if (clientRun) {
        clientRun.toolEvents = toolEvents;
        clientRun.latestTip = latestTip;
        // 不用 server 的 data.waited 覆盖前端累计（两端 t0 不同会导致秒数来回跳，如 29s/10s 交替）
        // 前端 statusTicker 每秒自己累计 latestWaited，更准且单一
      }
      if (node) {
        // 用前端累计的 latestWaited（单一时间源），不用 server data.waited
        const w = (clientRun && clientRun.latestWaited) || 0;
        updateAssistantBubble(node, acc, toolEvents, true, null, latestTip, w);
      }
      return;
    }

    if (data.delta != null && data.delta !== '​') {
      if (statusTicker) { clearInterval(statusTicker); statusTicker = null; }
      const node = ensureAsstNode();
      acc += data.delta;
      const clientRun = activeClientRuns.get(conv.id);
      if (clientRun) clientRun.acc = acc;
      if (node) {
        updateAssistantBubble(node, acc, toolEvents, true);
        if (feed) feed.scrollTop = feed.scrollHeight;
      }
    }

    if (data.conversationId) {
      conv.convId = data.conversationId;
      saveConversations();
    }

    if (data.done) {
      if (statusTicker) { clearInterval(statusTicker); statusTicker = null; }
      activeClientRuns.delete(conv.id);
      if (!reconnected) {
        // 未收到有效运行中标记或流式增量，直接关闭，绝不篡改历史
        try { ws.close(); } catch (_) {}
        return;
      }
      const cleanAcc = acc.replace(/​/g, '').trim();
      if (!cleanAcc && !toolEvents.length) {
        // 无实际内容产出，清理可能残留的空 streaming 占位
        if (asstNode && asstNode.row && asstNode.row.classList.contains("streaming")) {
          asstNode.row.remove();
        }
        state.streaming = false;
        updateSendButton();
        try { ws.close(); } catch (_) {}
        return;
      }
      const node = ensureAsstNode();
      if (node) {
        const metaSnapshot = { model: state.selectedModel };
        updateAssistantBubble(node, acc, toolEvents, false, metaSnapshot);
        node.row.classList.remove('streaming');
        state.streaming = false;
        updateSendButton();
        refreshIcons();
        if (cleanAcc || toolEvents.length) {
          const lastMsg = conv.messages[conv.messages.length - 1];
          if (!lastMsg || lastMsg.role !== 'assistant') {
            conv.messages.push({ role: 'assistant', content: acc, tools: toolEvents.length ? toolEvents : undefined, meta: { model: state.selectedModel } });
          } else {
            lastMsg.content = acc;
            if (toolEvents.length) lastMsg.tools = toolEvents;
          }
        }
        saveConversations(true);
      }
      silentSyncActiveConversation();
      try { ws.close(); } catch (_) {}
    }
  };

  ws.onclose = () => {
    if (reconnected && state.streaming) {
      setTimeout(() => { if (state.streaming) tryReconnectToOngoingRun(); }, 1000);
    } else {
      if (statusTicker) { clearInterval(statusTicker); statusTicker = null; }
      activeClientRuns.delete(conv.id);
      silentSyncActiveConversation();
    }
  };

  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}

// ── 附件上传（借鉴 CloudCLI）──
const fileInput = $("#file-input");
const btnAttach = $("#btn-attach");
const attachPreview = $("#attachment-preview");

// 高性能全功能图片灯箱：支持移动端双指缩放、拖拽平移、双击缩放、滚轮缩放与快捷控制栏
window.openImageLightbox = function(src) {
  let overlay = document.getElementById('img-lightbox');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'img-lightbox';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.94);z-index:99999;display:none;align-items:center;justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none;overflow:hidden;';
    overlay.innerHTML = `
      <div id="lightbox-toolbar" style="position:absolute;top:14px;left:16px;right:16px;display:flex;align-items:center;justify-content:space-between;z-index:10;pointer-events:none;">
        <div id="lightbox-zoom-info" style="color:rgba(255,255,255,0.75);font-size:12px;background:rgba(0,0,0,0.45);padding:4px 10px;border-radius:20px;backdrop-filter:blur(4px);pointer-events:auto;">100%</div>
        <div style="display:flex;align-items:center;gap:10px;pointer-events:auto;">
          <button id="lightbox-zoom-out" style="width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;color:#fff;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;">−</button>
          <button id="lightbox-zoom-reset" style="width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;">1:1</button>
          <button id="lightbox-zoom-in" style="width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;color:#fff;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;">+</button>
          <button id="lightbox-close-btn" style="width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,0.25);border:none;color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-left:6px;">&times;</button>
        </div>
      </div>
      <div id="lightbox-img-wrapper" style="position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">
        <img id="lightbox-img" style="max-width:92vw;max-height:90vh;object-fit:contain;border-radius:6px;transform-origin:center center;transition:transform 0.05s ease-out;will-change:transform;" draggable="false" />
      </div>
      <div style="position:absolute;bottom:16px;left:0;right:0;text-align:center;color:rgba(255,255,255,0.5);font-size:12px;pointer-events:none;">
        双指捏合缩放 · 单指拖动 · 双击还原
      </div>
    `;

    document.body.appendChild(overlay);

    const img = overlay.querySelector('#lightbox-img');
    const zoomInfo = overlay.querySelector('#lightbox-zoom-info');
    const closeBtn = overlay.querySelector('#lightbox-close-btn');
    const zoomInBtn = overlay.querySelector('#lightbox-zoom-in');
    const zoomOutBtn = overlay.querySelector('#lightbox-zoom-out');
    const zoomResetBtn = overlay.querySelector('#lightbox-zoom-reset');

    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let initialPinchDist = 0;
    let initialScale = 1;
    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let hasMoved = false;
    let lastTapTime = 0;

    function updateTransform(smooth = false) {
      if (scale < 1) scale = 1;
      if (scale > 5) scale = 5;
      if (scale === 1) {
        translateX = 0;
        translateY = 0;
      }
      img.style.transition = smooth ? 'transform 0.25s cubic-bezier(0.2,0,0,1)' : 'none';
      img.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
      if (zoomInfo) zoomInfo.textContent = `${Math.round(scale * 100)}%`;
    }

    window._resetLightboxState = function() {
      scale = 1;
      translateX = 0;
      translateY = 0;
      updateTransform(false);
    };

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.style.display = 'none';
      window._resetLightboxState();
    });

    zoomInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      scale = Math.min(5, scale + 0.5);
      updateTransform(true);
    });

    zoomOutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      scale = Math.max(1, scale - 0.5);
      updateTransform(true);
    });

    zoomResetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window._resetLightboxState();
    });

    // 遮罩点击退出 (仅当未放大且未拖拽时)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.id === 'lightbox-img-wrapper') {
        if (scale <= 1 && !hasMoved) {
          overlay.style.display = 'none';
          window._resetLightboxState();
        }
      }
    });

    // 双击快速缩放
    overlay.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        const now = Date.now();
        if (now - lastTapTime < 300 && !hasMoved) {
          scale = scale > 1.2 ? 1 : 2.5;
          translateX = 0;
          translateY = 0;
          updateTransform(true);
        }
        lastTapTime = now;
      }
    });

    // 触摸手势：支持双指捏合缩放 + 单指在放大状态下平移
    overlay.addEventListener('touchstart', (e) => {
      hasMoved = false;
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initialPinchDist = Math.hypot(dx, dy);
        initialScale = scale;
      } else if (e.touches.length === 1) {
        isDragging = true;
        startX = e.touches[0].clientX - translateX;
        startY = e.touches[0].clientY - translateY;
      }
    }, { passive: false });

    overlay.addEventListener('touchmove', (e) => {
      e.preventDefault();
      hasMoved = true;
      if (e.touches.length === 2 && initialPinchDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const currentDist = Math.hypot(dx, dy);
        scale = initialScale * (currentDist / initialPinchDist);
        updateTransform(false);
      } else if (e.touches.length === 1 && isDragging) {
        if (scale > 1) {
          translateX = e.touches[0].clientX - startX;
          translateY = e.touches[0].clientY - startY;
          updateTransform(false);
        }
      }
    }, { passive: false });

    overlay.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        isDragging = false;
        initialPinchDist = 0;
        if (scale < 1) {
          scale = 1;
          updateTransform(true);
        }
      } else if (e.touches.length === 1) {
        startX = e.touches[0].clientX - translateX;
        startY = e.touches[0].clientY - translateY;
      }
    });

    // PC 滚轮缩放与鼠标拖拽
    overlay.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      scale = Math.min(5, Math.max(1, scale + delta));
      updateTransform(true);
    }, { passive: false });

    let isMouseDown = false;
    let mouseStartX = 0;
    let mouseStartY = 0;

    overlay.addEventListener('mousedown', (e) => {
      if (e.target.closest('#lightbox-toolbar')) return;
      isMouseDown = true;
      hasMoved = false;
      mouseStartX = e.clientX - translateX;
      mouseStartY = e.clientY - translateY;
    });

    overlay.addEventListener('mousemove', (e) => {
      if (isMouseDown && scale > 1) {
        hasMoved = true;
        translateX = e.clientX - mouseStartX;
        translateY = e.clientY - mouseStartY;
        updateTransform(false);
      }
    });

    overlay.addEventListener('mouseup', () => {
      isMouseDown = false;
    });
  }

  const img = overlay.querySelector('#lightbox-img');
  if (img) img.src = src;
  if (window._resetLightboxState) window._resetLightboxState();
  overlay.style.display = 'flex';
};

if (btnAttach) {
  btnAttach.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => handleFiles(fileInput.files));
  // 拖拽
  const composer = $("#input");
  composer.addEventListener("dragover", (e) => { e.preventDefault(); composer.style.border = "1px solid var(--accent)"; });
  composer.addEventListener("dragleave", () => { composer.style.border = ""; });
  composer.addEventListener("drop", (e) => { e.preventDefault(); composer.style.border = ""; handleFiles(e.dataTransfer.files); });
  // 剪贴板截图粘贴支持 (Ctrl+V / Command+V)
  composer.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) pastedFiles.push(file);
      }
    }
    if (pastedFiles.length) {
      handleFiles(pastedFiles);
    }
  });
}

async function handleFiles(files) {
  if (!files || !files.length) return;
  if (files.length > 10) return toast("最多 10 个文件");
  const formData = new FormData();
  for (const f of files) {
    if (f.size > 100 * 1024 * 1024) return toast(`${f.name} 超过 100MB 上限`);
    formData.append("files", f);
  }
  // 上传到 server
  try {
    const res = await fetch("/api/assets/files", { method: "POST", body: formData });
    const data = await res.json();
    if (data.error) return toast(data.error);
    if (!data.attachments || !data.attachments.length) return toast("上传失败");
    pendingAttachments = (pendingAttachments || []).concat(data.attachments);
    renderAttachmentPreview();
    toast(`已添加 ${data.attachments.length} 个附件`);
  } catch (e) { toast("上传失败：" + e.message); }
  // 清空 file input 允许重复选择同一文件
  fileInput.value = "";
}

function renderAttachmentPreview() {
  if (!attachPreview) return;
  if (!pendingAttachments || !pendingAttachments.length) {
    attachPreview.classList.add("hidden");
    attachPreview.innerHTML = "";
    return;
  }
  attachPreview.classList.remove("hidden");
  attachPreview.innerHTML = pendingAttachments.map((a, i) => {
    const icon = a.mimeType?.startsWith("image/") ? "🖼️" : "📄";
    return `<div class="attach-chip" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;margin:2px;border-radius:8px;background:var(--bg-secondary);border:1px solid var(--border-color);font-size:12px;">
      <span>${icon}</span><span>${escapeHtml(a.name || "文件")}</span>
      <span class="attach-remove" data-idx="${i}" style="cursor:pointer;color:var(--danger);margin-left:4px;">✕</span>
    </div>`;
  }).join("");
  attachPreview.querySelectorAll(".attach-remove").forEach(b => {
    b.addEventListener("click", () => {
      const idx = parseInt(b.dataset.idx);
      pendingAttachments.splice(idx, 1);
      renderAttachmentPreview();
    });
  });
}

// ── 现代化工作区文件管理与代码/图片双模浏览器（借鉴 CloudCLI 设计）──
let currentDirPath = ""; // 当前浏览的目录路径（"" 自动加载默认根目录）
let currentDirData = null; // 当前目录返回的完整数据
let explorerShowHidden = false; // 是否显示隐藏文件（以点开头）
let activeFilePath = null; // 当前正在查看/编辑的文件完整路径
let activeFileItem = null; // 当前选中文件的元数据项

function formatFileSize(bytes) {
  if (bytes == null || isNaN(bytes) || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIconAndColor(name, ext) {
  const e = (ext || name.split('.').pop() || '').toLowerCase();
  switch (e) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return { icon: '📜', color: '#facc15', label: 'JavaScript' };
    case 'ts':
      return { icon: '📘', color: '#38bdf8', label: 'TypeScript' };
    case 'json':
      return { icon: '⚙️', color: '#34d399', label: 'JSON' };
    case 'html':
      return { icon: '🌐', color: '#fb923c', label: 'HTML' };
    case 'css':
    case 'scss':
      return { icon: '🎨', color: '#60a5fa', label: 'CSS' };
    case 'md':
      return { icon: '📑', color: '#a78bfa', label: 'Markdown' };
    case 'py':
      return { icon: '🐍', color: '#38bdf8', label: 'Python' };
    case 'sh':
    case 'bash':
      return { icon: '💻', color: '#10b981', label: 'Shell' };
    case 'env':
    case 'gitignore':
    case 'yml':
    case 'yaml':
      return { icon: '🔧', color: '#94a3b8', label: 'Config' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'ico':
      return { icon: '🖼️', color: '#f472b6', label: 'Image' };
    default:
      return { icon: '📄', color: '#94a3b8', label: 'File' };
  }
}

async function showWorkspaceExplorer() {
  activeFilePath = null;
  activeFileItem = null;

  openModal("📁 Antigravity 工作区文件管理器", `
    <div class="workspace-explorer-wrap">
      <!-- 左侧：目录导航与文件列表 -->
      <div class="explorer-sidebar" style="width:360px;min-width:300px;display:flex;flex-direction:column;">
        <!-- 预设目录快速下拉与功能操作 -->
        <div style="padding:8px 10px;background:var(--bg-tertiary);border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:6px;">
          <select id="explorer-preset-select" class="form-input" style="flex:1;font-size:11.5px;height:28px;padding:2px 6px;cursor:pointer;" onchange="onPresetRootChange(this.value)">
            <option value="">⚡ 加载预设根目录...</option>
          </select>
          <button id="btn-toggle-hidden" class="btn btn-ghost" style="padding:4px 7px;font-size:11.5px;" onclick="toggleExplorerHidden()" title="显示/隐藏点开头的隐藏文件">
            <i data-lucide="eye" style="width:13px;height:13px;"></i>
          </button>
          <button class="btn btn-ghost" style="padding:4px 7px;font-size:11.5px;" onclick="triggerExplorerUpload()" title="上传文件到当前目录">
            <i data-lucide="upload" style="width:13px;height:13px;"></i>
          </button>
          <input type="file" id="explorer-upload-input" multiple style="display:none;" onchange="handleExplorerUpload(this.files)" />
          <button class="btn btn-ghost" style="padding:4px 7px;font-size:11.5px;" onclick="promptCreateExplorerItem('file')" title="新建文件">
            <i data-lucide="file-plus" style="width:13px;height:13px;"></i>
          </button>
          <button class="btn btn-ghost" style="padding:4px 7px;font-size:11.5px;" onclick="promptCreateExplorerItem('dir')" title="新建文件夹">
            <i data-lucide="folder-plus" style="width:13px;height:13px;"></i>
          </button>
        </div>

        <!-- 顶部路径面包屑 & 返回上一级 -->
        <div class="explorer-path-bar">
          <button id="btn-explorer-back" class="btn btn-ghost explorer-btn-back" onclick="navigateExplorerUp()" title="返回上一级目录">
            <i data-lucide="arrow-up" style="width:13px;height:13px;"></i> 上一级
          </button>
          <div id="explorer-breadcrumbs" class="explorer-breadcrumbs"></div>
        </div>

        <!-- 搜索与刷新工具栏 -->
        <div class="explorer-toolbar">
          <div class="explorer-search-wrap">
            <i data-lucide="search" style="width:13px;height:13px;color:var(--text-dim);"></i>
            <input id="explorer-search-input" class="form-input" placeholder="过滤当前目录..." oninput="filterCurrentExplorerItems(this.value)" />
          </div>
          <button class="btn btn-ghost btn-icon" onclick="reloadWorkspaceExplorer()" title="刷新目录">
            <i data-lucide="rotate-cw" style="width:13px;height:13px;"></i>
          </button>
        </div>

        <!-- 状态信息条 -->
        <div id="explorer-stats-bar" style="padding:4px 12px;font-size:11px;color:var(--text-dim);background:var(--bg-secondary);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;">
          <span id="explorer-item-count">0 项</span>
          <span id="explorer-hidden-status" style="cursor:pointer;text-decoration:underline;" onclick="toggleExplorerHidden()">隐藏文件: 关</span>
        </div>

        <!-- 当前目录下文件与子文件夹列表 -->
        <div id="explorer-list-wrap" class="explorer-tree" style="flex:1;overflow-y:auto;padding:6px 8px;">
          <div style="padding:28px 16px;color:var(--text-dim);font-size:12.5px;text-align:center;">
            <span class="thinking-dots"><i></i><i></i><i></i></span> 正在读取工作区...
          </div>
        </div>
      </div>

      <!-- 右侧：文件预览与编辑器 -->
      <div class="explorer-main">
        <!-- 空状态 -->
        <div id="explorer-empty-view" class="explorer-empty">
          <div style="font-size:42px;margin-bottom:12px;">📂</div>
          <div style="font-weight:600;font-size:15px;color:var(--text-main);margin-bottom:6px;">在左侧选择文件浏览或编辑</div>
          <div style="font-size:12px;color:var(--text-dim);max-width:380px;line-height:1.6;">
            单层极速按需加载，数万文件目录瞬时秒开。支持直接预览图片、全屏缩放手势、在线编辑代码并快捷保存 (Ctrl+S)。
          </div>
        </div>

        <!-- 代码与文本编辑器视图 -->
        <div id="explorer-editor-view" class="explorer-editor hidden">
          <div class="explorer-editor-header">
            <div class="explorer-breadcrumb">
              <button class="explorer-mobile-back-btn" onclick="closeExplorerFileView()" title="返回列表">
                <i data-lucide="chevron-left" style="width:14px;height:14px;"></i> 返回
              </button>
              <i data-lucide="file-code" style="width:15px;height:15px;color:var(--accent);"></i>
              <span id="explorer-current-path" style="font-weight:600;font-size:13px;color:var(--text-main);word-break:break-all;"></span>
              <span id="explorer-file-badge" class="explorer-badge"></span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <span id="explorer-save-status" style="font-size:11.5px;color:var(--text-dim);"></span>
              <button class="btn btn-ghost" style="padding:4px 8px;font-size:12px;" onclick="downloadActiveFile()" title="下载文件">
                <i data-lucide="download" style="width:13px;height:13px;"></i>
              </button>
              <button id="btn-explorer-save" class="btn btn-primary" style="padding:4px 12px;font-size:12px;" onclick="saveCurrentExplorerFile()">
                <i data-lucide="save" style="width:13px;height:13px;"></i> 保存修改
              </button>
            </div>
          </div>

          <div class="explorer-textarea-wrap">
            <textarea id="explorer-code-editor" class="explorer-code-editor" spellcheck="false" placeholder="文件内容为空..."></textarea>
          </div>

          <div class="explorer-editor-footer">
            <span id="explorer-stat-lines">0 行</span>
            <span id="explorer-stat-size">0 KB</span>
            <span style="opacity:0.7;">UTF-8 · 快捷键 Ctrl+S 保存</span>
          </div>
        </div>

        <!-- 图片多媒体全景预览视图 -->
        <div id="explorer-image-view" class="explorer-editor hidden">
          <div class="explorer-editor-header">
            <div class="explorer-breadcrumb">
              <button class="explorer-mobile-back-btn" onclick="closeExplorerFileView()" title="返回列表">
                <i data-lucide="chevron-left" style="width:14px;height:14px;"></i> 返回
              </button>
              <i data-lucide="image" style="width:15px;height:15px;color:#f472b6;"></i>
              <span id="explorer-image-name" style="font-weight:600;font-size:13px;color:var(--text-main);word-break:break-all;"></span>
              <span id="explorer-image-badge" class="explorer-badge" style="color:#f472b6;">IMAGE</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="openActiveImageFullscreen()" title="全屏手势缩放查看">
                <i data-lucide="maximize-2" style="width:13px;height:13px;"></i> 全屏放大
              </button>
              <button class="btn btn-primary" style="padding:4px 12px;font-size:12px;" onclick="downloadActiveFile()">
                <i data-lucide="download" style="width:13px;height:13px;"></i> 下载原图
              </button>
            </div>
          </div>

          <div class="explorer-image-container" style="flex:1;display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto;background: repeating-conic-gradient(#1e222d 0% 25%, #181b23 0% 50%) 50% / 20px 20px;">
            <img id="explorer-image-preview" src="" alt="Image Preview" style="max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 8px 28px rgba(0,0,0,0.6);border-radius:6px;cursor:zoom-in;" title="点击全屏放大预览" />
          </div>

          <div class="explorer-editor-footer">
            <span id="explorer-image-dimensions">正在读取尺寸...</span>
            <span id="explorer-image-size">0 KB</span>
            <span style="opacity:0.7;">点击图片可进入高性能手势灯箱</span>
          </div>
        </div>
      </div>
    </div>
  `, true, 'explorer-modal');

  refreshIcons();
  await reloadWorkspaceExplorer(currentDirPath || "");

  const editor = $("#explorer-code-editor");
  if (editor) {
    editor.addEventListener("input", updateExplorerEditorStats);
    editor.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveCurrentExplorerFile();
      }
    });
  }
}

window.reloadWorkspaceExplorer = async function(dirToLoad) {
  const listWrap = $("#explorer-list-wrap");
  if (dirToLoad !== undefined) currentDirPath = dirToLoad;

  if (listWrap) {
    listWrap.innerHTML = `
      <div style="padding:28px 16px;color:var(--text-dim);font-size:12.5px;text-align:center;">
        <span class="thinking-dots"><i></i><i></i><i></i></span> 正在读取目录...
      </div>
    `;
  }

  try {
    const url = `/api/workspace/list?dir=${encodeURIComponent(currentDirPath || '')}&showHidden=${explorerShowHidden ? 'true' : 'false'}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '加载目录失败');

    currentDirData = data;
    currentDirPath = data.currentPath || currentDirPath;

    // 填充快捷预设目录下拉选项
    const presetSelect = $("#explorer-preset-select");
    if (presetSelect && data.presetRoots && data.presetRoots.length) {
      presetSelect.innerHTML = data.presetRoots.map(r => {
        const isMatched = currentDirPath === r.path || currentDirPath.startsWith(r.path + '/');
        return `<option value="${escapeHtml(r.path)}" ${isMatched ? 'selected' : ''}>${escapeHtml(r.name)}</option>`;
      }).join('');
    }

    renderExplorerNav(data);
    renderExplorerList();
  } catch (e) {
    if (listWrap) {
      listWrap.innerHTML = `<div style="padding:24px 16px;color:var(--danger);font-size:12.5px;text-align:center;">读取失败: ${escapeHtml(e.message)}</div>`;
    }
  }
  refreshIcons();
};

window.reloadWorkspaceTree = window.reloadWorkspaceExplorer;

function renderExplorerNav(data) {
  const breadcrumbs = $("#explorer-breadcrumbs");
  const backBtn = $("#btn-explorer-back");
  const hiddenBtn = $("#btn-toggle-hidden");
  const hiddenStatus = $("#explorer-hidden-status");

  if (backBtn) {
    const canGoBack = Boolean(data.parentPath);
    backBtn.disabled = !canGoBack;
    backBtn.style.opacity = canGoBack ? "1" : "0.35";
    backBtn.style.cursor = canGoBack ? "pointer" : "default";
  }

  if (hiddenBtn) {
    hiddenBtn.style.color = explorerShowHidden ? "var(--accent)" : "inherit";
  }
  if (hiddenStatus) {
    hiddenStatus.textContent = explorerShowHidden ? "隐藏文件: 开" : "隐藏文件: 关";
    hiddenStatus.style.color = explorerShowHidden ? "var(--accent)" : "var(--text-dim)";
  }

  if (breadcrumbs) {
    const current = data.currentPath || "";
    const parts = current.split('/').filter(Boolean);
    let crumbHtml = `<span class="explorer-crumb" onclick="navigateExplorerTo('/')" title="根目录">/</span>`;
    let accum = "";
    parts.forEach((p, idx) => {
      accum += '/' + p;
      const isLast = idx === parts.length - 1;
      crumbHtml += `<span class="explorer-crumb-sep">/</span>`;
      crumbHtml += `<span class="explorer-crumb ${isLast ? 'current' : ''}" onclick="${isLast ? '' : `navigateExplorerTo('${escapeHtml(accum)}')`}" title="${escapeHtml(accum)}">${escapeHtml(p)}</span>`;
    });
    breadcrumbs.innerHTML = crumbHtml;
  }
}

function renderExplorerList(filter = "") {
  const listWrap = $("#explorer-list-wrap");
  const countEl = $("#explorer-item-count");
  if (!listWrap || !currentDirData) return;

  const items = currentDirData.items || [];
  const q = (filter || "").toLowerCase().trim();
  const filtered = items.filter(it => !q || it.name.toLowerCase().includes(q));

  if (countEl) {
    countEl.textContent = `${filtered.length} 项${q ? ` (过滤自 ${items.length} 项)` : ''}`;
  }

  if (!filtered.length) {
    listWrap.innerHTML = `
      <div style="padding:36px 16px;color:var(--text-dim);font-size:12.5px;text-align:center;">
        <div style="font-size:26px;margin-bottom:8px;">📭</div>
        ${q ? '没有匹配的文件或文件夹' : '当前目录为空'}
      </div>
    `;
    return;
  }

  let html = "";
  filtered.forEach(it => {
    const isDir = it.type === 'dir';
    const isActive = activeFilePath === it.fullPath;
    const meta = isDir ? { icon: '📁', color: '#f59e0b', label: 'Folder' } : getFileIconAndColor(it.name, it.ext);

    let infoText = "";
    if (isDir) {
      infoText = it.count === -1 ? '大型目录' : `${it.count} 项`;
    } else {
      infoText = formatFileSize(it.size);
    }

    const clickFn = isDir 
      ? `navigateExplorerTo('${escapeHtml(it.fullPath)}')`
      : `openExplorerItem(${JSON.stringify(it).replace(/"/g, '&quot;')})`;

    html += `
      <div class="explorer-item-card ${isActive ? 'active' : ''}" onclick="${clickFn}" title="${escapeHtml(it.name)} (${infoText})">
        <div class="explorer-item-left">
          <span style="font-size:${isDir ? '16px' : '14px'};flex-shrink:0;">${meta.icon}</span>
          <span class="explorer-item-name" style="${isDir ? 'font-weight:500;' : ''}">${escapeHtml(it.name)}</span>
        </div>
        
        <div class="explorer-item-info" style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
          <span style="font-size:11px;color:var(--text-dim);">${infoText}</span>
          ${isDir ? '<span class="explorer-item-arrow">›</span>' : ''}
        </div>

        <div class="explorer-actions-hover">
          <button class="explorer-action-btn" onclick="promptRenameExplorerItem(${JSON.stringify(it).replace(/"/g, '&quot;')}, event)" title="重命名">
            <i data-lucide="edit-2" style="width:11px;height:11px;"></i>
          </button>
          ${!isDir ? `
            <button class="explorer-action-btn" onclick="downloadActiveFile('${escapeHtml(it.fullPath)}'); event.stopPropagation();" title="下载文件">
              <i data-lucide="download" style="width:11px;height:11px;"></i>
            </button>
          ` : ''}
          <button class="explorer-action-btn danger" onclick="promptDeleteExplorerItem(${JSON.stringify(it).replace(/"/g, '&quot;')}, event)" title="删除">
            <i data-lucide="trash-2" style="width:11px;height:11px;"></i>
          </button>
        </div>
      </div>
    `;
  });

  listWrap.innerHTML = html;
  refreshIcons();
}

window.navigateExplorerTo = function(dirPath) {
  const searchInput = $("#explorer-search-input");
  if (searchInput) searchInput.value = "";
  reloadWorkspaceExplorer(dirPath);
};

window.navigateExplorerUp = function() {
  if (currentDirData && currentDirData.parentPath) {
    navigateExplorerTo(currentDirData.parentPath);
  }
};

window.onPresetRootChange = function(rootPath) {
  if (rootPath) {
    navigateExplorerTo(rootPath);
  }
};

window.toggleExplorerHidden = function() {
  explorerShowHidden = !explorerShowHidden;
  reloadWorkspaceExplorer();
};

window.filterCurrentExplorerItems = function(val) {
  renderExplorerList(val);
};

window.openExplorerItem = async function(item) {
  activeFilePath = item.fullPath;
  activeFileItem = item;

  const wrap = $(".workspace-explorer-wrap");
  if (wrap) wrap.classList.add("mobile-viewing-file");

  const emptyView = $("#explorer-empty-view");
  const editorView = $("#explorer-editor-view");
  const imageView = $("#explorer-image-view");

  document.querySelectorAll(".explorer-item-card").forEach(c => c.classList.remove("active"));
  // 查找并高亮对应卡片
  document.querySelectorAll(".explorer-item-card").forEach(c => {
    if (c.getAttribute("title")?.startsWith(item.name)) c.classList.add("active");
  });

  if (item.isImage) {
    if (emptyView) emptyView.classList.add("hidden");
    if (editorView) editorView.classList.add("hidden");
    if (imageView) imageView.classList.remove("hidden");

    const imgEl = $("#explorer-image-preview");
    const nameEl = $("#explorer-image-name");
    const badgeEl = $("#explorer-image-badge");
    const dimEl = $("#explorer-image-dimensions");
    const sizeEl = $("#explorer-image-size");

    const rawUrl = `/api/workspace/file?path=${encodeURIComponent(item.fullPath)}&raw=true`;
    if (nameEl) nameEl.textContent = item.name;
    if (badgeEl) badgeEl.textContent = (item.ext || 'IMAGE').toUpperCase();
    if (sizeEl) sizeEl.textContent = formatFileSize(item.size);
    if (dimEl) dimEl.textContent = "正在读取图片尺寸...";

    if (imgEl) {
      imgEl.src = rawUrl;
      imgEl.onload = function() {
        if (dimEl) dimEl.textContent = `${this.naturalWidth} × ${this.naturalHeight} 像素`;
      };
      imgEl.onclick = function() {
        openActiveImageFullscreen();
      };
    }
    refreshIcons();
    return;
  }

  // 文本 / 代码文件模式
  if (emptyView) emptyView.classList.add("hidden");
  if (imageView) imageView.classList.add("hidden");
  if (editorView) editorView.classList.remove("hidden");

  const pathEl = $("#explorer-current-path");
  const badgeEl = $("#explorer-file-badge");
  const editor = $("#explorer-code-editor");
  const saveStatus = $("#explorer-save-status");
  const meta = getFileIconAndColor(item.name, item.ext);

  if (pathEl) pathEl.textContent = item.name;
  if (badgeEl) {
    badgeEl.textContent = meta.label || (item.ext || 'TEXT').toUpperCase();
    badgeEl.style.color = meta.color || "var(--text-dim)";
  }
  if (saveStatus) saveStatus.textContent = "正在读取...";

  try {
    const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(item.fullPath)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (editor) editor.value = data.content != null ? data.content : "";
    if (saveStatus) saveStatus.textContent = "";
    updateExplorerEditorStats();
    if (editor) editor.focus();
  } catch (e) {
    toast("无法打开文件: " + e.message);
    if (saveStatus) saveStatus.textContent = "读取失败";
  }
  refreshIcons();
};

window.saveCurrentExplorerFile = async function() {
  if (!activeFilePath) return;
  const editor = $("#explorer-code-editor");
  const saveStatus = $("#explorer-save-status");
  const saveBtn = $("#btn-explorer-save");

  const content = editor ? editor.value : "";
  if (saveStatus) saveStatus.textContent = "正在保存...";
  if (saveBtn) saveBtn.disabled = true;

  try {
    const res = await fetch("/api/workspace/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: activeFilePath, content })
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    if (saveStatus) saveStatus.textContent = "已保存 ✔";
    toast(`已保存: ${activeFilePath.split('/').pop()}`);
    setTimeout(() => { if (saveStatus && saveStatus.textContent.includes("已保存")) saveStatus.textContent = ""; }, 2500);
  } catch (e) {
    if (saveStatus) saveStatus.textContent = "保存失败 ✕";
    toast("保存失败: " + e.message);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
};

window.openActiveImageFullscreen = function() {
  if (!activeFilePath) return;
  const url = `/api/workspace/file?path=${encodeURIComponent(activeFilePath)}&raw=true`;
  if (typeof window.openImageLightbox === 'function') {
    window.openImageLightbox(url);
  } else {
    window.open(url, '_blank');
  }
};

window.downloadActiveFile = function(filePath) {
  const p = filePath || activeFilePath;
  if (!p) return;
  const url = `/api/workspace/file?path=${encodeURIComponent(p)}&raw=true`;
  const a = document.createElement('a');
  a.href = url;
  a.download = p.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

window.promptCreateExplorerItem = async function(type) {
  const isDir = type === 'dir';
  const name = prompt(`请输入新建${isDir ? '文件夹' : '文件'}名称:`);
  if (!name || !name.trim()) return;
  const targetDir = currentDirPath || "";
  const targetPath = (targetDir ? targetDir.replace(/\/$/, '') + '/' : '') + name.trim();
  try {
    const res = await fetch('/api/workspace/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath, type })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    toast(`成功创建${isDir ? '文件夹' : '文件'}: ${name.trim()}`);
    await reloadWorkspaceExplorer();
  } catch (e) {
    toast('创建失败: ' + e.message);
  }
};

window.promptRenameExplorerItem = async function(item, e) {
  if (e) e.stopPropagation();
  const newName = prompt(`请输入新名称:`, item.name);
  if (!newName || !newName.trim() || newName.trim() === item.name) return;
  const oldPath = item.fullPath;
  const parent = item.fullPath.substring(0, item.fullPath.lastIndexOf('/'));
  const newPath = parent + '/' + newName.trim();
  try {
    const res = await fetch('/api/workspace/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    toast('重命名成功');
    if (activeFilePath === oldPath) {
      activeFilePath = newPath;
      if (activeFileItem) activeFileItem.name = newName.trim();
    }
    await reloadWorkspaceExplorer();
  } catch (err) {
    toast('重命名失败: ' + err.message);
  }
};

window.promptDeleteExplorerItem = async function(item, e) {
  if (e) e.stopPropagation();
  const isDir = item.type === 'dir';
  if (!confirm(`确定要彻底删除此${isDir ? '文件夹及其所有内容' : '文件'}吗？\n\n${item.name}`)) return;
  try {
    const res = await fetch('/api/workspace/file?path=' + encodeURIComponent(item.fullPath), {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    toast('删除成功');
    if (activeFilePath === item.fullPath) {
      activeFilePath = null;
      $("#explorer-empty-view")?.classList.remove("hidden");
      $("#explorer-editor-view")?.classList.add("hidden");
      $("#explorer-image-view")?.classList.add("hidden");
    }
    await reloadWorkspaceExplorer();
  } catch (err) {
    toast('删除失败: ' + err.message);
  }
};

window.closeExplorerFileView = function() {
  activeFilePath = null;
  activeFileItem = null;
  const wrap = $(".workspace-explorer-wrap");
  if (wrap) wrap.classList.remove("mobile-viewing-file");
  const emptyView = $("#explorer-empty-view");
  const editorView = $("#explorer-editor-view");
  const imageView = $("#explorer-image-view");
  if (emptyView) emptyView.classList.remove("hidden");
  if (editorView) editorView.classList.add("hidden");
  if (imageView) imageView.classList.add("hidden");
  document.querySelectorAll(".explorer-item-card").forEach(c => c.classList.remove("active"));
};

window.triggerExplorerUpload = function() {
  const input = $("#explorer-upload-input");
  if (input) input.click();
};

window.handleExplorerUpload = async function(files) {
  if (!files || !files.length) return;
  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }
  const targetDir = currentDirPath || '';
  toast(`正在上传 ${files.length} 个文件...`);
  try {
    const res = await fetch(`/api/workspace/upload?dir=${encodeURIComponent(targetDir)}`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    toast(`成功上传 ${data.count || files.length} 个文件`);
    await reloadWorkspaceExplorer();
  } catch (err) {
    toast('上传失败: ' + err.message);
  } finally {
    const input = $("#explorer-upload-input");
    if (input) input.value = '';
  }
};

function updateExplorerEditorStats() {
  const editor = $("#explorer-code-editor");
  const linesEl = $("#explorer-stat-lines");
  const sizeEl = $("#explorer-stat-size");
  if (!editor) return;

  const lines = editor.value.split("\n").length;
  const bytes = new Blob([editor.value]).size;
  const sizeStr = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

  if (linesEl) linesEl.textContent = `${lines} 行`;
  if (sizeEl) sizeEl.textContent = sizeStr;
}

// 绑定侧边栏文件管理按钮
const btnFiles = $("#btn-files");
if (btnFiles) {
  btnFiles.addEventListener("click", showWorkspaceExplorer);
}

async function showAccountSwitcher() {
  let accounts = [];
  let activeEmail = "";
  try {
    const r = await fetch("/api/accounts");
    const d = await r.json();
    accounts = d.accounts || [];
    activeEmail = d.activeEmail || "";
  } catch (_) {}
  
  let rows = "";
  for (const a of accounts) {
    const isActive = a.email === activeEmail;
    const isPrimary = !!a.isPrimary;
    rows += `
      <div class="acct-row" data-email="${escapeHtml(a.email)}" style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;cursor:pointer;${isActive ? 'background:var(--bg-tertiary);' : ''};border:1px solid ${isPrimary ? 'rgba(245,158,11,0.3)' : 'var(--border-color)'};margin-bottom:6px;">
        <div style="position:relative;flex-shrink:0;">
          <img src="${escapeHtml(a.picture || '')}" style="width:32px;height:32px;border-radius:50%" onerror="this.style.display='none'"/>
          ${isPrimary ? '<span style="position:absolute;top:-4px;right:-4px;font-size:10px;">👑</span>' : ''}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(a.name || a.label || a.email)}</span>
            ${isPrimary ? '<span style="background:rgba(245,158,11,0.15);color:#f59e0b;font-size:10px;padding:1px 5px;border-radius:4px;font-weight:600;flex-shrink:0;">默认主账号</span>' : ''}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(a.email)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          ${isActive ? '<span style="color:#10b981;font-weight:600;font-size:12px;padding:2px 8px;border-radius:4px;background:rgba(16,185,129,0.1);">当前生效</span>' : '<span style="color:var(--accent);font-size:12px;">点击切换</span>'}
          ${isPrimary 
            ? '<span style="font-size:11px;color:var(--text-dim);cursor:not-allowed;" title="默认主账号不可删除，保障系统基础登录态">🔒 固定</span>' 
            : `<button class="acct-del" data-email="${escapeHtml(a.email)}" style="font-size:11px;padding:2px 6px;border:none;background:rgba(239,68,68,0.1);color:var(--danger);border-radius:4px;cursor:pointer">删除</button>`
          }
        </div>
      </div>
    `;
  }
  
  if (!rows) {
    rows = '<div style="padding:20px;text-align:center;color:var(--text-muted)">还没有添加多个账号</div>';
  }
  
  const modalHtml = `
    <div id="acct-list" style="margin-bottom:12px;max-height:300px;overflow-y:auto">${rows}</div>
    <div style="border-top:1px solid var(--border-color);padding-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:13px;font-weight:600;">管理账号</span>
      </div>
      
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn btn-primary" id="acct-add-new" style="width:100%;justify-content:center;">
          <i data-lucide="plus" style="width:14px;height:14px;margin-right:6px"></i> 网页登录添加新账号
        </button>
        
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
          <input id="acct-label" placeholder="当前账号的备注名（可选）" style="flex:1;padding:6px 10px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px"/>
          <button class="btn btn-ghost btn-sm" id="acct-add" style="font-size:12px;white-space:nowrap;">
            仅保存当前生效账号
          </button>
        </div>
      </div>
    </div>
    <div class="modal-footer" style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;">
      <button class="btn btn-ghost btn-sm" id="btn-open-usage-from-switcher" style="color:var(--accent);display:inline-flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;">
        <i data-lucide="gauge" style="width:13px;height:13px;"></i>
        <span>查看配额中心</span>
      </button>
      <button class="btn btn-ghost" data-cancel>关闭</button>
    </div>
  `;
  
  openModal("切换 Google 账号", modalHtml);
  refreshIcons();
  
  const modal = document.getElementById("modal-root");
  modal.querySelector("[data-cancel]").onclick = closeModal;
  const btnUsageFromSwitcher = modal.querySelector("#btn-open-usage-from-switcher");
  if (btnUsageFromSwitcher) {
    btnUsageFromSwitcher.onclick = () => {
      closeModal();
      showUsageModal();
    };
  }
  
  document.querySelectorAll(".acct-row").forEach(item => {
    item.onclick = async e => {
      if (e.target.classList.contains("acct-del")) return;
      const email = item.getAttribute("data-email");
      if (email === activeEmail) {
        closeModal();
        toast("正在对当前账号 " + email + " 执行实时额度检查与校准...");
        try {
          const r2 = await fetch("/api/accounts/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
          const d2 = await r2.json();
          if (d2.quota) {
            state.latestUsageData = d2.quota;
            try { localStorage.setItem('agy-cached-usage', JSON.stringify(d2.quota)); } catch (_) {}
            updateUsageSummary(d2.quota);
            if (document.getElementById("usage-account-card")) {
              renderUsageModalContent(d2.quota);
            }
          }
          toast("当前账号额度检查已完成");
          await refreshSystemStatus();
        } catch (_) {}
        return;
      }
      closeModal();
      toast("正在切换到 " + email + " 并执行额度检查...");
      try {
        const r2 = await fetch("/api/accounts/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
        const d2 = await r2.json();
        if (d2.error) { toast(d2.error); return; }
        
        // 立即用新切换账号由 Google 官方返回的实时配额替换旧数据
        if (d2.quota) {
          state.latestUsageData = d2.quota;
          try { localStorage.setItem('agy-cached-usage', JSON.stringify(d2.quota)); } catch (_) {}
        } else {
          state.latestUsageData = null;
          try { localStorage.removeItem('agy-cached-usage'); } catch (_) {}
        }
        localStorage.removeItem('claudeResetAt');
        toast("已切换到 " + (d2.account.label || d2.account.email) + "，额度检查已完成");
        await refreshSystemStatus();
        await refreshModels();
        updateUsageSummary(d2.quota || null);
        renderLoginArea();
        renderConvList();

        // 若当前模型用量与配额中心处于打开状态，立即用新账号数据刷新4个板块
        if (document.getElementById("usage-account-card") && d2.quota) {
          renderUsageModalContent(d2.quota);
        }
      } catch (e2) { toast("切换失败: " + e2.message); }
    };
  });
  
  document.querySelectorAll(".acct-del").forEach(btn => {
    btn.onclick = async e => {
      e.stopPropagation();
      const email = btn.getAttribute("data-email");
      toast("正在切除账号并检查剩余主账号额度...");
      const delRes = await fetch("/api/accounts/" + encodeURIComponent(email), { method: "DELETE" });
      const delData = await delRes.json();
      if (delData.error) {
        toast("切除失败: " + delData.error);
      } else {
        if (delData.quota) {
          state.latestUsageData = delData.quota;
          try { localStorage.setItem('agy-cached-usage', JSON.stringify(delData.quota)); } catch (_) {}
          updateUsageSummary(delData.quota);
          if (document.getElementById("usage-account-card")) {
            renderUsageModalContent(delData.quota);
          }
        }
        toast("已切除账号，主账号最新额度已同步");
        await refreshSystemStatus();
        await refreshModels();
        renderLoginArea();
      }
      showAccountSwitcher();
    };
  });
  
  const addNewBtn = document.getElementById("acct-add-new");
  if (addNewBtn) {
    addNewBtn.onclick = () => {
      closeModal();
      showCliLogin(async (tokenData) => {
        toast("授权完成，正在添加新账号...");
        const label = ""; // Let backend fetch default name/email as label
        const r3 = await fetch("/api/accounts/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, tokenData }) });
        const d3 = await r3.json();
        if (d3.error) {
          toast("添加失败: " + d3.error);
        } else {
          toast("已添加: " + (d3.account.label || d3.account.email));
          await refreshSystemStatus();
          await refreshModels();
          renderLoginArea();
          renderConvList();
        }
        showAccountSwitcher();
      });
    };
  }

  const addBtn = document.getElementById("acct-add");
  if (addBtn) {
    addBtn.onclick = async () => {
      const label = document.getElementById("acct-label").value.trim();
      const r3 = await fetch("/api/accounts/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) });
      const d3 = await r3.json();
      if (d3.error) { 
        toast(d3.error + " (如失效请在终端 agy login 重新登录)"); 
        return; 
      }
      toast("已添加: " + (d3.account.label || d3.account.email));
      showAccountSwitcher();
    };
  }
}
