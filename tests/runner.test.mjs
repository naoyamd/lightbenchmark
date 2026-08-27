import assert from 'node:assert/strict';
import test from 'node:test';
import { addUsage, responseText } from '../scripts/run-chat-openai.mjs';
import { consumeCodexLine, emptyCodexStats, runCapturedProcess } from '../scripts/run-codex-task.mjs';

test('raw chat helpers preserve text and sum reported usage', () => {
  const first = { output: [{ content: [{ type: 'output_text', text: 'one' }] }], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 3 } } };
  const second = { output_text: 'two', usage: { input_tokens: 20, output_tokens: 6, total_tokens: 26, input_tokens_details: { cached_tokens: 5 }, output_tokens_details: { reasoning_tokens: 4 } } };
  assert.equal(responseText(first), 'one');
  assert.equal(responseText(second), 'two');
  assert.deepEqual(addUsage(first, second), { inputTokens: 30, outputTokens: 10, cachedTokens: 7, reasoningTokens: 7, totalTokens: 40 });
});

test('Codex JSONL parser records usage, tools, and subagents', () => {
  const stats = emptyCodexStats();
  for (const event of [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'item.completed', item: { type: 'command_execution' } },
    { type: 'item.completed', item: { type: 'collaboration_tool_call', tool_name: 'spawn_agent' } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
  ]) consumeCodexLine(stats, JSON.stringify(event));
  assert.deepEqual(stats, { threadId: 'thread-1', itemCount: 2, toolCalls: 2, subagents: 1, usage: { input_tokens: 10, output_tokens: 5 }, malformedLines: 0 });
});

test('captured processes are stopped by the configured deadline', async () => {
  const result = await runCapturedProcess({
    executable: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 1000)'],
    cwd: process.cwd(),
    input: '',
    timeoutMs: 30,
  });
  assert.equal(result.timedOut, true);
  assert.ok(result.durationMs < 900);
});
