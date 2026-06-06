/**
 * TreeNav - Componente albero navigazione
 * Renderizza un albero espandibile con icone e selezione.
 */
export class TreeNav {
  constructor(container) {
    this.container = container;
    this._listeners = {};
    this._selectedEl = null;
  }

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(cb => cb(data));
  }

  build(treeData) {
    this.container.innerHTML = '';
    if (!treeData || treeData.length === 0) {
      this.container.innerHTML = '<li class="tree-empty">Nessun dato disponibile</li>';
      return;
    }
    treeData.forEach(node => this.container.appendChild(this._createNode(node)));
  }

  _createNode(node) {
    const li = document.createElement('li');
    li.className = 'tree-node';
    li.dataset.nodeId = node.id;
    li.dataset.nodeType = node.type;

    const hasChildren = node.children && node.children.length > 0;

    // Content row
    const content = document.createElement('div');
    content.className = 'tree-node-content';

    // Toggle arrow
    const toggle = document.createElement('span');
    toggle.className = `tree-toggle ${hasChildren ? '' : 'leaf'}`;
    toggle.innerHTML = hasChildren
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5l8 7-8 7z"/></svg>'
      : '';
    content.appendChild(toggle);

    // Icon
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.innerHTML = this._getIcon(node.type, node.icon);
    content.appendChild(icon);

    // Label
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.label;
    // Non usiamo title nativo (non si chiude programmaticamente).
    // Il tooltip custom e gestito via mouseenter/mouseleave.
    content.appendChild(label);

    li.appendChild(content);

    // Children
    if (hasChildren) {
      const childrenUl = document.createElement('ul');
      childrenUl.className = 'tree-children';
      node.children.forEach(child => childrenUl.appendChild(this._createNode(child)));
      li.appendChild(childrenUl);

      // Toggle expand/collapse
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = childrenUl.classList.toggle('open');
        toggle.classList.toggle('expanded', isOpen);
        // Accordion: aprendo un gruppo, chiudi gli altri gruppi aperti
        if (isOpen && node.type === 'group') this._collapseOtherGroups(li);
      });
    }

    // Select on click
    content.addEventListener('click', () => {
      // Deseleziona precedente
      if (this._selectedEl) this._selectedEl.classList.remove('selected');
      content.classList.add('selected');
      this._selectedEl = content;

      // Auto-expand
      if (hasChildren) {
        const childrenUl = li.querySelector(':scope > .tree-children');
        if (childrenUl && !childrenUl.classList.contains('open')) {
          childrenUl.classList.add('open');
          toggle.classList.add('expanded');
        }
        // Accordion: aprendo un gruppo, chiudi gli altri gruppi aperti
        if (node.type === 'group') this._collapseOtherGroups(li);
      }

      this._emit('select', {
        type: node.type,
        id: node.id,
        data: node.data,
      });
    });

    // Doppio click: chiudi tooltip e notifica
    content.addEventListener('dblclick', () => {
      this._hideTreeTooltip();
      this._emit('dblclick', { type: node.type, id: node.id, data: node.data });
    });

    // Hover su nodi tavola: preview SVG
    if (node.type === 'table') {
      content.addEventListener('mouseenter', (e) => {
        this._emit('node-hover', { type: node.type, id: node.id, data: node.data, clientX: e.clientX, clientY: e.clientY });
      });
      content.addEventListener('mouseleave', () => {
        this._emit('node-unhover', {});
      });
    }

    return li;
  }

  /**
   * Accordion sui gruppi: chiude tutti i gruppi aperti tranne quello passato.
   * Utile quando le liste pezzi sono lunghe.
   */
  // ─── Tooltip custom ───

  _showTreeTooltip(event, html) {
    let tt = document.getElementById('tree-tooltip-custom');
    if (!tt) {
      tt = document.createElement('div');
      tt.id = 'tree-tooltip-custom';
      tt.className = 'tree-tooltip-custom';
      document.body.appendChild(tt);
    }
    tt.innerHTML = html;
    tt.style.display = 'block';
    this._moveTreeTooltip(event);
  }

  _moveTreeTooltip(event) {
    const tt = document.getElementById('tree-tooltip-custom');
    if (!tt || tt.style.display === 'none') return;
    tt.style.left = (event.clientX + 14) + 'px';
    tt.style.top  = (event.clientY - 6) + 'px';
  }

  _hideTreeTooltip() {
    const tt = document.getElementById('tree-tooltip-custom');
    if (tt) tt.style.display = 'none';
  }

  _collapseOtherGroups(currentLi) {
    this.container.querySelectorAll('.tree-node[data-node-type="group"]').forEach(li => {
      if (li === currentLi) return;
      // Non chiudere antenati o discendenti del gruppo aperto (vista annidata)
      if (li.contains(currentLi) || currentLi.contains(li)) return;
      const ul = li.querySelector(':scope > .tree-children');
      if (ul && ul.classList.contains('open')) {
        ul.classList.remove('open');
        const tg = li.querySelector(':scope > .tree-node-content > .tree-toggle');
        if (tg) tg.classList.remove('expanded');
      }
    });
  }

  _getIcon(type, icon) {
    switch (type) {
      // Macchina: icona "macchinario / impianto"
      case 'machine':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="#1d4fd8" stroke-width="1.8"><path d="M3 21h18"/><path d="M4 21V10l6 3V10l6 3V8l4 2v11"/><path d="M9 6V3h3v3"/></svg>';
      // Sezione: gruppo di moduli (4 blocchi)
      case 'section':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
      // Gruppo: sotto-assieme (due scatole sovrapposte)
      case 'group':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="1.8"><path d="M3.5 7.5 10 4l6.5 3.5L10 11z"/><path d="M3.5 7.5V15l6.5 3.5V11"/><path d="M16.5 7.5V15L10 18.5"/><path d="M20.5 9.5 14 13v7l6.5-3.5z"/></svg>';
      // Tavola: disegno tecnico
      case 'table':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 8h18M8 8v13"/><path d="M12 12h6M12 15h6M12 18h4"/></svg>';
      // Particolare: bullone / dado esagonale
      case 'part':
        return '<svg viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.8"><path d="M12 2.5 20 7v10l-8 4.5L4 17V7z"/><circle cx="12" cy="12" r="3.2"/></svg>';
      default:
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/></svg>';
    }
  }

  selectByNodeId(nodeId) {
    const el = this.container.querySelector(`[data-node-id="${nodeId}"] > .tree-node-content`);
    if (el) {
      if (this._selectedEl) this._selectedEl.classList.remove('selected');
      el.classList.add('selected');
      this._selectedEl = el;

      // Expand parent nodes
      let parent = el.closest('.tree-children');
      while (parent) {
        parent.classList.add('open');
        const toggle = parent.previousElementSibling?.querySelector('.tree-toggle');
        if (toggle) toggle.classList.add('expanded');
        parent = parent.parentElement?.closest('.tree-children');
      }

      // Scroll into view
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  deselectAll() {
    if (this._selectedEl) {
      this._selectedEl.classList.remove('selected');
      this._selectedEl = null;
    }
  }
}
