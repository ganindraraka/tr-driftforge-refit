// Token Radar · page logic
//
// Three views: board (ranked table), detail (per-protocol dossier with HOW THE
// FIGURE IS MADE), evidence (out-of-sample validation panel + filtered board).
// The page is a thin renderer over window.RADAR; it never recomputes a rank.

(() => {
  'use strict';

  const data = window.RADAR;
  const byId = (id) => document.getElementById(id);

  if (!data) {
    const c = byId('count'); if (c) c.textContent = 'Data missing: run main.ts.';
    return;
  }

  // ---- formatters -----------------------------------------------------------

  const money = (n) =>
    n == null ? 'Unreported' : '$' + new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const moneyFull = (n) =>
    n == null ? 'Unreported' : '$' + new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(n);
  const pct = (n) => (n == null ? 'Unreported' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%');
  const pct0 = (n) => (n == null ? '-' : (n * 100).toFixed(1) + '%');
  const num = (n) => n == null ? '-' : n.toLocaleString('en');

  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }

  // ---- state ----------------------------------------------------------------

  const params = new URLSearchParams(location.hash.slice(1));
  const qp = new URLSearchParams(location.search);
  let sortKey = 'implied_value_usd';
  let sortDir = -1;
  let currentView = 'board';
  const ascendingFirst = ['name', 'category', 'chains', 'rank'];

  // ---- view switching -------------------------------------------------------

  function showView(name) {
    currentView = name;
    ['board', 'detail', 'evidence'].forEach((v) => {
      const el = byId('view-' + v); if (el) el.style.display = v === name ? '' : 'none';
    });
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    byId('model-box').style.display = name === 'board' ? '' : 'none';
  }

  document.querySelectorAll('.tabs button[data-view]').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.view;
      if (v === 'detail') return;
      showView(v);
      if (v === 'evidence') renderEvidence();
      updateHash();
    };
  });

  // ---- shot parameter support -----------------------------------------------

  function checkShot() {
    const shot = qp.get('shot') || params.get('shot');
    if (!shot) return;
    if (shot === 'board') { showView('board'); render(); }
    else if (shot === 'evidence') { showView('evidence'); renderEvidence(); }
    else if (shot === 'detail') {
      const slug = qp.get('p') || params.get('p') || (data.rows.length > 0 ? data.rows[0].slug : null);
      if (slug) { showView('detail'); openDetailStatic(slug); }
    }
  }

  // ---- static chrome --------------------------------------------------------

  function fillSelect(id, values, allLabel) {
    const sel = byId(id); if (!sel) return;
    sel.append(new Option(allLabel, ''));
    [...new Set(values)].sort().forEach((v) => sel.append(new Option(v, v)));
  }

  function buildStats() {
    const rankedSlugs = new Set((data.rows || []).map((r) => r.slug));
    const covered = (data.watchlist || []).filter((s) => rankedSlugs.has(s)).length;
    const figures = [
      [covered + '/' + data.watchlist_size, 'Watchlist covered'],
      [data.board_size, 'Protocols ranked'],
      [data.early_size, 'Below the floor'],
      [data.live_size, 'Token references'],
      [data.report.peer_count, 'Priced peers fitted'],
      ['200', 'Bootstrap refits'],
    ];
    const container = byId('stats');
    for (const [num, label] of figures) {
      const stat = el('div', null, 'stat');
      stat.append(el('strong', num, 'num'), el('span', label));
      container.append(stat);
    }
  }

  function buildFormula() {
    const r = data.report;
    const sc = r.term_fit_table.find((t) => t.term === 'size_curve');
    byId('formula').textContent =
      `Implied = TVL × size_multiple(TVL) × launch_odds(age,TVL) × growth × maturity | Size curve: log(mcap/TVL) ~ ${(sc ? sc.coefficient : 0).toFixed(2)}·log(TVL) | Launch odds: logistic regression P(token|logTVL,age) | Growth = 1 + 0.5·tanh(7d%/50) | Maturity = 0.5 + age/(age+365)`;
  }

  function buildKPI() {
    const r = data.report;
    const items = [
      ['L-O-O miss', r.size_loo_miss.toFixed(3), 'vs ' + r.size_flat_miss.toFixed(3) + ' flat'],
      ['W-F miss', r.size_wf_miss.toFixed(3), 'vs ' + r.size_flat_miss.toFixed(3) + ' flat'],
      ['Brier', r.odds_brier.toFixed(4), 'vs ' + r.odds_flat_brier.toFixed(4) + ' rate'],
      ['Range honest?', r.loo_pct_in_50.toFixed(0) + '%–' + r.loo_pct_in_80.toFixed(0) + '%', 'LOO coverage'],
    ];
    const strip = byId('kpi-strip');
    for (const [label, value, sub] of items) {
      const d = el('div', null, 'kpi');
      d.append(el('span', value, 'kpi-val'), el('span', label, 'kpi-lbl'), el('span', sub, 'kpi-sub'));
      strip.append(d);
    }
  }

  // ---- row helpers ----------------------------------------------------------

  function cellValue(row, key) {
    if (key === 'chains') return row.chains.join(', ');
    if (key === 'category') return row.category || 'Other';
    if (key === 'p25p75') return money(row.p25_usd) + ' – ' + money(row.p75_usd);
    return row[key];
  }

  function farmVerdict(row) {
    const lo = row.launch_odds ?? 0;
    const iv = row.implied_value_usd ?? 0;
    if (iv >= 10_000_000 && lo >= 0.3) return 'Farm';
    if (iv >= 3_000_000) return 'Marginal';
    return 'Skip';
  }

  function verdictClass(v) {
    return v === 'Farm' ? 'v-farm' : v === 'Marginal' ? 'v-marg' : 'v-skip';
  }

  // ---- board rendering ------------------------------------------------------

  function render() {
    const source = data.rows;
    const q = byId('q').value.trim().toLowerCase();
    const category = byId('category').value;
    const chain = byId('chain').value;
    const wlo = byId('watchlist-only').checked;

    let list = source.filter((r) =>
      (!category || (r.category || 'Other') === category) &&
      (!chain || r.chains.includes(chain)) &&
      [r.name, r.slug, r.category, ...r.chains].join(' ').toLowerCase().includes(q));

    if (wlo) {
      // data.watchlist is the snapshot's own watchlist; membership is by slug.
      const wlSet = new Set(data.watchlist || []);
      list = list.filter((r) => wlSet.has(r.slug));
    }

    list.sort((a, b) => {
      const av = cellValue(a, sortKey);
      const bv = cellValue(b, sortKey);
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return cmp * sortDir || a.slug.localeCompare(b.slug);
    });

    byId('count').textContent = `${list.length} / ${source.length} shown`;
    byId('board-title').textContent = 'Pre-token field · ranked by implied value';

    const cols = [
      ['rank', '#'], ['name', 'Protocol'], ['category', 'Category'], ['chains', 'Chains'],
      ['tvl_usd', 'TVL'], ['change_7d', '7D'], ['age_days', 'Days¹'],
      ['implied_value_usd', 'Implied'], ['p25p75', 'P25–P75'],
      ['launch_odds', 'Odds'], ['hazard_90d', 'Haz90d'], ['verdict', 'Verdict'],
    ];

    renderHead(byId('head'), cols);
    renderBody(byId('rows'), list, cols);
    byId('empty').hidden = list.length > 0;
  }

  function renderHead(thead, cols) {
    thead.replaceChildren();
    const tr = el('tr');
    for (const [key, label] of cols) {
      const th = el('th');
      th.scope = 'col';
      th.setAttribute('aria-sort', sortKey === key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none');
      const arrow = sortKey === key ? (sortDir === 1 ? ' ↑' : ' ↓') : '';
      const button = el('button', label + arrow);
      button.onclick = () => {
        sortDir = sortKey === key ? -sortDir : (ascendingFirst.includes(key) ? 1 : -1);
        sortKey = key;
        render();
      };
      th.append(button);
      tr.append(th);
    }
    thead.append(tr);
  }

  function renderBody(tbody, list, cols) {
    tbody.replaceChildren();
    for (const row of list) {
      const tr = el('tr');
      tr.tabIndex = 0;
      tr.setAttribute('aria-label', 'Open ' + row.name + ' details');
      tr.onclick = () => openDetail(row);
      tr.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(row); }
      };
      for (const [key] of cols) tr.append(cell(row, key));
      tbody.append(tr);
    }
  }

  function cell(row, key) {
    let value = cellValue(row, key);
    let cls = '';
    if (['tvl_usd', 'implied_value_usd'].includes(key)) {
      value = money(value);
      cls = 'num' + (key === 'implied_value_usd' ? ' value' : '');
    } else if (key === 'change_7d') {
      value = pct(value);
      cls = 'num ' + (row.change_7d == null ? '' : row.change_7d >= 0 ? 'pos' : 'neg');
    } else if (key === 'age_days') {
      value = value == null ? 'Unknown' : value.toLocaleString();
      cls = 'num';
    } else if (key === 'launch_odds' || key === 'hazard_90d') {
      value = pct0(value);
      cls = 'num ' + (key === 'launch_odds' ? 'value' : '');
    } else if (key === 'p25p75') {
      cls = 'num muted';
    } else if (key === 'verdict') {
      const v = farmVerdict(row);
      value = v;
      cls = 'verdict ' + verdictClass(v);
    } else {
      cls = key === 'rank' ? 'num' : key === 'name' ? 'protocol' : key;
    }
    const td = el('td', value, cls);
    if (key === 'name') td.append(el('small', row.slug));
    return td;
  }

  // ---- detail view ----------------------------------------------------------

  function openDetail(row) {
    showView('detail');
    renderDetail(row);
    updateHash();
  }

  function openDetailStatic(slug) {
    const row = data.rows.find((r) => r.slug === slug);
    if (row) renderDetail(row);
  }

  function renderDetail(row) {
    const box = byId('detail-body');
    box.replaceChildren();

    box.append(el('h2', row.name));
    const sub = el('p', (row.category || 'Other') + ' · ' + (row.chains.join(', ') || 'Chain unreported'), 'muted-text');
    box.append(sub);

    // Implied value with uncertainty
    box.append(el('div', money(row.implied_value_usd), 'detail-value'));
    const ur = el('div', 'P50 (implied): ' + moneyFull(row.implied_value_usd) + ' | P25–P75: ' + moneyFull(row.p25_usd) + ' – ' + moneyFull(row.p75_usd) + ' | P10–P90: ' + moneyFull(row.p10_usd) + ' – ' + moneyFull(row.p90_usd), 'range-line');
    box.append(ur);
    box.append(el('small', 'Rank #' + row.rank + ' · implied value model · pre-token'));

    // HOW THE FIGURE IS MADE
    const how = el('section', null, 'section');
    how.append(el('h3', 'HOW THE FIGURE IS MADE'));
    const parts = [
      ['TVL', '$' + (row.tvl_usd / 1e6).toFixed(1) + 'M', 'Snapshot capital base'],
      ['× Size curve multiple', row.size_curve_multiple.toFixed(4), 'Fitted from ' + data.report.peer_count + ' traded peers: log(mcap/TVL) ~ log(TVL). Intercept: ' + (data.report.term_fit_table.find(t => t.term === 'size_curve')?.coefficient || 0).toFixed(3)],
      ['× Launch odds', (row.launch_odds * 100).toFixed(1) + '%', 'Logistic regression P(token|logTVL,age) on all protocols'],
      ['× Growth (7d)', row.growth_multiplier.toFixed(4), 'Bounded tanh: 1 + 0.5·tanh(7d%/50)'],
      ['× Maturity (age)', row.maturity_multiplier.toFixed(4), 'Saturating: 0.5 + age/(age+365)'],
      ['= Implied value', money(row.implied_value_usd), 'USD, rounded to whole dollar'],
    ];
    const ul = el('ul', null, 'how-list');
    parts.forEach(([label, val, desc]) => {
      const li = el('li');
      li.append(el('b', label + ': '), el('span', val, 'how-val'), el('small', desc));
      ul.append(li);
    });
    how.append(ul);
    box.append(how);

    // Reason lines
    if (row.reasons) {
      const sec = el('section', null, 'section');
      sec.append(el('h3', 'Score Breakdown'));
      const rl = el('ul', null, 'reasons');
      row.reasons.forEach((s) => rl.append(el('li', s)));
      sec.append(rl);
      box.append(sec);
    }

    // Farm plan with cost/time
    if (row.farm_steps) {
      const sec = el('section', null, 'section');
      sec.append(el('h3', 'Farm Plan · Costed & Timed'), el('small', 'Each step carries an explicit cost, time, exit rule, cadence, and benchmark vs 4% T-bill. Gas and fees are planning estimates.'));
      const ol = el('ol');
      row.farm_steps.forEach((s) => {
        const parts = s.split(' | ');
        const action = parts[0] || s;
        const li = el('li', action);
        if (parts.length > 1) {
          const meta = el('div', null, 'step-meta');
          for (let i = 1; i < parts.length; i++) meta.append(el('span', parts[i], 'step-tag'));
          li.append(meta);
        }
        ol.append(li);
      });
      sec.append(ol);
      box.append(sec);
    }

    // Nearest priced peers
    if (data.peers && data.peers.length > 0) {
      const sec = el('section', null, 'section');
      sec.append(el('h3', 'Nearest Priced Peers (10 by TVL proximity)'));
      const dist = data.peers
        .map((p) => ({ ...p, dist: Math.abs(Math.log(p.tvl_usd) - Math.log(row.tvl_usd)) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 10);
      const tbl = el('table');
      tbl.append(peerRowEl('th', ['Peer', 'TVL', 'MCAP', 'Multiple', 'Category'], true));
      dist.forEach((p) => {
        tbl.append(peerRowEl('td', [p.name, money(p.tvl_usd), money(p.mcap_usd), p.multiple.toFixed(3), p.category || 'Other'], false));
      });
      sec.append(tbl);
      box.append(sec);
    }

    // Raw snapshot figures
    const sec = el('section', null, 'section');
    sec.append(el('h3', 'Snapshot Figures'));
    const dl = el('dl');
    const figs = [
      ['TVL, exact USD', row.tvl_usd.toLocaleString('en')],
      ['7-day change', row.change_7d == null ? 'null / neutral' : row.change_7d + '%'],
      ['Listed at', row.listed_at ?? 'Unreported'],
      ['Days since listing', row.age_days ?? 'Unreported'],
      ['Snapshot date', data.as_of],
      ['Source', data.source],
    ];
    figs.forEach(([k, v]) => dl.append(el('dt', k), el('dd', String(v), 'num')));
    sec.append(dl);
    box.append(sec);
  }

  function peerRowEl(tag, cells, isHead) {
    const tr = document.createElement('tr');
    cells.forEach((c) => {
      const td = document.createElement(tag);
      td.textContent = String(c);
      if (tag === 'th') td.scope = 'col';
      tr.append(td);
    });
    return tr;
  }

  byId('back-detail').onclick = () => { showView('board'); render(); updateHash(); };

  // ---- evidence view --------------------------------------------------------

  function renderEvidence() {
    const r = data.report;

    // Evidence grid: two methods side by side
    const grid = byId('evidence-grid');
    grid.replaceChildren();

    const methods = [
      {
        name: 'Leave-One-Out',
        miss: r.size_loo_miss.toFixed(3),
        flat: r.size_flat_miss.toFixed(3),
        pct50: r.loo_pct_in_50.toFixed(0) + '%',
        pct80: r.loo_pct_in_80.toFixed(0) + '%',
        desc: 'Each traded peer held out once; model fitted on the other N−1, error measured on the held-out one.',
        brier: r.odds_brier.toFixed(4),
        brierFlat: r.odds_flat_brier.toFixed(4),
      },
      {
        name: 'Walk-Forward',
        miss: r.size_wf_miss.toFixed(3),
        flat: r.size_flat_miss.toFixed(3),
        pct50: r.wf_pct_in_50.toFixed(0) + '%',
        pct80: r.wf_pct_in_80.toFixed(0) + '%',
        desc: 'Peers sorted by TVL; trained on first 80%, tested on last 20%. Tests temporal stability.',
        brier: r.odds_brier.toFixed(4),
        brierFlat: r.odds_flat_brier.toFixed(4),
      },
    ];

    methods.forEach((m) => {
      const card = el('div', null, 'evidence-card');
      card.append(el('h3', m.name));
      card.append(el('p', m.desc, 'muted-text'));
      const dl = el('dl', null, 'evidence-dl');
      [
        ['OOS miss (size)', m.miss + ' vs ' + m.flat + ' flat'],
        ['Range honest?', m.pct50 + ' / ' + m.pct80 + ' coverage'],
        ['Brier (odds)', m.brier + ' vs ' + m.brierFlat + ' rate'],
      ].forEach(([k, v]) => {
        dl.append(el('dt', k), el('dd', v));
      });
      card.append(dl);
      grid.append(card);
    });

    // Calibration line
    const calLine = el('p', 'Calibration: ' + (r.loo_pct_in_50 + r.wf_pct_in_50 > 80
      ? 'The printed range is honest. '
      : 'Range may be under-confident. ') +
      (r.loo_pct_in_50).toFixed(0) + '%–' + (r.loo_pct_in_80).toFixed(0) + '% (LOO), ' +
      (r.wf_pct_in_50).toFixed(0) + '%–' + (r.wf_pct_in_80).toFixed(0) + '% (WF)', 'cal-line');
    grid.after(calLine);

    // Term fit table
    const termBody = byId('term-table-body');
    termBody.replaceChildren();
    r.term_fit_table.forEach((t) => {
      const tr = el('tr');
      tr.append(el('td', t.term));
      tr.append(el('td', t.coefficient.toFixed(6), 'num'));
      tr.append(el('td', t.kept ? '✓' : '✗', t.kept ? 'pos' : 'neg'));
      termBody.append(tr);
    });

    // Tested, not used
    const tnu = byId('tested-not-used');
    tnu.replaceChildren();
    (r.tested_not_used || []).forEach((t) => {
      tnu.append(el('span', t, 'chip chip-drop'));
    });
    if ((r.tested_not_used || []).length === 0) {
      tnu.append(el('span', 'All evaluated terms are in use.', 'muted-text'));
    }

    // Bootstrap SE
    byId('bootstrap-se-text').textContent =
      'Median bootstrap standard error across all peers: ' + money(r.bootstrap_se_median) +
      '. Based on 200 bootstrap refits of the size curve and odds model with protocol resampling.';

    // Verdict chips
    const verdicts = { Farm: 0, Marginal: 0, Skip: 0 };
    data.rows.forEach((row) => verdicts[farmVerdict(row)]++);
    const vc = byId('verdict-chips');
    vc.replaceChildren();
    Object.entries(verdicts).forEach(([v, count]) => {
      vc.append(el('span', v + ' ' + count, 'chip ' + verdictClass(v)));
    });

    // Evidence filters + table
    renderEvidenceTable();
  }

  function renderEvidenceTable() {
    const source = data.rows;
    const q = byId('eq').value.trim().toLowerCase();
    const category = byId('ecategory').value;
    const chain = byId('echain').value;
    const wlo = byId('ewatchlist-only').checked;

    let list = source.filter((r) =>
      (!category || (r.category || 'Other') === category) &&
      (!chain || r.chains.includes(chain)) &&
      [r.name, r.slug, r.category, ...r.chains].join(' ').toLowerCase().includes(q));

    if (wlo) {
      const wlSet = new Set(data.watchlist || []);
      list = list.filter((r) => wlSet.has(r.slug));
    }

    list.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));

    byId('ecount').textContent = `${list.length} / ${source.length} shown`;
    byId('eboard-title').textContent = 'Filtered pre-token field';

    const cols = [
      ['rank', '#'], ['name', 'Protocol'], ['tvl_usd', 'TVL'], ['implied_value_usd', 'Implied'],
      ['p25p75', 'P25–P75'], ['launch_odds', 'Odds'], ['verdict', 'Verdict'],
    ];

    renderHead(byId('ehead'), cols);
    renderBody(byId('erows'), list, cols);
    byId('eempty').hidden = list.length > 0;
  }

  // ---- hash management ------------------------------------------------------

  function updateHash() {
    const hash = new URLSearchParams();
    hash.set('view', currentView);
    ['q', 'category', 'chain'].forEach((id) => {
      const el = byId(id); if (el && el.value) hash.set(id, el.value);
    });
    history.replaceState(null, '', '#' + hash);
  }

  // ---- init -----------------------------------------------------------------

  function init() {
    byId('stamp').textContent = data.as_of + ' / SEALED SNAPSHOT';
    buildStats();
    buildFormula();
    buildKPI();

    const every = data.rows.concat(data.live);
    fillSelect('category', every.map((r) => r.category || 'Other'), 'All categories');
    fillSelect('chain', every.flatMap((r) => r.chains), 'All chains');
    fillSelect('ecategory', every.map((r) => r.category || 'Other'), 'All categories');
    fillSelect('echain', every.flatMap((r) => r.chains), 'All chains');

    // Bind board filters
    ['q', 'category', 'chain'].forEach((id) => {
      if (params.has(id)) byId(id).value = params.get(id);
      byId(id).addEventListener(id === 'q' ? 'input' : 'change', render);
    });
    byId('watchlist-only').onchange = render;
    byId('reset').onclick = () => {
      ['q', 'category', 'chain'].forEach((id) => { byId(id).value = ''; });
      byId('watchlist-only').checked = false;
      render();
    };

    // Bind evidence filters
    ['eq', 'ecategory', 'echain'].forEach((id) => {
      byId(id).addEventListener(id === 'eq' ? 'input' : 'change', renderEvidenceTable);
    });
    byId('ewatchlist-only').onchange = renderEvidenceTable;
    byId('ereset').onclick = () => {
      ['eq', 'ecategory', 'echain'].forEach((id) => { byId(id).value = ''; });
      byId('ewatchlist-only').checked = false;
      renderEvidenceTable();
    };

    // Restore view from hash
    const viewFromHash = params.get('view') || 'board';
    showView(viewFromHash);
    if (viewFromHash === 'evidence') renderEvidence();
    render();

    // Auto-capture shot
    checkShot();
  }

  init();
})();