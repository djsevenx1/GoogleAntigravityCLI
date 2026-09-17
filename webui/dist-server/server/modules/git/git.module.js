import * as fs from 'node:fs/promises';
import spawn from 'cross-spawn';
import { projectsDb } from '../../modules/database/index.js';
import { createGitRouter } from './git.routes.js';
/** Assembles the Git router with runners from the centralized provider runtime service. */
export function createGitModule(externalDependencies) {
    return createGitRouter({
        fileSystem: fs,
        spawnProcess: spawn,
        resolveProjectPathById: (projectId) => projectsDb.getProjectPathById(projectId),
        ...externalDependencies,
    });
}
//# sourceMappingURL=git.module.js.map