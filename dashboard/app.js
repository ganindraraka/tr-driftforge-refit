// Token Radar · page logic
//
// The page is a thin renderer over one dataset (window.RADAR, written by main.ts
// into ../data.js). It never recomputes a rank or a value: the model already did
// that, and the board, the filters and the dossier all read the same numbers.
// Everything here is presentation — sorting, filtering, and the detail dialog.

(() => {
  'use strict';

  const data = window.RADAR;
  const byId = (id) => document.getElementById(id);

  // No dataset means the generator was not run; say so instead of rendering empty.
  if (!data) {
    byId('count').textContent = 'Data missing: run main.ts to generate data.js.';
    return;
  }

  // ---- formatters -----------------------------------------------------------

  // Compact USD, e.g. $739.4M. An unreported figure reads "Unreported", never $0.
  const money = (n) =>
    n == null ? 'Unreported' : '$' + new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

  // Signed percent with one decimal; unreported reads "Unreported".
  const pct = (n) => (n == null ? 'Unreported' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%');

  // A small element builder: tag, optional text, optional class.
  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }

  // ---- state ----------------------------------------------------------------

  // Deep-link state lives in the URL hash so a filtered or opened view survives reload.
  const params = new URLSearchParams(location.hash.slice(1));
  let sortKey = 'implied_value_usd';
  let sortDir = -1;
  let lastOpener = null;

  // Columns whose natural first click is ascending (text and rank); the rest descend.
  const ascendingFirst = ['name', 'category', 'chains', 'rank', 'hint'];

  // ---- static chrome --------------------------------------------------------

  function fillSelect(id, values, allLabel) {
    const select = byId(id);
    select.append(new Option(allLabel, ''));
    [...new Set(values)].sort().forEach((v) => select.append(new Option(v, v)));
  }

  function buildStats() {
    const figures = [
      [data.watchlist_size + '/' + data.watchlist_size, 'Watchlist covered'],
      [data.board_size, 'Protocols ranked'],
      [data.early_size, 'Below the floor'],
      [data.live_size, 'Token references, separate'],
    ];
    for (const [num, label] of figures) {
      const stat = el('div', null, 'stat');
      stat.append(el('strong', num, 'num'), el('span', label));
      byId('stats').append(stat);
    }
  }

  function buildFormula() {
    const m = data.model;
    byId('formula').textContent =
      `Implied = TVL × ${m.base_multiple} × G × M   |   G = 1 + ${m.growth_weight} tanh(7d% / ${m.growth_cap})   |   M = ${m.maturity_floor} + age / (age + ${m.maturity_days})`;
    const note = el('small', 'G ranges 0.5–1.5×; M rises from 0.5× toward 1.5×. Missing growth uses 1×; missing listing age uses 365 days (1×). Age is whole days from listed_at to the snapshot date.');
    byId('formula').after(note);
  }

  // ---- row helpers ----------------------------------------------------------

  // The farm-route hint shown in the board: the first action of the plan, minus its cost.
  function hint(row) {
    return row.farm_steps ? row.farm_steps[1].split(' Cost:')[0] : 'Token already recorded';
  }

  // The comparable value of a cell for sorting.
  function cellValue(row, key) {
    if (key === 'chains') return row.chains.join(', ');
    if (key === 'category') return row.category || 'Other';
    if (key === 'hint') return hint(row);
    return row[key];
  }

  // ---- the board ------------------------------------------------------------

  function render() {
    const live = byId('universe').value === 'live';
    const source = live ? data.live : data.rows;

    // Apply the three filters: category, chain, and free text over name/slug/category/chains.
    const q = byId('q').value.trim().toLowerCase();
    const category = byId('category').value;
    const chain = byId('chain').value;
    const list = source.filter((r) =>
      (!category || (r.category || 'Other') === category) &&
      (!chain || r.chains.includes(chain)) &&
      [r.name, r.slug, r.category, ...r.chains].join(' ').toLowerCase().includes(q));

    // Sort on the active column; nulls always sink to the bottom; ties break by slug.
    list.sort((a, b) => {
      const av = cellValue(a, sortKey);
      const bv = cellValue(b, sortKey);
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return cmp * sortDir || a.slug.localeCompare(b.slug);
    });

    // Mirror the filters (and any open protocol) into the hash without a navigation.
    const hash = new URLSearchParams();
    ['q', 'category', 'chain', 'universe'].forEach((id) => { if (byId(id).value) hash.set(id, byId(id).value); });
    if (byId('detail').open) hash.set('p', params.get('p') || '');
    history.replaceState(null, '', '#' + hash);

    byId('count').textContent = `${list.length} / ${source.length} shown`;
    byId('board-title').textContent = live ? 'Token recorded · market references' : 'Ranked field · no token recorded';

    const cols = live
      ? [['name', 'Protocol'], ['category', 'Category'], ['chains', 'Chains'], ['tvl_usd', 'TVL'], ['change_7d', '7d'], ['mcap_usd', 'Market cap']]
      : [['rank', '#'], ['name', 'Protocol'], ['category', 'Category'], ['chains', 'Chains'], ['tvl_usd', 'TVL'], ['change_7d', '7d'], ['age_days', 'Days¹'], ['implied_value_usd', 'Implied USD'], ['hint', 'Farm route']];

    renderHead(cols);
    renderBody(list, cols);
    byId('empty').hidden = list.length > 0;
    document.querySelector('caption').textContent = live
      ? 'Token recorded: these market caps are separate from the pre-token ranking.'
      : '¹ Days since listing while no token is recorded at snapshot time. Click a row for score reasons and a numbered farm plan.';
  }

  function renderHead(cols) {
    const head = byId('head');
    head.replaceChildren();
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
    head.append(tr);
  }

  function renderBody(list, cols) {
    const body = byId('rows');
    body.replaceChildren();
    for (const row of list) {
      const tr = el('tr');
      tr.tabIndex = 0;
      tr.setAttribute('aria-label', 'Open ' + row.name + ' details');
      tr.onclick = () => openDetail(row, tr);
      tr.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(row, tr); }
      };
      for (const [key] of cols) tr.append(cell(row, key));
      body.append(tr);
    }
  }

  // One table cell, formatted and classed by its column.
  function cell(row, key) {
    let value = cellValue(row, key);
    let cls = '';
    if (['tvl_usd', 'implied_value_usd', 'mcap_usd'].includes(key)) {
      value = money(value);
      cls = 'num' + (key === 'implied_value_usd' ? ' value' : '');
    } else if (key === 'change_7d') {
      value = pct(value);
      cls = 'num ' + (row.change_7d == null ? '' : row.change_7d >= 0 ? 'pos' : 'neg');
    } else if (key === 'age_days') {
      value = value == null ? 'Unknown' : value.toLocaleString();
      cls = 'num';
    } else {
      cls = key === 'rank' ? 'num' : key === 'name' ? 'protocol' : key;
    }
    const td = el('td', value, cls);
    if (key === 'name') td.append(el('small', row.slug));
    if (key === 'hint') {
      td.title = value;
      td.textContent = value.length > 92 ? value.slice(0, 89) + '…' : value;
    }
    return td;
  }

  // ---- the dossier dialog ---------------------------------------------------

  function openDetail(row, from) {
    lastOpener = from;
    params.set('p', row.slug);
    const m = data.model;
    const box = byId('detail-body');
    box.replaceChildren();

    box.append(el('h2', row.name));
    const sub = el('p', (row.category || 'Other') + ' · ' + (row.chains.join(', ') || 'Chain unreported'));
    sub.id = 'detail-title';
    box.append(sub);
    box.append(el('div', money(row.implied_value_usd ?? row.mcap_usd), 'detail-value'));
    box.append(el('small', row.rank ? 'Rank #' + row.rank + ' · implied value, USD · no token recorded' : 'Market cap, USD · token recorded'));

    // Why this score: the model's own reasons, then the exact factors.
    if (row.reasons) {
      const section = el('section', null, 'section');
      section.append(el('h3', 'Why this score'));
      const ul = el('ul', null, 'reasons');
      row.reasons.forEach((s) => ul.append(el('li', s)));
      section.append(ul, el('small', `TVL × ${m.base_multiple} × growth ${row.growth_multiplier} × maturity ${row.maturity_multiplier}. Displayed factors rounded to four decimals; valuation uses full precision.`));
      box.append(section);
    }

    // The numbered farm plan, each step split into its action and its cost/time.
    if (row.farm_steps) {
      const section = el('section', null, 'section');
      section.append(
        el('h3', 'Farm plan / costs & time'),
        el('small', 'Suggested workflow, subject to current app support and eligibility. Gas and fees are planning estimates; capital remains exposed. No points eligibility is inferred from the snapshot.'));
      const ol = el('ol');
      row.farm_steps.forEach((s) => {
        const [action, cost] = s.split(' Cost: ');
        const li = el('li', action);
        if (cost) li.append(el('span', 'Cost: ' + cost, 'cost'));
        ol.append(li);
      });
      section.append(ol);
      box.append(section);
    }

    // The raw snapshot figures behind the score, plus the full record for auditing.
    const section = el('section', null, 'section');
    section.append(el('h3', 'Snapshot figures'));
    const dl = el('dl');
    const figures = [
      ['TVL, exact USD', row.tvl_usd.toLocaleString('en')],
      ['Seven-day change', row.change_7d == null ? 'null / neutral' : row.change_7d + '%'],
      ['Listed at', row.listed_at ?? 'Unreported'],
      ['Days since listing', row.age_days ?? 'Unreported'],
      ['Snapshot date', data.as_of],
    ];
    figures.forEach(([k, v]) => dl.append(el('dt', k), el('dd', String(v), 'num')));
    section.append(dl);
    const raw = el('details');
    raw.append(el('summary', 'Raw record & source'), el('pre', JSON.stringify({ source: data.source, ...row }, null, 2)));
    section.append(raw);
    box.append(section);

    if (!byId('detail').open) byId('detail').showModal();
    history.replaceState(null, '', location.hash.replace(/&?p=[^&]*/, '') + '&p=' + encodeURIComponent(row.slug));
  }

  // ---- wiring ---------------------------------------------------------------

  function init() {
    byId('stamp').textContent = data.as_of + ' / SEALED SNAPSHOT';
    buildStats();
    buildFormula();

    const every = data.rows.concat(data.live);
    fillSelect('category', every.map((r) => r.category || 'Other'), 'All categories');
    fillSelect('chain', every.flatMap((r) => r.chains), 'All chains');

    // Restore any deep-linked filters, then re-render on every change.
    ['q', 'category', 'chain', 'universe'].forEach((id) => {
      if (params.has(id)) byId(id).value = params.get(id);
      byId(id).addEventListener(id === 'q' ? 'input' : 'change', render);
    });

    byId('close').onclick = () => byId('detail').close();
    byId('detail').addEventListener('close', () => {
      params.delete('p');
      render();
      if (lastOpener?.isConnected) lastOpener.focus();
    });
    byId('reset').onclick = () => {
      ['q', 'category', 'chain'].forEach((id) => { byId(id).value = ''; });
      render();
    };

    render();

    // Open a deep-linked protocol, if the hash names one.
    const selected = every.find((r) => r.slug === params.get('p'));
    if (selected) openDetail(selected);
  }

  init();
})();