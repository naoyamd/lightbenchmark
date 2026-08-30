const results = document.querySelector('#results');
const pageTitle = document.querySelector('#page-title');
const pageLede = document.querySelector('#page-lede');
const pageNav = document.querySelector('#page-nav');
const dialog = document.querySelector('#detail-dialog');
const detailContent = document.querySelector('#detail-content');
const closeButton = document.querySelector('#dialog-close');
let runs = [];
let activeShowcase = null;
let requestSerial = 0;
const showcaseSessions = new WeakMap();
const showcaseMarker = '__LIGHTBENCH_ASSET_ROOT_9b41c8__';

const taskDefinitions = [
  { id: 'japanese-chat', number: '01', title: '日本語チャット', summary: '閉本で答え、資料を読んだ後に自分の誤りを訂正する。', promptVersion: 'JP-2.0' },
  { id: 'color-cascade-18', number: '02', title: 'ぷよぷよ風・18連鎖全消し', summary: '空盤面から配置を計画し、丸い色ぷよの18連鎖と全消しを実ロジックで再演する。', visualVersion: 'PUYO-2.0', promptVersion: 'PUYO-2.0' },
  { id: 'prism-twist', number: '03', title: '3×3 ルービックキューブ', summary: '標準6色・黒い境界の3×3キューブを、実際の面回転だけで揃える。', visualVersion: 'CUBE-1.4', promptVersion: 'CUBE-1.4' },
  { id: 'robot-arm-sort', number: '04', title: '2リンク・ロボットアーム仕分け', summary: 'IK・速度制限・障害物回避・把持を満たし、3色の荷物を実軌道で仕分ける。', visualVersion: 'ARM-1.0', promptVersion: 'ARM-1.0' },
];

const labels = {
  runId: 'Run ID', cohortId: 'コホート', taskId: 'タスク', runKind: '区分', status: 'ステータス',
  displayName: '表示名', provider: 'プロバイダー', modelId: 'モデルID', revision: 'リビジョン', reasoning: '推論設定',
  startedAt: '開始', endedAt: '終了', timeZone: 'タイムゾーン', durationMs: '実行時間', agentSteps: 'エージェントステップ',
  toolCalls: 'ツール呼び出し', terminationReason: '終了理由', inputTokens: '入力トークン', outputTokens: '出力トークン',
  cachedTokens: 'キャッシュトークン', reasoningTokens: '推論トークン', totalTokens: '合計トークン', cost: 'コスト',
  currency: '通貨', costStatus: 'コスト状態', spawned: '起動数', completed: '完了数', failed: '失敗数',
  maxConcurrent: '最大同時実行', role: 'ロール', tokens: 'トークン', interventions: '介入', versions: 'バージョン',
  hashes: 'ハッシュ', evaluation: '評価', items: '内訳', kind: '種類', path: 'パス', label: 'ラベル', url: '表示URL',
  lane: '実行レーン',
  harness: '実行ハーネス',
  isolation: '実行隔離',
  codexHomeIsolation: 'Codexホーム隔離',
  externalContextExposure: '外部ユーザー文脈への接触',
  benchmarkRepositoryExposure: '非公開ベンチマークへの接触',
  showcase: 'ショーケース',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function text(value) {
  return value === null || value === undefined || value === '' ? '取得不能' : escapeHtml(value);
}

function label(key) { return labels[key] ?? key; }

function formatNumber(value) {
  return value === null || value === undefined ? '取得不能' : new Intl.NumberFormat('ja-JP').format(value);
}

function formatDuration(value) {
  if (value === null || value === undefined) return '取得不能';
  if (value < 1000) return `${formatNumber(value)} ms`;
  const seconds = value / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)} 秒` : `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

function formatDate(value) {
  if (value === null || value === undefined) return '取得不能';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value) : new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatCost(bucket) {
  if (bucket?.cost === null || bucket?.cost === undefined) return '取得不能';
  const currency = bucket.currency ? ` ${bucket.currency}` : '';
  return `${bucket.cost}${currency}`;
}

