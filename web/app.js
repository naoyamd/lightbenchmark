const results = document.querySelector('#results');
const taskFilter = document.querySelector('#task-filter');
const statusFilter = document.querySelector('#status-filter');
const resultCount = document.querySelector('#result-count');
const dialog = document.querySelector('#detail-dialog');
const detailContent = document.querySelector('#detail-content');
const closeButton = document.querySelector('#dialog-close');
let runs = [];
let activeShowcase = null;
let requestSerial = 0;

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

function evaluationSummary(run) {
  if (run.evaluation === null || run.evaluation === undefined) return '';
  if (typeof run.evaluation !== 'object') return `<section class="evaluation-summary"><h3>独立評価</h3><p>${text(run.evaluation)}</p></section>`;
  let passes = [run.evaluation.headline, run.evaluation.logic, run.evaluation.robustness]
    .map(item => item?.pass).filter(value => typeof value === 'boolean');
  if (!passes.length && run.evaluation.deterministicChecks) {
    passes = Object.values(run.evaluation.deterministicChecks)
      .map(item => item?.pass ?? item?.formatPass).filter(value => typeof value === 'boolean');
  }
  const verdict = passes.length && passes.every(Boolean) ? '成功'
    : passes.some(Boolean) ? '部分達成'
      : passes.length ? '失敗' : '判定不能';
  const reason = run.evaluation.headline?.reason;
  return `<section class="evaluation-summary"><h3>独立評価</h3><p><strong>${verdict}</strong> · ${text(run.evaluation.status ?? '記録あり')}${reason ? `<br>${text(reason)}` : ''}</p></section>`;
}

function showcaseMarkup(run, compact = false) {
  const showcase = run.showcase;
  if (!showcase) return showcaseMissing(run);
  if (showcaseKind(run) === 'chat') {
    const turns = Array.isArray(showcase.turns) ? showcase.turns : showcase.text === undefined ? [] : [{ label: 'チャット', text: showcase.text }];
    return `<section class="showcase chat-showcase${compact ? ' showcase-compact' : ''}"><h3>チャット</h3>${turns.map(turn => `<div class="chat-turn"><strong>${text(turn.label ?? 'チャット')}</strong><pre class="chat-transcript">${escapeHtml(typeof turn.text === 'string' ? turn.text : '取得不能')}</pre></div>`).join('') || '<p class="showcase-empty">取得不能</p>'}</section>`;
  }
  if (showcaseKind(run) !== 'live') return showcaseMissing(run);
  const index = runs.indexOf(run);
  return `<section class="showcase live-showcase${compact ? ' showcase-compact' : ''}" data-showcase-container>
    <button class="showcase-button" type="button" data-showcase-run-index="${index}">再演する</button>
    <span class="showcase-status">クリックで生成</span>
  </section>`;
}

function metric(labelText, value) {
  return `<div class="metric"><dt>${escapeHtml(labelText)}</dt><dd>${text(value)}</dd></div>`;
}

