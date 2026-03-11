'use strict';
/* ============================================================
   LEGO MARKET v2 – Frontend Application
   Consumes /api/* endpoints from the Node.js server.
   ============================================================ */

const state = {
  currentSlide: 0,
  heroSlides:   [],
  slideTimer:   null,
  currentFranchise: 'all',
  currentSort:  'deal',
  currentQuery: '',
  currentPage:  1,
  totalLoaded:  0,
  searchDebounce: null,
  votes: {}, // setNum -> { up: bool, down: bool }
  franchiseMeta: {},
};

// ---- DOM refs ----
const $ = id => document.getElementById(id);

// ---- Utils ----
const fmt = n => {
  if (n == null) return '—';
  return parseFloat(n).toFixed(2).replace('.', ',') + ' €';
};
const saving = (orig, cur) => {
  if (!orig || !cur) return null;
  return ((orig - cur)).toFixed(2).replace('.', ',') + ' €';
};
const discountClass = d => {
  if (!d) return 'badge-cold';
  if (d <= -40) return 'badge-fire';
  if (d <= -25) return 'badge-great';
  if (d <= -15) return 'badge-good';
  return 'badge-cold';
};
const discountMClass = d => {
  if (!d) return 'badge-cold';
  if (d <= -40) return 'badge-fire';
  if (d <= -25) return 'badge-great';
  return 'badge-good';
};
const marqueeClass = d => {
  if (!d) return 'good';
  if (d <= -40) return 'fire';
  if (d <= -25) return 'great';
  return 'good';
};

function showToast(msg, duration = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ---- API ----
async function api(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.data ?? json;
  } catch (err) {
    console.warn('[API]', path, err.message);
    return null;
  }
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  // Load franchise meta first (needed for chip labels)
  const meta = await api('/api/franchise-meta');
  if (meta) state.franchiseMeta = meta;

  // Kick off parallel loads
  await Promise.all([
    loadStats(),
    loadSpotlight(),
    loadFranchises(),
    loadDeals(true),
  ]);

  // Hero needs spotlight data
  buildHero();
  buildMarquee();

  // UI bindings
  setupSearch();
  setupFilters();
  setupHeroControls();
  setupRefresh();
  setupScroll();
  setupStickyFilterBar();
});

// ---- Stats bar ----
async function loadStats() {
  const stats = await api('/api/stats');
  if (!stats) return;
  $('stat-sets').textContent = `${stats.totalSets} sets`;
  $('stat-deals').textContent = `${stats.totalDeals} deals`;
  if (stats.bestDeal) {
    $('stat-best').textContent = `Best: ${stats.bestDeal.discount_pct}% off – ${stats.bestDeal.name}`;
  }
}

// ---- Spotlight ----
let spotlight = [];
async function loadSpotlight() {
  const data = await api('/api/spotlight');
  const grid = $('spotlight-grid');
  if (!data || data.length === 0) {
    if (grid) grid.innerHTML = '<p style="color:var(--text-muted);font-size:.875rem">No spotlight deals yet. Try refreshing data.</p>';
    return;
  }
  spotlight = data;
  if (grid) {
    grid.innerHTML = '';
    data.forEach((s, i) => {
      const card = buildCard(s, true);
      card.style.animationDelay = `${i * 0.07}s`;
      grid.appendChild(card);
    });
  }
}

