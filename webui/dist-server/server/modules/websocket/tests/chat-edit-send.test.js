import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeConnection, initializeDatabase, sessionsDb } from '../../../modules/database/index.js';
import { sessionsService } from '../../../modules/providers/index.js';
import { handleChatConnection } from '../../../modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '../../../modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '../../../modules/websocket/services/websocket-state.service.js';
const SESSION_ID = 'edit-session';
function createFakeSocket() {
    const socket = new EventEmitter();
    socket.readyState = 1;
    socket.frames = [];
    socket.send = (data) => socket.frames.push(JSON.parse(data));
    return socket;
}
/** Two turns and an edit of the second, which is the transcript the gateway reads. */
const TRANSCRIPT_ROWS = [
    {
        type: 'user', uuid: 'e-u1', parentUuid: null, sessionId: SESSION_ID,
        timestamp: '2026-08-23T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'first' }] },
    },
    {
        type: 'assistant', uuid: 'e-a1', parentUuid: 'e-u1', sessionId: SESSION_ID,
        timestamp: '2026-08-23T10:00:01.000Z',
        message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'reply' }] },
    },
    {
        type: 'user', uuid: 'e-u2', parentUuid: 'e-a1', sessionId: SESSION_ID,
        timestamp: '2026-08-23T10:00:02.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'second' }] },
    },
];
/**
 * The same two turns as a Codex rollout. Codex rows carry no id of their own,
 * so the edit anchor is the enclosing turn — which is also the unit its fork
 * endpoint cuts at.
 */
const CODEX_TRANSCRIPT_ROWS = [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-a' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'first' } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-a' } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-b' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'second' } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-b' } },
];
/**
 * Set by a test that needs a run to still be in flight when the next frame
 * arrives; the stub runtime returns immediately otherwise. Released when the
 * test ends, so no stub run is left pending for the rest of the file.
 */
