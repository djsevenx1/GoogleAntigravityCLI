import fsp from 'node:fs/promises';
/**
 * A transcript entry's heap cost is roughly the file it was parsed from, so
 * the budget is expressed in file bytes. The newest entry is always retained
 * even when it alone exceeds the budget — evicting it would just re-parse the
 * same file on the next request.
 */
const MAX_CACHED_TRANSCRIPT_FILE_BYTES = 256 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 8;
export function createSessionHistoryCache(maxTotalFileBytes = MAX_CACHED_TRANSCRIPT_FILE_BYTES, maxEntries = MAX_CACHE_ENTRIES) {
    const entries = new Map();
    const pendingLoads = new Map();
    function evictOverBudget() {
        let totalBytes = 0;
        for (const entry of entries.values()) {
            totalBytes += entry.size;
        }
        for (const key of entries.keys()) {
            if (entries.size <= 1 || (totalBytes <= maxTotalFileBytes && entries.size <= maxEntries)) {
                break;
            }
            totalBytes -= entries.get(key).size;
            entries.delete(key);
        }
    }
    return {
        /**
         * Returns the session's full transcript through the cache, or null when
         * the session is not cacheable (no transcript path, or the file cannot be
         * stat'ed) — the caller then falls back to a plain provider read.
         */
        async getFullHistory({ sessionId, transcriptPath, loadFull }) {
            if (!transcriptPath) {
                return null;
            }
            let stat;
            try {
                stat = await fsp.stat(transcriptPath);
            }
            catch {
                entries.delete(sessionId);
                return null;
            }
            if (!stat.isFile()) {
                entries.delete(sessionId);
                return null;
            }
            const cached = entries.get(sessionId);
            if (cached
                && cached.transcriptPath === transcriptPath
                && cached.mtimeMs === stat.mtimeMs
                && cached.size === stat.size) {
                // Re-insert to mark as most recently used.
                entries.delete(sessionId);
                entries.set(sessionId, cached);
                return cached.full;
            }
            // Concurrent requests for the same session share one parse. The file may
            // gain rows while the load runs; the pre-load stat is what the entry is
            // keyed by, so the next request would see a changed stat and re-read.
            const pending = pendingLoads.get(sessionId);
            if (pending) {
                return pending;
            }
            const load = loadFull().then((full) => {
                entries.delete(sessionId);
                entries.set(sessionId, {
                    transcriptPath,
                    mtimeMs: stat.mtimeMs,
                    size: stat.size,
                    full,
                });
                evictOverBudget();
                return full;
            });
            pendingLoads.set(sessionId, load);
            try {
                return await load;
            }
            finally {
                pendingLoads.delete(sessionId);
            }
        },
    };
}
export const sessionHistoryCache = createSessionHistoryCache();
//# sourceMappingURL=session-history-cache.service.js.map