function artifactGallery(run, compact = false) {
  if (!Array.isArray(run.artifacts) || !run.artifacts.length) return '';
  return `<div class="gallery${compact ? ' gallery-compact' : ''}">${run.artifacts.map(artifact => {
    const source = escapeHtml(artifact.url ?? artifact.path);
    const caption = text(artifact.label ?? artifact.path);
    const media = artifact.kind === 'video'
      ? `<video controls preload="metadata" aria-label="${caption}"><source src="${source}"></video>`
      : `<img src="${source}" alt="${caption}" loading="lazy">`;
    return `<figure class="artifact">${media}<figcaption>${caption}</figcaption></figure>`;
  }).join('')}</div>`;
}

function showcaseKind(run) {
  return run.showcase?.kind ?? run.showcase?.type ?? run.showcase?.mode;
}

function showcaseMissing(run) {
  const reason = typeof run.evaluation?.showcase?.reason === 'string' ? `：${run.evaluation.showcase.reason}` : '';
  return `<p class="showcase-empty">ビジュアル未収録${reason ? text(reason) : ''}</p>`;
}

function demoMessage(run) {
  return run.demo === true || run.isDemo === true
    ? '<p class="demo-message">表示確認用のデモ</p>'
    : '';
}

function secondaryVerdict(value) {
  if (!value || typeof value !== 'object') return null;
  const passes = ['headline', 'logic', 'robustness']
    .map(key => value[key]?.pass).filter(item => typeof item === 'boolean');
  if (!passes.length) return null;
  return passes.every(Boolean) ? '成功' : passes.some(Boolean) ? '部分達成' : '失敗';
}

function secondaryValue(value) {
  if (value === null || value === undefined) return '取得不能';
  if (typeof value === 'boolean') return value ? '成功' : '失敗';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.pass === 'boolean') return value.pass ? '成功' : '失敗';
    if (typeof value.status === 'string') return value.status;
    const scores = ['clarity', 'delight', 'trust']
      .filter(key => value[key] !== null && value[key] !== undefined)
      .map(key => `${key}: ${formatNumber(value[key])}`);
    if (scores.length) return scores.join(' / ');
    const verdict = secondaryVerdict(value);
    if (verdict) return verdict;
  }
  return JSON.stringify(value);
}

function evaluationSummary(run) {
  const evaluation = run.evaluation;
  const logic = evaluation?.logic ?? evaluation?.independentEvaluator?.logic;
  const replay = evaluation?.replay;
  const experience = evaluation?.experience;
  const status = evaluation?.status;
  return `<section class="evaluation-summary"><h3>副評価</h3>
    <dl class="secondary-metrics">
      ${metric('logic', secondaryValue(logic))}
      ${metric('replay', secondaryValue(replay))}
      ${metric('experience', secondaryValue(experience))}
    </dl>
    ${status ? `<p class="secondary-status">評価記録: ${text(status)}</p>` : ''}
  </section>`;
}

function showcaseMarkup(run, compact = false) {
  const showcase = run.showcase;
  if (!showcase) return showcaseMissing(run);
  if (showcaseKind(run) === 'chat') {
    const turns = Array.isArray(showcase.turns) ? showcase.turns : showcase.text === undefined ? [] : [{ label: 'チャット', text: showcase.text }];
    return `<section class="showcase chat-showcase${compact ? ' showcase-compact' : ''}"><h3>チャット</h3>${turns.map(turn => `<div class="chat-turn"><strong>${text(turn.label ?? 'チャット')}</strong><pre class="chat-transcript">${escapeHtml(typeof turn.text === 'string' ? turn.text : '取得不能')}</pre></div>`).join('') || '<p class="showcase-empty">取得不能</p>'}</section>`;
  }
  if (showcaseKind(run) !== 'live') return showcaseMissing(run);
  const plan = showcaseActions(run.taskId);
  if (!plan) return showcaseMissing(run);
  const index = runs.indexOf(run);
  return `<section class="showcase live-showcase${compact ? ' showcase-compact' : ''}" data-showcase-container data-showcase-index="${index}">
    <div class="showcase-visual" data-showcase-visual><p class="showcase-loading">実ビジュアルを準備中…</p></div>
    <div class="showcase-controls"><button class="showcase-button" type="button" data-showcase-run-index="${index}" disabled>${text(plan.label)}</button>
    <span class="showcase-status" aria-live="polite">準備中…</span></div>
  </section>`;
}

