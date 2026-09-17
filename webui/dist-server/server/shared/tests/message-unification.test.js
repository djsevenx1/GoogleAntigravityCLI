import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareTranscriptMessages } from '../../shared/message-unification.js';
let nextId = 0;
const message = (fields) => ({
    id: `m-${(nextId += 1)}`,
    sessionId: 'session',
    timestamp: '2026-08-22T00:00:00.000Z',
    provider: 'claude',
    kind: 'text',
    ...fields,
});
const prose = () => message({ kind: 'text', role: 'assistant', content: 'Working on it.' });
const taskCall = (toolName, toolId, toolInput, toolUseResult) => message({ kind: 'tool_use', toolName, toolId, toolInput, toolResult: { content: 'ok', toolUseResult } });
const todosOf = (entry) => entry.toolInput.todos
    .map((todo) => `${todo.status}:${todo.content}`);
test('Claude task-tracker calls become one evolving checklist', () => {
    const unified = prepareTranscriptMessages([
        taskCall('TaskCreate', 't1', { subject: 'Read notes', activeForm: 'Reading notes' }, { task: { id: '1' } }),
        taskCall('TaskCreate', 't2', { subject: 'Run tests', activeForm: 'Running tests' }, { task: { id: '2' } }),
        prose(),
        taskCall('TaskUpdate', 't3', { taskId: '1', status: 'completed' }, { success: true }),
    ]);
    const snapshots = unified.filter((entry) => entry.toolName === 'TodoWrite');
    assert.equal(snapshots.length, 2, 'the two adjacent creates collapse into one snapshot');
    assert.deepEqual(todosOf(snapshots[0]), ['pending:Read notes', 'pending:Run tests']);
    assert.deepEqual(todosOf(snapshots[1]), ['completed:Read notes', 'pending:Run tests']);
    assert.equal(snapshots[0].toolInput.todos[0].activeForm, 'Reading notes');
});
test('a task listing keeps the wording each task was created with', () => {
    const unified = prepareTranscriptMessages([
        taskCall('TaskCreate', 't1', { subject: 'Read notes', activeForm: 'Reading notes' }, { task: { id: '1' } }),
        prose(),
        taskCall('TaskList', 't2', {}, { tasks: [{ id: '1', subject: 'Read notes', status: 'in_progress' }] }),
    ]);
    const listed = unified.filter((entry) => entry.toolName === 'TodoWrite').at(-1);
    assert.deepEqual(todosOf(listed), ['in_progress:Read notes']);
    assert.equal(listed.toolInput.todos[0].activeForm, 'Reading notes');
});
test('a checklist that has not changed since it was last drawn is dropped', () => {
    const unified = prepareTranscriptMessages([
        message({ kind: 'tool_use', toolName: 'TodoWrite', toolId: 'w1', toolInput: { todos: [{ content: 'Ship it', status: 'pending' }] } }),
        prose(),
        message({ kind: 'tool_use', toolName: 'TodoWrite', toolId: 'w2', toolInput: { todos: [{ content: 'Ship it', status: 'pending' }] } }),
    ]);
    assert.deepEqual(unified.map((entry) => entry.toolId), ['w1', undefined]);
});
test('a superseded checklist and its result row both go', () => {
    const unified = prepareTranscriptMessages([
        message({ kind: 'tool_use', toolName: 'TodoWrite', toolId: 'w1', toolInput: { todos: [{ content: 'One', status: 'pending' }] } }),
        message({ kind: 'tool_result', toolId: 'w1', content: 'stale' }),
        message({ kind: 'tool_use', toolName: 'TodoWrite', toolId: 'w2', toolInput: { todos: [{ content: 'One', status: 'completed' }] } }),
        message({ kind: 'tool_result', toolId: 'w2', content: 'fresh' }),
    ]);
    assert.deepEqual(unified.map((entry) => entry.toolId), ['w2']);
});
test('a result that names its call is not shipped alongside it', () => {
    const unified = prepareTranscriptMessages([
        message({ kind: 'tool_use', toolName: 'Bash', toolId: 'b1', toolInput: { command: 'ls' }, toolResult: { content: 'a\nb' } }),
        message({ kind: 'tool_result', toolId: 'b1', content: 'a\nb' }),
    ]);
    assert.equal(unified.length, 1, 'the result already rides on the call it belongs to');
    assert.equal(unified[0].kind, 'tool_use');
    assert.equal(unified[0].toolResult?.content, 'a\nb');
});
test('a result with no call to attach to is kept', () => {
    const unified = prepareTranscriptMessages([
        message({ kind: 'tool_result', content: 'orphaned output' }),
    ]);
    assert.deepEqual(unified.map((entry) => entry.kind), ['tool_result']);
});
test("Codex's request_user_input becomes an answered AskUserQuestion", () => {
    const [unified] = prepareTranscriptMessages([
        message({
            provider: 'codex',
            kind: 'tool_use',
            toolName: 'request_user_input',
            toolId: 'call-1',
            toolInput: JSON.stringify({
                questions: [{ id: 'season', header: 'Quick test', question: 'Which season?', options: [{ label: 'Summer' }] }],
            }),
            toolResult: { content: '{"answers":{"season":{"answers":["Summer"]}}}' },
        }),
    ]);
    assert.equal(unified.toolName, 'AskUserQuestion');
    assert.deepEqual(unified.toolInput.answers, { 'Which season?': 'Summer' });
});
test('a multi-select Codex answer keeps every label it picked', () => {
    const [unified] = prepareTranscriptMessages([
        message({
            provider: 'codex',
            kind: 'tool_use',
            toolName: 'request_user_input',
            toolId: 'call-1',
            toolInput: JSON.stringify({ questions: [{ id: 'scope', question: 'Which areas?', options: [] }] }),
            toolResult: { content: '{"answers":{"scope":{"answers":["Providers","Tests"]}}}' },
        }),
    ]);
    assert.deepEqual(unified.toolInput.answers, { 'Which areas?': 'Providers, Tests' });
});
test("Claude's AskUserQuestion answer is folded into the question it answers", () => {
    const [unified] = prepareTranscriptMessages([
        message({
            kind: 'tool_use',
            toolName: 'AskUserQuestion',
            toolId: 'call-1',
            toolInput: { questions: [{ question: 'What next?', header: 'Focus', options: [{ label: 'Branch changes' }] }] },
            toolResult: {
                content: 'Your questions have been answered.',
                toolUseResult: { answers: { 'What next?': 'Branch changes' } },
            },
        }),
    ]);
    assert.deepEqual(unified.toolInput.answers, { 'What next?': 'Branch changes' });
});
test('a live Claude answer is recovered from the acknowledgement sentence', () => {
    const [unified] = prepareTranscriptMessages([
        message({
            kind: 'tool_use',
            toolName: 'AskUserQuestion',
            toolId: 'call-1',
            toolInput: { questions: [{ question: 'What next?', options: [] }] },
            toolResult: {
                content: 'Your questions have been answered: "What next?"="Branch changes". You can now continue.',
            },
        }),
    ]);
    assert.deepEqual(unified.toolInput.answers, { 'What next?': 'Branch changes' });
});
test('a question that was never answered carries no answers', () => {
    const [unified] = prepareTranscriptMessages([
        message({
            kind: 'tool_use',
            toolName: 'AskUserQuestion',
            toolId: 'call-1',
            toolInput: { questions: [{ question: 'What next?', options: [] }] },
            toolResult: { content: '<tool_use_error>InputValidationError</tool_use_error>', isError: true },
        }),
    ]);
    assert.equal(unified.toolInput.answers, undefined);
});
test('a huge tool output is capped, and says how much it dropped', () => {
    const body = 'x'.repeat(120_000);
    const [unified] = prepareTranscriptMessages([
        message({
            kind: 'tool_use',
            toolName: 'Read',
            toolId: 'r1',
            toolInput: { file_path: '/tmp/shot.png' },
            toolResult: { content: body, toolUseResult: { file: { base64: body } } },
        }),
    ]);
    const content = String(unified.toolResult?.content);
    assert.ok(content.length < body.length / 2, 'the output must not survive at full size');
    assert.match(content, /… 80000 more characters$/);
    const nested = (unified.toolResult?.toolUseResult).file.base64;
    assert.equal(nested, content, 'the structured copy is capped the same way');
});
test('a search result keeps every file it found', () => {
    const filenames = Array.from({ length: 900 }, (_, index) => `/repo/src/file-${index}.ts`);
    const [unified] = prepareTranscriptMessages([
        message({
            kind: 'tool_use',
            toolName: 'Glob',
            toolId: 'g1',
            toolInput: { pattern: '**/*.ts' },
            toolResult: { content: 'ok', toolUseResult: { numFiles: filenames.length, filenames } },
        }),
    ]);
    const result = unified.toolResult?.toolUseResult;
    assert.equal(result.numFiles, 900);
    assert.deepEqual(result.filenames, filenames);
});
//# sourceMappingURL=message-unification.test.js.map