(() => {
  'use strict';
  const D = window.RADAR, $ = id => document.getElementById(id);
  if (!D) { $('count').textContent = 'Data missing: run main.ts to generate data.js.'; return; }
  const money = n => n == null ? 'Unreported' : '$' + new Intl.NumberFormat('en', {notation:'compact',maximumFractionDigits:1}).format(n);
  const pct = n => n == null ? 'Unreported' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  const params = new URLSearchParams(location.hash.slice(1));
  let sort = 'implied_value_usd', dir = -1, opener;
  function node(tag, text, cls) { const e = document.createElement(tag); if(text != null) e.textContent = text; if(cls) e.className = cls; return e; }
  function options(id, values, label) { $(id).append(new Option(label,'')); [...new Set(values)].sort().forEach(v => $(id).append(new Option(v,v))); }
  options('category',D.rows.concat(D.live).map(r=>r.category || 'Other'),'All categories');
  options('chain',D.rows.concat(D.live).flatMap(r=>r.chains),'All chains');
  ['q','category','chain','universe'].forEach(id=>{ if(params.has(id)) $(id).value=params.get(id); $(id).addEventListener(id==='q'?'input':'change',render); });
  $('stamp').textContent = D.as_of + ' / SEALED SNAPSHOT';
  [[D.watchlist_size+'/'+D.watchlist_size,'Watchlist covered'],[D.board_size,'Protocols ranked'],[D.early_size,'Below the floor'],[D.live_size,'Token references, separate']].forEach(([n,t])=>{const e=node('div',null,'stat');e.append(node('strong',n,'num'),node('span',t));$('stats').append(e);});
  const m=D.model;
  $('formula').textContent=`Implied = TVL × ${m.base_multiple} × G × M   |   G = 1 + ${m.growth_weight} tanh(7d% / ${m.growth_cap})   |   M = ${m.maturity_floor} + age / (age + ${m.maturity_days})`;
  const note=node('small','G ranges 0.5–1.5×; M rises from 0.5× toward 1.5×. Missing growth uses 1×; missing listing age uses 365 days (1×). Age is whole days from listed_at to the snapshot date.'); $('formula').after(note);
  function hint(r) { return r.farm_steps ? r.farm_steps[1].split(' Cost:')[0] : 'Token already recorded'; }
  function value(r,key) { if(key==='chains') return r.chains.join(', '); if(key==='category')return r.category||'Other'; if(key==='hint')return hint(r); return r[key]; }
  function render() {
    const live=$('universe').value==='live', source=live?D.live:D.rows;
    const q=$('q').value.trim().toLowerCase(), category=$('category').value, chain=$('chain').value;
    const list=source.filter(r=>(!category||(r.category||'Other')===category)&&(!chain||r.chains.includes(chain))&&[r.name,r.slug,r.category,...r.chains].join(' ').toLowerCase().includes(q));
    list.sort((a,b)=>{let av=value(a,sort),bv=value(b,sort);if(av==null)return bv==null?0:1;if(bv==null)return -1;return (typeof av==='string'?av.localeCompare(bv):av-bv)*dir || a.slug.localeCompare(b.slug);});
    const hash=new URLSearchParams(); ['q','category','chain','universe'].forEach(id=>{if($(id).value)hash.set(id,$(id).value);}); if($('detail').open)hash.set('p',params.get('p')||''); history.replaceState(null,'','#'+hash);
    $('count').textContent=`${list.length} / ${source.length} shown`;
    $('board-title').textContent=live?'Token recorded · market references':'Ranked field · no token recorded';
    const cols=live?[['name','Protocol'],['category','Category'],['chains','Chains'],['tvl_usd','TVL'],['change_7d','7d'],['mcap_usd','Market cap']]:[['rank','#'],['name','Protocol'],['category','Category'],['chains','Chains'],['tvl_usd','TVL'],['change_7d','7d'],['age_days','Days¹'],['implied_value_usd','Implied USD'],['hint','Farm route']];
    $('head').replaceChildren(); const hr=node('tr');cols.forEach(([key,label])=>{const th=node('th');th.scope='col';th.setAttribute('aria-sort',sort===key?(dir===1?'ascending':'descending'):'none');const b=node('button',label+(sort===key?(dir===1?' ↑':' ↓'):''));b.onclick=()=>{dir=sort===key?-dir:(['name','category','chains','rank','hint'].includes(key)?1:-1);sort=key;render();};th.append(b);hr.append(th);});$('head').append(hr);
    $('rows').replaceChildren();
    list.forEach(r=>{const tr=node('tr');tr.tabIndex=0;tr.setAttribute('aria-label','Open '+r.name+' details');tr.onclick=()=>open(r,tr);tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(r,tr);}};cols.forEach(([key])=>{let v=value(r,key),cls='';if(['tvl_usd','implied_value_usd','mcap_usd'].includes(key)){v=money(v);cls='num'+(key==='implied_value_usd'?' value':'');}else if(key==='change_7d'){v=pct(v);cls='num '+(r.change_7d==null?'':r.change_7d>=0?'pos':'neg');}else if(key==='age_days'){v=v==null?'Unknown':v.toLocaleString();cls='num';}else cls=key==='rank'?'num':key==='name'?'protocol':key;const td=node('td',v,cls);if(key==='name')td.append(node('small',r.slug));if(key==='hint'){td.title=v;td.textContent=v.length>92?v.slice(0,89)+'…':v;}tr.append(td);});$('rows').append(tr);});
    $('empty').hidden=list.length>0;
    document.querySelector('caption').textContent=live?'Token recorded: these market caps are separate from the pre-token ranking.':'¹ Days since listing while no token is recorded at snapshot time. Click a row for score reasons and a numbered farm plan.';
  }
  function open(r,from) {
    opener=from;params.set('p',r.slug);const box=$('detail-body');box.replaceChildren();box.append(node('h2',r.name));const sub=node('p',(r.category||'Other')+' · '+(r.chains.join(', ')||'Chain unreported'));sub.id='detail-title';box.append(sub);
    box.append(node('div',money(r.implied_value_usd??r.mcap_usd),'detail-value'));
    box.append(node('small',r.rank?'Rank #'+r.rank+' · implied value, USD · no token recorded':'Market cap, USD · token recorded'));
    if(r.reasons){const section=node('section',null,'section');section.append(node('h3','Why this score'));const ul=node('ul',null,'reasons');r.reasons.forEach(s=>ul.append(node('li',s)));section.append(ul,node('small',`TVL × ${m.base_multiple} × growth ${r.growth_multiplier} × maturity ${r.maturity_multiplier}. Displayed factors rounded to four decimals; valuation uses full precision.`));box.append(section);}
    if(r.farm_steps){const section=node('section',null,'section');section.append(node('h3','Farm plan / costs & time'),node('small','Suggested workflow, subject to current app support and eligibility. Gas and fees are planning estimates; capital remains exposed. No points eligibility is inferred from the snapshot.'));const ol=node('ol');r.farm_steps.forEach(s=>{const [action,cost]=s.split(' Cost: ');const li=node('li',action);if(cost)li.append(node('span','Cost: '+cost,'cost'));ol.append(li);});section.append(ol);box.append(section);}
    const section=node('section',null,'section');section.append(node('h3','Snapshot figures'));const dl=node('dl');[['TVL, exact USD',r.tvl_usd.toLocaleString('en')],['Seven-day change',r.change_7d==null?'null / neutral':r.change_7d+'%'],['Listed at',r.listed_at??'Unreported'],['Days since listing',r.age_days??'Unreported'],['Snapshot date',D.as_of]].forEach(([k,v])=>dl.append(node('dt',k),node('dd',String(v),'num')));section.append(dl);const raw=node('details');raw.append(node('summary','Raw record & source'),node('pre',JSON.stringify({source:D.source,...r},null,2)));section.append(raw);box.append(section);
    if(!$('detail').open)$('detail').showModal();history.replaceState(null,'',location.hash.replace(/&?p=[^&]*/,'')+'&p='+encodeURIComponent(r.slug));
  }
  $('close').onclick=()=>$('detail').close();$('detail').addEventListener('close',()=>{params.delete('p');render();if(opener?.isConnected)opener.focus();});
  $('reset').onclick=()=>{['q','category','chain'].forEach(id=>$(id).value='');render();};
  render();const selected=D.rows.concat(D.live).find(r=>r.slug===params.get('p'));if(selected)open(selected);
})();
