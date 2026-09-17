import os from 'node:os';
import path from 'node:path';
import { SkillsProvider } from '../../../../modules/providers/shared/skills/skills.provider.js';
import { resolveAntigravityStateDir } from './antigravity-auth.provider.js';
export class AntigravitySkillsProvider extends SkillsProvider {
    constructor() {
        super('antigravity');
    }
    async getSkillSources(workspacePath) {
        return [
            {
                scope: 'project',
                rootDir: path.join(workspacePath, '.agents', 'skills'),
                commandPrefix: '/',
            },
            {
                scope: 'project',
                rootDir: path.join(workspacePath, '.antigravity', 'skills'),
                commandPrefix: '/',
            },
            {
                scope: 'system',
                rootDir: path.join(resolveAntigravityStateDir(), 'builtin', 'skills'),
                commandPrefix: '/',
            },
            {
                scope: 'user',
                rootDir: path.join(resolveAntigravityStateDir(), 'skills'),
                commandPrefix: '/',
            },
            {
                scope: 'user',
                rootDir: path.join(os.homedir(), '.agents', 'skills'),
                commandPrefix: '/',
            },
        ];
    }
    async getGlobalSkillSource() {
        return {
            scope: 'user',
            rootDir: path.join(resolveAntigravityStateDir(), 'skills'),
            commandPrefix: '/',
        };
    }
}
//# sourceMappingURL=antigravity-skills.provider.js.map