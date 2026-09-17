import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import spawn from 'cross-spawn';
export function resolveAntigravityBinary() {
    if (process.env.AGY_BIN && fs.existsSync(process.env.AGY_BIN)) {
        return process.env.AGY_BIN;
    }
    const defaultPath = '/vol1/@apphome/GoogleAntigravityCLI/bin/antigravity';
    if (fs.existsSync(defaultPath)) {
        return defaultPath;
    }
    const defaultSymlink = '/vol1/@apphome/GoogleAntigravityCLI/bin/agy';
    if (fs.existsSync(defaultSymlink)) {
        return defaultSymlink;
    }
    return 'antigravity';
}
/**
 * Resolves the Antigravity CLI state root (the dir holding `.gemini/antigravity-cli`).
 * When AGY_HOME is set, state stays isolated from any other Antigravity install
 * (e.g. the user's real ~/.gemini/antigravity-cli). Otherwise falls back to the
 * process home directory, matching the CLI's own default resolution.
 */
export function resolveAntigravityHome() {
    return process.env.AGY_HOME || os.homedir();
}
/** Full path to the `.gemini/antigravity-cli` state directory for this install. */
export function resolveAntigravityStateDir() {
    return path.join(resolveAntigravityHome(), '.gemini', 'antigravity-cli');
}
export class AntigravityProviderAuth {
    checkInstalled() {
        const binPath = resolveAntigravityBinary();
        if (fs.existsSync(binPath)) {
            return true;
        }
        try {
            const result = spawn.sync(binPath, ['--help'], { stdio: 'ignore', timeout: 5000 });
            return result.status === 0;
        }
        catch {
            return false;
        }
    }
    async getStatus() {
        const installed = this.checkInstalled();
        if (!installed) {
            return {
                installed: false,
                provider: 'antigravity',
                authenticated: false,
                email: null,
                method: null,
                error: 'Google Antigravity CLI is not installed or binary not found',
            };
        }
        try {
            const { antigravityAccountsService } = await import('./antigravity-accounts.service.js');
            const activeAccount = await antigravityAccountsService.getActiveAccount();
            const hasToken = Boolean(activeAccount?.tokenData?.token?.access_token || activeAccount?.tokenData?.token?.refresh_token);
            if (activeAccount && hasToken) {
                const displayName = activeAccount.name && activeAccount.name !== activeAccount.email
                    ? `${activeAccount.name} (${activeAccount.email})`
                    : activeAccount.email;
                return {
                    installed: true,
                    provider: 'antigravity',
                    authenticated: true,
                    email: displayName,
                    method: 'google-oauth',
                };
            }
        }
        catch (_) { }
        return {
            installed: true,
            provider: 'antigravity',
            authenticated: false,
            email: null,
            method: 'google-oauth',
            error: '未连接 Google 账号，请点击添加账号',
        };
    }
}
//# sourceMappingURL=antigravity-auth.provider.js.map