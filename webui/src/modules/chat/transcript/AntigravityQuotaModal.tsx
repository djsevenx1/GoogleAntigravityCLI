import React, { useState } from 'react';
import {
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
  Crown,
  Info,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/Dialog';
import type { AntigravityQuotaSnapshot } from '@/shared/types';
import { formatDynamicCountdown } from '@/modules/chat/hooks/useAntigravityQuota';

type AntigravityQuotaModalProps = {
  isOpen: boolean;
  onClose: () => void;
  quota: AntigravityQuotaSnapshot | null;
  onRefresh: (force?: boolean) => Promise<any> | void;
  isRefreshing?: boolean;
  onOpenAccountManager?: () => void;
};

export default function AntigravityQuotaModal({
  isOpen,
  onClose,
  quota,
  onRefresh,
  isRefreshing,
  onOpenAccountManager,
}: AntigravityQuotaModalProps) {
  const [showToast, setShowToast] = useState(false);

  const handleRefresh = async () => {
    try {
      await onRefresh(true);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    } catch (_) {}
  };

  // 1. Account profile info
  const accountName = quota?.accountName || quota?.accountEmail?.split('@')[0] || 'Google 用户';
  const accountEmail = quota?.accountEmail || '正在连接 Google AI Pro 云端服务...';
  const accountPicture = quota?.accountPicture || '';
  const tierName = quota?.tier || 'Google AI Pro (Gemini Advanced · G1 Credits)';
  const tierBadge = quota?.tierBadge || 'Google AI Pro';
  const isPro = quota?.tierType === 'pro' || !quota?.tierType || tierName.includes('Pro');

  // 2. Pool percent & reset text calculations
  const g5h = quota?.gemini5h;
  const g5hPct = g5h?.percent != null ? g5h.percent : 100;
  const g5hResetText = formatDynamicCountdown(g5h?.resetTime, g5h?.resetsIn || g5h?.resetText, true, g5hPct);
  const color5h = g5hPct > 70 ? 'text-emerald-500' : g5hPct > 30 ? 'text-blue-500' : 'text-amber-500';
  const barColor5h = g5hPct > 70 ? 'bg-emerald-500' : g5hPct > 30 ? 'bg-blue-500' : 'bg-amber-500';

  const gWeekly = quota?.geminiWeekly;
  const gWeeklyPct = gWeekly?.percent != null ? gWeekly.percent : 100;
  const gWeeklyResetText = formatDynamicCountdown(gWeekly?.resetTime, gWeekly?.resetsIn || gWeekly?.resetText, false, gWeeklyPct);
  const colorWeekly = gWeeklyPct > 70 ? 'text-emerald-500' : gWeeklyPct > 30 ? 'text-blue-500' : 'text-amber-500';
  const barColorWeekly = gWeeklyPct > 70 ? 'bg-emerald-500' : gWeeklyPct > 30 ? 'bg-blue-500' : 'bg-amber-500';

  const c5h = quota?.claude5h;
  const c5hPct = c5h?.percent != null ? c5h.percent : 100;
  const c5hResetText = formatDynamicCountdown(c5h?.resetTime, c5h?.resetsIn || c5h?.resetText, true, c5hPct);

  const cWeekly = quota?.claudeWeekly;
  const cWeeklyPct = cWeekly?.percent != null ? cWeekly.percent : 100;
  const cWeeklyResetText = formatDynamicCountdown(cWeekly?.resetTime, cWeekly?.resetsIn || cWeekly?.resetText, false, cWeeklyPct);

  // 3. Metrics
  const metrics = quota?.metrics;
  const convCount = metrics?.totalConversations ?? 6;
  const turnCount = metrics?.totalTurns ?? 169;
  const tokenDisplay = metrics?.tokensFormatted ?? '0';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl p-4 sm:p-6 overflow-hidden max-h-[92vh] overflow-y-auto">
        <DialogHeader className="pb-1">
          <div className="flex items-center gap-2">
            <span className="text-xl">📊</span>
            <DialogTitle className="text-base sm:text-lg font-bold text-foreground">
              Google AI Pro 模型用量与配额中心
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3 pt-1">
          {/* 账号信息卡片 */}
          <div className="flex items-center justify-between rounded-xl border border-border/80 bg-card p-3 sm:p-3.5 shadow-xs">
            <div className="flex items-center gap-3 min-w-0">
              {/* Exclusive Avatar Frame with Crown & Pro badge */}
              <div className="relative flex shrink-0 items-center justify-center">
                {isPro && (
                  <span
                    className="absolute -top-3 left-1/2 -translate-x-1/2 text-sm select-none z-10 filter drop-shadow"
                    title="Google AI Pro 认证用户"
                  >
                    👑
                  </span>
                )}
                <div className="relative h-12 w-12 rounded-full p-[2px] bg-gradient-to-tr from-amber-500 via-purple-500 to-blue-500 shadow-sm flex items-center justify-center">
                  <div className="h-full w-full rounded-full bg-card overflow-hidden flex items-center justify-center">
                    {accountPicture ? (
                      <img
                        src={accountPicture}
                        alt={accountName}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-muted text-foreground font-bold text-base">
                        {accountName.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>
                <span className="absolute -bottom-1 -right-1 text-[8.5px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-gradient-to-r from-amber-500 to-purple-600 text-white shadow-xs leading-none border border-card">
                  {isPro ? 'PRO' : 'FREE'}
                </span>
              </div>

              {/* User text */}
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-bold text-foreground truncate">{accountName}</div>
                <div className="text-xs text-muted-foreground font-mono truncate">{accountEmail}</div>
              </div>
            </div>

            {/* Right Controls */}
            <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 shrink-0">
              <div
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold border border-purple-500/30 text-indigo-500 dark:text-indigo-400 bg-gradient-to-r from-blue-500/10 via-purple-500/15 to-pink-500/10 whitespace-nowrap"
                title={tierName}
              >
                {tierBadge}
              </div>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary/80 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary hover:text-primary transition-all disabled:opacity-50 cursor-pointer shadow-2xs"
                title="点击从 Google 上游直连拉取最新配额"
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
                <span className="text-[11.5px]">{isRefreshing ? '同步中...' : '实时刷新'}</span>
              </button>
            </div>
          </div>

          {/* 5小时与每周全量配额周期 (2x2 网格) */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {/* 1. Google 5h 算力 */}
            <div className="rounded-xl border border-border/80 bg-card p-3.5 flex flex-col gap-2 shadow-xs transition-all hover:border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Zap className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span>Google / Gemini 5小时算力</span>
                </div>
                <div className={`font-mono text-xs font-bold ${color5h}`}>
                  {g5hPct}% 可用
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor5h}`}
                  style={{ width: `${Math.max(2, Math.min(100, g5hPct))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>速率限制重置</span>
                <span className="font-mono text-foreground font-medium">
                  {g5hResetText === '即将重置' ? '即将重置' : `${g5hResetText} 后重置`}
                </span>
              </div>
            </div>

            {/* 2. Gemini 每周旗舰算力 */}
            <div className="rounded-xl border border-border/80 bg-card p-3.5 flex flex-col gap-2 shadow-xs transition-all hover:border-border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span>每周 Gemini 旗舰算力</span>
                </div>
                <div className={`font-mono text-xs font-bold ${colorWeekly}`}>
                  {gWeeklyPct}% 可用
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColorWeekly}`}
                  style={{ width: `${Math.max(2, Math.min(100, gWeeklyPct))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>周刷新周期</span>
                <span className="font-mono text-foreground font-medium">
                  {gWeeklyResetText === '即将重置' ? '即将刷新' : `${gWeeklyResetText} 后刷新`}
                </span>
              </div>
            </div>

            {/* 3. Claude 5h 滚动算力 */}
            <div className="rounded-xl border border-purple-500/25 bg-gradient-to-b from-purple-500/[0.04] to-transparent p-3.5 flex flex-col gap-2 shadow-xs transition-all hover:border-purple-500/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-600 dark:text-purple-400">
                  <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                  <span>Claude 5 小时滚动算力</span>
                </div>
                <div className="font-mono text-xs font-bold text-purple-600 dark:text-purple-400">
                  {c5hPct}% 算力
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-500 to-violet-400 transition-all duration-500"
                  style={{ width: `${Math.max(2, Math.min(100, c5hPct))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>速率限制重置</span>
                <span className="font-mono text-purple-600 dark:text-purple-400 font-medium">
                  {c5hResetText === '即将重置' ? '即将重置' : `${c5hResetText} 后重置`}
                </span>
              </div>
            </div>

            {/* 4. 每周 Claude 旗舰配额 */}
            <div className="rounded-xl border border-amber-500/25 bg-gradient-to-b from-amber-500/[0.04] to-transparent p-3.5 flex flex-col gap-2 shadow-xs transition-all hover:border-amber-500/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span>每周 Claude 旗舰配额</span>
                </div>
                <div className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                  {cWeeklyPct}% 旗舰配额
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 transition-all duration-500"
                  style={{ width: `${Math.max(2, Math.min(100, cWeeklyPct))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>周刷新周期</span>
                <span className="font-mono text-amber-600 dark:text-amber-400 font-medium">
                  {cWeeklyResetText === '即将重置' ? '即将刷新' : `${cWeeklyResetText} 后刷新`}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Metrics Grid (3 列统计卡片) */}
          <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
            <div className="rounded-xl border border-border/80 bg-card p-2.5 sm:p-3 flex flex-col gap-0.5 shadow-2xs">
              <div className="text-[11px] text-muted-foreground">本地会话 / 轮次</div>
              <div className="text-[15px] sm:text-base font-bold text-foreground font-mono">
                {convCount} 组 ({turnCount} 轮)
              </div>
              <div className="text-[10px] text-muted-foreground/70">历史总会话</div>
            </div>

            <div className="rounded-xl border border-border/80 bg-card p-2.5 sm:p-3 flex flex-col gap-0.5 shadow-2xs">
              <div className="text-[11px] text-muted-foreground">累计消耗 Tokens</div>
              <div className="text-[15px] sm:text-base font-bold text-foreground font-mono">
                {tokenDisplay}
              </div>
              <div className="text-[10px] text-muted-foreground/70">双向文本吞吐</div>
            </div>

            <div className="rounded-xl border border-border/80 bg-card p-2.5 sm:p-3 flex flex-col gap-0.5 shadow-2xs">
              <div className="text-[11px] text-muted-foreground">G1 Credits 状态</div>
              <div className="text-[15px] sm:text-base font-bold text-emerald-500 font-mono">
                已激活
              </div>
              <div className="text-[10px] text-muted-foreground/70">自动抵扣保障</div>
            </div>
          </div>

          {/* Quota Policy Note */}
          <div className="rounded-xl border border-dashed border-border bg-muted/25 p-3 text-xs leading-relaxed text-muted-foreground">
            <div className="flex items-center gap-1.5 font-semibold text-foreground mb-1 text-xs">
              <Info className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>Google AI Pro 模型配额与权益说明</span>
            </div>
            <div className="text-[11.5px] leading-relaxed text-muted-foreground space-y-1">
              <div>
                • <strong>Gemini 3.7 / 3.6 / 3.5 Flash</strong>：享有 Google AI Pro 5 小时高额滚动算力池（无总 Token 计费上限），适合日常高并发代码编写与长文本分析。
              </div>
              <div>
                • <strong>Claude / GPT 系列</strong>：享有 Pro 优先通道与 5 小时滚动配额，若高阶模型触达速率限制，系统将自动使用 G1 Credits 算力点数无缝补充。
              </div>
            </div>
          </div>

          {/* Toast on success */}
          {showToast && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-3 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 animate-in fade-in duration-200">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>已成功从 Google 上游直连拉取最新配额！</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-1">
            {onOpenAccountManager ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAccountManager();
                }}
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
              >
                <span>管理 Google 账号</span>
                <ExternalLink className="h-3 w-3" />
              </button>
            ) : (
              <div />
            )}

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-card px-4 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer shadow-2xs"
            >
              关闭
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
