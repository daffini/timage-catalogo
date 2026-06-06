/**
 * SvgViewer - Visualizzatore SVG interattivo
 * Carica SVG inline, pan/zoom, hover/click sui pezzi annotati.
 *
 * Gli SVG annotati hanno path con attributi:
 *   data-piece-id, data-piece-name (numero posizione), data-piece-category, data-piece-color
 *
 * Il viewer evidenzia:
 * - hover  → bordo rosso trasparente + riga nella distinta
 * - click  → persistente, annulla precedente
 */
export class SvgViewer {
  constructor(container) {
    this.container = container;
    this.svgElement = null;
    this._listeners = {};

    // Stato interattività pezzi (basato su data-piece-name, così
    // istanze multiple con stesso numero si evidenziano insieme)
    this._hoveredName = null;
    this._selectedName = null;

    // Pan/Zoom
    this._scale = 1;
    this._translateX = 0;
    this._translateY = 0;
    this._isPanning = false;
    this._startX = 0;
    this._startY = 0;

    this._initPanZoom();
  }

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(cb => cb(data));
  }

  async load(svgPath) {
    // Salva il tableId corrente per il popup da dblclick
    // svgPath es. "models/xxx/svg/G.TRSP.LNCT.000036_02_12.svg"
    const match = svgPath.match(/svg\/([^/]+)\.svg$/);
    this.currentTableId = match ? match[1] : null;
    const svgContent = await window.catalog.readSvg(svgPath);
    if (!svgContent) {
      this.container.innerHTML = `<div class="placeholder"><p>Tavola non trovata: ${svgPath}</p></div>`;
      return;
    }

    this.container.innerHTML = svgContent;
    this.svgElement = this.container.querySelector('svg');

    if (this.svgElement) {
      this.svgElement.style.width = '100%';
      this.svgElement.style.height = '100%';
      this.svgElement.style.maxWidth = '100%';
      this.svgElement.style.maxHeight = '100%';

      this._scale = 1;
      this._translateX = 0;
      this._translateY = 0;
      this._applyTransform();

      this._hoveredName = null;
      this._selectedName = null;

      // Rimuovi il rettangolo di bordo (4 path senza data-piece-id alle estremità del viewBox)
      this._removeBorderPaths();

      // Attiva interattività su pezzi annotati (se presenti)
      this._setupPieceInteraction();

      // Attiva interattività testi (codici/TAV)
      this._makeInteractive();
    }
  }

  clear() {
    this.container.innerHTML = `
      <div class="placeholder">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        </svg>
        <p>Seleziona una tavola dall'albero</p>
      </div>`;
    this.svgElement = null;
  }

  // ─── Interattività pezzi annotati ───

  _setupPieceInteraction() {
    if (!this.svgElement) return;

    const annotated = this.svgElement.querySelectorAll('[data-piece-id]');
    if (annotated.length === 0) {
      this._pieceElements = null;
      this._pieceIdToName = null;
      this._idToName = null;
      this._nameToIds = null;
      return;
    }

    // Raggruppa per data-piece-id e calcola info path
    const byId = new Map();
    this._pieceIdToName = new Map(); // id → numero posizione (data-piece-name)

    annotated.forEach(el => {
      const id = el.getAttribute('data-piece-id');
      const name = el.getAttribute('data-piece-name');
      if (name && !this._pieceIdToName.has(id)) {
        this._pieceIdToName.set(id, name);
      }
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(el);
    });

    this._pieceElements = new Map();
    this._pieceBBox = new Map();
    this._idToName = new Map();   // id → name (con fallback __id_<id>)
    this._nameToIds = new Map();  // name → Set<id> (per gestire numeri doppi)

    // Per ogni pezzo: crea un <g> wrapper con i suoi path (per area hover estesa)
    for (const [id, elements] of byId) {
      // Calcola lunghezza e bbox
      const pathInfo = elements.map(el => {
        if (el.tagName !== 'path') return { el, len: 0 };
        const d = el.getAttribute('d') || '';
        const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
        if (!coords || coords.length < 4) return { el, len: 0 };
        const x1 = parseFloat(coords[0]), y1 = parseFloat(coords[1]);
        const x2 = parseFloat(coords[coords.length - 2]), y2 = parseFloat(coords[coords.length - 1]);
        return { el, len: Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) };
      });

      // BBox del pezzo
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      elements.forEach(el => {
        if (el.tagName === 'path') {
          const d = el.getAttribute('d') || '';
          const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
          if (coords) {
            for (let i = 0; i < coords.length - 1; i += 2) {
              const x = parseFloat(coords[i]), y = parseFloat(coords[i + 1]);
              if (isFinite(x) && isFinite(y)) {
                minX = Math.min(minX, x); minY = Math.min(minY, y);
                maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
              }
            }
          }
        } else if (el.tagName === 'text') {
          const x = parseFloat(el.getAttribute('x') || 0);
          const y = parseFloat(el.getAttribute('y') || 0);
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      });

      this._pieceElements.set(id, pathInfo);
      this._pieceBBox.set(id, { minX, minY, maxX, maxY });

      // Mappa id ↔ name (data-piece-name, fallback su id se assente)
      const nameEl = elements.find(el => el.hasAttribute('data-piece-name'));
      const name = nameEl ? nameEl.getAttribute('data-piece-name') : `__id_${id}`;
      this._idToName.set(id, name);
      if (!this._nameToIds.has(name)) this._nameToIds.set(name, new Set());
      this._nameToIds.get(name).add(id);

      // Cursor pointer sui path/text (no listener — il click globale
      // con elementsFromPoint sceglie il pezzo migliore)
      elements.forEach(el => { el.style.cursor = 'pointer'; });
    }

    // ── HitArea ordinate per area DESC ──
    // Le hitArea (rect invisibili) coprono il bbox di ogni pezzo.
    // Devono essere appese in ordine di area DECRESCENTE: i bbox grandi
    // prima (in fondo), i piccoli dopo (sopra), così le hitArea piccole
    // non vengono coperte da quelle grandi (z-order = ordine DOM).
    const sortedIds = [...this._pieceBBox.keys()].sort((a, b) => {
      const ba = this._pieceBBox.get(a);
      const bb = this._pieceBBox.get(b);
      const areaA = (ba.maxX - ba.minX) * (ba.maxY - ba.minY);
      const areaB = (bb.maxX - bb.minX) * (bb.maxY - bb.minY);
      return areaB - areaA; // grandi prima
    });

    for (const id of sortedIds) {
      const { minX, minY, maxX, maxY } = this._pieceBBox.get(id);
      if (!isFinite(minX)) continue;
      const elements = byId.get(id);

      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hitArea.setAttribute('x', minX - 2);
      hitArea.setAttribute('y', minY - 2);
      hitArea.setAttribute('width', maxX - minX + 4);
      hitArea.setAttribute('height', maxY - minY + 4);
      hitArea.setAttribute('fill', 'transparent');
      hitArea.setAttribute('stroke', 'none');
      hitArea.setAttribute('pointer-events', 'all');
      hitArea.style.cursor = 'pointer';
      hitArea.dataset.hitAreaFor = id;

      // No listener su hitArea: il click/hover globale via elementsFromPoint
      // sceglie il pezzo migliore tra quelli sotto al cursore.
      this.svgElement.appendChild(hitArea);
    }

    // ── Click globale con disambiguazione "best fit" ──
    // Quando ci sono più pezzi sotto al cursore (hitArea sovrapposte o
    // bbox di pezzi piccoli dentro pezzi grandi), scegliamo il pezzo
    // con bbox più PICCOLO = più specifico. Capture phase per intercettare
    // prima dei listener inner.
    this.svgElement.addEventListener('click', (e) => {
      const els = document.elementsFromPoint(e.clientX, e.clientY);

      // 1) Priorità ai testi navigabili (TAV-/sezione/gruppo) sotto al
      // cursore, anche se coperti da hitArea
      for (const el of els) {
        if (el.tagName !== 'text') continue;
        const refType = this._classifyText(el.textContent.trim());
        if (refType) {
          e.stopPropagation();
          this._emit('navigate', { type: refType.type, value: refType.value, raw: el.textContent.trim() });
          return;
        }
      }

      // 2) Altrimenti scegli il pezzo con bbox più piccolo (più specifico)
      let bestId = null, bestArea = Infinity;
      for (const el of els) {
        if (!el.getAttribute) continue;
        const id = el.getAttribute('data-piece-id') || (el.dataset && el.dataset.hitAreaFor);
        if (!id || !this._pieceBBox.has(id)) continue;
        const bb = this._pieceBBox.get(id);
        const area = (bb.maxX - bb.minX) * (bb.maxY - bb.minY);
        if (area < bestArea) { bestArea = area; bestId = id; }
      }
      e.stopPropagation();
      this._clickPiece(bestId);
    }, true);

    // Mousemove globale per hover "best fit" (analogo al click)
    this.svgElement.addEventListener('mousemove', (e) => {
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      let bestId = null, bestArea = Infinity;
      for (const el of els) {
        if (!el.getAttribute) continue;
        const id = el.getAttribute('data-piece-id') || (el.dataset && el.dataset.hitAreaFor);
        if (!id || !this._pieceBBox.has(id)) continue;
        const bb = this._pieceBBox.get(id);
        const area = (bb.maxX - bb.minX) * (bb.maxY - bb.minY);
        if (area < bestArea) { bestArea = area; bestId = id; }
      }
      if (bestId !== null) this._hoverPiece(bestId);
      else if (this._hoveredName) this._unhoverByName(this._hoveredName);
    });
  }

  // ─── API basata su data-piece-name (gestisce numeri doppi) ───

  _hoverByName(name) {
    if (!name || this._hoveredName === name) return;
    if (this._hoveredName) this._unhoverByName(this._hoveredName);
    this._hoveredName = name;
    const ids = this._nameToIds?.get(name);
    if (!ids) return;
    // I riferimenti TAV- non si evidenziano con colore (sono navigabili)
    if (!this._classifyText(name)) {
      for (const id of ids) this._applyHoverStyle(id);
    }
    this._emit('piece-hover', { id: [...ids][0], name });
  }

  _unhoverByName(name) {
    if (!name || this._hoveredName !== name) return;
    this._hoveredName = null;
    const ids = this._nameToIds?.get(name);
    if (!ids) return;
    const selectedIds = this._selectedName ? this._nameToIds?.get(this._selectedName) : null;
    for (const id of ids) {
      this._restorePieceStyle(id);
      // Se l'id era anche selezionato, ri-applica lo stile selected
      if (selectedIds && selectedIds.has(id)) this._applySelectedStyle(id);
    }
    this._emit('piece-hover', { id: null, name: null });
  }

  _clickByName(name) {
    if (!name) {
      this._emit('piece-click', { id: null, name: null });
      return;
    }

    // Se il nome è un riferimento TAV-, naviga invece di selezionare
    const refType = this._classifyText(name);
    if (refType) {
      this._emit('navigate', { type: refType.type, value: refType.value, raw: name });
      return;
    }

    // Pulisci selezione precedente
    if (this._selectedName && this._selectedName !== name) {
      const oldIds = this._nameToIds?.get(this._selectedName);
      if (oldIds) for (const id of oldIds) this._restorePieceStyle(id);
    }
    this._selectedName = name;
    const ids = this._nameToIds?.get(name);
    if (!ids) return;
    for (const id of ids) this._applySelectedStyle(id);
    this._emit('piece-click', { id: [...ids][0], name });
  }

  // ─── Wrapper retro-compatibili (chiamati dai listener interni) ───

  _hoverPiece(id) {
    const name = this._idToName?.get(id);
    if (name) this._hoverByName(name);
  }

  _unhoverPiece(id) {
    const name = this._idToName?.get(id);
    if (name) this._unhoverByName(name);
  }

  _clickPiece(id) {
    if (id === null || id === undefined) {
      this._clickByName(null);
      return;
    }
    const name = this._idToName?.get(id);
    if (name) this._clickByName(name);
  }

  _applyHoverStyle(id) {
    this._applyPieceStyle(id, '#f59e0b', false);  // ambra visibile
  }

  _clearHoverStyle(id) {
    this._restorePieceStyle(id);
    // Se il pezzo è anche selezionato, ri-applica lo stile di selezione
    if (this._selectedPieceId === id) this._applySelectedStyle(id);
  }

  _applySelectedStyle(id) {
    this._applyPieceStyle(id, '#e85500', true);  // arancione scuro, ben visibile
  }

  _clearSelectedStyle(id) {
    this._restorePieceStyle(id);
  }

  /**
   * Evidenzia i path del pezzo:
   * - Path significativi (len > 5): aumento leggero spessore + cambio colore
   * - Path piccoli: solo cambio colore (no aumento spessore)
   * - Testo: cambio colore
   */
  _applyPieceStyle(id, color, persistent) {
    const pathInfo = this._pieceElements?.get(id);
    if (!pathInfo) return;

    // stroke-width più alto per selezione, leggermente meno per hover
    const sw = persistent ? '2.0' : '1.2';

    pathInfo.forEach(({ el, len }) => {
      if (el.tagName === 'path') {
        if (el.dataset._origStroke === undefined) {
          el.dataset._origStroke = el.getAttribute('stroke') || '';
          el.dataset._origStrokeWidth = el.getAttribute('stroke-width') || '';
        }
        el.setAttribute('stroke', color);
        // Ispessisci tutti i path (non solo quelli lunghi)
        el.setAttribute('stroke-width', sw);
        el.setAttribute('vector-effect', 'non-scaling-stroke');
      } else if (el.tagName === 'text') {
        if (el.dataset._origFill === undefined) {
          el.dataset._origFill = el.getAttribute('fill') || '';
        }
        el.setAttribute('fill', color);
      }
    });
  }

  _restorePieceStyle(id) {
    const pathInfo = this._pieceElements?.get(id);
    if (!pathInfo) return;

    pathInfo.forEach(({ el }) => {
      if (el.tagName === 'path') {
        if (el.dataset._origStroke !== undefined) {
          if (el.dataset._origStroke) el.setAttribute('stroke', el.dataset._origStroke);
          else el.removeAttribute('stroke');
          if (el.dataset._origStrokeWidth) el.setAttribute('stroke-width', el.dataset._origStrokeWidth);
          else el.removeAttribute('stroke-width');
          el.removeAttribute('vector-effect');
          delete el.dataset._origStroke;
          delete el.dataset._origStrokeWidth;
        }
      } else if (el.tagName === 'text') {
        if (el.dataset._origFill !== undefined) {
          if (el.dataset._origFill) el.setAttribute('fill', el.dataset._origFill);
          else el.removeAttribute('fill');
          delete el.dataset._origFill;
        }
      }
    });
  }

  _getPieceName(id) {
    const pathInfo = this._pieceElements?.get(id);
    if (!pathInfo) return null;
    const item = pathInfo.find(({ el }) => el.hasAttribute('data-piece-name'));
    return item?.el.getAttribute('data-piece-name') || null;
  }

  /**
   * Evidenzia programmaticamente un pezzo (es. hover su riga distinta).
   */
  /**
   * Ritorna il numero di posizione (data-piece-name) per un dato indice
   * della distinta (idx 0-based). Corrisponde al data-piece-id del SVG.
   * Ritorna null se non c'è SVG annotato o l'idx non è mappato.
   */
  getPieceNameByIndex(idx) {
    if (!this._pieceIdToName) return null;
    return this._pieceIdToName.get(String(idx)) || null;
  }

  /**
   * Mappa: ritorna oggetto { idx → name } per tutte le posizioni del SVG corrente.
   */
  getPieceNameMap() {
    if (!this._pieceIdToName) return null;
    const obj = {};
    for (const [k, v] of this._pieceIdToName) obj[k] = v;
    return obj;
  }

  highlightPieceByName(name, persistent = false) {
    if (!this._nameToIds) return null;
    const key = String(name);
    if (!this._nameToIds.has(key)) return null;
    if (persistent) this._clickByName(key);
    else this._hoverByName(key);
    return key;
  }

  unhighlightPieceByName(name) {
    if (!this._nameToIds) return;
    this._unhoverByName(String(name));
  }

  // ─── Interattività testi ───

  _makeInteractive() {
    if (!this.svgElement) return;
    const texts = this.svgElement.querySelectorAll('text');
    texts.forEach(t => {
      const content = t.textContent.trim();
      if (!content) return;

      const refType = this._classifyText(content);
      if (!refType) return;

      // Se ha data-piece-id, il cursore è già pointer da _setupPieceInteraction
      t.style.cursor = 'pointer';

      // Click su testo TAV- o codice
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        this._emit('navigate', { type: refType.type, value: refType.value, raw: content });
      });

      // Hover su riferimento TAV-: preview della tavola puntata
      if (refType.type === 'table-ref') {
        t.addEventListener('mouseenter', (e) => {
          this._emit('ref-hover', { refType, clientX: e.clientX, clientY: e.clientY });
        });
        t.addEventListener('mouseleave', () => {
          this._emit('ref-hover', { refType: null });
        });
      }
    });
  }

  _classifyText(text) {
    const tavMatch = text.match(/^TAV-\d+\.(.+?)\.(\d+)\/(\d+)$/);
    if (tavMatch) {
      return { type: 'table-ref', value: { groupCode: tavMatch[1], page: parseInt(tavMatch[2]) - 1 } };
    }
    if (/^\d{2}$/.test(text)) return { type: 'section-num', value: text };
    if (/^[A-Z]\.[A-Z]{4}\.[A-Z]{4}\.\d+/.test(text)) return { type: 'group-code', value: text };
    return null;
  }

  // ─── Pan & Zoom ───

  _initPanZoom() {
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(10, this._scale * delta));
      const rect = this.container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      this._translateX = cx - (cx - this._translateX) * (newScale / this._scale);
      this._translateY = cy - (cy - this._translateY) * (newScale / this._scale);
      this._scale = newScale;
      this._applyTransform();
    }, { passive: false });

    this.container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.tagName === 'text' || e.target.tagName === 'path') return;
      this._isPanning = true;
      this._startX = e.clientX - this._translateX;
      this._startY = e.clientY - this._translateY;
      this.container.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!this._isPanning) return;
      this._translateX = e.clientX - this._startX;
      this._translateY = e.clientY - this._startY;
      this._applyTransform();
    });

    document.addEventListener('mouseup', () => {
      this._isPanning = false;
      this.container.style.cursor = '';
    });

    this.container.addEventListener('dblclick', (e) => {
      // Controlla se c'è un pezzo sotto il cursore
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      let bestId = null, bestArea = Infinity;
      for (const el of els) {
        if (!el.getAttribute) continue;
        const id = el.getAttribute('data-piece-id') || (el.dataset && el.dataset.hitAreaFor);
        if (!id || !this._pieceBBox.has(id)) continue;
        const bb = this._pieceBBox.get(id);
        const area = (bb.maxX - bb.minX) * (bb.maxY - bb.minY);
        if (area < bestArea) { bestArea = area; bestId = id; }
      }
      if (bestId) {
        // Doppio click su pezzo → popup dettagli
        const name = this._getPieceName(bestId);
        if (name) this._emit('piece-dblclick', { id: bestId, name });
      } else {
        // Doppio click su spazio vuoto → reset zoom
        this._scale = 1;
        this._translateX = 0;
        this._translateY = 0;
        this._applyTransform();
      }
    });
  }

  /**
   * Rimuove i 4 path che formano il rettangolo di bordo del disegno.
   * Si tratta di path senza data-piece-id le cui coordinate stanno tutte
   * ai bordi del viewBox (x≈0 o x≈width, y≈0 o y≈height).
   */
  _removeBorderPaths() {
    if (!this.svgElement) return;
    const vb = this.svgElement.viewBox?.baseVal;
    if (!vb) return;
    const W = vb.width, H = vb.height;
    const eps = W * 0.01; // tolleranza 1% della larghezza

    this.svgElement.querySelectorAll('path:not([data-piece-id])').forEach(p => {
      const d = p.getAttribute('d') || '';
      const nums = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
      if (!nums || nums.length < 2) return;
      // Tutte le coordinate devono stare vicino ai bordi (0 o W per x, 0 o H per y)
      const onEdge = (v, max) => v < eps || v > max - eps;
      let allOnEdge = true;
      for (let i = 0; i < nums.length - 1; i += 2) {
        const x = parseFloat(nums[i]), y = parseFloat(nums[i + 1]);
        if (!onEdge(x, W) && !onEdge(y, H)) { allOnEdge = false; break; }
      }
      if (allOnEdge) p.remove();
    });
  }

  _applyTransform() {
    if (this.svgElement) {
      this.svgElement.style.transform =
        `translate(${this._translateX}px, ${this._translateY}px) scale(${this._scale})`;
      this.svgElement.style.transformOrigin = '0 0';
    }
  }

  highlightCode(code) {
    if (!this.svgElement) return;
    const texts = this.svgElement.querySelectorAll('text');
    texts.forEach(t => {
      if (t.textContent.trim().includes(code)) {
        t.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const bbox = t.getBBox();
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', bbox.x - 2);
        rect.setAttribute('y', bbox.y - 2);
        rect.setAttribute('width', bbox.width + 4);
        rect.setAttribute('height', bbox.height + 4);
        rect.setAttribute('fill', 'none');
        rect.setAttribute('stroke', '#e05555');
        rect.setAttribute('stroke-width', '2');
        t.parentElement.insertBefore(rect, t);
      }
    });
  }
}