let holdRun = null;
let releaseHeldRun = null;
function holdTheNextRun() {
    holdRun = new Promise((resolve) => { releaseHeldRun = resolve; });
}
async function withGateway(provider, runTest, rows = TRANSCRIPT_ROWS) {
    const previousDatabasePath = process.env.DATABASE_PATH;
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-edit-send-'));
    const transcriptPath = path.join(tempDirectory, `${SESSION_ID}.jsonl`);
    await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
    await initializeDatabase();
    const runs = [];
    const socket = createFakeSocket();
    try {
        const now = new Date().toISOString();
        sessionsDb.createSession(SESSION_ID, provider, tempDirectory, 'Edit session', now, now, transcriptPath);
        handleChatConnection(socket, { user: { id: 1 } }, {
            runtime: {
                hasRuntime: () => true,
                run: async (runProvider, command, options) => {
                    runs.push({ provider: runProvider, command, options });
                    if (holdRun) {
                        await holdRun;
                    }
                },
            },
        });
        await runTest({ socket, runs });
    }
    finally {
        releaseHeldRun?.();
        releaseHeldRun = null;
        holdRun = null;
        connectedClients.clear();
        chatRunRegistry.clearAll();
        closeConnection();
        if (previousDatabasePath === undefined) {
            delete process.env.DATABASE_PATH;
        }
        else {
            process.env.DATABASE_PATH = previousDatabasePath;
        }
        await rm(tempDirectory, { recursive: true, force: true });
    }
}
/** The handler is async and the socket listener does not await it. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 30); });
test('an edit resumes through the turn before the one being replaced', async () => {
    await withGateway('claude', async ({ socket, runs }) => {
        socket.emit('message', JSON.stringify({
            type: 'chat.edit-send',
            sessionId: SESSION_ID,
            anchorId: 'e-u2',
            content: 'a better second prompt',
        }));
        await settle();
        assert.equal(runs.length, 1);
        assert.equal(runs[0].command, 'a better second prompt');
        // Inclusive of the row it names, so this is the last turn KEPT.
        assert.equal(runs[0].options.resumeAnchorId, 'e-a1');
        assert.equal(runs[0].options.resumeFromScratch, false);
    });
});
test('editing the first prompt starts the conversation over', async () => {
    await withGateway('claude', async ({ socket, runs }) => {
        socket.emit('message', JSON.stringify({
            type: 'chat.edit-send',
            sessionId: SESSION_ID,
            anchorId: 'e-u1',
            content: 'a better first prompt',
        }));
        await settle();
        assert.equal(runs.length, 1);
        assert.equal(runs[0].options.resumeAnchorId, undefined);
        assert.equal(runs[0].options.resumeFromScratch, true);
    });
});
test('every subscribed client is told to drop the superseded turns', async () => {
    await withGateway('claude', async ({ socket }) => {
        socket.emit('message', JSON.stringify({
            type: 'chat.edit-send',
            sessionId: SESSION_ID,
            anchorId: 'e-u2',
            content: 'replacement',
        }));
        await settle();
        const truncation = socket.frames.find((frame) => frame.kind === 'history_truncated');
        assert.ok(truncation, 'a history_truncated frame is emitted');
        assert.equal(truncation?.anchorId, 'e-u2');
        assert.equal(truncation?.sessionId, SESSION_ID);
        // Sequenced like every other run event, so a reconnecting tab replays it.
        assert.equal(typeof truncation?.seq, 'number');
    });
});
test('an edit without an anchor is refused', async () => {
    await withGateway('claude', async ({ socket, runs }) => {
        socket.emit('message', JSON.stringify({
            type: 'chat.edit-send',
            sessionId: SESSION_ID,
            content: 'no anchor',
        }));
        await settle();
        assert.equal(runs.length, 0);
        assert.equal(socket.frames.at(-1)?.code, 'ANCHOR_REQUIRED');
    });
});
test('an anchor the transcript does not hold is refused', async () => {
    await withGateway('claude', async ({ socket, runs }) => {
        socket.emit('message', JSON.stringify({
            type: 'chat.edit-send',
            sessionId: SESSION_ID,
            anchorId: 'not-in-transcript',
            content: 'replacement',
        }));
        await settle();
        assert.equal(runs.length, 0);
        assert.equal(socket.frames.at(-1)?.code, 'ANCHOR_NOT_FOUND');
    });
});
test('a provider that cannot re-run from a point is refused rather than sending a new message', async () => {
    await withGateway('cursor', async ({ socket, runs }) => {
        socket.emit('message', JSON.stringify({
            type: 'chat.edit-send',
            sessionId: SESSION_ID,
            anchorId: 'e-u2',
            content: 'replacement',
        }));
        await settle();
        assert.equal(runs.length, 0);
        assert.equal(socket.frames.at(-1)?.code, 'EDIT_NOT_SUPPORTED');
    });
});
test('a refused send never rewinds the conversation', async () => {
    await withGateway('codex', async ({ socket, runs }) => {
        // The rewind moves the session onto a different provider transcript and
        // cannot be undone, so a send the gateway is about to refuse must not
        // reach it. A run already in flight is the realistic way that happens: a
        // scheduled message, or another device.
        const realRewind = sessionsService.rewindSessionForEdit;
        let rewound = false;
        sessionsService.rewindSessionForEdit = async () => { rewound = true; };
        holdTheNextRun();
        try {
            socket.emit('message', JSON.stringify({
                type: 'chat.send',
                sessionId: SESSION_ID,
                content: 'a turn that is already running',
            }));
            await settle();
            assert.equal(runs.length, 1);
            socket.emit('message', JSON.stringify({
                type: 'chat.edit-send',
                sessionId: SESSION_ID,
                anchorId: 'turn-b',
                content: 'an edit that arrives too late',
            }));
            await settle();
        }
        finally {
            sessionsService.rewindSessionForEdit = realRewind;
        }
        assert.equal(rewound, false);
        assert.equal(runs.length, 1);
        assert.equal(socket.frames.at(-1)?.code, 'RUN_IN_PROGRESS');
    }, CODEX_TRANSCRIPT_ROWS);
});
test('a provider that has to branch to rewind is rewound before the run, not during it', async () => {
    await withGateway('codex', async ({ socket, runs }) => {
        // The rewind itself belongs to the provider and is covered there; what
        // this asserts is the gateway's half — that a provider which reports it
        // rewound gets an ordinary run instead of one carrying a resume anchor its
        // runtime would not know what to do with.
        const realRewind = sessionsService.rewindSessionForEdit;
        const rewindCalls = [];
        let truncatedBeforeRewind = false;
        sessionsService.rewindSessionForEdit = async (sessionId, keepThroughId) => {
            truncatedBeforeRewind = socket.frames.some((frame) => frame.kind === 'history_truncated');
            rewindCalls.push({ sessionId, keepThroughId });
        };
        try {
            socket.emit('message', JSON.stringify({
                type: 'chat.edit-send',
                sessionId: SESSION_ID,
                anchorId: 'turn-b',
                content: 'a better second prompt',
            }));
            await settle();
        }
        finally {
            sessionsService.rewindSessionForEdit = realRewind;
        }
        // Resolved from the real Codex rollout: the turn before the edited one.
        assert.deepEqual(rewindCalls, [{ sessionId: SESSION_ID, keepThroughId: 'turn-a' }]);
        assert.equal(runs.length, 1);
        assert.equal(runs[0].command, 'a better second prompt');
        assert.equal(runs[0].options.resumeAnchorId, undefined);
        assert.equal(runs[0].options.resumeFromScratch, undefined);
        // Clients still hear about the cut; how it was made is the server's
        // business. And they hear about it first: a rewind that branches waits on
        // a spawned process, and holding the frame until it returned left the
        // replaced message on screen for about a second.
        assert.ok(socket.frames.some((frame) => frame.kind === 'history_truncated'));
        assert.equal(truncatedBeforeRewind, true);
    }, CODEX_TRANSCRIPT_ROWS);
});
//# sourceMappingURL=chat-edit-send.test.js.map