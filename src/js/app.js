/**
 * Timage Catalog - Entry point renderer
 * Inizializza tutti i moduli e gestisce il flusso dell'app.
 */
import { CatalogManager } from './catalog.js';
import { TreeNav } from '../components/tree-nav.js';
import { SvgViewer } from './viewer-svg.js';
import { Viewer3D } from './viewer-3d.js';
import { Cart } from './cart.js';
import { SearchManager } from './search.js';
import { initSplitter } from './splitter.js';

class App {
  constructor() {
    this.catalog = new CatalogManager();
    this.treeNav = new TreeNav(document.getElementById('tree-view'));
    this.svgViewer = new SvgViewer(document.getElementById('svg-content'));
    this.viewer3d = null; // lazy init
    this.cart = new Cart();
    this.search = new SearchManager();
    this.history = [];  // [{ node, view }]
    this.future  = [];  // [{ node, view }]
    this.currentView = '3d'; // '3d' o 'tree'
    this._treeHierarchy = 'flat'; // 'flat' | 'nested'
    // Stato navigazione condiviso tra le due viste
    this._activeGroup = null;  // groupId corrente
    this._activeTable = null;  // tableId corrente (solo Esplosi)
    this._activePart  = null;  // part.code corrente
  }

  async init() {
    console.log('Timage Catalog - Inizializzazione...');

    // Carica il catalogo
    await this.catalog.init();

    // Costruisci l'albero (in base alla vista corrente: 3D = pezzi, Esplosi = tavole)
    this._treeMode = (this.currentView === '3d') ? '3d' : '2d';
    this._buildTree();
    const titleEl = document.getElementById('model-title');
    if (titleEl) titleEl.textContent = this.catalog.currentModel?.name || 'Catalogo';

    // Event listeners
    this.bindEvents();

    // Init splitter
    initSplitter();

    // Pre-carica SVG layout per quando si passa a vista Esplosi
    const serial = this.catalog.currentModel?.serial;
    if (serial) {
      this.svgViewer.load(`models/${serial}/svg/layout.svg`);
    }

    // Mostra toolbar 3D all'avvio (vista 3D è default)
    const threeUI = [document.getElementById('three-nav'), document.getElementById('three-toolbar')];
    threeUI.forEach(el => { if (el) el.style.display = 'flex'; });

    // Carica il viewer 3D
    this._preload3D();

    console.log('Inizializzazione completata.');
  }

  async _preload3D() {
    const canvas = document.getElementById('three-canvas');
    this.viewer3d = new Viewer3D(canvas);
    this.viewer3d.on('select-section', (sectionNode) => this.on3DSelectSection(sectionNode));
    this.viewer3d.on('select-group', (groupNode) => this.on3DSelectGroup(groupNode));
    // Click singolo su pezzo nel 3D: evidenzia (arancione) + selezione footer, NO popup
    this.viewer3d.on('select-part', (partName) => {
      this.on3DSelectPart(partName);
    });
    // Doppio click su pezzo nel 3D: apre popup dettagli
    this.viewer3d.on('open-part', (partName) => {
      const norm = this._norm(partName);
      const part = this.catalog.parts.find(p => this._norm(p.code) === norm);
      if (part) this._openPartInfoModal3D(part.code);
    });
    this.viewer3d.on('tooltip-info', ({ nodeName, callback }) => {
      callback(this._getTooltipInfo(nodeName));
    });
    this.viewer3d.on('check-part', ({ nodeName, callback }) => {
      const norm = this._norm(nodeName);
      const found = this.catalog.parts.some(p => this._norm(p.code) === norm);
      callback(found);
    });

    this._3dReady = false;
    this._3dReadyPromise = new Promise(async (resolve) => {
      const modelPath = this.catalog.get3DModelPath();
      if (modelPath) {
        await this.viewer3d.loadModel(modelPath);
        // Costruisci la gerarchia navigabile (sezioni/gruppi) dal catalogo
        this.viewer3d.setCatalogHierarchy(
          this.catalog.groups?.sections || [],
          this.catalog.currentLang,
          this.catalog.parts || []
        );
        document.getElementById('three-loading').classList.add('hidden');
      }
      this.viewer3d.resize();
      this._3dReady = true;
      console.log('3D pronto! Sezioni:', this.viewer3d.sectionNodes.map(s => s.name));
      // Mostra tabella sezioni all'avvio
      this._show3DSectionsTable();
      resolve();
    });
  }