function choices(values, placeholder) {
  return `<option value="">${placeholder}</option>${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
}

function populateFilters() {
  const tasks = [...new Set(runs.map(run => run.taskId).filter(value => value !== null))].sort();
  const statuses = [...new Set(runs.map(run => run.status).filter(value => value !== null))].sort();
  taskFilter.innerHTML = choices(tasks, 'すべてのタスク');
  statusFilter.innerHTML = choices(statuses, 'すべてのステータス');
}

function renderCards() {
  const task = taskFilter.value;
  const status = statusFilter.value;
  const filtered = runs
    .filter(run => (!task || run.taskId === task) && (!status || run.status === status))
    .sort((first, second) => {
      const rank = run => run.demo === true || run.isDemo === true ? 0 : run.evaluation == null ? 2 : 1;
      return rank(first) - rank(second) || String(first.runId).localeCompare(String(second.runId));
    });
  resultCount.textContent = `${filtered.length} 件`;
  if (!filtered.length) {
    results.innerHTML = '<div class="empty"><strong>まだ結果がないみたい。</strong><br>フィルターをゆるめるか、新しい run を追加してみてね。</div>';
    return;
  }
  results.innerHTML = filtered.map(run => {
    const total = run.usage?.total;
    const demo = run.demo === true || run.isDemo === true;
    const debug = run.runKind === 'debug';
    const badge = demo ? '<span class="badge demo-badge">DEMO</span>'
        : debug ? '<span class="badge debug-badge">DEBUG · INCONCLUSIVE</span>'
        : `<span class="badge">${text(run.status)}</span>`;
    return `<article class="card">
      ${demoMessage(run)}
      ${showcaseMarkup(run, true)}
      ${evaluationSummary(run)}
      <div class="card-head"><div><h2>${text(run.model?.displayName)}</h2><p class="provider">${text(run.model?.provider)} · ${text(run.model?.modelId)}</p></div>${badge}</div>
      <p class="task-line">${text(run.taskId)} · ${formatDate(run.execution?.startedAt ?? run.execution?.endedAt)}</p>
      ${artifactGallery(run, true)}
      <dl class="metrics">
        ${metric('合計トークン', formatNumber(total?.totalTokens))}
        ${metric('サブエージェント', formatNumber(run.agents?.spawned))}
        ${metric('実行時間', formatDuration(run.execution?.durationMs))}
        ${metric('コスト', formatCost(total))}
      </dl>
      <button class="detail-button" type="button" data-run-index="${runs.indexOf(run)}">全内訳を見る →</button>
    </article>`;
  }).join('');
  results.querySelectorAll('[data-run-index]').forEach(button => button.addEventListener('click', () => openDetail(runs[Number(button.dataset.runIndex)])));
  bindShowcaseButtons(results);
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
    'color-cascade-18': ['reset', 'runChallenge'],
    'prism-twist': ['reset', 'scramble', 'play'],
    'lander-pop': ['reset', 'run'],
  }[taskId] ?? [];
}

function stopShowcase() {
  if (!activeShowcase) return;
  const session = activeShowcase;
  session.cancelled = true;
  clearTimeout(session.readyTimer);
  session.readyReject?.(new Error('showcase replay superseded'));
  for (const pending of session.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('showcase replay superseded'));
  }
  session.pending.clear();
  if (session.onMessage) window.removeEventListener('message', session.onMessage);
  session.frame.remove();
  session.button.textContent = '再演する';
  if (!session.finished) session.status.textContent = '停止しました';
  activeShowcase = null;
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

function playShowcase(run, container) {
  if (activeShowcase?.container === container && !activeShowcase.finished) {
    stopShowcase();
    return;
  }
  stopShowcase();
  const url = run.showcase?.url;
  const expectedPrefix = `./showcases/${encodeURIComponent(run.runId)}/`;
  if (typeof url !== 'string' || !url.startsWith(expectedPrefix)) {
    container.querySelector('.showcase-status').textContent = 'ショーケースを読み込めません';
    return;
  }
  const actions = showcaseActions(run.taskId);
  if (!actions.length) {
    container.querySelector('.showcase-status').textContent = 'このタスクはライブ非対応';
    return;
  }
  const frame = document.createElement('iframe');
  frame.className = 'showcase-frame';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = `${run.taskId} live showcase`;
  const status = container.querySelector('.showcase-status');
  const button = container.querySelector('.showcase-button');
  const session = { frame, button, container, status, cancelled: false, finished: false, nonce: null, pending: new Map(), readyReject: null, onMessage: null };
  activeShowcase = session;
  button.textContent = '停止する';
  status.textContent = '読み込み中…';

  const send = (action, args = []) => new Promise((resolve, reject) => {
    if (session.cancelled) {
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

  (async () => {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`showcase HTTP ${response.status}`);
      const source = await response.text();
      if (session.cancelled) return;
      const marker = '__LIGHTBENCH_ASSET_ROOT_9b41c8__';
      if (!source.includes(marker)) throw new Error('showcase security metadata is missing');
      const assetRoot = new URL('.', new URL(url, location.href)).href;
      const ready = new Promise((resolve, reject) => {
        session.readyResolve = resolve;
        session.readyReject = reject;
        session.readyTimer = setTimeout(() => reject(new Error('bridge timeout')), 8000);
      });
      session.onMessage = event => {
        if (event.source !== frame.contentWindow) return;
        const data = event.data;
        if (!data || data.protocol !== 'LIGHTBENCH-1' || data.taskId !== run.taskId) return;
        if (data.type === 'ready' && typeof data.nonce === 'string') {
          session.nonce = data.nonce;
          clearTimeout(session.readyTimer);
          session.readyResolve();
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
      frame.srcdoc = source.replaceAll(marker, assetRoot);
      container.append(frame);
      status.textContent = '再生中…';
      await ready;
      for (const action of actions) {
        if (session.cancelled) return;
        await send(action);
      }
      if (!session.cancelled) {
        session.finished = true;
        button.textContent = '再演する';
        status.textContent = '再生完了';
      }
    } catch (error) {
      if (!session.cancelled) {
        session.finished = true;
        button.textContent = '再演する';
        status.textContent = `再生失敗：${error.message}`;
      }
    }
  })();
}

function openDetail(run) {
  if (!run) return;
  const title = `${run.model?.displayName ?? 'モデル'} / ${run.runId}`;
  detailContent.innerHTML = `<h2 id="detail-title">${text(title)}</h2>${demoMessage(run)}${showcaseMarkup(run)}${evaluationSummary(run)}${artifactGallery(run)}
    ${detailList([['runId', run.runId], ['cohortId', run.cohortId], ['taskId', run.taskId], ['runKind', run.runKind], ['status', run.status]])}
    <h3>モデル</h3>${detailList(Object.entries(run.model ?? {}).map(([key, value]) => [key, value]))}
    <h3>実行</h3>${detailList(Object.entries(run.execution ?? {}).map(([key, value]) => [key, key.endsWith('At') ? formatDate(value) : key === 'durationMs' ? formatDuration(value) : value]))}
    <h3>使用量</h3>${usageSection('ルート', run.usage?.root)}${usageSection('サブエージェント', run.usage?.subagents)}${usageSection('合計', run.usage?.total)}
    <h3>エージェント</h3>${detailList(Object.entries(run.agents ?? {}).filter(([key]) => key !== 'items').map(([key, value]) => [key, value]))}${run.agents?.items === null ? '<p class="raw">内訳: 取得不能</p>' : (run.agents?.items ?? []).map((item, index) => `<div class="raw agent-item">#${index + 1}\n${escapeHtml(JSON.stringify(item, null, 2))}</div>`).join('') || '<p class="raw">内訳なし</p>'}
    ${rawSection('介入', run.interventions)}${rawSection('バージョン', run.versions)}${rawSection('ハッシュ', run.hashes)}${rawSection('評価', run.evaluation)}`;
  bindShowcaseButtons(detailContent);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

taskFilter.addEventListener('change', renderCards);
statusFilter.addEventListener('change', renderCards);
closeButton.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

fetch('./data/runs.json')
  .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then(data => {
    if (!Array.isArray(data)) throw new Error('runs.json must contain an array');
    runs = data;
    populateFilters();
    renderCards();
  })
  .catch(error => {
    resultCount.textContent = '';
    results.innerHTML = `<div class="error">結果を読み込めませんでした。<br><small>${text(error.message)}</small></div>`;
  });
