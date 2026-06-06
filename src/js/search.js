/**
 * SearchManager - Ricerca parti nel catalogo
 */
export class SearchManager {
  constructor() {
    this._listeners = {};
    this._lastResults = null;  // conserva i risultati per quando si riapre
    this._lastCatalog = null;
  }

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(cb => cb(data));
  }

  open() {
    const panel = document.getElementById('search-panel');
    panel.classList.remove('hidden');
    document.getElementById('search-unified').focus();

    // Drag inizializzato una sola volta
    if (!this._dragInited) {
      this._initDrag(panel, document.getElementById('search-panel-drag'));
      this._dragInited = true;
    }

    // Pulsante chiudi
    document.getElementById('search-panel-close').onclick = () =>
      panel.classList.add('hidden');

    // Mostra i risultati della ricerca precedente (se ci sono)
    if (this._lastResults && this._lastCatalog) {
      this._renderResults(this._lastResults, this._lastCatalog);
    } else {
      document.getElementById('search-results').classList.add('hidden');
    }
  }

  _initDrag(panel, handle) {
    let ox = 0, oy = 0, startX = 0, startY = 0;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      // Prima mossa: converti da transform centrato a left/top assoluti
      if (panel.style.transform) {
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        panel.style.transform = '';
      }
      ox = panel.offsetLeft; oy = panel.offsetTop;
      startX = e.clientX; startY = e.clientY;
      const onMove = mv => {
        panel.style.left = (ox + mv.clientX - startX) + 'px';
        panel.style.top  = (oy + mv.clientY - startY) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  doSearch(catalog) {
    const query = (document.getElementById('search-unified')?.value || '').trim().toLowerCase();
    if (!query) return;

    const lang = catalog.currentLang;
    const results = catalog.parts.filter(part => {
      if (/^TAV-/i.test(part.code)) return false;
      const partDesc = (part.description?.[lang] || part.description?.it || '').toLowerCase();
      const gDesc = this._getGroupDescription(catalog, part.group, lang).toLowerCase();
      return part.code.toLowerCase().includes(query)
          || partDesc.includes(query)
          || (part.group || '').toLowerCase().includes(query)
          || gDesc.includes(query);
    });

    // Dedup per codice (un pezzo può stare in più tavole)
    const seen = new Set();
    const unique = results.filter(p => {
      if (seen.has(p.code)) return false;
      seen.add(p.code); return true;
    });

    this._lastResults = unique;
    this._lastCatalog = catalog;
    this._renderResults(unique, catalog);
  }

  _getGroupDescription(catalog, groupCode, lang) {
    if (!catalog.groups?.sections) return '';
    for (const section of catalog.groups.sections) {
      for (const group of section.groups || []) {
        if (group.code === groupCode) {
          return group.name?.[lang] || group.name?.it || '';
        }
      }
    }
    return '';
  }

  _getSectionDescription(catalog, sectionId, lang) {
    if (!catalog.groups?.sections || !sectionId) return '';
    const sec = catalog.groups.sections.find(s => s.id === sectionId);
    return sec?.name?.[lang] || sec?.name?.it || '';
  }

  _renderResults(results, catalog) {
    const container = document.getElementById('search-results');
    const tbody = document.getElementById('search-results-body');
    const lang = catalog.currentLang;

    container.classList.remove('hidden');

    if (results.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:16px;">
          Nessun risultato trovato
        </td></tr>`;
      return;
    }

    tbody.innerHTML = results.slice(0, 100).map(part => {
      const desc = part.description?.[lang] || part.description?.it || '';
      const groupDesc = this._getGroupDescription(catalog, part.group, lang);
      const sectionDesc = this._getSectionDescription(catalog, part.section, lang);
      const sectionLabel = part.section
        ? `<div style="font-size:11px;color:var(--text-secondary)">${part.section}</div><b>${sectionDesc}</b>`
        : '';
      const groupLabel = part.group
        ? `<div style="font-size:11px;color:var(--text-secondary)">${part.group}</div><b>${groupDesc}</b>`
        : '';
      // Numero posizione sul disegno
      const tableId = this._resolveTableId(catalog, part.group, part.table);
      const posData = tableId ? catalog.getPartPosData(tableId, part.code) : null;
      const posNum = posData?.pos || '';
      return `
      <tr data-code="${part.code}" data-group="${part.group}" data-table="${part.table}">
        <td class="search-thumb-cell" data-code="${part.code}" data-group="${part.group}"
            data-table-num="${part.table}"
            data-pos-x="${posData?.x || ''}" data-pos-y="${posData?.y || ''}"
            style="width:100px;text-align:center;padding:4px">
          <div class="search-thumb-wrap" style="width:92px;height:72px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--bg-surface);border-radius:4px;border:1px solid var(--border)"></div>
        </td>
        <td style="font-size:12px">${sectionLabel}</td>
        <td style="font-size:12px">${groupLabel}</td>
        <td style="font-weight:600;font-size:12px">${part.code}</td>
        <td>${desc}</td>
        <td style="text-align:center">${part.table || ''}</td>
        <td style="text-align:center">${posNum ? `<b>${posNum}</b>` : ''}</td>
        <td style="text-align:center">${part.quantity || ''}</td>
        <td style="white-space:nowrap">
          <button class="btn-search-action btn-tavola" data-action="tavola" title="Apri tavola esplosi">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="1.5"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            Tavola
          </button>
          <button class="btn-search-action btn-3d" data-action="3d" title="Evidenzia nel 3D" style="margin-top:3px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            3D
          </button>
        </td>
      </tr>`;
    }).join('');

    // Carica miniature SVG
    this._loadSearchThumbs(tbody, catalog);

    // Bottone Tavola
    tbody.querySelectorAll('[data-action="tavola"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const row = btn.closest('tr');
        // Risolvi il vero tableId SVG da group + numero tavola
        const tableId = this._resolveTableId(catalog, row.dataset.group, Number(row.dataset.table));
        this._emit('navigate', { table: tableId, code: row.dataset.code, view: 'tree' });
      });
    });

    // Bottone 3D
    tbody.querySelectorAll('[data-action="3d"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const row = btn.closest('tr');
        this._emit('navigate', { table: row.dataset.table, code: row.dataset.code,
          group: row.dataset.group, view: '3d' });
      });
    });
  }

  async _loadSearchThumbs(tbody, catalog) {
    const cells = tbody.querySelectorAll('.search-thumb-cell');
    const serial = catalog.currentModel?.serial;
    if (!serial) return;

    const toLoad = [...cells].slice(0, 20);

    for (const cell of toLoad) {
      const code = cell.dataset.code;
      const groupCode = cell.dataset.group;
      const tableNum = Number(cell.dataset.tableNum) || 1;
      const wrap = cell.querySelector('.search-thumb-wrap');
      if (!wrap) continue;

      // Risolvi tableId e posizione
      const tableId = this._resolveTableId(catalog, groupCode, tableNum);
      if (!tableId) continue;
      const posData = catalog.getPartPosData(tableId, code);
      const pos = posData?.pos;
      if (!pos) continue;

      const svgPath = `models/${serial}/svg/${tableId}.svg`;
      try {
        // Usa la stessa logica del cart: ritaglia solo le path del pezzo
        const svgHtml = await this._renderPieceThumbnail(svgPath, pos);
        if (svgHtml) {
          wrap.innerHTML = svgHtml;
        }
      } catch (e) { /* ignora */ }
    }
  }

  /**
   * Genera una miniatura SVG ritagliata del singolo pezzo.
   * Stessa logica di Cart._renderPieceThumbnail.
   */
  async _renderPieceThumbnail(svgPath, pieceName) {
    if (!svgPath || !pieceName) return '';
    const cache = (this._svgCache ||= new Map());
    let svgText = cache.get(svgPath);
    if (svgText === undefined) {
      try { svgText = await window.catalog.readSvg(svgPath); } catch { svgText = null; }
      cache.set(svgPath, svgText || null);
    }
    if (!svgText) return '';

    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return '';

    const targets = Array.from(svg.querySelectorAll(`[data-piece-name="${CSS.escape(String(pieceName))}"]`))
      .filter(el => el.tagName.toLowerCase() !== 'text')
      .filter(el => { const d = el.getAttribute('stroke-dasharray'); return !d || d === 'none'; });
    if (targets.length === 0) return '';

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of targets) {
      if (el.tagName.toLowerCase() !== 'path') continue;
      const coords = (el.getAttribute('d') || '').match(/[-+]?[0-9]*\.?[0-9]+/g);
      if (!coords) continue;
      for (let i = 0; i < coords.length - 1; i += 2) {
        const x = parseFloat(coords[i]), y = parseFloat(coords[i + 1]);
        if (isFinite(x) && isFinite(y)) {
          if (x < minX) minX = x; if (y < minY) minY = y;
          if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        }
      }
    }
    if (!isFinite(minX) || maxX <= minX || maxY <= minY) return '';

    const w = maxX - minX, h = maxY - minY;
    const pad = Math.max(w, h) * 0.12;
    const vb = `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`;
    const ns = 'http://www.w3.org/2000/svg';
    const out = document.createElementNS(ns, 'svg');
    out.setAttribute('xmlns', ns);
    out.setAttribute('viewBox', vb);
    out.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    out.setAttribute('width', '100%');
    out.setAttribute('height', '100%');
    for (const el of targets) {
      const c = el.cloneNode(true);
      c.removeAttribute('data-piece-id');
      c.removeAttribute('data-piece-name');
      c.removeAttribute('data-piece-color');
      c.removeAttribute('data-piece-category');
      c.setAttribute('stroke', '#222');
      c.setAttribute('stroke-width', '1');
      c.setAttribute('vector-effect', 'non-scaling-stroke');
      c.setAttribute('fill', 'none');
      out.appendChild(c);
    }
    return out.outerHTML;
  }

  _findTableForPart(catalog, code, groupCode) {
    // Prima tavola non-copertina del gruppo (per miniatura)
    return this._resolveTableId(catalog, groupCode, 1);
  }

  /**
   * Converte group + numero tavola (1-based) → vero SVG tableId.
   * part.table = N → detailTables[N-1]
   */
  _resolveTableId(catalog, groupCode, tableNum) {
    if (!catalog.groups?.sections) return null;
    for (const section of catalog.groups.sections) {
      for (const group of section.groups || []) {
        if (group.code === groupCode) {
          const detail = (group.tables || []).filter(t => !/_00_\d+$/.test(t));
          const idx = (tableNum || 1) - 1;
          return detail[idx] || detail[0] || null;
        }
      }
    }
    return null;
  }
}