// ---- Hero ----
function buildHero() {
  const track   = $('hero-track');
  const dotsEl  = $('hero-dots');
  if (!track || !dotsEl) return;

  // Use spotlight deals as hero slides (up to 5), or fallback messages
  const slides = spotlight.slice(0, 5);
  if (!slides.length) {
    track.innerHTML = `
      <div class="hero-slide active">
        <div class="hero-slide-bg" style="background-image:linear-gradient(135deg,#271507,#4D2E18)"></div>
        <div class="hero-slide-vignette"></div>
        <div class="hero-slide-content">
          <div class="hero-info">
            <div class="hero-eyebrow"><span class="material-symbols-rounded" style="font-size:1.1em; margin-right:6px">toys</span> Welcome</div>
            <h2 class="hero-title">Finding your next Lego deal…</h2>
            <p class="hero-sub">Data loads on first startup. Please wait a moment.</p>
          </div>
        </div>
      </div>
    `;
    return;
  }

  state.heroSlides = slides;
  track.innerHTML  = '';
  dotsEl.innerHTML = '';

  slides.forEach((s, i) => {
    // Slide
    const slide = document.createElement('div');
    slide.className = 'hero-slide' + (i === 0 ? ' active' : '');
    slide.dataset.setNum = s.set_num;

    const bgStyle = s.img_url
      ? `url('${s.img_url}') center 20% / cover`
      : 'linear-gradient(135deg, #271507, #4D2E18)';

    slide.innerHTML = `
      <div class="hero-slide-bg" style="background:${bgStyle}"></div>
      <div class="hero-slide-vignette"></div>
      <div class="hero-slide-content">
        <div class="hero-info">
          <div class="hero-eyebrow">
            ${state.franchiseMeta[s.franchise]?.icon ? `<span class="material-symbols-rounded" style="font-size:1.1em; margin-right:4px">${state.franchiseMeta[s.franchise].icon}</span>` : ''} 
            ${s.theme_name || s.franchise || 'LEGO'} &nbsp;·&nbsp; Set #${s.set_num}
          </div>
          <h2 class="hero-title">${s.name}</h2>
          <p class="hero-sub">${s.num_parts ? `${s.num_parts.toLocaleString()} pieces` : ''}</p>
        </div>
        <div class="hero-pricing">
          <div class="hero-discount-chip">${s.discount_pct}%</div>
          <div class="hero-price-current">${fmt(s.price)}</div>
          <div class="hero-price-original">${fmt(s.original_price)}</div>
        </div>
      </div>
    `;
    slide.addEventListener('click', () => goToSet(s.set_num));
    track.appendChild(slide);

    // Dot
    const dot = document.createElement('button');
    dot.className = 'hero-dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Slide ${i + 1}: ${s.name}`);
    dot.addEventListener('click', () => goToSlide(i));
    dotsEl.appendChild(dot);
  });

  startHeroTimer();
}

function goToSlide(idx) {
  const slides = document.querySelectorAll('.hero-slide');
  const dots   = document.querySelectorAll('.hero-dot');
  if (!slides.length) return;
  state.currentSlide = (idx + slides.length) % slides.length;

  document.querySelector(`[${'hero-track'}]`)?.style; // noop
  const track = $('hero-track');
  if (track) track.style.transform = `translateX(-${state.currentSlide * 100}%)`;

  slides.forEach((s, i) => s.classList.toggle('active', i === state.currentSlide));
  dots.forEach((d, i) => d.classList.toggle('active', i === state.currentSlide));
  restartHeroTimer();
}
function startHeroTimer() {
  state.slideTimer = setInterval(() => goToSlide(state.currentSlide + 1), 5500);
}
function restartHeroTimer() {
  clearInterval(state.slideTimer);
  startHeroTimer();
}
function setupHeroControls() {
  $('hero-prev')?.addEventListener('click', () => goToSlide(state.currentSlide - 1));
  $('hero-next')?.addEventListener('click', () => goToSlide(state.currentSlide + 1));
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') goToSlide(state.currentSlide + 1);
    if (e.key === 'ArrowLeft')  goToSlide(state.currentSlide - 1);
  });
}

// ---- Marquee ----
async function buildMarquee() {
  const track = $('marquee-track');
  if (!track) return;
  const data = await api('/api/deals?sort=deal&page=1');
  const items = data ? data.slice(0, 14) : [];
  if (!items.length) { track.innerHTML = '<span class="marquee-item">Loading deals…</span>'; return; }

  const html = [...items, ...items].map(s => `
    <span class="marquee-item" data-set="${s.set_num}" tabindex="0" role="button">
      <span class="m-disc ${marqueeClass(s.discount_pct)}">${s.discount_pct ?? '?'}%</span>
      ${s.name}
      <span class="m-price">${fmt(s.price)}</span>
    </span>
  `).join('');
  track.innerHTML = html;
  track.querySelectorAll('.marquee-item').forEach(el => {
    el.addEventListener('click', () => goToSet(el.dataset.set));
  });
}

