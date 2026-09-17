import os from 'node:os';
import spawn from 'cross-spawn';
import { createSystemRouter } from './system.routes.js';
import { createSystemUpdateService } from './system.service.js';
function runShellCommand(command, workingDirectory, environment, onOutput, onErrorOutput) {
    return new Promise((resolve, reject) => {
        const childProcess = spawn('sh', ['-c', command], {
            cwd: workingDirectory,
            env: environment,
        });
        let output = '';
        let errorOutput = '';
        childProcess.stdout?.on('data', (data) => {
            const text = data.toString();
            output += text;
            onOutput(text);
        });
        childProcess.stderr?.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            onErrorOutput(text);
        });
        childProcess.once('error', reject);
        childProcess.once('close', (exitCode) => {
            resolve({ exitCode, output, errorOutput });
        });
    });
}
/**
 * Builds the authenticated system router for the server entrypoint using the
 * installation details it already resolves for health and startup metadata.
 */
export function createSystemModule(options) {
    const systemUpdateService = createSystemUpdateService({
        ...options,
        homeDirectory: os.homedir(),
        environment: process.env,
        runShellCommand,
        logInfo: (message, detail) => console.log(message, detail ?? ''),
        logError: (message, detail) => console.error(message, detail ?? ''),
    });
    return createSystemRouter(systemUpdateService);
}
//# sourceMappingURL=system.module.js.map