import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import express from 'express';
import { connectedClients } from '../../../modules/websocket/index.js';
import { createTaskmasterRouter } from '../taskmaster.routes.js';
test('tasks route resolves project ids through the injected project adapter', async () => {
    const resolvedIds = [];
    const router = createTaskmasterRouter({
        fileSystem: {},
        fileSystemPromises: {},
        spawnProcess: (() => { throw new Error('spawn should not run'); }),
        resolveProjectPathById: (projectId) => { resolvedIds.push(projectId); return null; },
        taskmasterService: {
            detectMcpServer: async () => ({
                hasMCPServer: false,
                reason: 'Not configured',
                hasConfig: false,
            }),
        },
    });
    const app = express().use('/api/taskmaster', router);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/taskmaster/tasks/project-1`);
        assert.equal(response.status, 404);
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
    }
    assert.deepEqual(resolvedIds, ['project-1']);
});
test('MCP status route delegates detection to the injected TaskMaster service', async () => {
    let detectionCount = 0;
    const router = createTaskmasterRouter({
        fileSystem: {},
        fileSystemPromises: {},
        spawnProcess: (() => { throw new Error('spawn should not run'); }),
        resolveProjectPathById: () => null,
        taskmasterService: {
            detectMcpServer: async () => {
                detectionCount += 1;
                return {
                    hasMCPServer: true,
                    isConfigured: true,
                    hasApiKeys: false,
                    scope: 'user',
                    config: {
                        command: 'npx',
                        args: ['-y', 'task-master-ai'],
                        url: null,
                        envVars: [],
                        type: 'stdio',
                    },
                };
            },
        },
    });
    const app = express().use('/api/taskmaster', router);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/taskmaster/mcp-status`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            hasMCPServer: true,
            isConfigured: true,
            hasApiKeys: false,
            scope: 'user',
            config: {
                command: 'npx',
                args: ['-y', 'task-master-ai'],
                url: null,
                envVars: [],
                type: 'stdio',
            },
        });
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
    }
    assert.equal(detectionCount, 1);
});
test('TaskMaster process errors use the endpoint failure response and settle once', async () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const router = createTaskmasterRouter({
        fileSystem: { constants: { F_OK: 0 } },
        fileSystemPromises: {
            access: async () => { throw new Error('not initialized'); },
        },
        spawnProcess: (() => {
            process.nextTick(() => {
                child.emit('error', new Error('spawn failed'));
                child.emit('close', 1);
            });
            return child;
        }),
        resolveProjectPathById: () => '/workspace/project',
        taskmasterService: {
            detectMcpServer: async () => ({
                hasMCPServer: false,
                reason: 'Not configured',
                hasConfig: false,
            }),
        },
    });
    const app = express().use('/api/taskmaster', router);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/taskmaster/init/project-1`, {
            method: 'POST',
        });
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
            error: 'Failed to initialize TaskMaster',
            message: 'spawn failed',
            code: null,
        });
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
    }
});
test('TaskMaster broadcasts reach only the tracked chat clients', async () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const chatClient = { readyState: 1, frames: [], send(data) { this.frames.push(data); } };
    const closingClient = { readyState: 3, frames: [], send(data) { this.frames.push(data); } };
    const router = createTaskmasterRouter({
        fileSystem: { constants: { F_OK: 0 } },
        fileSystemPromises: {
            access: async () => { throw new Error('not initialized'); },
        },
        spawnProcess: (() => {
            process.nextTick(() => child.emit('close', 0));
            return child;
        }),
        resolveProjectPathById: () => '/workspace/project',
        taskmasterService: {
            detectMcpServer: async () => ({
                hasMCPServer: false,
                reason: 'Not configured',
                hasConfig: false,
            }),
        },
    });
    const app = express().use('/api/taskmaster', router);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    connectedClients.add(chatClient);
    connectedClients.add(closingClient);
    try {
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/taskmaster/init/project-1`, {
            method: 'POST',
        });
        assert.equal(response.status, 200);
        assert.equal(chatClient.frames.length, 1);
        const frame = JSON.parse(chatClient.frames[0]);
        assert.equal(frame.type, 'taskmaster-project-updated');
        assert.equal(frame.projectId, 'project-1');
        assert.equal(closingClient.frames.length, 0);
    }
    finally {
        connectedClients.clear();
        await new Promise((resolve) => server.close(() => resolve()));
    }
});
//# sourceMappingURL=taskmaster.routes.test.js.map