// ---- Franchises ----
async function loadFranchises() {
  const data = await api('/api/franchises');
  const container = $('franchise-container');
  if (!container) return;
  if (!data || !data.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:.875rem">No franchise data yet. Data loads in the background on first startup.</p>';
    return;
  }
  container.innerHTML = '';

  // Build filter chips from franchises + populate footer
  const chips = $('filter-chips');
  const footerLinks = $('footer-franchise-links');

  data.slice(0, 10).forEach(f => {
    // Add filter chip
    if (chips) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.dataset.franchise = f.franchise;
      chip.innerHTML = `${f.icon ? `<span class="material-symbols-rounded" style="font-size:1.1em; vertical-align:-3px; margin-right:2px">${f.icon}</span>` : ''} ${f.label ?? f.franchise}`;
      chip.addEventListener('click', () => handleChipClick(chip, f.franchise));
      chips.appendChild(chip);
    }
    // Footer link
    if (footerLinks) {
      const li = document.createElement('li');
      li.innerHTML = `<a href="#franchises" data-scroll="franchises">${f.icon ? `<span class="material-symbols-rounded" style="font-size:1.1em; vertical-align:-3px; margin-right:4px">${f.icon}</span>` : ''} ${f.label ?? f.franchise}</a>`;
      footerLinks.appendChild(li);
    }
  });

  // Build franchise rows (top 5 franchises with most deals)
  for (const f of data.slice(0, 5)) {
    const dealsData = await api(`/api/deals?franchise=${f.franchise}&sort=deal&page=1`);
    const deals = dealsData || [];
    if (!deals.length) continue;

    const block = document.createElement('div');
    block.className = 'franchise-block';
    block.innerHTML = `
      <div class="franchise-header-bar">
        <div class="franchise-emoji">${f.icon ? `<span class="material-symbols-rounded" style="font-size: 2rem;">${f.icon}</span>` : ''}</div>
        <div>
          <div class="franchise-name">${f.label ?? f.franchise}</div>
          <div class="franchise-count">${f.count} sets · Best deal: ${f.best_discount ?? '?'}%</div>
        </div>
      </div>
      <div class="franchise-scroll">
        <div class="franchise-row" id="frow-${f.franchise}"></div>
      </div>
    `;
    container.appendChild(block);

    const row = block.querySelector(`#frow-${f.franchise}`);
    deals.slice(0, 10).forEach(s => row.appendChild(buildCard(s)));
  }
}

// ---- Deals grid ----
async function loadDeals(reset = true) {
  if (reset) {
    state.currentPage = 1;
    state.totalLoaded = 0;
    const grid = $('deals-grid');
    if (grid) grid.innerHTML = '';
  }

  const data = await api(
    `/api/deals?franchise=${state.currentFranchise}&sort=${state.currentSort}&page=${state.currentPage}&q=${encodeURIComponent(state.currentQuery || '')}`
  );
  const grid     = $('deals-grid');
  const countEl  = $('deal-count');
  const emptyEl  = $('empty-state');
  const loadWrap = $('load-more-wrap');

  if (!data) return;

  if (data.length === 0 && state.currentPage === 1) {
    if (emptyEl) emptyEl.hidden = false;
    if (loadWrap) loadWrap.hidden = true;
    if (countEl) countEl.textContent = '0';
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  state.totalLoaded += data.length;
  if (countEl) countEl.textContent = state.totalLoaded;

  data.forEach((s, i) => {
    const card = buildCard(s);
    card.style.animationDelay = `${(i % 24) * 0.04}s`;
    grid?.appendChild(card);
  });

  // Show "load more" if full page returned
  if (loadWrap) loadWrap.hidden = data.length < 24;
}

function setupFilters() {
  // "All" chip is always first
  document.querySelectorAll('.chip[data-franchise]').forEach(chip => {
    chip.addEventListener('click', () => handleChipClick(chip, chip.dataset.franchise));
  });

  const sortSel = $('sort-select');
  if (sortSel) {
    sortSel.addEventListener('change', () => {
      state.currentSort = sortSel.value;
      loadDeals(true);
    });
  }

  $('load-more-btn')?.addEventListener('click', () => {
    state.currentPage++;
    loadDeals(false);
  });
}

function handleChipClick(chip, franchise) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  state.currentFranchise = franchise;
  state.currentQuery = ''; // Reset search query on franchise click
  const title = $('deals-title');
  if (title) title.textContent = 'All Deals';
  
  const input = $('search-input');
  const clearBtn = $('search-clear');
  if (input) input.value = '';
  if (clearBtn) clearBtn.hidden = true;

  // Keep sticky bar sort in sync with main bar
  const dfbChips = document.querySelectorAll('#dfb-chips .chip');
  dfbChips.forEach(c => c.classList.toggle('active', c.dataset.franchise === franchise));
  
  loadDeals(true);
}

