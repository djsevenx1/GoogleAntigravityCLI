import { useCallback, useEffect, useState } from 'react';
import { api, readApiJson } from '@/shared/api';
import type { AntigravityQuotaSnapshot } from '@/shared/types';

let cachedQuotaSnapshot: AntigravityQuotaSnapshot | null = null;
let lastFetchTime = 0;
const listeners = new Set<(quota: AntigravityQuotaSnapshot | null) => void>();

function unwrapQuotaSnapshot(raw: any): AntigravityQuotaSnapshot | null {
  if (!raw) return null;
  if (typeof raw === 'object' && 'data' in raw && raw.data) {
    return raw.data as AntigravityQuotaSnapshot;
  }
  return raw as AntigravityQuotaSnapshot;
}

const perAccountSnapshots = new Map<string, AntigravityQuotaSnapshot>();

function notifyListeners(quota: any) {
  const unwrapped = unwrapQuotaSnapshot(quota);
  if (unwrapped) {
    cachedQuotaSnapshot = unwrapped;
    if (unwrapped.accountEmail) {
      perAccountSnapshots.set(unwrapped.accountEmail.toLowerCase(), unwrapped);
    }
  }
  listeners.forEach((listener) => listener(unwrapped));
}

export function formatDynamicCountdown(
  isoString?: string | null,
  fallbackText?: string,
  is5h: boolean = false,
  percent?: number
): string {
  const now = new Date();
  const fiveHourMs = 5 * 3600 * 1000;
  const currentBlockMs = now.getTime() % fiveHourMs;
  const fiveHourRemainingMs = fiveHourMs - currentBlockMs;
  const fiveHourH = Math.floor(fiveHourRemainingMs / (3600 * 1000));
  const fiveHourM = Math.floor((fiveHourRemainingMs % (3600 * 1000)) / (60 * 1000));
  const default5hText = `${fiveHourH}小时 ${fiveHourM}分钟`;

  const utcDay = now.getUTCDay();
  const utcHours = now.getUTCHours();
  const daysUntilWeekly = utcDay === 0 ? 0 : (7 - utcDay);
  const defaultWeeklyText = `${daysUntilWeekly}天 ${23 - utcHours}小时`;

  const isFiveHourBucket = is5h || (fallbackText ? /5h|5小时|five\s*hour/i.test(fallbackText) : false);

  // 1. Google 官方 description 正则提取（最高优先级：这是 Google 原生返回的具体刷新时间文本）
  if (fallbackText) {
    const desc = String(fallbackText).trim();
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

  // 2. 5小时滚动算力桶（5h）专用计算：
  // 核心机制：当额度为 100%（或未触发限流）时，Google 上游每次返回的 resetTime 都是 request_time + 5h。
  // 若直接 diff 计算，会永远得出 4小时59分不动。此时按 Google 集群 5 小时 epoch 块（now % 5h）精确计算距离下个周期重置的倒计时！
  // 当额度被真实消耗（percent < 99.9）且 Google 返回真实提前恢复时间时，精确计算真实差值。
  if (isFiveHourBucket) {
    const isFull = percent != null ? percent >= 99.9 : true;
    if (isoString) {
      const target = new Date(isoString).getTime();
      if (!isNaN(target)) {
        const diff = target - Date.now();
        if (!isFull && diff > 60 * 1000 && diff < 4.75 * 3600 * 1000) {
          const h = Math.floor(diff / (3600 * 1000));
          const m = Math.floor((diff % (3600 * 1000)) / (60 * 1000));
          if (h > 0) return `${h}小时 ${m}分钟`;
          return `${m}分钟`;
        }
      }
    }
    return default5hText;
  }

  // 3. 周度旗舰配额（Weekly）计算：
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

  if (fallbackText && !fallbackText.includes('查询中') && !fallbackText.includes('计算中') && !fallbackText.includes('即将')) {
    return fallbackText;
  }

  return defaultWeeklyText;
}

export function formatPreciseTimeTag(str?: string | null): string {
  if (!str) return '即将重置';
  const s = String(str).trim();
  if (s === '即将重置' || s.includes('即将') || s.includes('计算中') || s.includes('查询中')) return '即将重置';
  
  // 1. Chinese day + hour: "6天 23小时" / "6天"
  const mDayHour = s.match(/(\d+)\s*天\s*(?:(\d+)\s*小时)?/);
  if (mDayHour) {
    const d = mDayHour[1];
    const h = mDayHour[2];
    return h && h !== '0' ? `${d}天${h}h` : `${d}天`;
  }
  
  // 2. Chinese hour + min: "4小时 59分钟" / "4小时" / "59分钟"
  const mHourMin = s.match(/(?:(\d+)\s*小时)?\s*(?:(\d+)\s*分钟)?/);
  if (mHourMin && (mHourMin[1] || mHourMin[2])) {
    const h = mHourMin[1];
    const m = mHourMin[2];
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    if (m) return `${m}m`;
  }

  // 3. English day + hour: "6 days, 23 hours"
  const mEngDayHour = s.match(/(\d+)\s*days?(?:\s*,?\s*(\d+)\s*hours?)?/i);
  if (mEngDayHour) {
    const d = mEngDayHour[1];
    const h = mEngDayHour[2];
    return h && h !== '0' ? `${d}天${h}h` : `${d}天`;
  }

  // 4. English hour + min: "4 hours, 35 minutes" / "4h 35m"
  const mEngHourMin = s.match(/(?:(\d+)\s*(?:hours?|h))?\s*,?\s*(?:(\d+)\s*(?:min(?:ute)?s?|m))?/i);
  if (mEngHourMin && (mEngHourMin[1] || mEngHourMin[2])) {
    const h = mEngHourMin[1];
    const m = mEngHourMin[2];
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    if (m) return `${m}m`;
  }

  return s;
}

export function getCachedAccountQuota(email?: string | null): AntigravityQuotaSnapshot | null {
  if (email) {
    const found = perAccountSnapshots.get(email.toLowerCase());
    if (found) return found;
  }
  return cachedQuotaSnapshot;
}

export async function fetchAntigravityQuota(force = false, email?: string): Promise<AntigravityQuotaSnapshot | null> {
  const now = Date.now();
  const cached = email ? perAccountSnapshots.get(email.toLowerCase()) : cachedQuotaSnapshot;
  if (!force && cached && now - lastFetchTime < 30000) {
    return cached;
  }

  try {
    const res = await api.providers.antigravityQuota(force, email);
    if (res.ok) {
      const raw = await readApiJson<any>(res);
      const payload = unwrapQuotaSnapshot(raw);
      if (payload) {
        lastFetchTime = Date.now();
        notifyListeners(payload);
        return payload;
      }
    }
  } catch (_) {
    // ignore
  }
  return cached || cachedQuotaSnapshot;
}

export function updateCachedAntigravityQuota(snapshot: any) {
  if (snapshot) {
    const payload = unwrapQuotaSnapshot(snapshot);
    lastFetchTime = Date.now();
    notifyListeners(payload);
  }
}

export function useAntigravityQuota(targetEmail?: string) {
  const [quota, setQuota] = useState<AntigravityQuotaSnapshot | null>(() => {
    if (targetEmail) {
      const perAcc = perAccountSnapshots.get(targetEmail.toLowerCase());
      if (perAcc) return perAcc;
    }
    return unwrapQuotaSnapshot(cachedQuotaSnapshot);
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleUpdate = (nextQuota: any) => {
      const unwrapped = unwrapQuotaSnapshot(nextQuota);
      if (targetEmail && unwrapped?.accountEmail) {
        if (unwrapped.accountEmail.toLowerCase() === targetEmail.toLowerCase()) {
          setQuota(unwrapped);
        }
      } else {
        setQuota(unwrapped);
      }
    };
    listeners.add(handleUpdate);
    return () => {
      listeners.delete(handleUpdate);
    };
  }, [targetEmail]);

  const refreshQuota = useCallback(async (force = true, email?: string): Promise<AntigravityQuotaSnapshot | null> => {
    setLoading(true);
    try {
      return await fetchAntigravityQuota(force, email || targetEmail);
    } finally {
      setLoading(false);
    }
  }, [targetEmail]);

  useEffect(() => {
    const cached = targetEmail ? perAccountSnapshots.get(targetEmail.toLowerCase()) : cachedQuotaSnapshot;
    if (!cached || Date.now() - lastFetchTime > 60000) {
      void refreshQuota(false, targetEmail);
    }

    // Refresh every 60s
    const interval = setInterval(() => {
      void refreshQuota(false, targetEmail);
    }, 60000);

    return () => clearInterval(interval);
  }, [refreshQuota, targetEmail]);

  return {
    quota,
    loading,
    isLoading: loading,
    isRefreshing: loading,
    refreshQuota,
  };
}
