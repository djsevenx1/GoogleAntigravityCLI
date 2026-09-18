import fs from 'node:fs';
import path from 'node:path';
import { sessionsDb } from '../../../../modules/database/index.js';
import { isGenericSessionName, normalizeSessionName } from '../../../../shared/utils.js';
import { resolveAntigravityStateDir } from './antigravity-auth.provider.js';
function tryExtractFromLog(file) {
    let fd = null;
    try {
        if (!fs.existsSync(file))
            return null;
        const stat = fs.statSync(file);
        if (stat.size === 0)
            return null;
        // 性能优化：首个用户输入必定在日志文件开头，仅读取前 64KB，避免把几十MB日志全量载入内存
        const bytesToRead = Math.min(stat.size, 65536);
        const buffer = Buffer.alloc(bytesToRead);
        fd = fs.openSync(file, 'r');
        fs.readSync(fd, buffer, 0, bytesToRead, 0);
        fs.closeSync(fd);
        fd = null;
        const content = buffer.toString('utf-8');
        const lines = content.split('\n');
        const completeLines = lines.length > 1 ? lines.slice(0, -1) : lines;
        for (const line of completeLines) {
            if (!line.trim())
                continue;
            try {
                const entry = JSON.parse(line);
                if (entry.source === 'USER_EXPLICIT' || entry.type === 'USER_INPUT') {
                    const text = entry.content || '';
                    const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
                    const userText = match ? match[1].trim() : text.replace(/<[A-Z_]+>[\s\S]*?<\/[A-Z_]+>/g, '').trim();
                    const firstLine = userText.split('\n')[0].trim();
                    if (firstLine) {
                        return normalizeSessionName(firstLine, '');
                    }
                }
            }
            catch (_) { }
        }
    }
    catch (_) {
    }
    finally {
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            }
            catch (_) { }
        }
    }
    return null;
}
function extractAntigravitySessionName(logFile, fallback) {
    const extracted = tryExtractFromLog(logFile);
    if (extracted)
        return extracted;
    // If logFile was an incremental chunk or didn't contain user input,
    // locate the session's logs directory and check primary log or chunk 0.
    try {
        const parts = path.normalize(logFile).split(path.sep);
        const brainIdx = parts.lastIndexOf('brain');
        if (brainIdx !== -1 && brainIdx + 1 < parts.length) {
            const convId = parts[brainIdx + 1];
            const stateDir = resolveAntigravityStateDir();
            const logsDir = path.join(stateDir, 'brain', convId, '.system_generated', 'logs');
            const primary = findPrimaryLogFile(logsDir);
            if (primary && primary !== logFile) {
                const primaryExtracted = tryExtractFromLog(primary);
                if (primaryExtracted)
                    return primaryExtracted;
            }
        }
    }
    catch (_) { }
    return fallback;
}
function findPrimaryLogFile(logsDir) {
    const directPath = path.join(logsDir, 'transcript.jsonl');
    if (fs.existsSync(directPath))
        return directPath;
    const fullPath = path.join(logsDir, 'transcript_full.jsonl');
    if (fs.existsSync(fullPath))
        return fullPath;
    const chunk0 = path.join(logsDir, 'chunks', 'transcript', '00000000.jsonl');
    if (fs.existsSync(chunk0))
        return chunk0;
    const chunkFull0 = path.join(logsDir, 'chunks', 'transcript_full', '00000000.jsonl');
    if (fs.existsSync(chunkFull0))
        return chunkFull0;
    return null;
}
export class AntigravitySessionSynchronizer {
    provider = 'antigravity';
    lastSyncTimes = new Map();
    async synchronize(_since) {
        const brainDir = path.join(resolveAntigravityStateDir(), 'brain');
        if (!fs.existsSync(brainDir))
            return 0;
        let processed = 0;
        try {
            const entries = fs.readdirSync(brainDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const convId = entry.name;
                const logsDir = path.join(brainDir, convId, '.system_generated', 'logs');
                const logFile = findPrimaryLogFile(logsDir);
                if (logFile) {
                    const stats = fs.statSync(logFile);
                    // 如果传入增量扫描游标，且文件修改时间早于游标，跳过处理
                    if (_since && stats.mtime < _since) {
                        continue;
                    }
                    const existing = sessionsDb.getSessionById(convId);
                    const existingName = existing?.custom_name;
                    const hasMeaningfulName = Boolean(existingName && !isGenericSessionName(existingName));
                    // 如果数据库中已有且未发生过修改，无需重复插入更新
                    if (existing && hasMeaningfulName && existing.updated_at === stats.mtime.toISOString()) {
                        continue;
                    }
                    const sessionName = hasMeaningfulName
                        ? existingName
                        : extractAntigravitySessionName(logFile, `Antigravity ${convId.slice(0, 8)}`);
                    sessionsDb.createSession(convId, this.provider, process.cwd(), sessionName, stats.birthtime.toISOString(), stats.mtime.toISOString(), logFile);
                    processed++;
                }
            }
        }
        catch (_) { }
        return processed;
    }
    async synchronizeFile(filePath) {
        // 严格过滤：忽略所有 chunks 分片与 full 镜像，仅处理主 transcript.jsonl
        if (!filePath.endsWith('transcript.jsonl') || filePath.includes('chunks') || filePath.includes('transcript_full')) {
            return null;
        }
        const parts = path.normalize(filePath).split(path.sep);
        const brainIdx = parts.lastIndexOf('brain');
        if (brainIdx === -1 || brainIdx + 1 >= parts.length)
            return null;
        const convId = parts[brainIdx + 1];
        const now = Date.now();
        const lastSync = this.lastSyncTimes.get(convId) || 0;
        // 3 秒内同一会话至多同步一次，杜绝密集高频写盘阻塞 Node.js 事件循环
        if (now - lastSync < 3000) {
            return convId;
        }
        this.lastSyncTimes.set(convId, now);
        const stateDir = resolveAntigravityStateDir();
        const logsDir = path.join(stateDir, 'brain', convId, '.system_generated', 'logs');
        const primaryLogFile = findPrimaryLogFile(logsDir);
        const bestLogFile = primaryLogFile || filePath;
        // Check existing session in DB to preserve any user-defined or already resolved title
        const existing = sessionsDb.getSessionById(convId);
        const existingCustomName = existing?.custom_name;
        const hasMeaningfulExistingName = Boolean(existingCustomName && !isGenericSessionName(existingCustomName));
        const sessionName = hasMeaningfulExistingName
            ? existingCustomName
            : extractAntigravitySessionName(bestLogFile, `Antigravity ${convId.slice(0, 8)}`);
        let updatedAt;
        try {
            if (fs.existsSync(filePath)) {
                updatedAt = fs.statSync(filePath).mtime.toISOString();
            }
            else if (primaryLogFile && fs.existsSync(primaryLogFile)) {
                updatedAt = fs.statSync(primaryLogFile).mtime.toISOString();
            }
        }
        catch (_) { }
        sessionsDb.createSession(convId, this.provider, process.cwd(), sessionName, undefined, updatedAt, bestLogFile);
        return convId;
    }
}
//# sourceMappingURL=antigravity-session-synchronizer.provider.js.map