// ---- Smooth scroll nav ----
function setupScroll() {
  document.querySelectorAll('[data-scroll]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const target = document.getElementById(el.dataset.scroll);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ---- Search ----
function setupSearch() {
  const form     = $('search-form');
  const input    = $('search-input');
  const dropdown = $('search-dropdown');
  const clearBtn = $('search-clear');

  if (!input) return;

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q.length > 0) submitSearch(q);
  });

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn.hidden = q.length === 0;
    clearTimeout(state.searchDebounce);
    if (q.length < 2) { dropdown.hidden = true; return; }
    state.searchDebounce = setTimeout(() => runSearch(q), 320);
  });

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    dropdown.hidden = true;
    
    // Clear search and reset UI if we were previously searching
    if (state.currentQuery !== '') {
      state.currentQuery = '';
      const title = $('deals-title');
      if (title) title.textContent = 'All Deals';
      loadDeals(true);
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.header-search-wrap')) dropdown.hidden = true;
  });
}

function submitSearch(q) {
  const dropdown = $('search-dropdown');
  if (dropdown) dropdown.hidden = true;
  
  // reset franchise filters if querying
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  const allChip = document.querySelector('.chip[data-franchise="all"]');
  if (allChip) allChip.classList.add('active');
  state.currentFranchise = 'all';
  
  state.currentQuery = q;
  
  // Update header text to show search
  const title = $('deals-title');
  if (title) title.innerHTML = `Results for "<strong>${q}</strong>"`;
  
  loadDeals(true);
  
  // Scroll down to deals grid
  const section = $('deals');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function runSearch(q) {
  const dropdown = $('search-dropdown');
  if (!dropdown) return;
  dropdown.hidden = false;
  dropdown.innerHTML = '<div class="search-no-results">Searching…</div>';

  const results = await api(`/api/search?q=${encodeURIComponent(q)}`);
  if (!results || results.length === 0) {
    dropdown.innerHTML = `<div class="search-no-results">No results for "<strong>${q}</strong>"</div>`;
    return;
  }

  dropdown.innerHTML = results.slice(0, 8).map(s => `
    <div class="search-result-item" data-set="${s.set_num}" role="option" tabindex="0">
      ${s.img_url
        ? `<img class="search-result-thumb" src="${s.img_url}" alt="${s.name}" loading="lazy" />`
        : `<div class="search-result-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.4rem;color:var(--text-muted)"><span class="material-symbols-rounded">toys</span></div>`}
      <div class="search-result-info">
        <div class="search-result-name">${s.name}</div>
        <div class="search-result-meta">#${s.set_num} ${s.theme_name ? `· ${s.theme_name}` : ''} ${s.num_parts ? `· ${s.num_parts.toLocaleString()} pcs` : ''}</div>
      </div>
      <div class="search-result-price">${s.price ? fmt(s.price) : '—'}</div>
    </div>
  `).join('');

  dropdown.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', () => {
      goToSet(el.dataset.set);
      dropdown.hidden = true;
      const input = $('search-input');
      if (input) input.value = '';
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.click(); });
  });
}

