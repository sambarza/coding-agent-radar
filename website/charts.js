const BASE = './public/';

Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = '#30363d';
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
Chart.defaults.font.size = 12;

// ── Global data cache ─────────────────────────────────────────────────────────

let _agents   = [];
let _timeline = [];
let _langData = [];
let _starsData = [];
let _selected = new Set();      // agent keys currently visible
let _topLangs = [];             // top 10 languages (computed once)
let _selectedLangs = new Set(); // languages currently visible
const _charts = {};             // id → Chart instance

async function load(file) {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
  return res.json();
}

async function loadStarCount() {
  try {
    const res = await fetch('https://api.github.com/repos/sambarza/coding-agent-radar');
    if (!res.ok) return;
    const { stargazers_count } = await res.json();
    const el = document.getElementById('star-count');
    if (el) el.textContent = fmt(stargazers_count);
  } catch (_) {}
}

function showError(msg) {
  const el = document.getElementById('error');
  el.style.display = 'block';
  el.textContent = msg;
}

function fmt(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function visibleAgents() {
  return _agents.filter(a => _selected.has(a.agent));
}

function mkChart(id, config) {
  if (_charts[id]) { _charts[id].destroy(); }
  const old = document.getElementById(id);
  const fresh = document.createElement('canvas');
  fresh.id = id;
  if (old.hasAttribute('height')) fresh.setAttribute('height', old.getAttribute('height'));
  old.parentNode.replaceChild(fresh, old);
  _charts[id] = new Chart(fresh, config);
}

// ── Filter UI helpers ─────────────────────────────────────────────────────────

function buildFilter() {
  const container = document.getElementById('agent-filter');
  container.innerHTML = '';
  _agents.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'agent-toggle' + (_selected.has(a.agent) ? ' active' : '');
    btn.textContent = a.label;
    btn.style.setProperty('--agent-color', a.color);
    if (_selected.has(a.agent)) btn.style.borderColor = a.color;
    btn.addEventListener('click', () => {
      if (_selected.has(a.agent)) {
        if (_selected.size === 1) return;
        _selected.delete(a.agent);
      } else {
        _selected.add(a.agent);
      }
      buildFilter();
      renderCharts();
    });
    container.appendChild(btn);
  });
}

function buildLangFilter() {
  const container = document.getElementById('lang-filter');
  container.innerHTML = '';
  _topLangs.forEach(lang => {
    const btn = document.createElement('button');
    btn.className = 'agent-toggle' + (_selectedLangs.has(lang) ? ' active' : '');
    btn.textContent = lang;
    btn.style.setProperty('--agent-color', 'var(--accent)');
    if (_selectedLangs.has(lang)) btn.style.borderColor = 'var(--accent)';
    btn.addEventListener('click', () => {
      if (_selectedLangs.has(lang)) {
        if (_selectedLangs.size === 1) return;
        _selectedLangs.delete(lang);
      } else {
        _selectedLangs.add(lang);
      }
      buildLangFilter();
      renderLanguages();
      renderLanguagesByAgent();
    });
    container.appendChild(btn);
  });
}

// ── Meta / stat cards ─────────────────────────────────────────────────────────

async function renderMeta() {
  const meta = await load('scan_meta.json');
  document.getElementById('stat-total').textContent = fmt(meta.total_detections);
  document.getElementById('stat-last-repos').textContent = fmt(meta.repos_scanned_last_run);
  document.getElementById('stat-new').textContent = fmt(meta.new_detections_last_run);

  const date = meta.last_scan
    ? new Date(meta.last_scan).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : 'never';
  document.getElementById('meta-date').textContent = `Last scan: ${date}`;
}

// ── Agent distribution (horizontal bar) ──────────────────────────────────────

function renderAgentsChart() {
  const agents = visibleAgents();
  mkChart('chart-agents', {
    type: 'bar',
    data: {
      labels: agents.map(a => a.label),
      datasets: [{
        data:            agents.map(a => a.count),
        backgroundColor: agents.map(a => a.color + 'cc'),
        borderColor:     agents.map(a => a.color),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#21262d' } },
        y: { grid: { display: false } },
      },
    },
  });
}

// ── Adoption timeline (line chart) ────────────────────────────────────────────

function renderTimeline() {
  const agents = visibleAgents();
  const months = [...new Set(_timeline.map(d => d.month))].sort();

  const cumulative = {};
  const datasets = agents.map(a => {
    cumulative[a.agent] = 0;
    return {
      label:           a.label,
      borderColor:     a.color,
      backgroundColor: a.color + '22',
      fill: false,
      tension: 0.3,
      pointRadius: 2,
      data: months.map(m => {
        const entry = _timeline.find(d => d.month === m && d.agent === a.agent);
        cumulative[a.agent] += entry ? entry.count : 0;
        return cumulative[a.agent];
      }),
    };
  }).filter(ds => ds.data.some(v => v > 0));

  mkChart('chart-timeline', {
    type: 'line',
    data: { labels: months, datasets },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
      },
      scales: {
        x: { grid: { color: '#21262d' }, ticks: { maxTicksLimit: 8 } },
        y: { grid: { color: '#21262d' } },
      },
    },
  });
}

// ── Agent share by language ───────────────────────────────────────────────────

