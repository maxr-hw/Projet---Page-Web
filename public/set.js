'use strict';

const params = new URLSearchParams(window.location.search);
const setId = params.get('id');

const $ = id => document.getElementById(id);

const fmt = n => {
  if (n == null) return '—';
  return parseFloat(n).toFixed(2).replace('.', ',') + ' €';
};

const discountMClass = d => {
  if (!d) return 'badge-cold';
  if (d <= -40) return 'badge-fire';
  if (d <= -25) return 'badge-great';
  return 'badge-good';
};

async function init() {
  const container = $('set-container');
  if (!setId) {
    container.innerHTML = '<h2 class="set-title">No Set ID specified.</h2>';
    return;
  }

  try {
    const [setRes, metaRes] = await Promise.all([
      fetch(`/api/sets/${setId}`),
      fetch(`/api/franchise-meta`)
    ]);

    if (!setRes.ok) {
      container.innerHTML = '<h2 class="set-title">Set not found in catalog.</h2>';
      return;
    }

    const { data: set } = await setRes.json();
    const { data: metaMap } = await metaRes.json();

    const fMeta = metaMap[set.franchise] || metaMap['other'];
    const deals = set.deals || [];
    const bestDeal = deals.length ? deals[0] : null;
    const discCls = bestDeal ? discountMClass(bestDeal.discount_pct) : '';

    container.innerHTML = `
      <a href="javascript:history.back()" class="back-btn">
        <span class="material-symbols-rounded" style="font-size:1.2rem;">arrow_back</span>
        Back to Results
      </a>

      <div class="set-layout">
        <div class="set-img-col">
          <div class="set-img-wrap">
            ${set.img_url 
              ? `<img src="${set.img_url}" alt="${set.name}" onerror="this.onerror=null; this.src=''; this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                 <span class="material-symbols-rounded" style="font-size: 5rem; opacity: 0.15; display:none;">toys</span>`
              : `<span class="material-symbols-rounded" style="font-size: 5rem; opacity: 0.15;">toys</span>`}
          </div>
          
          <div class="deals-box">
            <div class="deals-title">Price Comparison</div>
            ${deals.some(d => d.original_price) 
              ? `<div style="margin-bottom: 1rem; color: var(--text-secondary); font-size: 0.95rem;">Lego Retail Price: <span style="text-decoration:line-through">${fmt(Math.max(...deals.map(d => d.original_price || 0)))}</span></div>` 
              : ''}
            ${deals.length === 0 ? '<p style="color:var(--text-muted)">No active deals found for this set. Check back later!</p>' : ''}
            
            ${deals.map((d, i) => {
              let url = d.source_url || '#';
              if (url.includes('https://www.avenuedelabrique.comhttps://')) {
                url = url.replace('https://www.avenuedelabrique.comhttps://', 'https://');
              }
              return `
              <div class="deal-row">
                <a href="${url}" target="_blank" rel="noopener noreferrer" class="deal-source">
                  ${i === 0 ? '<span class="material-symbols-rounded" style="font-size:1rem; margin-right:4px; color:var(--accent-gold); vertical-align:-2px">sell</span>' : ''}${d.source}
                </a>
                <div>
                  <span class="deal-price">${fmt(d.price)}</span>
                  ${d.discount_pct ? `<span class="deal-badge ${discountMClass(d.discount_pct)}">${d.discount_pct}%</span>` : ''}
                </div>
              </div>
              `;
            }).join('')}

            ${bestDeal?.source_url ? (() => {
              let btnUrl = bestDeal.source_url;
              if (btnUrl.includes('https://www.avenuedelabrique.comhttps://')) {
                btnUrl = btnUrl.replace('https://www.avenuedelabrique.comhttps://', 'https://');
              }
              return `
              <a href="${btnUrl}" target="_blank" rel="noopener noreferrer" class="btn" style="margin-top: 1.5rem; width: 100%;">
                Get Best Deal – ${fmt(bestDeal.price)}
              </a>
              `;
            })() : ''}
          </div>
        </div>

        <div class="set-info-col">
          <div class="set-franchise">
            ${fMeta.icon ? `<span class="material-symbols-rounded" style="font-size:1.1em; vertical-align:-3px; margin-right:2px">${fMeta.icon}</span>` : ''} 
            ${set.theme_name || set.franchise || 'LEGO'}
          </div>
          
          <h1 class="set-title">${set.name}</h1>
          <div class="set-meta-text">Set #${set.set_num}${set.year ? ` &nbsp;·&nbsp; ${set.year}` : ''}</div>

          <div class="set-grid-data">
            ${set.num_parts ? `
            <div>
              <div class="data-label">Pieces</div>
              <div class="data-val">${set.num_parts.toLocaleString()}</div>
            </div>` : ''}
            ${set.theme_name ? `
            <div>
              <div class="data-label">Theme</div>
              <div class="data-val">${set.theme_name}</div>
            </div>` : ''}
            <div>
              <div class="data-label">Votes</div>
              <div class="data-val" style="display:flex; gap:0.5rem">
                <span style="color:var(--accent-leaf)">+${set.upvotes ?? 0}</span> 
                <span style="color:var(--accent-rust)">-${set.downvotes ?? 0}</span>
              </div>
            </div>
            ${bestDeal?.discount_pct ? `
            <div>
              <div class="data-label">Top Discount</div>
              <div class="data-val" style="color:var(--accent-gold)">${bestDeal.discount_pct}%</div>
            </div>` : ''}
          </div>

          ${set.description ? `<p style="line-height:1.6; color:var(--text-secondary)">${set.description}</p>` : ''}
        </div>
      </div>
    `;

  } catch (err) {
    console.error(err);
    container.innerHTML = '<h2 class="set-title">Error loading set data.</h2>';
  }
}

document.addEventListener('DOMContentLoaded', init);