// ---- Build Card ----
function buildCard(set, spotlight = false) {
  const card = document.createElement('div');
  card.className = 'deal-card' + (spotlight ? ' spotlight' : '');
  card.dataset.setNum = set.set_num;

  const voteState = state.votes[set.set_num] || { up: false, down: false };
  const score = (set.upvotes || 0) - (set.downvotes || 0);
  const fMeta = state.franchiseMeta[set.franchise] || {};
  const discCls = discountClass(set.discount_pct);
  const hasImg = set.img_url && set.img_url.trim();

  card.innerHTML = `
    <div class="card-img-zone">
      ${hasImg
        ? `<img class="card-img" src="${set.img_url}" alt="${set.name}" loading="lazy" onerror="this.onerror=null; this.src=''; this.style.display='none'; this.nextElementSibling.style.display='flex';" />
           <div class="card-img-placeholder" style="display:none;"><span class="material-symbols-rounded">toys</span></div>`
        : `<div class="card-img-placeholder"><span class="material-symbols-rounded">toys</span></div>`}
      ${set.discount_pct
        ? `<span class="card-badge-discount ${discCls}">${set.discount_pct}%</span>`
        : ''}
      ${set.source
        ? `<span class="card-badge-source">${set.source}</span>`
        : ''}
    </div>
    <div class="card-body">
      <div class="card-franchise">
        ${fMeta.icon ? `<span class="material-symbols-rounded" style="font-size:1.1em; vertical-align:-3px; margin-right:2px">${fMeta.icon}</span>` : ''} 
        ${set.theme_name || set.franchise || 'LEGO'}
      </div>
      <div class="card-name">${set.name}</div>
      <div class="card-meta">
        ${set.set_num ? `<span>#${set.set_num}</span>` : ''}
        ${set.num_parts ? `<span>${set.num_parts.toLocaleString()} pcs</span>` : ''}
        ${set.year ? `<span>${set.year}</span>` : ''}
      </div>
      <div class="card-prices">
        ${set.price ? (() => {
          // Use scraped original_price OR official retail_price as the 'was' price
          const wasPriceSrc = set.original_price || set.retail_price;
          const wasLabel = !set.original_price && set.retail_price ? 'PPC' : null;
          const savings = wasPriceSrc && set.price ? saving(wasPriceSrc, set.price) : null;
          return `
            <span class="card-price-now">${fmt(set.price)}</span>
            ${wasPriceSrc ? `<span class="card-price-was" title="${wasLabel ? 'Prix public conseillé' : 'Prix d\'origine'}">${wasLabel ? `<span class="card-rrp-tag">PPC</span>` : ''}${fmt(wasPriceSrc)}</span>` : ''}
            ${savings ? `<span class="card-savings">−${savings}</span>` : ''}
          `;
        })() : `<span class="card-price-now" style="color:var(--text-muted); font-size: 1rem; font-weight: 500;">No active deals</span>`}
      </div>
    </div>
    <div class="card-footer">
      <div class="vote-row">
        <button class="vote-btn up${voteState.up ? ' active' : ''}" data-set="${set.set_num}" data-dir="up" aria-label="Upvote">
          <span class="material-symbols-rounded" style="font-size: 1.1em;">thumb_up</span>
        </button>
        <span class="vote-score" id="vscore-${set.set_num}">${score}</span>
        <button class="vote-btn down${voteState.down ? ' active' : ''}" data-set="${set.set_num}" data-dir="down" aria-label="Downvote">
          <span class="material-symbols-rounded" style="font-size: 1.1em;">thumb_down</span>
        </button>
      </div>
      <button class="card-view-btn" data-set="${set.set_num}">Details →</button>
    </div>
  `;

  // Votes
  card.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      handleVote(btn.dataset.set, btn.dataset.dir);
    });
  });
  // View detail
  card.querySelector('.card-view-btn').addEventListener('click', e => {
    e.stopPropagation();
    goToSet(set.set_num);
  });
  // Click card body
  card.querySelector('.card-img-zone')?.addEventListener('click', () => goToSet(set.set_num));
  card.querySelector('.card-body')?.addEventListener('click', () => goToSet(set.set_num));

  return card;
}

// ---- Vote ----
async function handleVote(setNum, direction) {
  const v = state.votes[setNum] || { up: false, down: false };

  // Toggle logic
  if (direction === 'up') {
    if (v.up) v.up = false;
    else { if (v.down) v.down = false; v.up = true; }
  } else {
    if (v.down) v.down = false;
    else { if (v.up) v.up = false; v.down = true; }
  }
  state.votes[setNum] = v;

  try {
    const res = await fetch(`/api/vote/${setNum}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    });
    const json = await res.json();
    if (json.ok) updateVoteUI(setNum, json.data.upvotes - json.data.downvotes, v);
  } catch (e) {
    console.warn('[Vote]', e.message);
  }
}