function renderLanguages() {
  const agents = visibleAgents();
  const langs = _topLangs.filter(l => _selectedLangs.has(l));

  // Recompute per-language totals restricted to visible agents
  const visibleLangTotals = {};
  for (const row of _langData) {
    if (!_selected.has(row.agent)) continue;
    visibleLangTotals[row.language] = (visibleLangTotals[row.language] || 0) + row.count;
  }

  const datasets = agents.map(a => ({
    label:           a.label,
    backgroundColor: a.color + 'cc',
    borderColor:     a.color,
    borderWidth: 1,
    borderRadius: 3,
    data: langs.map(lang => {
      const row = _langData.find(d => d.language === lang && d.agent === a.agent);
      if (!row || !visibleLangTotals[lang]) return 0;
      return Math.round(row.count / visibleLangTotals[lang] * 1000) / 10;
    }),
  })).filter(ds => ds.data.some(v => v > 0));

  mkChart('chart-languages', {
    type: 'bar',
    data: { labels: langs, datasets },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` } },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          type: 'logarithmic',
          grid: { color: '#21262d' },
          ticks: { callback: v => Number.isInteger(Math.log10(v)) ? v + '%' : '' },
        },
      },
    },
  });
}

// ── Language share by agent ───────────────────────────────────────────────────

function renderLanguagesByAgent() {
  const agents = visibleAgents();
  const agentTotals = Object.fromEntries(agents.map(a => [a.agent, a.count]));
  const langs = _topLangs.filter(l => _selectedLangs.has(l));

  const LANG_COLORS = [
    '#f97316','#a78bfa','#34d399','#fb7185','#38bdf8',
    '#fbbf24','#e879f9','#4ade80','#f43f5e','#60a5fa',
  ];
  const datasets = langs.map((lang, i) => ({
    label:           lang,
    backgroundColor: LANG_COLORS[i % LANG_COLORS.length] + 'cc',
    borderColor:     LANG_COLORS[i % LANG_COLORS.length],
    borderWidth: 1,
    borderRadius: 3,
    data: agents.map(a => {
      const row = _langData.find(d => d.language === lang && d.agent === a.agent);
      if (!row || !agentTotals[a.agent]) return 0;
      return Math.round(row.count / agentTotals[a.agent] * 1000) / 10;
    }),
  })).filter(ds => ds.data.some(v => v > 0));

  mkChart('chart-languages-by-agent', {
    type: 'bar',
    data: { labels: agents.map(a => a.label), datasets },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` } },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          type: 'logarithmic',
          grid: { color: '#21262d' },
          ticks: { callback: v => Number.isInteger(Math.log10(v)) ? v + '%' : '' },
        },
      },
    },
  });
}

// ── Repository popularity by agent ────────────────────────────────────────────

function renderStars() {
  const agents = visibleAgents();
  const BUCKETS = ['< 100', '100–1k', '1k–10k', '10k+'];

  const datasets = agents.map(a => ({
    label:           a.label,
    backgroundColor: a.color + 'cc',
    borderColor:     a.color,
    borderWidth: 1,
    borderRadius: 3,
    data: BUCKETS.map(bucket => {
      const row = _starsData.find(d => d.agent === a.agent && d.bucket === bucket);
      return row ? row.count : 0;
    }),
  })).filter(ds => ds.data.some(v => v > 0));

  mkChart('chart-stars', {
    type: 'bar',
    data: { labels: BUCKETS, datasets },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          type: 'logarithmic',
          grid: { color: '#21262d' },
          ticks: { callback: v => Number.isInteger(Math.log10(v)) ? v.toLocaleString() : '' },
        },
      },
    },
  });
}

// ── Render all charts ─────────────────────────────────────────────────────────

function renderCharts() {
  renderAgentsChart();
  renderTimeline();
  renderLanguages();
  renderLanguagesByAgent();
  renderStars();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  // Load all data in parallel
  [_agents, _timeline, _langData, _starsData] = await Promise.all([
    load('agents.json'), load('timeline.json'), load('languages.json'), load('stars.json'),
  ]);

  // Default: all agents and languages selected
  _selected = new Set(_agents.map(a => a.agent));

  const langTotals = {};
  for (const row of _langData) {
    langTotals[row.language] = (langTotals[row.language] || 0) + row.count;
  }
  _topLangs = Object.entries(langTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([lang]) => lang);
  _selectedLangs = new Set(_topLangs);

  document.getElementById('stat-agents').textContent = _agents.length;

  // Populate signal table
  const signalList = document.getElementById('signal-list');
  _agents.forEach(a => {
    if (!a.signals || a.signals.length === 0) return;
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.className = 'agent-name';
    tdName.textContent = a.label;
    const tdPills = document.createElement('td');
    const pillsWrapper = document.createElement('div');
    pillsWrapper.className = 'signal-pills';
    a.signals.forEach(sig => {
      const pill = document.createElement('span');
      pill.className = 'signal';
      pill.textContent = sig;
      pillsWrapper.appendChild(pill);
    });
    tdPills.appendChild(pillsWrapper);
    tr.appendChild(tdName);
    tr.appendChild(tdPills);
    signalList.appendChild(tr);
  });

  buildFilter();
  buildLangFilter();
  renderCharts();
}

Promise.all([renderMeta(), init()])
  .catch(err => showError(`Could not load data: ${err.message}. Run the scanner first.`));

loadStarCount();