function metric(labelText, value) {
  return `<div class="metric"><dt>${escapeHtml(labelText)}</dt><dd>${text(value)}</dd></div>`;
}

function runTime(run) {
  return Date.parse(run.execution?.startedAt ?? run.execution?.endedAt ?? '') || 0;
}

function sortedNewest(items) {
  return [...items].sort((first, second) => runTime(second) - runTime(first) || String(second.runId).localeCompare(String(first.runId)));
}

function latestTaskRuns(modelRuns) {
  return taskDefinitions.map(definition => sortedNewest(modelRuns.filter(run => run.taskId === definition.id))[0]).filter(Boolean);
}

function aggregateValue(runs, getter) {
  if (runs.length !== taskDefinitions.length) return null;
  const values = runs.map(getter);
  return values.every(value => typeof value === 'number' && Number.isFinite(value))
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

function modelSummary(model, selectedRuns) {
  const newest = sortedNewest(selectedRuns)[0];
  const cohortCount = new Set(selectedRuns.map(run => run.cohortId)).size;
  return `<section class="model-summary" data-model-id="${text(model.modelId)}">
    <div class="summary-identity"><span class="summary-kicker">MODEL</span><strong>${text(model.modelId)}</strong><span class="summary-kicker">RESULT SET</span><strong>各課題の最新run</strong><small>${selectedRuns.length} / ${taskDefinitions.length} task records · ${cohortCount} cohort</small></div>
    <dl class="summary-metrics">
      ${metric('4run合計トークン', formatNumber(aggregateValue(selectedRuns, run => run.usage?.total?.totalTokens)))}
      ${metric('4run合計サブエージェント', formatNumber(aggregateValue(selectedRuns, run => run.agents?.spawned)))}
      ${metric('実行日時', formatDate(newest?.execution?.startedAt ?? newest?.execution?.endedAt))}
      ${metric('4run合計時間', formatDuration(aggregateValue(selectedRuns, run => run.execution?.durationMs)))}
    </dl>
    ${cohortCount > 1 ? '<p class="cohort-warning">デバッグ修正を反映するためcohortが混在しています。各カードに採用cohortを併記しています。</p>' : ''}
    <p class="candidate-note">候補snapshotは正式判定に使用しません。</p>
  </section>`;
}

function statusLabel(run) {
  return run?.runKind === 'debug' ? 'DEBUG・判定不能' : run?.status ?? '判定不能';
}

function statusBadge(run) {
  if (run.demo === true || run.isDemo === true) return '<span class="badge demo-badge">DEMO</span>';
  const status = statusLabel(run);
  const className = run.runKind === 'debug' ? 'debug-badge' : `status-${String(run.status ?? 'inconclusive').replace(/[^a-z0-9-]/gi, '-')}`;
  return `<span class="badge ${className}" data-primary-status="${text(status)}">${text(status)}</span>`;
}

function visualContract(definition, run) {
  if (!definition.visualVersion) return '';
  const actual = run.versions?.prompt;
  if (actual !== definition.visualVersion) {
    return `<p class="visual-contract visual-contract-old"><strong>旧ビジュアル契約のrun</strong> · ${text(actual)}。抽象的な宝石・記号表現を許していたため、現在の「見慣れた見た目」評価には採用しません。</p>`;
  }
  return '<p class="visual-contract"><strong>視覚評価対象</strong> · 実行ボタンで、課題名から想像する見た目と操作を確認できます。</p>';
}

function previousAttempts(items, primary) {
  const previous = sortedNewest(items).filter(run => run !== primary);
  if (!previous.length) return '';
  return `<details class="attempts"><summary>過去試行 ${previous.length}件</summary><ul>${previous.map(run => `<li><span><strong class="legacy-note">旧評価方式・再演未検証</strong><br>${formatDate(run.execution?.startedAt ?? run.execution?.endedAt)} · cohort ${text(run.cohortId)} · ${text(run.versions?.prompt)} · ${text(statusLabel(run))}</span><button type="button" data-run-index="${runs.indexOf(run)}">記録</button></li>`).join('')}</ul></details>`;
}

function isLegacyRun(definition, run) {
  return run.legacy === true || run.evaluation?.legacy === true
    || (definition.promptVersion && run.versions?.prompt && run.versions.prompt !== definition.promptVersion);
}

function legacyRunNotice(definition, run) {
  return isLegacyRun(definition, run)
    ? '<p class="legacy-note legacy-warning"><strong>旧評価方式・再演未検証</strong> · このrunの評価方式は現行cohortと比較できません。</p>'
    : '';
}

function taskResult(definition, cohortRuns, allModelRuns) {
  const attempts = allModelRuns.filter(run => run.taskId === definition.id);
  const run = sortedNewest(cohortRuns.filter(item => item.taskId === definition.id))[0];
  const promptLabel = run && definition.promptVersion && run.versions?.prompt !== definition.promptVersion ? '修正版prompt' : '完成版prompt';
  if (!run) {
    return `<article class="task-result task-missing" id="task-${definition.id}"><header class="task-heading"><p>${definition.number}</p><div><h2>${definition.title}</h2><span>${definition.summary}</span></div><div class="task-heading-meta"><a href="./prompts/${definition.id}.prompt.html">完成版prompt ↗</a><div class="primary-verdict"><span>正式判定</span><span class="badge">欠損 · 判定不能</span></div></div></header><p class="showcase-empty">このモデルの実行結果がありません。</p></article>`;
  }
  return `<article class="task-result" id="task-${definition.id}">
    <header class="task-heading"><p>${definition.number}</p><div><h2>${definition.title}</h2><span>${definition.summary}</span></div><div class="task-heading-meta"><a href="./prompts/${definition.id}.prompt.html">${promptLabel} ↗</a><small>cohort: ${text(run.cohortId)}</small><div class="primary-verdict"><span>正式判定</span>${statusBadge(run)}</div></div></header>
    ${showcaseMarkup(run, true)}
    ${evaluationSummary(run)}
    ${legacyRunNotice(definition, run)}
    <details class="task-details"><summary>詳細・過去試行</summary>
      ${visualContract(definition, run)}${artifactGallery(run)}
      <div class="record-actions"><span>run: ${text(run.runId)}</span><button class="detail-button" type="button" data-run-index="${runs.indexOf(run)}">usage・ハッシュ・評価記録</button></div>
      ${previousAttempts(attempts, run)}
    </details>
  </article>`;
}

function bindResultActions() {
  results.querySelectorAll('[data-run-index]').forEach(button => button.addEventListener('click', () => openDetail(runs[Number(button.dataset.runIndex)])));
  bindShowcaseButtons(results);
}

function mountModelShowcases() {
  results.querySelectorAll('[data-showcase-container]').forEach(container => {
    const run = runs[Number(container.dataset.showcaseIndex)];
    if (run) mountShowcase(run, container);
  });
}

function renderModelPage(modelId) {
  const modelRuns = runs.filter(run => run.model?.modelId === modelId && run.demo !== true && run.isDemo !== true);
  if (!modelRuns.length) {
    results.innerHTML = `<div class="error">モデル「${text(modelId)}」の結果が見つかりません。</div>`;
    return;
  }
  const selectedRuns = latestTaskRuns(modelRuns);
  const model = sortedNewest(modelRuns)[0].model;
  document.body.classList.add('model-page');
  pageNav.hidden = false;
  pageTitle.innerHTML = `${text(model.displayName)}<span>の4課題。</span>`;
  pageLede.textContent = '各課題の最新runを表示。実演を先に、正式判定と副評価をあわせて確認できます。';
  results.className = 'model-results';
  results.innerHTML = `${modelSummary(model, selectedRuns)}<section class="task-grid" aria-label="4課題">${taskDefinitions.map(definition => taskResult(definition, selectedRuns, modelRuns)).join('')}</section>`;
  bindResultActions();
  mountModelShowcases();
}

function renderModelIndex() {
  const models = new Map();
  for (const run of runs) {
    if (run.demo === true || run.isDemo === true || !run.model?.modelId) continue;
    if (!models.has(run.model.modelId)) models.set(run.model.modelId, []);
    models.get(run.model.modelId).push(run);
  }
  const entries = [...models.values()].sort((first, second) => String(first[0].model.displayName).localeCompare(String(second[0].model.displayName)));
  pageTitle.innerHTML = '評価と実演を、<span>モデルごとに。</span>';
  pageLede.textContent = 'カードを選ぶと、そのモデルの日本語・ぷよぷよ風ゲーム・3×3キューブ・ロボットアームを1ページで追えます。';
  results.className = 'model-index';
  results.innerHTML = entries.map(items => {
    const taskRuns = latestTaskRuns(items);
    const newest = sortedNewest(taskRuns)[0] ?? sortedNewest(items)[0];
    const cohortCount = new Set(taskRuns.map(run => run.cohortId)).size;
    const completedTasks = new Set(taskRuns.map(run => run.taskId)).size;
    const visibleTasks = new Set(taskRuns.filter(run => ['live', 'chat'].includes(showcaseKind(run))).map(run => run.taskId)).size;
    return `<a class="model-card" href="${text(newest.model.pageUrl)}"><p class="model-card-kicker">MODEL</p><h2>${text(newest.model.displayName)}</h2><p>${text(newest.model.modelId)}</p><dl><div><dt>収録課題</dt><dd>${completedTasks} / 4</dd></div><div><dt>結果表示</dt><dd>${visibleTasks} / 4</dd></div><div><dt>使用cohort</dt><dd>${cohortCount}</dd></div></dl><strong>4課題をまとめて見る →</strong></a>`;
  }).join('') || '<div class="empty">まだモデルの結果がありません。</div>';
}

function detailList(entries) {
  return `<dl class="detail-list">${entries.map(([key, value]) => `<div><dt>${escapeHtml(label(key))}</dt><dd>${typeof value === 'string' ? text(value) : text(JSON.stringify(value))}</dd></div>`).join('')}</dl>`;
}

function usageSection(name, bucket) {
  if (bucket === null || bucket === undefined) return `<h3>${escapeHtml(name)}</h3><p class="raw">取得不能</p>`;
  return `<h3>${escapeHtml(name)}</h3>${detailList([
    ['inputTokens', formatNumber(bucket.inputTokens)], ['outputTokens', formatNumber(bucket.outputTokens)],
    ['cachedTokens', formatNumber(bucket.cachedTokens)], ['reasoningTokens', formatNumber(bucket.reasoningTokens)],
    ['totalTokens', formatNumber(bucket.totalTokens)], ['cost', formatCost(bucket)], ['currency', bucket.currency], ['costStatus', bucket.costStatus],
  ])}`;
}

function rawSection(name, value) {
  const content = value === null || value === undefined ? '取得不能' : JSON.stringify(value, null, 2);
  return `<h3>${escapeHtml(name)}</h3><pre class="raw">${escapeHtml(content)}</pre>`;
}

function showcaseActions(taskId) {
  return {
    'color-cascade-18': { prepare: ['reset'], run: ['runChallenge'], label: '18連鎖を実行' },
    'prism-twist': { prepare: ['reset', 'scramble'], run: ['play'], label: 'キューブを解く' },
    'robot-arm-sort': { prepare: ['reset'], run: ['run'], label: '自動仕分けを実行' },
  }[taskId] ?? null;
}

function isCurrentShowcase(session) {
  return !session.cancelled && showcaseSessions.get(session.container) === session;
}

function releaseShowcaseVisibility(session) {
  session.visibilityObserver?.disconnect();
  session.visibilityObserver = null;
  const resolve = session.visibilityResolve;
  session.visibilityResolve = null;
  resolve?.();
}

function waitForShowcaseVisibility(session) {
  if (!('IntersectionObserver' in window)) return Promise.resolve();
  return new Promise(resolve => {
    session.visibilityResolve = resolve;
    session.visibilityObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) releaseShowcaseVisibility(session);
    });
    session.visibilityObserver.observe(session.visual);
  });
}

