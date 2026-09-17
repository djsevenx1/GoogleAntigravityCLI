import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { handleShellConnection } from '../../../modules/websocket/services/shell-websocket.service.js';
function createFakeSocket() {
    const socket = new EventEmitter();
    socket.readyState = WebSocket.OPEN;
    socket.frames = [];
    socket.send = (data) => socket.frames.push(data);
    return socket;
}
function createFakePty() {
    let dataListener = null;
    let exitListener = null;
    return {
        killed: false,
        onData(listener) {
            dataListener = listener;
            return { dispose: () => undefined };
        },
        onExit(listener) {
            exitListener = listener;
            return { dispose: () => undefined };
        },
        emitData(data) {
            dataListener?.(data);
        },
        emitExit() {
            exitListener?.({ exitCode: 0 });
        },
        write() { },
        resize() { },
        kill() {
            this.killed = true;
        },
    };
}
test('a stale socket close cannot detach the socket that replaced it', () => {
    const pty = createFakePty();
    const dependencies = {
        resolveProviderSessionId: () => null,
        spawnPty: () => pty,
    };
    const initMessage = JSON.stringify({
        type: 'init',
        projectPath: process.cwd(),
        sessionId: `stale-close-${Date.now()}`,
        hasSession: false,
        provider: 'plain-shell',
        isPlainShell: true,
        initialCommand: 'test-command',
    });
    const firstSocket = createFakeSocket();
    handleShellConnection(firstSocket, dependencies);
    firstSocket.emit('message', initMessage);
    const replacementSocket = createFakeSocket();
    handleShellConnection(replacementSocket, dependencies);
    replacementSocket.emit('message', initMessage);
    replacementSocket.frames.length = 0;
    // This ordering reproduces a delayed close from a backgrounded mobile tab.
    firstSocket.emit('close');
    pty.emitData('output-after-stale-close');
    assert.equal(pty.killed, false);
    assert.equal(replacementSocket.frames.length, 1);
    assert.match(replacementSocket.frames[0], /output-after-stale-close/);
    pty.emitExit();
});
test('shell output detects and normalizes a wrapped authentication URL', () => {
    const pty = createFakePty();
    const socket = createFakeSocket();
    const dependencies = {
        resolveProviderSessionId: () => null,
        spawnPty: () => pty,
    };
    handleShellConnection(socket, dependencies);
    socket.emit('message', JSON.stringify({
        type: 'init',
        projectPath: process.cwd(),
        sessionId: `wrapped-url-${Date.now()}`,
        hasSession: false,
        provider: 'plain-shell',
        isPlainShell: true,
        initialCommand: 'test-command',
    }));
    socket.frames.length = 0;
    pty.emitData("Continue in your browser: https://example.com/authorize?\ncode=abc\x1b[0m");
    const frames = socket.frames.map((frame) => JSON.parse(frame));
    const authenticationFrame = frames.find((frame) => frame.type === 'auth_url');
    assert.deepEqual(authenticationFrame, {
        type: 'auth_url',
        url: 'https://example.com/authorize?code=abc',
        autoOpen: false,
    });
    pty.emitExit();
});
test('bypassPermissions launches claude with --dangerously-skip-permissions', () => {
    const spawnedCommands = [];
    const dependencies = {
        resolveProviderSessionId: () => null,
        spawnPty: (_shell, args) => {
            spawnedCommands.push(Array.isArray(args) ? args[args.length - 1] : args);
            return createFakePty();
        },
    };
    const bypassSocket = createFakeSocket();
    handleShellConnection(bypassSocket, dependencies);
    bypassSocket.emit('message', JSON.stringify({
        type: 'init',
        projectPath: process.cwd(),
        sessionId: `bypass-on-${Date.now()}`,
        hasSession: false,
        provider: 'claude',
        bypassPermissions: true,
    }));
    const defaultSocket = createFakeSocket();
    handleShellConnection(defaultSocket, dependencies);
    defaultSocket.emit('message', JSON.stringify({
        type: 'init',
        projectPath: process.cwd(),
        sessionId: `bypass-off-${Date.now()}`,
        hasSession: false,
        provider: 'claude',
    }));
    assert.deepEqual(spawnedCommands, ['claude --dangerously-skip-permissions', 'claude']);
});
test('bypassPermissions carries through to resumed claude sessions', () => {
    const spawnedCommands = [];
    const dependencies = {
        resolveProviderSessionId: () => 'resumed-session-id',
        spawnPty: (_shell, args) => {
            spawnedCommands.push(Array.isArray(args) ? args[args.length - 1] : args);
            return createFakePty();
        },
    };
    const socket = createFakeSocket();
    handleShellConnection(socket, dependencies);
    socket.emit('message', JSON.stringify({
        type: 'init',
        projectPath: process.cwd(),
        sessionId: `bypass-resume-${Date.now()}`,
        hasSession: true,
        provider: 'claude',
        bypassPermissions: true,
    }));
    assert.equal(spawnedCommands.length, 1);
    if (os.platform() !== 'win32') {
        assert.equal(spawnedCommands[0], 'claude --resume "resumed-session-id" --dangerously-skip-permissions || claude --dangerously-skip-permissions');
    }
});
test('a missing project directory is reported as an error frame and starts no pty', () => {
    const socket = createFakeSocket();
    let spawnCount = 0;
    const dependencies = {
        resolveProviderSessionId: () => null,
        spawnPty: () => {
            spawnCount += 1;
            return createFakePty();
        },
    };
    handleShellConnection(socket, dependencies);
    socket.emit('message', JSON.stringify({
        type: 'init',
        // A project row survives its directory being deleted or unmounted, so
        // this is what the Shell tab sends for a stale sidebar entry.
        projectPath: path.join(os.tmpdir(), `shell-missing-${Date.now()}`),
        sessionId: `missing-path-${Date.now()}`,
        hasSession: false,
        provider: 'plain-shell',
        isPlainShell: true,
    }));
    assert.equal(spawnCount, 0);
    assert.deepEqual(socket.frames.map((frame) => JSON.parse(frame)), [{ type: 'error', message: 'Invalid project path' }]);
});
//# sourceMappingURL=shell-websocket.service.test.js.map