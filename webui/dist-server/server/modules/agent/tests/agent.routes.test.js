import assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import express from 'express';
import { createAgentRouter } from '../agent.routes.js';
function createDependencies(overrides = {}) {
    const unexpectedProviderCall = async () => {
        throw new Error('Provider runtime should not be called');
    };
    return {
        fileSystem: {},
        crypto: nodeCrypto,
        homeDirectory: () => '/home/test',
        spawnProcess: (() => { throw new Error('spawn should not run'); }),
        platformMode: true,
        users: { getFirstUser: () => ({ id: 1, username: 'test-user' }) },
        apiKeys: { validateApiKey: () => undefined },
        githubTokens: { getActiveGithubToken: () => null },
        projects: { createProjectPath: () => ({ outcome: 'created' }) },
        models: {},
        queryClaude: unexpectedProviderCall,
        queryCursor: unexpectedProviderCall,
        queryCodex: unexpectedProviderCall,
        queryOpenCode: unexpectedProviderCall,
        queryAntigravity: unexpectedProviderCall,
        GithubClient: class {
        },
        ...overrides,
    };
}
async function withAgentServer(dependencies, run) {
    const app = express();
    app.use(express.json());
    app.use('/api/agent', createAgentRouter(dependencies));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const address = server.address();
        await run(`http://127.0.0.1:${address.port}`);
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
test('Agent route rejects missing project input before invoking provider dependencies', async () => {
    await withAgentServer(createDependencies(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/agent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: 'Inspect this project', stream: false }),
        });
        const body = await response.json();
        assert.equal(response.status, 400);
        assert.equal(body.error, 'Either githubUrl or projectPath is required');
    });
});
test('Agent route validates API keys through the injected repository', async () => {
    const receivedKeys = [];
    await withAgentServer(createDependencies({
        platformMode: false,
        apiKeys: {
            validateApiKey: (apiKey) => {
                receivedKeys.push(apiKey);
                return undefined;
            },
        },
    }), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/agent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'invalid-key' },
            body: JSON.stringify({ projectPath: '/workspace/project', message: 'Run' }),
        });
        assert.equal(response.status, 401);
    });
    assert.deepEqual(receivedKeys, ['invalid-key']);
});
test('Agent route rejects GitHub lookalike hosts before cloning', async () => {
    await withAgentServer(createDependencies(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/agent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                githubUrl: 'https://github.com.evil.example/owner/repo',
                message: 'Run',
                stream: false,
            }),
        });
        const body = await response.json();
        assert.equal(response.status, 500);
        assert.equal(body.error, 'Invalid GitHub URL');
    });
});
test('GitHub cloning keeps credentials out of arguments and remote URL', async () => {
    const token = 'secret-token';
    let cloneArgs = [];
    let cloneEnvironment;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    await withAgentServer(createDependencies({
        fileSystem: {
            access: async () => { throw new Error('missing'); },
            mkdir: async () => undefined,
        },
        githubTokens: { getActiveGithubToken: () => token },
        spawnProcess: ((_command, args, options) => {
            cloneArgs = args;
            cloneEnvironment = options.env;
            process.nextTick(() => child.emit('error', new Error('expected test failure')));
            return child;
        }),
    }), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/agent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                githubUrl: 'https://github.com/owner/repo.git',
                message: 'Run',
                stream: false,
            }),
        });
        assert.equal(response.status, 500);
    });
    assert.deepEqual(cloneArgs.slice(0, 5), [
        'clone', '--depth', '1', '--', 'https://github.com/owner/repo.git',
    ]);
    assert.equal(cloneArgs.length, 6);
    assert.equal(cloneArgs.join(' ').includes(token), false);
    assert.equal(cloneEnvironment?.CLOUDCLI_GITHUB_TOKEN, token);
    assert.equal(cloneEnvironment?.GIT_CONFIG_KEY_0, 'credential.helper');
    assert.equal(cloneEnvironment?.GIT_CONFIG_VALUE_0, '');
    assert.equal(cloneEnvironment?.GIT_CONFIG_KEY_1, 'credential.helper');
});
test('Agent route reuses a matching checkout without cloning or deleting it', async () => {
    const spawnedArguments = [];
    const removedPaths = [];
    const spawnProcess = ((_command, args) => {
        spawnedArguments.push([...args]);
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        process.nextTick(() => {
            child.stdout.end('https://github.com/owner/repo.git\n');
            child.emit('close', 0);
        });
        return child;
    });
    await withAgentServer(createDependencies({
        fileSystem: {
            access: async () => undefined,
            rm: async (targetPath) => { removedPaths.push(targetPath); },
        },
        spawnProcess,
        models: {
            getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'default-model' }),
        },
        queryClaude: (async () => undefined),
    }), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/agent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                githubUrl: 'https://github.com/owner/repo.git',
                projectPath: '/home/test/.claude/external-projects/existing',
                message: 'Run',
                stream: false,
                cleanup: true,
            }),
        });
        assert.equal(response.status, 200);
    });
    assert.deepEqual(spawnedArguments, [['config', '--get', 'remote.origin.url']]);
    assert.deepEqual(removedPaths, []);
});
test('Agent route starts codex on the catalog default when the request names no model', async () => {
    const codexCalls = [];
    await withAgentServer(createDependencies({
        fileSystem: {
            access: async () => undefined,
        },
        models: {
            // `getProviderModels` resolves to a `ProviderModelsDefinition` - `OPTIONS`
            // and `DEFAULT`, with nothing wrapped around it.
            getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'catalog-default' }),
        },
        queryCodex: (async (_prompt, options) => {
            codexCalls.push(options);
        }),
    }), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/agent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                projectPath: '/home/test/project',
                message: 'Run',
                provider: 'codex',
                stream: false,
            }),
        });
        assert.equal(response.status, 200);
    });
    assert.deepEqual(codexCalls.map((call) => call.model), ['catalog-default']);
});
//# sourceMappingURL=agent.routes.test.js.map