function releaseShowcaseBridge(session, error) {
  clearTimeout(session.readyTimer);
  releaseShowcaseVisibility(session);
  if (error) session.readyReject?.(error);
  session.readyResolve = null;
  session.readyReject = null;
  for (const pending of session.pending.values()) {
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
  }
  session.pending.clear();
  if (session.onMessage) window.removeEventListener('message', session.onMessage);
  session.onMessage = null;
}

function cancelShowcase(session) {
  if (!session || session.cancelled) return;
  session.cancelled = true;
  releaseShowcaseBridge(session, new Error('showcase replay superseded'));
  session.frame.remove();
  if (showcaseSessions.get(session.container) === session) showcaseSessions.delete(session.container);
  if (activeShowcase === session) activeShowcase = null;
}

function bindShowcaseButtons(root) {
  root.querySelectorAll('[data-showcase-run-index]').forEach(button => {
    button.addEventListener('click', () => {
      const run = runs[Number(button.dataset.showcaseRunIndex)];
      const container = button.closest('[data-showcase-container]');
      if (run && container) playShowcase(run, container);
    });
  });
}

function mountShowcase(run, container, mode = 'initial') {
  const plan = showcaseActions(run.taskId);
  const visual = container.querySelector('[data-showcase-visual]');
  const status = container.querySelector('.showcase-status');
  const button = container.querySelector('.showcase-button');
  if (!plan || !visual || !status || !button) return null;

  cancelShowcase(showcaseSessions.get(container));
  const frame = document.createElement('iframe');
  frame.className = 'showcase-frame';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = `${run.model?.displayName ?? 'モデル'} ${plan.label}の実動ショーケース`;
  const session = {
    run, plan, mode, frame, visual, button, container, status,
    cancelled: false, finished: false, nonce: null, pending: new Map(), readyReject: null, onMessage: null,
    visibilityObserver: null, visibilityResolve: null,
  };
  showcaseSessions.set(container, session);
  if (mode === 'execute') activeShowcase = session;
  button.disabled = true;
  button.textContent = plan.label;
  status.textContent = mode === 'execute' ? '準備して実行中…' : '準備中…';

  void (async () => {
    try {
      const url = run.showcase?.url;
      const expectedPrefix = `./showcases/${encodeURIComponent(run.runId)}/`;
      if (typeof url !== 'string' || !url.startsWith(expectedPrefix)) throw new Error('ショーケースを読み込めません');
      const requestedUrl = new URL(url, document.baseURI);
      if (requestedUrl.origin !== location.origin) throw new Error('ショーケースの配信元が不正です');
      const response = await fetch(requestedUrl.href, { cache: 'no-store' });
      if (!response.ok) throw new Error(`showcase HTTP ${response.status}`);
      const responseUrl = new URL(response.url);
      if (responseUrl.origin !== requestedUrl.origin || responseUrl.pathname !== requestedUrl.pathname) {
        throw new Error('ショーケースのredirectを拒否しました');
      }
      const source = await response.text();
      if (!isCurrentShowcase(session)) return;
      const marker = showcaseMarker;
      if (!source.includes(marker)) throw new Error('showcase security metadata is missing');
      const assetRoot = new URL('.', responseUrl).href;
      const ready = new Promise((resolve, reject) => {
        session.readyResolve = resolve;
        session.readyReject = reject;
        session.readyTimer = setTimeout(() => reject(new Error('bridge timeout')), 8000);
      });
      const send = (action, args = []) => new Promise((resolve, reject) => {
        if (!isCurrentShowcase(session)) {
          reject(new Error('showcase replay superseded'));
          return;
        }
        const requestId = `showcase-${++requestSerial}`;
        const timer = setTimeout(() => {
          session.pending.delete(requestId);
          reject(new Error(`${action} timeout`));
        }, 60_000);
        session.pending.set(requestId, { resolve, reject, timer });
        frame.contentWindow.postMessage({
          protocol: 'LIGHTBENCH-1', nonce: session.nonce, taskId: run.taskId, type: 'command', requestId, action, args,
        }, '*');
      });
      session.onMessage = event => {
        if (event.source !== frame.contentWindow) return;
        const data = event.data;
        if (!data || data.protocol !== 'LIGHTBENCH-1' || data.taskId !== run.taskId) return;
        if (data.type === 'ready' && typeof data.nonce === 'string') {
          session.nonce = data.nonce;
          clearTimeout(session.readyTimer);
          const resolveReady = session.readyResolve;
          session.readyResolve = null;
          session.readyReject = null;
          resolveReady?.();
          return;
        }
        if (data.type !== 'response' || data.nonce !== session.nonce) return;
        const pending = session.pending.get(data.requestId);
        if (!pending) return;
        session.pending.delete(data.requestId);
        clearTimeout(pending.timer);
        if (data.ok) pending.resolve(data.value);
        else pending.reject(new Error(data.error || 'showcase action failed'));
      };
      window.addEventListener('message', session.onMessage);
      visual.replaceChildren(frame);
      frame.srcdoc = source.replaceAll(marker, assetRoot);
      await ready;
      if (!isCurrentShowcase(session)) return;
      if (mode === 'initial') await waitForShowcaseVisibility(session);
      if (!isCurrentShowcase(session)) return;
      for (const action of plan.prepare) await send(action);
      if (!isCurrentShowcase(session)) return;
      if (mode === 'initial') {
        button.disabled = false;
        status.textContent = '準備完了';
        releaseShowcaseBridge(session);
        return;
      }
      button.textContent = '停止する';
      status.textContent = '実行中…';
      for (const action of plan.run) await send(action);
      if (!isCurrentShowcase(session)) return;
      session.finished = true;
      activeShowcase = null;
      button.disabled = false;
      button.textContent = plan.label;
      status.textContent = '実行完了';
      releaseShowcaseBridge(session);
    } catch (error) {
      if (!isCurrentShowcase(session)) return;
      session.finished = true;
      if (activeShowcase === session) activeShowcase = null;
      button.disabled = false;
      button.textContent = plan.label;
      status.textContent = `再生失敗：${error.message}`;
      releaseShowcaseBridge(session);
    }
  })();
  return session;
}

