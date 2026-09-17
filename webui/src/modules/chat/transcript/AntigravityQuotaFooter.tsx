import React, { memo, useState, useEffect, useMemo } from 'react';
import { ZapIcon, SparklesIcon, BotIcon, UserIcon } from 'lucide-react';
import type { ChatMessage, AntigravityQuotaSnapshot } from '@/shared/types';
import {
  useAntigravityQuota,
  formatDynamicCountdown,
  formatPreciseTimeTag,
} from '@/modules/chat/hooks/useAntigravityQuota';
import AntigravityQuotaModal from '@/modules/chat/transcript/AntigravityQuotaModal';

type AntigravityQuotaFooterProps = {
  message: ChatMessage;
  provider?: string;
  onOpenAccountManager?: () => void;
};

function formatModelShortName(rawName?: string): string {
  if (!rawName || typeof rawName !== 'string') return 'Gemini 3.8 Flash';
  const s = rawName.toLowerCase();
  if (s.includes('3.8') && s.includes('flash')) return 'Gemini 3.8 Flash';
  if (s.includes('3.7') && s.includes('flash')) return 'Gemini 3.7 Flash';
  if (s.includes('3.6') && s.includes('flash')) return 'Gemini 3.6 Flash';
  if (s.includes('3.1') && s.includes('pro')) return 'Gemini 3.1 Pro';
  if (s.includes('2.5') && s.includes('flash')) return 'Gemini 2.5 Flash';
  if (s.includes('2.5') && s.includes('pro')) return 'Gemini 2.5 Pro';
  if (s.includes('3-7-sonnet') || s.includes('3.7-sonnet') || s.includes('3.7 sonnet')) return 'Claude 3.7 Sonnet';
  if (s.includes('4-6-sonnet') || s.includes('4.6-sonnet') || s.includes('4.6 sonnet')) return 'Claude 4.6 Sonnet';
  if (s.includes('opus')) return 'Claude 3.5 Opus';
  if (s.includes('gpt-4o') || s.includes('gpt4o')) return 'GPT-4o';
  if (s.includes('gpt-oss') || s.includes('gpt_oss')) return 'GPT-OSS';

  // Capitalize hyphenated names
  return rawName
    .replace(/^antigravity[:/]/i, '')
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function AntigravityQuotaFooter({
  message,
  onOpenAccountManager,
}: AntigravityQuotaFooterProps) {
  const meta = (message.meta || {}) as Record<string, any>;
  const targetEmail = (message.quotaSnapshot as any)?.accountEmail || meta.quotaSnapshot?.accountEmail;
  const { quota: liveQuota, refreshQuota, loading: isRefreshing } = useAntigravityQuota(targetEmail);
  const displayEmail = targetEmail || liveQuota?.accountEmail;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [, setTick] = useState(0);

  // Update dynamic countdown tags every 15 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => (t + 1) % 10000);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const contentStr = String(message.content || '');
  const cleanLen = contentStr.replace(/[\u200b\s]/g, '').length;

  const rawModel = String(
    message.model || meta.model || (message.quotaSnapshot as any)?.model || 'gemini-2.5-flash'
  ).toLowerCase();

  const isClaude = rawModel.includes('claude');
  const isGpt = rawModel.includes('gpt') || rawModel.includes('oss');
  const isGemini = !isClaude && !isGpt;

  const modelDisplayName = formatModelShortName(rawModel);
  const tokens =
    message.tokens ||
    meta.tokens ||
    Math.max(1, Math.round(cleanLen / 3.2));
  const durationText = message.duration
    ? `${message.duration}s`
    : meta.duration
    ? `${meta.duration}s`
    : '';

  // Quota Data Resolution:
  // 1. Prioritize frozen snapshot on the message
  // 2. Fall back to live quota data
  const snap = (message.quotaSnapshot || meta.quotaSnapshot || liveQuota) as AntigravityQuotaSnapshot | null;

  const resolved = useMemo(() => {
    const pool5h = isGemini ? (snap?.gemini5h || liveQuota?.gemini5h) : (snap?.claude5h || liveQuota?.claude5h);
    const poolWeekly = isGemini ? (snap?.geminiWeekly || liveQuota?.geminiWeekly) : (snap?.claudeWeekly || liveQuota?.claudeWeekly);

    let h5Pct = pool5h?.percent ?? snap?.percent ?? 100;
    let h5ResetTime = pool5h?.resetTime ?? snap?.resetTime ?? null;
    let h5ResetFallback = pool5h?.resetsIn ?? pool5h?.resetText ?? snap?.resetsIn ?? '即将重置';
    let h5Reset = formatDynamicCountdown(h5ResetTime, h5ResetFallback, true, h5Pct);
    const h5ResetPrecise = formatPreciseTimeTag(h5Reset);
    const h5DisplayTag = h5ResetPrecise;

    let weeklyPct = poolWeekly?.percent ?? 100;
    let weeklyReset = formatDynamicCountdown(poolWeekly?.resetTime, poolWeekly?.resetsIn || '即将刷新', false, weeklyPct);
    const weeklyResetPrecise = formatPreciseTimeTag(weeklyReset);
    const weeklyDisplayTag = weeklyResetPrecise;

    return {
      h5Pct: Math.round((h5Pct ?? 100) * 10) / 10,
      h5Reset: h5Reset || '即将重置',
      h5ResetPrecise,
      h5DisplayTag,
      weeklyPct: Math.round(weeklyPct * 10) / 10,
      weeklyReset: weeklyReset || '即将刷新',
      weeklyResetPrecise,
      weeklyDisplayTag,
    };
  }, [snap, isGemini, liveQuota]);

  const poolLabel = isClaude ? 'Claude 5h' : isGpt ? 'GPT 5h' : 'Gemini 5h';

  const h5FillStyle = isClaude
    ? 'linear-gradient(90deg, #a855f7, #c084fc)'
    : isGpt
    ? 'linear-gradient(90deg, #3b82f6, #60a5fa)'
    : 'linear-gradient(90deg, #10b981, #34d399)';

  return (
    <>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-border/70 bg-secondary/40 px-3 py-1.5 text-xs text-muted-foreground shadow-2xs transition-colors hover:bg-secondary/60 dark:bg-muted/20 dark:hover:bg-muted/40">
        {/* Left: Model Badge & Usage Info */}
        <div className="flex items-center gap-1.5 flex-wrap font-medium">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold border ${
              isClaude
                ? 'bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400'
                : isGpt
                ? 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400'
                : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400'
            }`}
          >
            {isClaude ? (
              <SparklesIcon className="h-3 w-3 shrink-0" />
            ) : isGpt ? (
              <BotIcon className="h-3 w-3 shrink-0" />
            ) : (
              <ZapIcon className="h-3 w-3 shrink-0" />
            )}
            <span>{modelDisplayName}</span>
          </span>

          <span className="text-muted-foreground/40">·</span>
          <span className="text-[11px] text-muted-foreground font-mono">
            {tokens.toLocaleString()} tokens
          </span>

          {durationText && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-[11px] text-muted-foreground font-mono">
                {durationText}
              </span>
            </>
          )}

          {displayEmail && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span
                className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/85 border border-border/40 max-w-[130px] sm:max-w-[180px]"
                title={`对应 Google 账号: ${displayEmail}`}
              >
                <UserIcon className="h-2.5 w-2.5 shrink-0 opacity-70" />
                <span className="truncate">{displayEmail}</span>
              </span>
            </>
          )}
        </div>

        {/* Right: Model-Specific Quota Progress Bars */}
        <div
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-1.5 flex-wrap cursor-pointer group"
          title="点击查看 Google Antigravity 4 大算力池配额中心"
        >
          {isGemini ? (
            <>
              {/* Gemini 5-Hour Limit Bar */}
              <div
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2 py-0.5 text-[11px] transition-all hover:border-emerald-500/50"
                title={`Gemini 5h 滚动算力: 剩余 ${resolved.h5Pct}% (${resolved.h5Pct >= 100 ? '额度充足满额可用' : `${resolved.h5Reset} 后重置`})`}
              >
                <span className="text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">Gemini 5h</span>
                <div className="h-1.5 w-8 shrink-0 overflow-hidden rounded-full bg-emerald-500/20">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      resolved.h5Pct <= 10 ? '!bg-red-500' : ''
                    }`}
                    style={{
                      width: `${Math.max(4, Math.min(100, resolved.h5Pct))}%`,
                      background: 'linear-gradient(90deg, #10b981, #34d399)',
                    }}
                  />
                </div>
                <span
                  className={`font-semibold font-mono text-[11px] ${
                    resolved.h5Pct <= 10
                      ? 'text-red-500'
                      : resolved.h5Pct <= 30
                      ? 'text-amber-500'
                      : 'text-foreground'
                  }`}
                >
                  {resolved.h5Pct}%
                </span>
                <span className="text-[9.5px] font-mono text-muted-foreground/75">
                  ({resolved.h5DisplayTag})
                </span>
              </div>

              {/* Gemini Weekly Limit Bar */}
              <div
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-0.5 text-[11px] transition-all hover:border-amber-500/50"
                title={`Gemini 每周累计旗舰配额: 剩余 ${resolved.weeklyPct}% (${resolved.weeklyReset} 后刷新)`}
              >
                <span className="text-[10.5px] font-medium text-amber-600 dark:text-amber-400">Gemini周</span>
                <div className="h-1.5 w-8 shrink-0 overflow-hidden rounded-full bg-amber-500/20">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      resolved.weeklyPct <= 10 ? '!bg-red-500' : ''
                    }`}
                    style={{
                      width: `${Math.max(4, Math.min(100, resolved.weeklyPct))}%`,
                      background: 'linear-gradient(90deg, #eab308, #fde047)',
                    }}
                  />
                </div>
                <span
                  className={`font-semibold font-mono text-[11px] ${
                    resolved.weeklyPct < 100 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
                  }`}
                >
                  {resolved.weeklyPct}%
                </span>
                <span className="text-[9.5px] font-mono text-muted-foreground/75">
                  ({resolved.weeklyDisplayTag})
                </span>
              </div>
            </>
          ) : (
            <>
              {/* Claude / GPT 5-Hour Limit Bar */}
              <div
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] transition-all border ${
                  isGpt
                    ? 'border-blue-500/25 bg-blue-500/5 hover:border-blue-500/50'
                    : 'border-purple-500/25 bg-purple-500/5 hover:border-purple-500/50'
                }`}
                title={`${poolLabel} 滚动算力: 剩余 ${resolved.h5Pct}% (${resolved.h5Pct >= 100 ? '额度充足满额可用' : `${resolved.h5Reset} 后重置`})`}
              >
                <span className={`text-[10.5px] font-medium ${isGpt ? 'text-blue-600 dark:text-blue-400' : 'text-purple-600 dark:text-purple-400'}`}>
                  {poolLabel}
                </span>
                <div className={`h-1.5 w-8 shrink-0 overflow-hidden rounded-full ${isGpt ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      resolved.h5Pct <= 10 ? '!bg-red-500' : ''
                    }`}
                    style={{
                      width: `${Math.max(4, Math.min(100, resolved.h5Pct))}%`,
                      background: h5FillStyle,
                    }}
                  />
                </div>
                <span
                  className={`font-semibold font-mono text-[11px] ${
                    resolved.h5Pct <= 10
                      ? 'text-red-500'
                      : resolved.h5Pct <= 30
                      ? 'text-amber-500'
                      : 'text-foreground'
                  }`}
                >
                  {resolved.h5Pct}%
                </span>
                <span className="text-[9.5px] font-mono text-muted-foreground/75">
                  ({resolved.h5DisplayTag})
                </span>
              </div>

              {/* Claude / GPT Weekly Limit Bar */}
              <div
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] transition-all border ${
                  isGpt
                    ? 'border-indigo-500/25 bg-indigo-500/5 hover:border-indigo-500/50'
                    : 'border-purple-500/25 bg-purple-500/5 hover:border-purple-500/50'
                }`}
                title={`${isGpt ? 'GPT' : 'Claude'} 每周累计配额: 剩余 ${resolved.weeklyPct}% (${resolved.weeklyReset} 后刷新)`}
              >
                <span className={`text-[10.5px] font-medium ${isGpt ? 'text-indigo-600 dark:text-indigo-400' : 'text-purple-600 dark:text-purple-400'}`}>
                  {isGpt ? 'GPT周' : 'Claude周'}
                </span>
                <div className={`h-1.5 w-8 shrink-0 overflow-hidden rounded-full ${isGpt ? 'bg-indigo-500/20' : 'bg-purple-500/20'}`}>
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      resolved.weeklyPct <= 10 ? '!bg-red-500' : ''
                    }`}
                    style={{
                      width: `${Math.max(4, Math.min(100, resolved.weeklyPct))}%`,
                      background: isGpt ? 'linear-gradient(90deg, #6366f1, #38bdf8)' : 'linear-gradient(90deg, #a855f7, #c084fc)',
                    }}
                  />
                </div>
                <span
                  className={`font-semibold font-mono text-[11px] ${
                    resolved.weeklyPct < 100
                      ? isGpt ? 'text-indigo-600 dark:text-indigo-400' : 'text-purple-600 dark:text-purple-400'
                      : 'text-foreground'
                  }`}
                >
                  {resolved.weeklyPct}%
                </span>
                <span className="text-[9.5px] font-mono text-muted-foreground/75">
                  ({resolved.weeklyDisplayTag})
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Quota Details Modal on Click */}
      {isModalOpen && (
        <AntigravityQuotaModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          quota={snap || liveQuota}
          onRefresh={async () => {
            await refreshQuota(true);
          }}
          isRefreshing={isRefreshing}
          onOpenAccountManager={onOpenAccountManager}
        />
      )}
    </>
  );
}

export default memo(AntigravityQuotaFooter);