function updateVoteUI(setNum, score, vState) {
  document.querySelectorAll(`[id="vscore-${setNum}"]`).forEach(el => { el.textContent = score; });
  document.querySelectorAll(`.vote-btn[data-set="${setNum}"][data-dir="up"]`).forEach(btn => {
    btn.classList.toggle('active', !!vState.up);
  });
  document.querySelectorAll(`.vote-btn[data-set="${setNum}"][data-dir="down"]`).forEach(btn => {
    btn.classList.toggle('active', !!vState.down);
  });
}

// ---- Page routing ----
function goToSet(setNum) {
  window.location.href = `set.html?id=${setNum}`;
}

// ---- Refresh ----
function setupRefresh() {
  const btn   = $('refresh-btn');
  const fBtn  = $('footer-refresh');
  const doRefresh = async () => {
    btn?.classList.add('spinning');
    showToast('Refreshing data from sources…');
    await api('/api/refresh');
    setTimeout(async () => {
      btn?.classList.remove('spinning');
      await Promise.all([loadStats(), loadSpotlight(), loadDeals(true)]);
      buildMarquee();
      showToast('✅ Data refreshed!');
    }, 3000);
  };
  btn?.addEventListener('click', doRefresh);
  fBtn?.addEventListener('click', doRefresh);
}
// ---- Sticky filter bar (shown when user scrolls into #deals) ----
function setupStickyFilterBar() {
  const dealsSection = $('deals');
  const bar = $('deals-filter-bar');
  const dfbChipsEl = $('dfb-chips');
  const dfbSort = $('dfb-sort');
  const mainSort = $('sort-select');
  if (!dealsSection || !bar) return;

  // The sentinel we observe is the deals section HEADER (the h2 area)
  // When it scrolls above the viewport, show the sticky bar
  const sentinel = dealsSection.querySelector('.section-header') || dealsSection;

  // Clone chips into the sticky bar whenever they are updated
  function syncChips() {
    const mainChips = document.querySelector('#filter-chips');
    if (!mainChips || !dfbChipsEl) return;
    dfbChipsEl.innerHTML = mainChips.innerHTML;
    // Re-attach click listeners to the cloned chips
    dfbChipsEl.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => handleChipClick(chip, chip.dataset.franchise));
    });
  }

  // Sync sort selects bidirectionally
  dfbSort?.addEventListener('change', () => {
    state.currentSort = dfbSort.value;
    if (mainSort) mainSort.value = dfbSort.value;
    loadDeals(true);
  });
  mainSort?.addEventListener('change', () => {
    if (dfbSort) dfbSort.value = mainSort.value;
  });

  // Observe the deals header sentinel
  const observer = new IntersectionObserver(
    ([entry]) => {
      // Show bar when sentinel has scrolled OUT of view (above the top)
      const shouldShow = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      bar.classList.toggle('visible', shouldShow);
      if (shouldShow) syncChips();
    },
    { threshold: 0 }
  );
  observer.observe(sentinel);
}