function stopShowcase() {
  const session = activeShowcase;
  if (!session) return;
  cancelShowcase(session);
  mountShowcase(session.run, session.container);
}

function playShowcase(run, container) {
  const current = showcaseSessions.get(container);
  if (activeShowcase === current && !current.finished) {
    stopShowcase();
    return;
  }
  if (activeShowcase) stopShowcase();
  mountShowcase(run, container, 'execute');
}

function openDetail(run) {
  if (!run) return;
  const title = `${run.model?.displayName ?? 'モデル'} / ${run.runId}`;
  const detailShowcase = showcaseKind(run) === 'chat' ? showcaseMarkup(run, true) : '';
  detailContent.innerHTML = `<h2 id="detail-title">${text(title)}</h2>${demoMessage(run)}${detailShowcase}${evaluationSummary(run)}${artifactGallery(run)}
    ${detailList([['runId', run.runId], ['cohortId', run.cohortId], ['taskId', run.taskId], ['runKind', run.runKind], ['status', statusLabel(run)]])}
    <h3>モデル</h3>${detailList(Object.entries(run.model ?? {}).map(([key, value]) => [key, value]))}
    <h3>実行</h3>${detailList(Object.entries(run.execution ?? {}).map(([key, value]) => [key, key.endsWith('At') ? formatDate(value) : key === 'durationMs' ? formatDuration(value) : value]))}
    <h3>使用量</h3>${usageSection('ルート', run.usage?.root)}${usageSection('サブエージェント', run.usage?.subagents)}${usageSection('合計', run.usage?.total)}
    <h3>エージェント</h3>${detailList(Object.entries(run.agents ?? {}).filter(([key]) => key !== 'items').map(([key, value]) => [key, value]))}${run.agents?.items === null ? '<p class="raw">内訳: 取得不能</p>' : (run.agents?.items ?? []).map((item, index) => `<div class="raw agent-item">#${index + 1}\n${escapeHtml(JSON.stringify(item, null, 2))}</div>`).join('') || '<p class="raw">内訳なし</p>'}
    ${rawSection('介入', run.interventions)}${rawSection('バージョン', run.versions)}${rawSection('ハッシュ', run.hashes)}${rawSection('評価', run.evaluation)}`;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

closeButton.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

fetch('./data/runs.json')
  .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then(data => {
    if (!Array.isArray(data)) throw new Error('runs.json must contain an array');
    runs = data;
    const modelId = document.body.dataset.modelId;
    if (modelId) renderModelPage(modelId);
    else renderModelIndex();
  })
  .catch(error => {
    results.innerHTML = `<div class="error">結果を読み込めませんでした。<br><small>${text(error.message)}</small></div>`;
  });
