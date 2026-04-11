const BASE = './public/';

Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = '#30363d';
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
Chart.defaults.font.size = 12;

async function load(file) {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
  return res.json();
}

function showError(msg) {
  const el = document.getElementById('error');
  el.style.display = 'block';
  el.textContent = msg;
}

function fmt(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

// ── Meta / stat cards ────────────────────────────────────────────────────────

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

async function renderAgents() {
  const agents = await load('agents.json');

  document.getElementById('stat-agents').textContent = agents.length;

  // Populate signal table in the methodology section
  const signalList = document.getElementById('signal-list');
  agents.forEach(a => {
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

  new Chart(document.getElementById('chart-agents'), {
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

// ── Adoption timeline (line chart) ───────────────────────────────────────────

async function renderTimeline() {
  const [timeline, agents] = await Promise.all([load('timeline.json'), load('agents.json')]);

  const months = [...new Set(timeline.map(d => d.month))].sort();

  // Build running cumulative totals per agent per month
  const cumulative = {};
  const datasets = agents.map(a => {
    cumulative[a.agent] = 0;
    return {
      label:       a.label,
      borderColor: a.color,
      backgroundColor: a.color + '22',
      fill: false,
      tension: 0.3,
      pointRadius: 2,
      data: months.map(m => {
        const entry = timeline.find(d => d.month === m && d.agent === a.agent);
        cumulative[a.agent] += entry ? entry.count : 0;
        return cumulative[a.agent];
      }),
    };
  }).filter(ds => ds.data.some(v => v > 0));

  new Chart(document.getElementById('chart-timeline'), {
    type: 'line',
    data: { labels: months, datasets },
    options: {
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, padding: 12 },
        },
      },
      scales: {
        x: { grid: { color: '#21262d' }, ticks: { maxTicksLimit: 8 } },
        y: { grid: { color: '#21262d' } },
      },
    },
  });
}

// ── Languages breakdown (grouped bar, top 10 languages) ──────────────────────

async function renderLanguages() {
  const [langData, agents] = await Promise.all([load('languages.json'), load('agents.json')]);

  // Total detections per language across all agents (for normalization)
  const langTotals = {};
  for (const row of langData) {
    langTotals[row.language] = (langTotals[row.language] || 0) + row.count;
  }

  // Top 10 languages by total raw count across all agents
  const topLangs = Object.entries(langTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([lang]) => lang);

  const datasets = agents.map(a => ({
    label:           a.label,
    backgroundColor: a.color + 'cc',
    borderColor:     a.color,
    borderWidth: 1,
    borderRadius: 3,
    data: topLangs.map(lang => {
      const row = langData.find(d => d.language === lang && d.agent === a.agent);
      if (!row || !langTotals[lang]) return 0;
      return Math.round(row.count / langTotals[lang] * 1000) / 10; // % of this language's detections
    }),
  })).filter(ds => ds.data.some(v => v > 0));

  new Chart(document.getElementById('chart-languages'), {
    type: 'bar',
    data: { labels: topLangs, datasets },
    options: {
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, padding: 12 },
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          type: 'logarithmic',
          grid: { color: '#21262d' },
          ticks: {
            callback: v => Number.isInteger(Math.log10(v)) ? v + '%' : '',
          },
        },
      },
    },
  });
}

// ── Language share by agent (top 10 languages as % of each agent's repos) ────

async function renderLanguagesByAgent() {
  const [langData, agents] = await Promise.all([load('languages.json'), load('agents.json')]);

  const agentTotals = Object.fromEntries(agents.map(a => [a.agent, a.count]));

  // Top 10 languages by total raw count across all agents
  const langTotals = {};
  for (const row of langData) {
    langTotals[row.language] = (langTotals[row.language] || 0) + row.count;
  }
  const topLangs = Object.entries(langTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([lang]) => lang);

  // One dataset per language, one bar group per agent
  const LANG_COLORS = [
    '#f97316','#a78bfa','#34d399','#fb7185','#38bdf8',
    '#fbbf24','#e879f9','#4ade80','#f43f5e','#60a5fa',
  ];
  const datasets = topLangs.map((lang, i) => ({
    label:           lang,
    backgroundColor: LANG_COLORS[i % LANG_COLORS.length] + 'cc',
    borderColor:     LANG_COLORS[i % LANG_COLORS.length],
    borderWidth: 1,
    borderRadius: 3,
    data: agents.map(a => {
      const row = langData.find(d => d.language === lang && d.agent === a.agent);
      if (!row || !agentTotals[a.agent]) return 0;
      return Math.round(row.count / agentTotals[a.agent] * 1000) / 10;
    }),
  })).filter(ds => ds.data.some(v => v > 0));

  new Chart(document.getElementById('chart-languages-by-agent'), {
    type: 'bar',
    data: { labels: agents.map(a => a.label), datasets },
    options: {
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, padding: 12 },
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          type: 'logarithmic',
          grid: { color: '#21262d' },
          ticks: {
            callback: v => Number.isInteger(Math.log10(v)) ? v + '%' : '',
          },
        },
      },
    },
  });
}

// ── Repository popularity by agent (stacked bar, star buckets) ───────────────

async function renderStars() {
  const [starsData, agents] = await Promise.all([load('stars.json'), load('agents.json')]);

  const BUCKETS = ['< 100', '100–1k', '1k–10k', '10k+'];

  // One dataset per agent, one bar group per star bucket
  const datasets = agents.map(a => ({
    label:           a.label,
    backgroundColor: a.color + 'cc',
    borderColor:     a.color,
    borderWidth: 1,
    borderRadius: 3,
    data: BUCKETS.map(bucket => {
      const row = starsData.find(d => d.agent === a.agent && d.bucket === bucket);
      return row ? row.count : 0;
    }),
  })).filter(ds => ds.data.some(v => v > 0));

  new Chart(document.getElementById('chart-stars'), {
    type: 'bar',
    data: { labels: BUCKETS, datasets },
    options: {
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, padding: 12 },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          type: 'logarithmic',
          grid: { color: '#21262d' },
          ticks: {
            callback: v => Number.isInteger(Math.log10(v)) ? v.toLocaleString() : '',
          },
        },
      },
    },
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

Promise.all([renderMeta(), renderAgents(), renderTimeline(), renderLanguages(), renderLanguagesByAgent(), renderStars()])
  .catch(err => showError(`Could not load data: ${err.message}. Run the scanner first.`));
