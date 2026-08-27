import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);

export function responseText(response) {
  if (typeof response?.output_text === 'string' && response.output_text) return response.output_text;
  return (response?.output ?? []).flatMap(item => item?.content ?? [])
    .filter(item => item?.type === 'output_text')
    .map(item => item.text ?? '')
    .join('');
}

export function addUsage(...responses) {
  return responses.reduce((total, response) => {
    const usage = response?.usage ?? {};
    total.inputTokens += usage.input_tokens ?? 0;
    total.outputTokens += usage.output_tokens ?? 0;
    total.cachedTokens += usage.input_tokens_details?.cached_tokens ?? 0;
    total.reasoningTokens += usage.output_tokens_details?.reasoning_tokens ?? 0;
    total.totalTokens += usage.total_tokens ?? 0;
    return total;
  }, { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, totalTokens: 0 });
}

async function createResponse(apiKey, body, signal) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  const result = await response.json();
  if (result.status !== 'completed') throw new Error(`OpenAI response did not complete: ${result.status}`);
  if ((result.tools ?? []).length) throw new Error('OpenAI response unexpectedly exposed tools');
  return result;
}

export async function runChat({ workspace, model = 'gpt-5.6-luna', effort = 'max', timeoutMs = 720_000 }) {
  const root = path.resolve(workspace);
  const stat = await lstat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`workspace does not exist: ${root}`);
  const outputFiles = ['turn1-response.txt', 'turn2-response.txt', 'chat-api-run.json'];
  if ((await Promise.all(outputFiles.map(file => lstat(path.join(root, file)).catch(() => null)))).some(Boolean)) {
    throw new Error('chat output already exists; use a fresh workspace');
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');
  const [system, turn1, turn2, payloadText] = await Promise.all([
    readFile(path.join(root, 'system.txt'), 'utf8'),
    readFile(path.join(root, 'turn1.txt'), 'utf8'),
    readFile(path.join(root, 'turn2.txt'), 'utf8'),
    readFile(path.join(root, 'payload.json'), 'utf8'),
  ]);
  const payload = JSON.parse(payloadText);
  const promptHash = createHash('sha256').update(JSON.stringify(payload.sequence)).digest('hex');
  const startedAt = new Date();
  const signal = AbortSignal.timeout(timeoutMs);
  let first;
  try {
    first = await createResponse(apiKey, {
      model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: system }] },
        { role: 'user', content: [{ type: 'input_text', text: turn1 }] },
      ],
      reasoning: { effort },
      tools: [],
      store: true,
      max_output_tokens: 10_000,
    }, signal);
    const firstText = responseText(first);
    if (!firstText) throw new Error('turn 1 returned no output text');
    const second = await createResponse(apiKey, {
      model,
      previous_response_id: first.id,
      input: [{ role: 'user', content: [{ type: 'input_text', text: turn2 }] }],
      reasoning: { effort },
      tools: [],
      store: true,
      max_output_tokens: 10_000,
    }, signal);
    const secondText = responseText(second);
    if (!secondText) throw new Error('turn 2 returned no output text');
    const endedAt = new Date();
    const metadata = {
      schemaVersion: 1,
      harness: 'openai-responses-api',
      isolation: 'tools-disabled-api',
      officialEligible: true,
      modelRequested: model,
      modelReturned: second.model ?? first.model ?? null,
      reasoningEffort: effort,
      toolsSent: 0,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt - startedAt,
      promptHash,
      responseIds: [first.id, second.id],
      usage: addUsage(first, second),
    };
    await Promise.all([
      writeFile(path.join(root, outputFiles[0]), firstText, 'utf8'),
      writeFile(path.join(root, outputFiles[1]), secondText, 'utf8'),
      writeFile(path.join(root, outputFiles[2]), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8'),
    ]);
    return metadata;
  } catch (error) {
    const endedAt = new Date();
    const metadata = {
      schemaVersion: 1,
      harness: 'openai-responses-api',
      isolation: 'tools-disabled-api',
      officialEligible: true,
      modelRequested: model,
      reasoningEffort: effort,
      toolsSent: 0,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt - startedAt,
      promptHash,
      usage: first ? addUsage(first) : null,
      error: error instanceof Error ? error.message : String(error),
    };
    await writeFile(path.join(root, outputFiles[2]), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    throw error;
  }
}

function parseArgs(args) {
  const workspace = args.shift();
  if (!workspace) throw new Error('Usage: node scripts/run-chat-openai.mjs <workspace> [--model ID] [--effort LEVEL] [--timeout-ms N]');
  const options = { workspace };
  while (args.length) {
    const key = args.shift();
    const value = args.shift();
    if (!value) throw new Error(`${key} requires a value`);
    if (key === '--model') options.model = value;
    else if (key === '--effort') options.effort = value;
    else if (key === '--timeout-ms') options.timeoutMs = Number(value);
    else throw new Error(`unknown option: ${key}`);
  }
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error('--timeout-ms must be a positive integer');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  runChat(parseArgs(process.argv.slice(2)))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