  bindEvents() {
    // ─── Toolbar ───
    document.getElementById('btn-home').addEventListener('click', () => this.goHome());
    document.getElementById('btn-back').addEventListener('click', () => this.goBack());
    document.getElementById('btn-forward').addEventListener('click', () => this.goForward());
    document.getElementById('btn-search').addEventListener('click', () => this.search.open());
    document.getElementById('btn-cart').addEventListener('click', () => this.cart.openModal());
    document.getElementById('btn-help').addEventListener('click', () => this.showHelp());
    document.getElementById('btn-lang').addEventListener('click', () => this.toggleLanguage());

    // ─── View Tabs ───
    document.querySelectorAll('.view-tab[data-view]').forEach(tab => {
      tab.addEventListener('click', () => this.switchView(tab.dataset.view));
    });

    // ─── TreeView ───
    this.treeNav.on('select', (node) => { if (!this._navLock) this.onTreeSelect(node); });
    // Doppio click su un pezzo -> mostra la figura (tavola del gruppo)
    this.treeNav.on('dblclick', (node) => {
      if (node.type === 'part') this._openPartInfoModal3D(node.data);
    });
    // Nessun hover sull'albero: l'hover e solo sul canvas 3D.

    // ─── Selettore vista albero: piatta / annidata ───
    document.querySelectorAll('.tree-mode-btn[data-hier]').forEach(btn => {
      btn.addEventListener('click', () => {
        const hier = btn.dataset.hier;
        if (this._treeHierarchy === hier) return;
        this._treeHierarchy = hier;
        document.querySelectorAll('.tree-mode-btn[data-hier]').forEach(b =>
          b.classList.toggle('active', b.dataset.hier === hier));
        this._buildTree();
      });
    });

    // ─── Part Detail (combo nascosta, usata solo come store dati) ───
    const partSelect = document.getElementById('part-code-select');
    const onPartChange = () => {
      const code = partSelect.value;
      if (!code) return;
      const part = this.catalog.getPartByCode(code);
      if (part) {
        document.getElementById('part-description').textContent =
          part.description[this.catalog.currentLang] || part.description.it || '';
      }
      // Combo → 3D: evidenzia solo se il pezzo esiste nel 3D
      if (this.viewer3d && this.viewer3d.model) {
        if (this.viewer3d.hasNode(code)) {
          this.viewer3d.highlightPartByCode(code);
        } else {
          // Pezzo non presente: pulisci highlight, zoom sul gruppo, mostra toast
          this.viewer3d._clearPartHighlight();
          if (this.viewer3d.currentGroup) {
            this.viewer3d._fitCameraToNode(this.viewer3d.currentGroup.object);
          } else if (this.viewer3d.currentNode) {
            this.viewer3d._fitCameraToNode(this.viewer3d.currentNode.object);
          }
          this._showToast(`Pezzo ${code} non presente nel modello 3D`);
        }
      }
    };
    partSelect.addEventListener('change', onPartChange);

    // ─── Modali: chiudi ───
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.modal').classList.add('hidden');
      });
    });

    // ─── Ricerca ───
    document.getElementById('btn-do-search').addEventListener('click', () => {
      this.search.doSearch(this.catalog);
    });
    // Enter nel campo unificato lancia la ricerca
    document.getElementById('search-unified')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.search.doSearch(this.catalog);
    });
    this.search.on('navigate', (result) => {
      if (result.view === '3d') {
        // Evidenzia nel 3D: switcha vista, naviga al gruppo, evidenzia pezzo
        this.switchView('3d');
        const doHighlight = () => {
          if (!this.viewer3d?.model) return;
          const groupCode = result.group || this.catalog.getPartByCode(result.code)?.group;
          if (groupCode) this.viewer3d.navigateToGroup(groupCode, null);
          this.viewer3d.highlightPartByCode(result.code, true);
        };
        if (this._3dReadyPromise) this._3dReadyPromise.then(doHighlight);
        else doHighlight();
      } else {
        // Vista Tavola (Esplosi): result.table è già il vero SVG tableId
        this.switchView('tree');
        this.navigateToTable(result.table, result.code);
      }
    });

    // ─── SVG Navigation (click su numeri/codici nelle tavole) ───
    this.svgViewer.on('navigate', (ref) => this.onSvgNavigate(ref));

    // ─── Cart badge update ───
    this.cart.on('change', () => this.updateCartBadge());

    // ─── Tracking posizione mouse per tooltip SVG ───
    this._mouseX = 0;
    this._mouseY = 0;
    document.addEventListener('mousemove', (e) => {
      this._mouseX = e.clientX;
      this._mouseY = e.clientY;
      const tt = document.getElementById('svg-piece-tooltip');
      if (tt && tt.style.display === 'block') {
        tt.style.left = (e.clientX + 15) + 'px';
        tt.style.top = (e.clientY - 10) + 'px';
      }
      const pt = document.getElementById('svg-preview-tooltip');
      if (pt && pt.style.display === 'block') {
        pt.style.left = (e.clientX + 15) + 'px';
        pt.style.top  = (e.clientY - 10) + 'px';
      }
    });

    // ─── Preview SVG su hover nodo tavola nell'albero ───
    this.treeNav.on('node-hover', ({ data, clientX, clientY }) => {
      if (data?.svgPath) this._showSvgPreviewTooltip(data.svgPath, clientX, clientY);
    });
    this.treeNav.on('node-unhover', () => this._hideSvgPreviewTooltip());

    // ─── Preview SVG su hover riferimento TAV- nel disegno ───
    this.svgViewer.on('ref-hover', ({ refType, clientX, clientY }) => {
      if (!refType) { this._hideSvgPreviewTooltip(); return; }
      if (refType.type === 'table-ref') {
        const { groupCode, page } = refType.value;
        const allTables = this.catalog.getTablesForGroup(groupCode);
        const detailTables = allTables.filter(t => !/_00_\d+$/.test(t.id));
        const idx = Math.max(0, Math.min(page, detailTables.length - 1));
        const svgPath = detailTables[idx]?.svgPath;
        if (svgPath) this._showSvgPreviewTooltip(svgPath, clientX, clientY);
        else this._hideSvgPreviewTooltip();
      }
    });

    // ─── Interattività pezzi annotati SVG ───
    this.svgViewer.on('piece-hover', ({ name }) => {
      this._highlightTableRow(name, 'hover');

      // Controlla se è un riferimento TAV- (i testi TAV- possono avere hitArea
      // che cattura i mouse events prima del mouseenter sul testo stesso)
      const tavMatch = name && String(name).match(/^TAV-\d+\.(.+?)\.(\d+)\/(\d+)$/);
      if (tavMatch) {
        const groupCode = tavMatch[1];
        const page = parseInt(tavMatch[2]) - 1;
        const allTables = this.catalog.getTablesForGroup(groupCode);
        const detailTables = allTables.filter(t => !/_00_\d+$/.test(t.id));
        const idx = Math.max(0, Math.min(page, detailTables.length - 1));
        const svgPath = detailTables[idx]?.svgPath;
        if (svgPath) this._showSvgPreviewTooltip(svgPath, this._mouseX, this._mouseY);
        else this._hideSvgPreviewTooltip();
        this._hideSvgPieceTooltip();
      } else if (name) {
        this._showSvgPieceTooltip(name, this._mouseX, this._mouseY);
        this._hideSvgPreviewTooltip();
      } else {
        this._hideSvgPieceTooltip();
        this._hideSvgPreviewTooltip();
      }
    });
    this.svgViewer.on('piece-click', ({ name }) => {
      this._hideSvgPieceTooltip();
      this._hideSvgPreviewTooltip();
      this._highlightTableRow(name, 'selected');
      // Aggiorna breadcrumb con codice e descrizione del pezzo
      const tableId = this.svgViewer.currentTableId;
      if (tableId && name) {
        const parts = this.catalog.getPartsForTable(tableId);
        const pos = String(name);
        const part = parts.find(p => {
          const pd = this.catalog.getPartPosData(tableId, p.code);
          return pd && String(pd.pos) === pos;
        });
        if (part) this.updateBreadcrumb({ type: 'part', id: part.code, data: part });
      }
    });
    // Doppio click su pezzo negli esplosi → popup dettagli
    this.svgViewer.on('piece-dblclick', ({ name }) => {
      if (!name) return;
      // Trova il codice del pezzo dal numero posizione nella tavola corrente
      const tableId = this.svgViewer.currentTableId;
      if (!tableId) return;
      const parts = this.catalog.getPartsForTable(tableId);
      const pos = String(name);
      // Cerca il pezzo con quella posizione nella tavola
      const part = parts.find(p => {
        const pd = this.catalog.getPartPosData(tableId, p.code);
        return pd && String(pd.pos) === pos;
      });
      if (part) this._openPartInfoModal(part.code, pos, this.catalog.getTableById(tableId)?.svgPath || '');
    });

    // ─── 3D Navigation ───
    document.getElementById('three-back').addEventListener('click', () => this.go3DBack());
    document.getElementById('three-reset')?.addEventListener('click', () => this.reset3DView());

    // ─── 3D Toolbar ───
    document.getElementById('three-zoom-in').addEventListener('click', () => this.viewer3d?.zoomIn());
    document.getElementById('three-zoom-out').addEventListener('click', () => this.viewer3d?.zoomOut());
    document.getElementById('three-zoom-fit').addEventListener('click', () => this.viewer3d?.zoomFit());
    document.getElementById('three-view-front').addEventListener('click', () => this.viewer3d?.setView('front'));
    document.getElementById('three-view-top').addEventListener('click', () => this.viewer3d?.setView('top'));
    document.getElementById('three-view-side').addEventListener('click', () => this.viewer3d?.setView('side'));
    document.getElementById('three-wireframe').addEventListener('click', (e) => {
      if (!this.viewer3d) return;
      // Mostra/nasconde le parti in trasparenza (contesto del gruppo)
      const showing = this.viewer3d.toggleTransparency();
      e.currentTarget.classList.toggle('active', !showing);
    });
  }

  /**
   * Costruisce l'albero di sinistra in base alla vista:
   * - 3D     -> sezioni/gruppi/PEZZI
   * - Esplosi-> sezioni/gruppi/TAVOLE
   */
  _buildTree() {
    const nested = this._treeHierarchy === 'nested';
    let data;
    if (this._treeMode === '3d') {
      data = nested ? this.catalog.getTreeData3DNested() : this.catalog.getTreeData3D();
    } else {
      data = nested ? this.catalog.getTreeDataNested() : this.catalog.getTreeData();
    }
    this.treeNav.build(data);
  }

  switchView(view) {
    this.currentView = view;
    // Aggiorna la view nell'ultimo entry della history
    if (this.history.length > 0) {
      this.history[this.history.length - 1].view = view;
    }
    document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));

    // Rigenera l'albero solo se cambia il tipo (3D pezzi <-> Esplosi tavole)
    const treeMode = (view === '3d') ? '3d' : '2d';
    const treeChanged = this._treeMode !== treeMode;
    if (treeChanged) {
      this._treeMode = treeMode;
      this._buildTree();
      // Ripristina selezione albero e stato nella nuova vista (async, non blocca)
      this._restoreSelectionAfterViewSwitch(view);
    }

    const svgPanel = document.getElementById('svg-viewer');
    const threePanel = document.getElementById('three-viewer');

    const threeUI = [document.getElementById('three-nav'), document.getElementById('three-toolbar')];

    if (view === '3d') {
      svgPanel.classList.remove('active');
      threePanel.classList.add('active');
      threeUI.forEach(el => { if (el) el.style.display = 'flex'; });
      this.init3DViewer();
      // In vista 3D non si mostra la distinta sotto la tavola (c'e l'albero pezzi)
      this._hide3DDetailPanel();
    } else {
      threePanel.classList.remove('active');
      svgPanel.classList.add('active');
      threeUI.forEach(el => { if (el) el.style.display = 'none'; });
    }

  }

  async init3DViewer() {
    // Il 3D e gia pre-caricato in _preload3D, basta fare resize
    if (this.viewer3d) {
      this.viewer3d.resize();
    }
  }

  async onTreeSelect(node, { pushHistory = true } = {}) {
    // node = { type: 'machine'|'section'|'group'|'table', id, data }
    const serial = this.catalog.currentModel?.serial;
    const baseSvg = `models/${serial}/svg`;

    if (node.type === 'machine') {
      this._activeGroup = null; this._activeTable = null; this._activePart = null;
      await this.svgViewer.load(`${baseSvg}/layout.svg`);
      this._syncTreeTo3D(node);
      this._show3DSectionsTable();
      document.getElementById('thumb-strip').classList.add('hidden');
    } else if (node.type === 'section') {
      this._activeGroup = null; this._activeTable = null; this._activePart = null;
      const sezNum = (node.data?.numero_sezione || node.id.replace('SEZ-', '')).padStart(2, '0');
      await this.svgViewer.load(`${baseSvg}/${sezNum}.svg`);
      this._syncTreeTo3D(node);
      this._show3DGroupsTable(node.data);
    } else if (node.type === 'group') {
      const groupId = node.data.id || node.data.code;
      this._activeGroup = groupId; this._activeTable = null; this._activePart = null;
      const tables = this.catalog.getTablesForGroup(groupId);
      if (tables.length > 0) {
        await this._loadTableNoSwitch(tables[0]);
        this._activeTable = tables[0].id;
      }
      if (this.currentView === '3d') {
        this._show3DPartsTable(groupId);
      } else {
        this._hide3DDetailPanel();
      }
      this._syncTreeTo3D(node);
    } else if (node.type === 'table') {
      this._activeGroup = node.data.groupId || this._activeGroup;
      this._activeTable = node.data.id;
      this._activePart = null;
      await this._loadTableNoSwitch(node.data);
      this._show3DPartsTable(node.data.groupId, node.data.id);
    } else if (node.type === 'part') {
      this._activePart = node.data?.code || null;
      if (node.data?.group) this._activeGroup = node.data.group;
      await this._onTreeSelectPart(node.data);
    }
    this.updateBreadcrumb(node);
  }

  /**
   * Click su un PEZZO nell'albero 3D: naviga al gruppo del pezzo (se serve),
   * evidenzia il pezzo nel modello 3D e lo seleziona nel footer.
   */
  async _onTreeSelectPart(part) {
    if (!part) return;
    if (this._3dReadyPromise) await this._3dReadyPromise;

    if (this.currentView === '3d' && this.viewer3d && this.viewer3d.model) {
      const curCode = this.viewer3d.currentGroup?.code || this.viewer3d.currentGroup?.name;
      const inGroup = curCode && this._norm(curCode) === this._norm(part.group);

      if (!inGroup && part.group) {
        this.viewer3d.navigateToGroup(part.group, null);
      }

      // fit=true: zooma sul pezzo evidenziato, altrimenti rimane fuori dalla vista
      this.viewer3d.highlightPartByCode(part.code, true);
    }

    this.on3DSelectPart(part.code);
  }

  /**
   * Sincronizza la selezione nel TreeView con il viewer 3D.
   * Aggiorna il 3D senza cambiare la vista corrente.
   */
  async _syncTreeTo3D(node) {
    // Aspetta che il 3D sia pronto
    if (this._3dReadyPromise) {
      await this._3dReadyPromise;
    }
    if (!this.viewer3d || !this.viewer3d.model) return;

    if (node.type === 'machine') {
      this.reset3DView();
      return;
    }

    const node3d = node.data?.['3dNode'] || node.data?.code || node.id;
    if (!node3d) return;

    if (node.type === 'section') {
      // Prova prima col 3dNode della sezione, poi col 3dNode del primo gruppo
      let result = this.viewer3d.navigateToSection(node3d);
      if (!result && node.data?.groups?.length > 0) {
        // Il 3dNode della sezione potrebbe non matchare direttamente.
        // Prova col codice del primo gruppo per trovare la sezione 3D che lo contiene.
        const firstGroupCode = node.data.groups[0].code || node.data.groups[0]['3dNode'];
        if (firstGroupCode) {
          result = this.viewer3d.navigateToSection(firstGroupCode);
        }
      }
      console.log('TreeView→3D sezione:', node3d, 'result:', result);
      const sectionLabel = node.data?.name?.[this.catalog.currentLang] || node3d;
      this._update3DBreadcrumb('section', sectionLabel);
      this._show3DInfo(`Sezione: ${sectionLabel} — Clicca su un gruppo per aprirlo`);
    } else if (node.type === 'group') {
      // Non passiamo sectionNode3d dal catalogo perche potrebbe non
      // corrispondere al nome della sezione nel glTF.
      // navigateToGroup fara la ricerca automatica con _findSectionContainingNode.
      const result = this.viewer3d.navigateToGroup(node3d, null);
      console.log('TreeView→3D gruppo:', node3d, 'result:', result);
      const groupLabel = node.data?.name?.[this.catalog.currentLang] || node3d;
      this._update3DBreadcrumb('group', groupLabel);
      this._hide3DInfo();
    }
  }

  /**
   * Trova il nodo 3D della sezione che contiene un gruppo.
   */
  _findSection3DForGroup(groupCode) {
    if (!this.catalog.groups?.sections) return null;
    for (const section of this.catalog.groups.sections) {
      for (const group of section.groups || []) {
        if (group.code === groupCode || group.id === groupCode) {
          return section['3dNode'] || null;
        }
      }
    }
    return null;
  }

  async loadTable(tableData) {
    await this._loadTableNoSwitch(tableData);
    this.switchView('tree');
  }

  async _loadTableNoSwitch(tableData) {
    const svgPath = tableData.svgPath;
    if (!svgPath) return;

    await this.svgViewer.load(svgPath);

    // Mostra dettaglio parte e miniature
    const parts = this.catalog.getPartsForTable(tableData.id);
    this.showPartDetail(parts, tableData);
    // this.showThumbnails(tableData.groupId);
  }

  showGroupParts(groupData) {
    const tables = this.catalog.getTablesForGroup(groupData.id);
    if (tables.length === 1) {
      this.loadTable(tables[0]);
    } else if (tables.length > 0) {
      // this.showThumbnails(groupData.id);
    }
  }

  /**
   * Mostra miniature: la tavola 00 di ogni gruppo dentro una sezione.
   */
  showSectionThumbnails(sectionData) {
    const strip = document.getElementById('thumb-strip');
    const scroll = document.getElementById('thumb-scroll');
    const groups = sectionData?.groups || [];
    const lang = this.catalog.currentLang;

    if (groups.length === 0) {
      strip.classList.add('hidden');
      return;
    }

    // Per ogni gruppo, prendi la prima tavola (pagina 00)
    const items = groups.map(g => {
      const tables = g.tables || [];
      const firstTable = tables[0] || null;
      const svgPath = firstTable
        ? `models/${this.catalog.currentModel?.serial}/svg/${firstTable}.svg`
        : null;
      return {
        groupId: g.id || g.code,
        groupCode: g.code,
        label: g.name?.[lang] || g.name?.it || g.code,
        svgPath,
        data: { ...g, id: g.id || g.code },
      };
    }).filter(item => item.svgPath);

    if (items.length === 0) {
      strip.classList.add('hidden');
      return;
    }

    strip.classList.remove('hidden');
    scroll.innerHTML = items.map((item, i) => `
      <div class="thumb-item" data-group-id="${item.groupId}">
        <div class="thumb-preview" id="sec-thumb-${i}"></div>
        <div class="thumb-label">${item.label}</div>
      </div>
    `).join('');

    // Carica SVG inline per ogni miniatura
    items.forEach(async (item, i) => {
      const previewEl = document.getElementById(`sec-thumb-${i}`);
      if (!previewEl || !item.svgPath) return;
      const svgContent = await window.catalog.readSvg(item.svgPath);
      if (svgContent) {
        previewEl.innerHTML = svgContent;
        const svg = previewEl.querySelector('svg');
        if (svg) {
          svg.style.width = '100%';
          svg.style.height = '100%';
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        }
      }
    });

    // Click su miniatura → naviga al gruppo
    scroll.querySelectorAll('.thumb-item').forEach(el => {
      el.addEventListener('click', () => {
        const item = items.find(it => it.groupId === el.dataset.groupId);
        if (item) {
          this.onTreeSelect({
            type: 'group',
            id: item.groupId,
            data: item.data,
          });
          this.treeNav.selectByNodeId(item.groupId);
          scroll.querySelectorAll('.thumb-item').forEach(e => e.classList.remove('active'));
          el.classList.add('active');
        }
      });
    });
  }

  showPartDetail(parts, tableData) {
    const panel = document.getElementById('part-detail');
    const select = document.getElementById('part-code-select');

    if (!parts || parts.length === 0) {
      if (panel) panel.classList.add('hidden');
      return;
    }

    // Filtra via i riferimenti TAV- (non sono pezzi reali)
    const realParts = parts.filter(p => !p.code.startsWith('TAV-'));
    if (realParts.length === 0) {
      if (panel) panel.classList.add('hidden');
      return;
    }

    if (panel) panel.classList.remove('hidden');
    select.innerHTML = realParts.map(p =>
      `<option value="${p.code}">${p.code}</option>`
    ).join('');

    // Seleziona il primo
    const first = realParts[0];
    document.getElementById('part-description').textContent =
      first.description[this.catalog.currentLang] || first.description.it || '';
    document.getElementById('part-group-code').textContent = tableData?.groupCode || '';
    document.getElementById('part-group-desc').textContent = tableData?.groupName || '';
  }

  /**
   * Mostra il pannello dettaglio con tutti i pezzi di un gruppo.
   */
  showGroupPartDetail(groupCode) {
    const parts = this.catalog.getPartsForGroup(groupCode);
    const lang = this.catalog.currentLang;

    // Filtra via TAV-
    const realParts = parts.filter(p => !p.code.startsWith('TAV-'));

    // Deduplica per codice
    const seen = new Set();
    const uniqueParts = realParts.filter(p => {
      if (seen.has(p.code)) return false;
      seen.add(p.code);
      return true;
    });

    if (uniqueParts.length === 0) {
      document.getElementById('part-detail')?.classList.add('hidden');
      return;
    }

    const panel = document.getElementById('part-detail');
    const select = document.getElementById('part-code-select');

    if (panel) panel.classList.remove('hidden');

    // Ordina per descrizione
    uniqueParts.sort((a, b) => {
      const descA = (a.description[lang] || a.description.it || '').toLowerCase();
      const descB = (b.description[lang] || b.description.it || '').toLowerCase();
      return descA.localeCompare(descB);
    });

    const has3D = this.viewer3d && this.viewer3d._nodeNames;

    select.innerHTML = uniqueParts.map(p => {
      const desc = p.description[lang] || p.description.it || '';
      const in3D = has3D ? this.viewer3d.hasNode(p.code) : true;
      return `<option value="${p.code}" data-in3d="${in3D}" ${!in3D ? 'style="color:#aaa"' : ''}>${desc} - ${p.code}${!in3D ? '  [no 3D]' : ''}</option>`;
    }).join('');

    if (!has3D && this._3dReadyPromise) {
      this._3dReadyPromise.then(() => {
        if (!this.viewer3d || !this.viewer3d._nodeNames) return;
        for (const opt of select.options) {
          const code = opt.value;
          const in3D = this.viewer3d.hasNode(code);
          opt.dataset.in3d = String(in3D);
          const part = this.catalog.getPartByCode(code);
          const desc = part ? (part.description[lang] || part.description.it || '') : '';
          if (!in3D) {
            opt.textContent = `${desc} - ${code}  [no 3D]`;
            opt.style.color = '#aaa';
          }
        }
      });
    }

    // Aggiorna la combo con le info 3D quando il modello è pronto
    if (this._3dReadyPromise) {
      this._3dReadyPromise.then(() => {
        if (!this.viewer3d || !this.viewer3d._nodeNames) return;
        for (const opt of select.options) {
          if (!this.viewer3d.hasNode(opt.value)) {
            opt.textContent = `${opt.value}  [no 3D]`;
            opt.dataset.no3d = 'true';
          }
        }
      });
    }

    const first = uniqueParts[0];
    document.getElementById('part-description').textContent =
      first.description[lang] || first.description.it || '';

    // Info gruppo
    const groupData = this._findGroupData(groupCode);
    document.getElementById('part-group-code').textContent = groupCode;
    document.getElementById('part-group-desc').textContent =
      groupData?.name?.[lang] || groupData?.name?.it || '';
  }



  showThumbnails(groupId) {
    const strip = document.getElementById('thumb-strip');
    const scroll = document.getElementById('thumb-scroll');
    const tables = this.catalog.getTablesForGroup(groupId);

    if (!tables || tables.length === 0) {
      strip.classList.add('hidden');
      return;
    }

    strip.classList.remove('hidden');
    // Crea i contenitori con placeholder
    scroll.innerHTML = tables.map((t, i) => `
      <div class="thumb-item" data-table-id="${t.id}">
        <div class="thumb-preview" id="thumb-preview-${i}"></div>
        <div class="thumb-label">${t.id.replace(/_\d+_\d+$/, '')} (${(t.id.match(/_(\d+)_/) || [])[1] || i})</div>
      </div>
    `).join('');

    // Carica SVG inline per ogni miniatura
    tables.forEach(async (t, i) => {
      const previewEl = document.getElementById(`thumb-preview-${i}`);
      if (!previewEl || !t.svgPath) return;
      const svgContent = await window.catalog.readSvg(t.svgPath);
      if (svgContent) {
        previewEl.innerHTML = svgContent;
        // Ridimensiona l'SVG per la miniatura
        const svg = previewEl.querySelector('svg');
        if (svg) {
          svg.style.width = '100%';
          svg.style.height = '100%';
          svg.style.maxWidth = '100%';
          svg.style.maxHeight = '100%';
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        }
      }
    });

    scroll.querySelectorAll('.thumb-item').forEach(el => {
      el.addEventListener('click', () => {
        const table = tables.find(t => t.id === el.dataset.tableId);
        if (table) this.loadTable(table);
        // Evidenzia miniatura attiva
        scroll.querySelectorAll('.thumb-item').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
      });
    });
  }

  addPartToCart() {
    const code = document.getElementById('part-code-select').value;
    const qty = parseInt(document.getElementById('part-qty').value) || 1;
    const part = this.catalog.getPartByCode(code);
    if (part) {
      this.cart.addItem({
        code: part.code,
        description: part.description[this.catalog.currentLang] || part.description.it,
        quantity: qty,
        table: part.table,
        group: part.group,
      });
    }
  }

  addGroupToCart() {
    const groupCode = document.getElementById('part-group-code').textContent;
    const qty = parseInt(document.getElementById('group-qty').value) || 1;
    const parts = this.catalog.getPartsForGroup(groupCode);
    parts.forEach(p => {
      this.cart.addItem({
        code: p.code,
        description: p.description[this.catalog.currentLang] || p.description.it,
        quantity: qty,
        table: p.table,
        group: p.group,
      });
    });
  }

  updateCartBadge() {
    const badge = document.getElementById('cart-badge');
    const count = this.cart.itemCount;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }

  /**
   * Normalizza un nome rimuovendo punti/trattini per match fuzzy
   * (il glTF rimuove i punti dai nomi dei nodi).
   */
  _norm(name) {
    return (name || '').replace(/[.\-\s]/g, '').toUpperCase();
  }

  on3DSelectSection(sectionName) {
    const sectionId = this._findTreeNodeForSection3D(sectionName);
    if (sectionId) {
      this.treeNav.selectByNodeId(sectionId);
    }

    const sectionLabel = this._getSectionLabel(sectionName);
    this._update3DBreadcrumb('section', sectionLabel || sectionName);
    this._show3DInfo(`Sezione: ${sectionLabel || sectionName} — Doppio click su un gruppo`);
    if (sectionId) {
      const section = this.catalog.groups?.sections?.find(s => s.id === sectionId);
      const node = { type: 'section', id: sectionId, data: section || {} };
      this.updateBreadcrumb(node);
      if (section) this._show3DGroupsTable(section);
    }
  }

  on3DSelectGroup(groupName) {
    const groupId = this._findTreeNodeForGroup3D(groupName);
    if (groupId) { this._activeGroup = groupId; this._activeTable = null; this._activePart = null; }
    if (groupId) {
      this.treeNav.selectByNodeId(groupId);
      const tables = this.catalog.getTablesForGroup(groupId);
      if (tables.length > 0) {
        // this.showThumbnails(groupId);
      }
      this.showGroupPartDetail(groupId);
    }

    const groupLabel = this._getGroupLabel(groupName);
    this._update3DBreadcrumb('group', groupLabel || groupName);
    this._hide3DInfo();
    if (groupId) {
      const groupData = this._getGroupData(groupId);
      const node = { type: 'group', id: groupId, data: groupData || { id: groupId, code: groupId } };
      this.updateBreadcrumb(node);
      this._show3DPartsTable(groupId);
    }
  }

  on3DSelectPart(partName) {
    // 3D → Footer: seleziona il pezzo nella combo del footer
    // Il nome 3D non ha punti, il codice nel catalogo sì
    const normName = this._norm(partName);

    // Cerca il pezzo nel catalogo con match fuzzy
    const part = this.catalog.parts.find(p => this._norm(p.code) === normName);
    if (part) { this._activePart = part.code; if (part.group) this._activeGroup = part.group; }

    if (part) {
      // Mostra il pannello dettaglio se nascosto
      const panel = document.getElementById('part-detail');
      if (panel) panel.classList.remove('hidden');

      // Seleziona nella combo
      const select = document.getElementById('part-code-select');
      // Aggiungi l'opzione se non c'è già
      let found = false;
      for (const opt of select.options) {
        if (opt.value === part.code) { found = true; break; }
      }
      if (!found) {
        select.innerHTML += `<option value="${part.code}">${part.code}</option>`;
      }
      select.value = part.code;

      // Aggiorna descrizione
      document.getElementById('part-description').textContent =
        part.description[this.catalog.currentLang] || part.description.it || '';

      console.log('3D→Pezzo selezionato:', part.code, part.description.it);
      this.updateBreadcrumb({ type: 'part', id: part.code, data: part });
    } else {
      console.log('3D→Pezzo non trovato nel catalogo:', partName, '(norm:', normName, ')');
    }
  }

  /**
   * Trova l'ID della sezione nell'albero che corrisponde a un nodo 3D.
   * Usa match fuzzy (senza punti).
   */
  _findTreeNodeForSection3D(node3dName) {
    if (!this.catalog.groups?.sections) return null;
    const norm3d = this._norm(node3dName);

    for (const section of this.catalog.groups.sections) {
      // Match diretto col 3dNode della sezione
      if (this._norm(section['3dNode']) === norm3d) return section.id;

      // Match coi gruppi dentro la sezione
      for (const group of section.groups || []) {
        if (this._norm(group['3dNode']) === norm3d || this._norm(group.code) === norm3d) {
          return section.id;
        }
      }
    }
    return null;
  }

  /**
   * Trova l'ID del gruppo nell'albero che corrisponde a un nodo 3D.
   * Usa match fuzzy (senza punti).
   */
  _findTreeNodeForGroup3D(node3dName) {
    if (!this.catalog.groups?.sections) return null;
    const norm3d = this._norm(node3dName);

    for (const section of this.catalog.groups.sections) {
      for (const group of section.groups || []) {
        if (this._norm(group.code) === norm3d ||
            this._norm(group['3dNode']) === norm3d ||
            this._norm(group.id) === norm3d) {
          return group.id || group.code;
        }
      }
    }
    return null;
  }

  _getSectionLabel(node3dName) {
    if (!this.catalog.groups?.sections) return null;
    const lang = this.catalog.currentLang;
    const norm3d = this._norm(node3dName);

    for (const section of this.catalog.groups.sections) {
      if (this._norm(section['3dNode']) === norm3d) {
        return section.name?.[lang] || section.name?.it;
      }
      // Cerca anche nei gruppi (la sezione potrebbe essere identificata da un gruppo figlio)
      for (const group of section.groups || []) {
        if (this._norm(group.code) === norm3d || this._norm(group['3dNode']) === norm3d) {
          return section.name?.[lang] || section.name?.it;
        }
      }
    }
    return null;
  }

  _getGroupLabel(groupCode) {
    if (!this.catalog.groups?.sections) return null;
    const lang = this.catalog.currentLang;
    const normCode = this._norm(groupCode);

    for (const section of this.catalog.groups.sections) {
      for (const group of section.groups || []) {
        if (this._norm(group.code) === normCode ||
            this._norm(group['3dNode']) === normCode ||
            this._norm(group.id) === normCode) {
          return group.name?.[lang] || group.name?.it;
        }
      }
    }
    return null;
  }

  go3DBack() {
    if (this.viewer3d) {
      this.viewer3d.goBack();
      const level = this.viewer3d.currentLevel;
      if (level === 'root') {
        this._update3DBreadcrumb('root');
        this._hide3DInfo();
        this.treeNav.selectByNodeId('root');
        this._show3DSectionsTable();
      } else if (level === 'section') {
        const name = this.viewer3d.currentNode?.name || '';
        const sectionLabel = this._getSectionLabel(name);
        this._update3DBreadcrumb('section', sectionLabel || name);
        this._show3DInfo(`Sezione: ${sectionLabel || name} — Doppio click su un gruppo`);
        const sectionId = this._findTreeNodeForSection3D(name);
        if (sectionId) {
          this.treeNav.selectByNodeId(sectionId);
          const section = this.catalog.groups?.sections?.find(s => s.id === sectionId);
          if (section) this._show3DGroupsTable(section);
        }
      }
    }
  }

  reset3DView() {
    if (this.viewer3d) {
      while (this.viewer3d.currentLevel !== 'root') {
        this.viewer3d.goBack();
      }
      this._update3DBreadcrumb('root');
      this._hide3DInfo();
      this.treeNav.selectByNodeId('root');
      this._show3DSectionsTable();
    }
  }

  _update3DBreadcrumb(level, name) {
    const bc = document.getElementById('three-breadcrumb');
    if (!bc) return;
    const modelName = this.catalog.currentModel?.name || 'Macchina';

    if (level === 'root') {
      bc.innerHTML = `<span class="three-crumb active">${modelName}</span>`;
    } else if (level === 'section') {
      bc.innerHTML = `
        <span class="three-crumb" data-action="reset">${modelName}</span>
        <span class="three-crumb active">${name}</span>
      `;
    } else if (level === 'group') {
      const sectionName = this.viewer3d?.currentNode?.name || '';
      bc.innerHTML = `
        <span class="three-crumb" data-action="reset">${modelName}</span>
        <span class="three-crumb" data-action="back">${sectionName}</span>
        <span class="three-crumb active">${name}</span>
      `;
    }

    // Bind click sui crumb
    bc.querySelectorAll('[data-action="reset"]').forEach(el => {
      el.addEventListener('click', () => this.reset3DView());
    });
    bc.querySelectorAll('[data-action="back"]').forEach(el => {
      el.addEventListener('click', () => this.go3DBack());
    });
  }

  _show3DInfo(text) {
    const info = document.getElementById('three-info');
    document.getElementById('three-info-text').textContent = text;
    info.classList.remove('hidden');
  }

  _hide3DInfo() {
    document.getElementById('three-info').classList.add('hidden');
  }

  navigateToTable(tableId, highlightCode) {
    const table = this.catalog.getTableById(tableId);
    if (table) {
      this.loadTable(table);
      if (highlightCode) {
        // Evidenzia per numero di posizione (data-piece-name), non per codice
        setTimeout(() => {
          const pos = this.catalog.getPartPosition(tableId, highlightCode);
          if (pos) {
            this.svgViewer.highlightPieceByName(pos, true);
          }
        }, 400);
      }
    }
  }

  updateBreadcrumb(node) {
    const breadcrumb = document.getElementById('breadcrumb');
    const path = this.catalog.getPathTo(node);

    // Safety net per parts: descrizione diretta da node.data se manca
    if (node?.type === 'part') {
      const last = path[path.length - 1];
      const desc = node.data?.description;
      const lang = this.catalog.currentLang;
      const descText = desc
        ? (typeof desc === 'string' ? desc : (desc[lang] || desc.it || desc.en || Object.values(desc)[0] || ''))
        : '';
      if (last?.type === 'part') {
        if (!last.sublabel) last.sublabel = descText;
      } else {
        path.push({ type: 'part', id: node.data?.code || node.id, label: node.data?.code || node.id, sublabel: descText });
      }
    }

    breadcrumb.innerHTML = path.map((p, i) => {
      const sep = i > 0 ? '<span class="crumb-sep">›</span>' : '';
      const sub = p.sublabel ? `<span class="crumb-sub">${p.sublabel}</span>` : '';
      return `${sep}<span class="crumb ${i === path.length - 1 ? 'active' : ''}" data-nav='${JSON.stringify(p)}'>
        <span class="crumb-main">${p.label}</span>${sub}
      </span>`;
    }).join('');

    breadcrumb.querySelectorAll('.crumb').forEach(el => {
      el.addEventListener('click', () => {
        const nav = JSON.parse(el.dataset.nav);
        if (nav.type === 'home') this.goHome();
        else this.onTreeSelect(nav);
      });
    });

    // History: push il path corrente (punto unico, non duplicato durante back/forward)
    if (!this._navLock) {
      this.history.push({ path: path.map(p => ({ type: p.type, id: p.id })), view: this.currentView });
      this.future = [];
      this._updateNavButtons();
    }
  }

  _updateNavButtons() {
    const btnBack = document.getElementById('btn-back');
    const btnFwd  = document.getElementById('btn-forward');
    if (btnBack) btnBack.disabled = this.history.length <= 1;
    if (btnFwd)  btnFwd.disabled  = this.future.length === 0;
  }

  _pushHistory(node) {
    this.history.push({ node, view: this.currentView });
    this.future = [];
    this._updateNavButtons();
  }

  _getGroupData(groupId) {
    for (const section of this.catalog.groups?.sections || []) {
      for (const group of section.groups || []) {
        if ((group.id || group.code) === groupId) return { ...group, id: groupId };
      }
    }
    return null;
  }

  goHome() {
    this.history = [];
    this.future  = [];
    this._updateNavButtons();
    this.treeNav.selectByNodeId('root');
    document.getElementById('part-detail')?.classList.add('hidden');
    document.getElementById('thumb-strip').classList.add('hidden');
    // Carica layout.svg come vista iniziale
    const serial = this.catalog.currentModel?.serial;
    if (serial) {
      this.svgViewer.load(`models/${serial}/svg/layout.svg`);
    } else {
      this.svgViewer.clear();
    }
    const m = this.catalog.currentModel;
    const sub = m?.serial ? `<span class="crumb-sub">${m.serial}</span>` : '';
    document.getElementById('breadcrumb').innerHTML =
      `<span class="crumb active"><span class="crumb-main">${m?.name || 'Home'}</span>${sub}</span>`;
  }

  /**
   * Gestisce i click su riferimenti dentro gli SVG.
   * ref = { type: 'section-num'|'group-code'|'table-ref', value, raw }
   */
  onSvgNavigate(ref) {
    console.log('SVG navigate:', ref);

    if (ref.type === 'section-num') {
      // Click su numero sezione (es. "01") → naviga alla sezione
      const sectionId = `SEZ-${ref.value}`;
      const section = this.catalog.groups?.sections?.find(s => s.id === sectionId);
      if (section) {
        this.onTreeSelect({
          type: 'section',
          id: sectionId,
          data: section,
        });
        this.treeNav.selectByNodeId(sectionId);
      }
    } else if (ref.type === 'group-code') {
      // Click su codice gruppo → naviga al gruppo
      const groupData = this._findGroupData(ref.value);
      if (groupData) {
        this.onTreeSelect({
          type: 'group',
          id: groupData.id || groupData.code,
          data: groupData,
        });
        this.treeNav.selectByNodeId(groupData.id || groupData.code);
      }
    } else if (ref.type === 'table-ref') {
      // Click su riferimento tavola (TAV-XX.CODICE.PAGINA/TOTALE)
      // Esclude la copertina _00_ dalle tavole navigabili
      const { groupCode, page } = ref.value;
      const allTables = this.catalog.getTablesForGroup(groupCode);
      const detailTables = allTables.filter(t => !/_00_\d+$/.test(t.id));
      if (detailTables.length > 0) {
        const idx = Math.max(0, Math.min(page, detailTables.length - 1));
        const targetTable = detailTables[idx];
        this.onTreeSelect({
          type: 'table',
          id: targetTable.id,
          data: targetTable,
        });
        this.treeNav.selectByNodeId(targetTable.id);
      }
    }
  }

  _findGroupData(groupCode) {
    if (!this.catalog.groups?.sections) return null;
    for (const section of this.catalog.groups.sections) {
      for (const group of section.groups || []) {
        if (group.code === groupCode || group.id === groupCode) {
          return { ...group, id: group.id || group.code };
        }
      }
    }
    return null;
  }

  _nodeFromPathItem({ type, id }) {
    if (type === 'section') {
      const data = this.catalog.groups?.sections?.find(s => s.id === id) || {};
      return { type, id, data };
    }
    if (type === 'group') {
      return { type, id, data: this._getGroupData(id) || { id, code: id } };
    }
    if (type === 'table') {
      const data = this.catalog.getTableById(id) || { id };
      return { type, id, data };
    }
    if (type === 'part') {
      const data = this.catalog.parts.find(p => p.code === id) || { code: id };
      return { type, id, data };
    }
    return { type, id, data: {} };
  }

  async _restoreEntry(entry) {
    this._navLock = true;
    try {
      if (entry.view && entry.view !== this.currentView) this.switchView(entry.view);
      const last = entry.path[entry.path.length - 1];
      if (!last || last.type === 'home') { this.goHome(); return; }
      const node = this._nodeFromPathItem(last);
      this.treeNav.selectByNodeId(node.id);
      await this.onTreeSelect(node, { pushHistory: false });
    } finally {
      this._navLock = false;
    }
  }

  goBack() {
    if (this.history.length <= 1) { this.goHome(); return; }
    const curr = this.history.pop();
    this.future.unshift(curr);
    this._restoreEntry(this.history[this.history.length - 1]);
    this._updateNavButtons();
  }

  goForward() {
    if (!this.future.length) return;
    const next = this.future.shift();
    this.history.push(next);
    this._restoreEntry(next);
    this._updateNavButtons();
  }

  toggleLanguage() {
    this.catalog.toggleLanguage();
    document.getElementById('current-lang').textContent =
      this.catalog.currentLang.toUpperCase();
    // Ricarica albero con nuova lingua (rispettando la vista corrente)
    this._buildTree();
  }

  showHelp() {
    alert('Timage Technical Documentation\nVersione 2.0\n\nNavigazione: usa l\'albero o la vista 3D per esplorare le sezioni.\nCarrello: seleziona i pezzi e aggiungili al carrello per l\'ordine.');
  }

  // ─── Pannello tabella 3D ───

  /**
   * Mostra tabella sezioni nel footer 3D (livello macchina).
   */
  _show3DSectionsTable() {
    // In vista 3D non si mostra la distinta sotto la tavola
    if (this.currentView === '3d') { this._hide3DDetailPanel(); return; }
    const panel = document.getElementById('three-detail-panel');
    const content = document.getElementById('three-detail-content');
    const lang = this.catalog.currentLang;
    const sections = this.catalog.groups?.sections || [];

    panel.classList.remove('hidden');
    document.getElementById('part-detail')?.classList.add('hidden');

    content.innerHTML = `
      <table>
        <thead><tr>
          <th>N.</th><th>Sezione</th><th>Gruppi</th><th></th>
        </tr></thead>
        <tbody>${sections.map((s, i) => `
          <tr data-section-id="${s.id}" data-3d-node="${s['3dNode'] || ''}">
            <td>${s.id.replace('SEZ-', '')}</td>
            <td><b>${s.name?.[lang] || s.name?.it || s.id}</b></td>
            <td>${(s.groups || []).length}</td>
            <td><button class="btn-enter" data-section-id="${s.id}">Entra</button></td>
          </tr>
        `).join('')}</tbody>
      </table>`;

    // Click riga = evidenzia sezione nel 3D
    content.querySelectorAll('tr[data-section-id]').forEach(row => {
      row.addEventListener('click', () => {
        content.querySelectorAll('tr').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        const node3d = row.dataset['3dNode'] || row.dataset.sectionId;
        if (this.viewer3d) {
          this.viewer3d.highlightSection(node3d);
        }
      });
    });

    // Bottone Entra: naviga alla sezione come da treeview
    content.querySelectorAll('.btn-enter[data-section-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sectionId = btn.dataset.sectionId;
        const section = sections.find(s => s.id === sectionId);
        if (section) {
          this.treeNav.selectByNodeId(sectionId);
          this.onTreeSelect({
            type: 'section',
            id: sectionId,
            data: section,
          });
        }
      });
    });
  }

  /**
   * Mostra tabella gruppi della sezione nel footer 3D (livello sezione).
   */
  _show3DGroupsTable(section) {
    // In vista 3D non si mostra la distinta sotto la tavola
    if (this.currentView === '3d') { this._hide3DDetailPanel(); return; }
    const panel = document.getElementById('three-detail-panel');
    const content = document.getElementById('three-detail-content');
    const lang = this.catalog.currentLang;
    const groups = section.groups || [];

    panel.classList.remove('hidden');
    document.getElementById('part-detail')?.classList.add('hidden');

    content.innerHTML = `
      <table>
        <thead><tr>
          <th>Codice</th><th>Gruppo</th><th>Tavole</th><th></th>
        </tr></thead>
        <tbody>${groups.map(g => `
          <tr data-group-code="${g.code}" data-3d-node="${g['3dNode'] || g.code}">
            <td>${g.code}</td>
            <td><b>${g.name?.[lang] || g.name?.it || g.code}</b></td>
            <td>${(g.tables || []).length}</td>
            <td><button class="btn-enter" data-group-code="${g.code}">Entra</button></td>
          </tr>
        `).join('')}</tbody>
      </table>`;

    // Click riga = evidenzia gruppo nel 3D (alpha transparency)
    content.querySelectorAll('tr[data-group-code]').forEach(row => {
      row.addEventListener('click', () => {
        content.querySelectorAll('tr').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        const node3d = row.dataset['3dNode'];
        if (this.viewer3d) {
          this.viewer3d.highlightGroup(node3d);
        }
      });
    });

    // Bottone Entra: naviga al gruppo come da treeview
    content.querySelectorAll('.btn-enter[data-group-code]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupCode = btn.dataset.groupCode;
        const groupData = groups.find(g => g.code === groupCode);
        if (groupData) {
          const groupId = groupData.id || groupData.code;
          this.treeNav.selectByNodeId(groupId);
          this.onTreeSelect({
            type: 'group',
            id: groupId,
            data: { ...groupData, id: groupId },
          });
        }
      });
    });
  }

  /**
   * Mostra tabella pezzi nel footer 3D.
   * Se tableId e specificato, mostra solo i pezzi di quella tavola.
   * Altrimenti mostra tutti i pezzi del gruppo.
   */
  _show3DPartsTable(groupId, tableId = null) {
    // Non si mostra la distinta né in 3D né in Esplosi
    if (this.currentView === '3d' || this.currentView === 'tree') { this._hide3DDetailPanel(); return; }
    const panel = document.getElementById('three-detail-panel');
    const content = document.getElementById('three-detail-content');
    const lang = this.catalog.currentLang;
    const parts = tableId
      ? this.catalog.getPartsForTable(tableId)
      : this.catalog.getPartsForGroup(groupId);

    // Filtra TAV- e deduplica
    const seen = new Set();
    const uniqueParts = parts.filter(p => {
      if (p.code.startsWith('TAV-')) return false;
      if (seen.has(p.code)) return false;
      seen.add(p.code);
      return true;
    });

    // Ordina per id (l'idx 0-based corrisponde al data-piece-id nell'SVG annotato)
    uniqueParts.sort((a, b) => (a.id || 0) - (b.id || 0));

    panel.classList.remove('hidden');

    // In vista Esplosi per tavola specifica: mostra colonna Pos
    const showPos = !!tableId && this.currentView !== '3d';

    // Posizione = data-piece-name nel SVG annotato per quell'indice.
    // getPieceNameByIndex(idx) mappa idx → numero posizione sul disegno.
    // Fallback a idx+1 se l'SVG non è ancora caricato o non annotato.
    const itemsWithPos = uniqueParts.map((p, idx) => {
      // Posizione dal TXT (source of truth: numero scritto sul disegno)
      const txtPos = tableId ? this.catalog.getPartPosition(tableId, p.code) : null;
      const pos = txtPos != null ? txtPos : (idx + 1);
      return { part: p, pos, posNum: parseInt(pos) || (idx + 1) };
    });

    // Ordina per numero posizione sul disegno (ascending)
    if (showPos) itemsWithPos.sort((a, b) => a.posNum - b.posNum);

    content.innerHTML = `
      <table>
        <thead><tr>
          ${showPos ? '<th>Pos.</th>' : ''}
          <th>Codice</th><th>Descrizione</th><th>Qt.</th><th>Dim.</th><th></th>
        </tr></thead>
        <tbody>${itemsWithPos.map(({ part: p, pos }) => {
          const desc = p.description?.[lang] || p.description?.it || '';
          const in3D = this.viewer3d?.hasNode(p.code);
          return `
          <tr data-code="${p.code}" data-pos="${pos}" class="${!in3D ? 'no-3d' : ''}" style="${!in3D ? 'opacity:0.5' : ''}">
            ${showPos ? `<td><b>${pos}</b></td>` : ''}
            <td>${p.code}</td>
            <td><b>${desc}</b></td>
            <td>${p.quantity || ''}</td>
            <td>${p.dimensions || ''}</td>
            <td>
              <button class="btn-info-small" data-code="${p.code}" data-pos="${pos}" title="Info pezzo">i</button>
              <button class="btn-cart-small" data-code="${p.code}" title="Aggiungi al carrello">+</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;

    // Hover/Click riga = evidenzia pezzo in SVG + 3D
    content.querySelectorAll('tr[data-code]').forEach(row => {
      row.addEventListener('mouseenter', () => {
        const pos = row.dataset.pos;
        row.classList.add('row-hover');
        this.svgViewer?.highlightPieceByName(pos, false);
      });
      row.addEventListener('mouseleave', () => {
        const pos = row.dataset.pos;
        row.classList.remove('row-hover');
        this.svgViewer?.unhighlightPieceByName(pos);
      });
      row.addEventListener('click', () => {
        content.querySelectorAll('tr').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        const code = row.dataset.code;
        const pos = row.dataset.pos;
        // Evidenzia in SVG
        this.svgViewer?.highlightPieceByName(pos, true);
        // Evidenzia in 3D
        if (this.viewer3d && this.viewer3d.hasNode(code)) {
          this.viewer3d.highlightPartByCode(code);
        } else {
          this.viewer3d?._clearPartHighlight();
        }
        const select = document.getElementById('part-code-select');
        if (select) select.value = code;
        // Aggiorna breadcrumb
        const part = this.catalog.parts.find(p => p.code === code);
        if (part) this.updateBreadcrumb({ type: 'part', id: code, data: part });
      });
    });

    // Bottone + carrello
    content.querySelectorAll('.btn-cart-small').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = btn.dataset.code;
        const part = this.catalog.getPartByCode(code);
        if (part) {
          // Ricava svgPath e numero posizione (data-piece-name) per la fig.
          const row = btn.closest('tr');
          const pos = row?.dataset.pos || '';
          const svgPath = tableId
            ? this.catalog.getTableById(tableId)?.svgPath || ''
            : '';
          this.cart.addItem({
            code: part.code,
            description: part.description[lang] || part.description.it,
            quantity: 1,
            table: part.table,
            group: part.group,
            svgPath,
            pieceName: pos,
          });
          this._showToast(`${part.code} aggiunto al carrello`);
        }
      });
    });

    // Bottone i info pezzo
    content.querySelectorAll('.btn-info-small').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = btn.dataset.code;
        const pos = btn.dataset.pos;
        const svgPath = tableId
          ? this.catalog.getTableById(tableId)?.svgPath || ''
          : '';
        this._openPartInfoModal(code, pos, svgPath);
      });
    });
  }

  /**
   * Apre il popup dettagli pezzo (lo stesso degli esplosi) a partire da un
   * pezzo selezionato nel 3D. Ricava posizione e tavola best-effort.
   */
  _openPartInfoModal3D(arg) {
    // arg puo essere un codice (da viewport) o l'oggetto pezzo (da albero)
    const part = (typeof arg === 'string') ? this.catalog.getPartByCode(arg) : arg;
    if (!part) return;

    // Tavola del pezzo: cerca tra le tavole del gruppo quella che lo contiene
    const tableId = part._resolvedTable || this._findTableForPart(part);
    let svgPath = '';
    let pos = '';
    if (tableId) {
      svgPath = this.catalog.getTableById(tableId)?.svgPath || '';
      pos = this._partPositionInTable(part, tableId);
    }
    this._openPartInfoModal(part.code, pos, svgPath);
  }

  /**
   * Tavola di un pezzo (fallback se manca _resolvedTable):
   * tra le tavole del gruppo, sceglie la pagina indicata da part.table.
   */
  _findTableForPart(part) {
    if (!part?.group) return null;
    const tables = (this.catalog.getTablesForGroup(part.group) || [])
      .map(t => t.id)
      .filter(id => !/_00_\d+$/.test(id));
    if (!tables.length) return null;
    const idx = (parseInt(part.table) || 1) - 1;
    return tables[idx] || tables[0];
  }

  /**
   * Posizione del pezzo nella tavola (stesso ordinamento usato negli esplosi:
   * pezzi della tavola, esclusi TAV-, deduplicati, ordinati per id, idx+1).
   */
  _partPositionInTable(part, tableId) {
    const seen = new Set();
    const uniq = this.catalog.getPartsForTable(tableId)
      .filter(p => !/^TAV-/i.test(p.code))
      .filter(p => { if (seen.has(p.code)) return false; seen.add(p.code); return true; })
      .sort((a, b) => (a.id || 0) - (b.id || 0));
    const idx = uniq.findIndex(p => this._norm(p.code) === this._norm(part.code));
    if (idx < 0) return '';
    // Usa la posizione dal TXT (source of truth), fallback a idx+1
    return this.catalog.getPartPosition(tableId, part.code) ?? (idx + 1);
  }

  /**
   * Apre il modal con info dettagliate sul pezzo + miniatura SVG.
   */
  async _openPartInfoModal(code, pieceName, svgPath) {
    this.viewer3d?.clearTreeHover();
    this.treeNav?._hideTreeTooltip();
    const part = this.catalog.getPartByCode(code);
    if (!part) return;
    const lang = this.catalog.currentLang;
    const modal = document.getElementById('part-info-modal');
    const title = document.getElementById('part-info-title');
    const thumb = document.getElementById('part-info-thumb');
    const body = document.getElementById('part-info-body');

    title.textContent = part.code;

    // Render thumbnail (riusa logica del carrello)
    thumb.innerHTML = '<span style="color:#999">caricamento…</span>';
    const svgHtml = await this.cart._renderPieceThumbnail(svgPath, pieceName);
    thumb.innerHTML = svgHtml || '<span style="color:#999">Figura non disponibile</span>';

    // Tabella info
    const desc = part.description?.[lang] || part.description?.it || '';
    const rows = [
      ['Codice', part.code],
      ['Descrizione', desc],
      ['Codice esteso', part.extraCode || '—'],
      ['Quantità', part.quantity ?? '—'],
      ['Dimensioni', part.dimensions || '—'],
      ['Manutenzione', part.maintenance || '—'],
      ['Tavola', part.table ?? '—'],
      ['Gruppo', part.group || '—'],
      ['Sezione', part.section || '—'],
      ['Posizione', pieceName || '—'],
    ];
    body.innerHTML = rows.map(([k, v]) =>
      `<tr><th style="text-align:left;width:140px;padding:6px 8px;background:var(--bg-secondary)">${k}</th><td style="padding:6px 8px">${v}</td></tr>`
    ).join('');

    // Reset quantità
    const qtyInput = document.getElementById('part-info-qty');
    if (qtyInput) qtyInput.value = 1;

    // Wire-up bottone carrello (sostituisce il nodo per rimuovere listener precedenti)
    const addCartBtn = document.getElementById('part-info-add-cart');
    if (addCartBtn) {
      const fresh = addCartBtn.cloneNode(true);
      addCartBtn.parentNode.replaceChild(fresh, addCartBtn);
      fresh.addEventListener('click', () => {
        const qty = parseInt(document.getElementById('part-info-qty').value) || 1;
        this.cart.addItem({
          code: part.code,
          description: part.description?.[lang] || part.description?.it || '',
          quantity: qty,
          table: part.table,
          group: part.group,
          svgPath,
          pieceName,
        });
        this._showToast(`${part.code} aggiunto al carrello`);
      });
    }

    modal.classList.remove('hidden');
  }

  /**
   * Dopo il cambio vista, ripristina la selezione nell'albero e lo stato corrente.
   * - 3D:      naviga al gruppo/pezzo attivo nel viewer e nell'albero
   * - Esplosi: ricarica la tavola attiva e seleziona il nodo nell'albero
   */
  async _restoreSelectionAfterViewSwitch(view) {
    this._navLock = true;
    try {
      if (view === '3d') {
        // ── Ripristino vista 3D ──
        const groupId = this._activeGroup;
        if (!groupId) return;

        // Seleziona nell'albero 3D il pezzo (se attivo) o il gruppo
        const treeNodeId = this._activePart || groupId;
        this.treeNav.selectByNodeId(treeNodeId);

        // Naviga nel viewer 3D
        if (this._3dReadyPromise) await this._3dReadyPromise;
        if (this.viewer3d?.model) {
          this.viewer3d.navigateToGroup(groupId, null);
          if (this._activePart) {
            this.viewer3d.highlightPartByCode(this._activePart, false);
          }
        }

        // Breadcrumb: mostra gruppo (non tavola, che non esiste in 3D)
        const groupData = this._getGroupData(groupId);
        if (groupData) {
          this.updateBreadcrumb({
            type: 'group',
            id: groupId,
            data: { ...groupData, id: groupId },
          });
        }

        // 3D UI: aggiorna breadcrumb 3D
        const groupLabel = this._getGroupLabel(groupId) || groupId;
        this._update3DBreadcrumb('group', groupLabel);
        this._hide3DInfo();

      } else {
        // ── Ripristino vista Esplosi ──
        const groupId = this._activeGroup;
        if (!groupId) return;

        if (this._activeTable) {
          const table = this.catalog.getTableById(this._activeTable);
          if (table) {
            await this._loadTableNoSwitch(table);
            this.treeNav.selectByNodeId(this._activeTable);
            this.updateBreadcrumb({ type: 'table', id: this._activeTable, data: table });
            return;
          }
        }
        // Fallback: seleziona il gruppo
        this.treeNav.selectByNodeId(groupId);
        const groupData = this._getGroupData(groupId);
        if (groupData) {
          this.updateBreadcrumb({
            type: 'group',
            id: groupId,
            data: { ...groupData, id: groupId },
          });
        }
      }
    } finally {
      this._navLock = false;
    }
  }

  _hide3DDetailPanel() {
    document.getElementById('three-detail-panel').classList.add('hidden');
  }

  _getTooltipInfo(nodeName) {
    const lang = this.catalog.currentLang;
    const norm = this._norm(nodeName);

    // Cerca come pezzo in distinta -> tooltip con codice, nome, qtà, dimensioni
    const part = this.catalog.parts.find(p => this._norm(p.code) === norm);
    if (part) {
      const desc = part.description[lang] || part.description.it || '';
      const qty  = part.quantity != null ? `<br>Qt: <b>${part.quantity}</b>` : '';
      const dim  = part.dimensions ? `<br>${part.dimensions}` : '';
      return `<b>${part.code}</b><br>${desc}${qty}${dim}`;
    }

    // Cerca come gruppo
    const groupLabel = this._getGroupLabel(nodeName);
    if (groupLabel) return `<b>Gruppo</b><br>${groupLabel}`;

    // Cerca come sezione
    const sectionLabel = this._getSectionLabel(nodeName);
    if (sectionLabel) return `<b>Sezione</b><br>${sectionLabel}`;

    // Non in distinta: nessun tooltip
    return null;
  }

  /**
   * Evidenzia la riga della tabella footer corrispondente al numero posizione.
   * Chiamato quando hover/click su un pezzo nel SVG.
   */
  _highlightTableRow(pos, mode) {
    const content = document.getElementById('three-detail-content');
    if (!content) return;

    if (mode === 'hover') {
      // Rimuovi hover precedente
      content.querySelectorAll('tr.row-hover').forEach(r => r.classList.remove('row-hover'));
      if (pos) {
        const row = content.querySelector(`tr[data-pos="${pos}"]`);
        if (row) {
          row.classList.add('row-hover');
          row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    } else if (mode === 'selected') {
      // Rimuovi selezione precedente
      content.querySelectorAll('tr.active').forEach(r => r.classList.remove('active'));
      if (pos) {
        const row = content.querySelector(`tr[data-pos="${pos}"]`);
        if (row) {
          row.classList.add('active');
          row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }
  }

  _showSvgPreviewTooltip(svgPath, x, y) {
    let tt = document.getElementById('svg-preview-tooltip');
    if (!tt) {
      tt = document.createElement('div');
      tt.id = 'svg-preview-tooltip';
      tt.className = 'svg-preview-tooltip';
      document.body.appendChild(tt);
    }

    // Versione per annullare caricamenti precedenti
    const version = (this._svgPreviewVersion = (this._svgPreviewVersion || 0) + 1);

    tt.innerHTML = '<div class="svg-preview-loading">caricamento…</div>';
    tt.style.left = (x + 15) + 'px';
    tt.style.top  = (y - 10) + 'px';
    tt.style.display = 'block';

    window.catalog.readSvg(svgPath).then(svgHtml => {
      if (this._svgPreviewVersion !== version) return; // annullato
      const cur = document.getElementById('svg-preview-tooltip');
      if (!cur || cur.style.display === 'none') return;
      if (!svgHtml) { cur.innerHTML = '<div class="svg-preview-loading">Anteprima non disponibile</div>'; return; }
      cur.innerHTML = svgHtml;
      const svg = cur.querySelector('svg');
      if (svg) {
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.style.pointerEvents = 'none';
      }
    });
  }

  _hideSvgPreviewTooltip() {
    this._svgPreviewVersion = (this._svgPreviewVersion || 0) + 1;
    const tt = document.getElementById('svg-preview-tooltip');
    if (tt) tt.style.display = 'none';
  }

  _showSvgPieceTooltip(posName, x, y) {
    const tableId = this.svgViewer.currentTableId;
    if (!tableId || !posName) { this._hideSvgPieceTooltip(); return; }

    const parts = this.catalog.getPartsForTable(tableId);
    const lang = this.catalog.currentLang;
    const pos = String(posName);
    const part = parts.find(p => {
      const pd = this.catalog.getPartPosData(tableId, p.code);
      return pd && String(pd.pos) === pos;
    });

    if (!part) { this._hideSvgPieceTooltip(); return; }

    const desc  = part.description?.[lang] || part.description?.it || '';
    const extra = part.extraCode ? `<br><span style="opacity:.7;font-size:11px">${part.extraCode}</span>` : '';
    const qty   = `<br>Qt: <b>${part.quantity ?? '—'}</b>`;
    const maint = part.maintenance ? `<br>Manut: ${part.maintenance}` : '';

    let tt = document.getElementById('svg-piece-tooltip');
    if (!tt) {
      tt = document.createElement('div');
      tt.id = 'svg-piece-tooltip';
      tt.className = 'three-tooltip';
      document.body.appendChild(tt);
    }

    tt.innerHTML = `<b>${part.code}</b><br>${desc}${extra}${qty}${maint}`;
    tt.style.left = (x + 15) + 'px';
    tt.style.top  = (y - 10) + 'px';
    tt.style.display = 'block';
  }

  _hideSvgPieceTooltip() {
    const tt = document.getElementById('svg-piece-tooltip');
    if (tt) tt.style.display = 'none';
  }

  _showToast(message) {
    // Rimuovi toast precedente
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Mostra con animazione
    requestAnimationFrame(() => toast.classList.add('show'));

    // Rimuovi dopo 3 secondi
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// ─── Bootstrap ───
const app = new App();
window.app = app; // esponi per debug console
app.init().catch(err => console.error('Errore inizializzazione:', err));
