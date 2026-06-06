/**
 * Cart - Gestione carrello ordini
 * Aggiunta/rimozione parti, persistenza locale, rendering modale.
 */
export class Cart {
  constructor() {
    this.items = [];
    this.notes = '';
    this.operator = '';
    this._listeners = {};

    // Carica da localStorage se disponibile
    this._loadFromStorage();
    this._bindModalEvents();
  }

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(cb => cb(data));
  }

  get itemCount() {
    return this.items.length;
  }

  addItem(item) {
    // Controlla se esiste gia
    const existing = this.items.find(i => i.code === item.code && i.table === item.table);
    if (existing) {
      existing.quantity += item.quantity || 1;
    } else {
      this.items.push({
        pos: this.items.length + 1,
        code: item.code,
        description: item.description || '',
        quantity: item.quantity || 1,
        table: item.table || '',
        group: item.group || '',
        svgPath: item.svgPath || '',
        pieceName: item.pieceName || '',
      });
    }
    this._save();
    this._emit('change');
  }

  removeItem(index) {
    this.items.splice(index, 1);
    // Rinumera posizioni
    this.items.forEach((item, i) => item.pos = i + 1);
    this._save();
    this._emit('change');
  }

  clear() {
    this.items = [];
    this._save();
    this._emit('change');
  }

  updateQuantity(index, qty) {
    if (index >= 0 && index < this.items.length) {
      this.items[index].quantity = Math.max(1, qty);
      this._save();
      this._emit('change');
    }
  }

  openModal() {
    const modal = document.getElementById('cart-modal');
    modal.classList.remove('hidden');
    this._renderTable();
    document.getElementById('cart-notes').value = this.notes;
    document.getElementById('cart-operator').value = this.operator;
  }

  _bindModalEvents() {
    // Svuota tutto
    document.getElementById('cart-clear')?.addEventListener('click', () => {
      if (this.items.length > 0) {
        this.clear();
        this._renderTable();
      }
    });

    // Note e operatore
    document.getElementById('cart-notes')?.addEventListener('input', (e) => {
      this.notes = e.target.value;
      this._save();
    });
    document.getElementById('cart-operator')?.addEventListener('input', (e) => {
      this.operator = e.target.value;
      this._save();
    });

    // Export
    document.getElementById('cart-export-xlsx')?.addEventListener('click', () => this.exportExcel());
    document.getElementById('cart-export-pdf')?.addEventListener('click', () => this.exportPDF());
    document.getElementById('cart-print')?.addEventListener('click', () => this.print());
  }

  _renderTable() {
    const tbody = document.getElementById('cart-body');
    if (!tbody) return;

    if (this.items.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;">
          Carrello vuoto
        </td></tr>`;
      return;
    }

    tbody.innerHTML = this.items.map((item, idx) => `
      <tr>
        <td>${item.pos}</td>
        <td><div class="cart-thumb" id="cart-thumb-${idx}" style="width:140px;height:100px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid var(--border);border-radius:3px;overflow:hidden;"></div></td>
        <td style="font-weight:600">${item.code}</td>
        <td>${item.description}</td>
        <td>${item.table}</td>
        <td>
          <input type="number" value="${item.quantity}" min="1" style="width:50px;text-align:center;
            background:var(--bg-surface);border:1px solid var(--border);color:var(--text-primary);
            border-radius:3px;padding:2px 4px;" data-idx="${idx}" class="cart-qty-input">
        </td>
        <td>${item.group}</td>
        <td><button class="btn-remove" data-idx="${idx}">&times;</button></td>
      </tr>
    `).join('');

    // Carica i thumbnail in modo asincrono
    this.items.forEach((item, idx) => {
      this._renderPieceThumbnail(item.svgPath, item.pieceName).then(svgHtml => {
        const el = document.getElementById(`cart-thumb-${idx}`);
        if (el && svgHtml) el.innerHTML = svgHtml;
      });
    });

    // Bind eventi
    tbody.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this.removeItem(parseInt(btn.dataset.idx));
        this._renderTable();
      });
    });

    tbody.querySelectorAll('.cart-qty-input').forEach(input => {
      input.addEventListener('change', (e) => {
        this.updateQuantity(parseInt(input.dataset.idx), parseInt(e.target.value));
      });
    });
  }

  /**
   * Estrae dal SVG solo i path del pezzo specifico, senza testi (numeri di
   * posizione) e senza linee tratteggiate (callout). Ritorna SVG markup
   * croppato sul bbox del pezzo, o stringa vuota se non disponibile.
   */
  async _renderPieceThumbnail(svgPath, pieceName) {
    if (!svgPath || !pieceName) return '';
    const cache = (this._svgCache ||= new Map());
    let svgText = cache.get(svgPath);
    if (svgText === undefined) {
      try {
        svgText = await window.catalog.readSvg(svgPath);
      } catch {
        svgText = null;
      }
      cache.set(svgPath, svgText || null);
    }
    if (!svgText) return '';

    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return '';

    const targets = Array.from(svg.querySelectorAll(`[data-piece-name="${CSS.escape(String(pieceName))}"]`))
      .filter(el => el.tagName.toLowerCase() !== 'text')
      .filter(el => {
        const dash = el.getAttribute('stroke-dasharray');
        return !dash || dash === 'none';
      });
    if (targets.length === 0) return '';

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of targets) {
      if (el.tagName.toLowerCase() !== 'path') continue;
      const d = el.getAttribute('d') || '';
      const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
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
    const pad = Math.max(w, h) * 0.08;
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
      // Forza colore nero e stroke visibile (vector-effect mantiene
      // lo spessore costante in pixel anche dopo lo zoom del viewBox)
      c.setAttribute('stroke', '#222');
      c.setAttribute('stroke-width', '1');
      c.setAttribute('vector-effect', 'non-scaling-stroke');
      c.setAttribute('fill', 'none');
      out.appendChild(c);
    }
    return out.outerHTML;
  }

  // ─── Export ───

  async exportExcel() {
    // Genera CSV come fallback (SheetJS sara aggiunto dopo)
    const header = 'Pos;Codice;Descrizione;Tavola;Quantita;Gruppo\n';
    const rows = this.items.map(i =>
      `${i.pos};${i.code};${i.description};${i.table};${i.quantity};${i.group}`
    ).join('\n');
    const notes = this.notes ? `\n\nNote: ${this.notes}` : '';
    const op = this.operator ? `\nOperatore: ${this.operator}` : '';
    const content = header + rows + notes + op;

    await window.catalog.saveFile({
      defaultName: `ordine_${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [
        { name: 'CSV', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      content,
    });
  }

  async exportPDF() {
    // HTML per stampa come PDF
    const html = this._generatePrintHTML();
    await window.catalog.saveFile({
      defaultName: `ordine_${new Date().toISOString().slice(0, 10)}.html`,
      filters: [
        { name: 'HTML', extensions: ['html'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      content: html,
    });
  }

  print() {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(this._generatePrintHTML());
    printWindow.document.close();
    printWindow.print();
  }

  _generatePrintHTML() {
    const rows = this.items.map(i => `
      <tr>
        <td>${i.pos}</td>
        <td><b>${i.code}</b></td>
        <td>${i.description}</td>
        <td>${i.table}</td>
        <td style="text-align:center">${i.quantity}</td>
        <td>${i.group}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Ordine Ricambi</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  h2 { font-size: 14px; color: #666; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f0f0f0; padding: 6px 8px; text-align: left; border: 1px solid #ccc; font-size: 11px; }
  td { padding: 4px 8px; border: 1px solid #ddd; }
  .notes { margin-top: 16px; padding: 8px; background: #f9f9f9; border: 1px solid #ddd; }
  .footer { margin-top: 16px; font-size: 11px; color: #666; }
</style></head><body>
<h1>Lista Parti di Ricambio</h1>
<h2>Data: ${new Date().toLocaleDateString('it-IT')}</h2>
<table>
  <thead><tr><th>Pos</th><th>Codice</th><th>Descrizione</th><th>Tavola</th><th>Qt.</th><th>Gruppo</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${this.notes ? `<div class="notes"><b>Note:</b> ${this.notes}</div>` : ''}
<div class="footer">
  ${this.operator ? `<b>Operatore:</b> ${this.operator}` : ''}
</div>
</body></html>`;
  }

  // ─── Persistenza ───

  _save() {
    try {
      localStorage.setItem('timage-cart', JSON.stringify({
        items: this.items,
        notes: this.notes,
        operator: this.operator,
      }));
    } catch (e) {
      // Ignore storage errors
    }
  }

  _loadFromStorage() {
    try {
      const saved = localStorage.getItem('timage-cart');
      if (saved) {
        const data = JSON.parse(saved);
        this.items = data.items || [];
        this.notes = data.notes || '';
        this.operator = data.operator || '';
      }
    } catch (e) {
      // Ignore
    }
  }
}
