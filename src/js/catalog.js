/**
 * CatalogManager - Gestione dati catalogo
 * Carica e indicizza i dati JSON dal filesystem.
 */
export class CatalogManager {
  constructor() {
    this.currentModel = null;
    this.parts = [];
    this.groups = null;
    this.translations = {};
    this.currentLang = 'it';
    this.models = [];

    // Indici per lookup rapido
    this._partsByCode = new Map();
    this._partsByTable = new Map();
    this._partsByGroup = new Map();
    this._tableMap = new Map();
  }

  async init() {
    // Carica l'indice generale
    const catalogIndex = await window.catalog.readJson('catalog.json');

    if (!catalogIndex) {
      console.warn('catalog.json non trovato, creazione dati demo...');
      this._loadDemoData();
      return;
    }

    this.models = catalogIndex.models || [];

    // Carica il primo modello disponibile
    if (this.models.length > 0) {
      await this.loadModel(this.models[0].serial);
    }
  }

  async loadModel(serial) {
    const model = this.models.find(m => m.serial === serial);
    if (!model) return;

    this.currentModel = model;
    const basePath = `models/${serial}`;

    // Carica dati in parallelo
    const [parts, groups, translations] = await Promise.all([
      window.catalog.readJson(`${basePath}/parts.json`),
      window.catalog.readJson(`${basePath}/groups.json`),
      window.catalog.readJson(`${basePath}/translations.json`),
    ]);

    this.parts = parts || [];
    this.groups = groups || { sections: [] };
    this.translations = translations || {};

    // Costruisci indici
    this._buildIndexes();

    // Carica le posizioni dai file TXT (source of truth: numero sul disegno)
    await this._loadTxtPositions(basePath);
  }

  _buildIndexes() {
    this._partsByCode.clear();
    this._partsByTable.clear();
    this._partsByGroup.clear();
    this._tableMap.clear();

    // Mappa tavole da groups.json
    // Le tavole sono nomi file SVG come "G.TRSP.LNCT.000035_00_12"
    if (this.groups?.sections) {
      for (const section of this.groups.sections) {
        for (const group of section.groups || []) {
          for (const tableId of group.tables || []) {
            this._tableMap.set(tableId, {
              id: tableId,
              svgPath: `models/${this.currentModel.serial}/svg/${tableId}.svg`,
              groupId: group.id || group.code,
              groupCode: group.code,
              groupName: group.name?.[this.currentLang] || group.name?.it || group.code,
              sectionId: section.id,
            });
          }
        }
      }
    }

    // Indicizza parti.
    // Nel DB originale, part.table e un numero (indice pagina dentro il gruppo).
    // Lo risolviamo nel tableId effettivo usando il gruppo e l'indice.
    for (const part of this.parts) {
      this._partsByCode.set(part.code, part);

      // Risolvi il tableId: part.table e l'indice della pagina nel gruppo
      const resolvedTableId = this._resolvePartTable(part);
      part._resolvedTable = resolvedTableId;

      if (resolvedTableId) {
        if (!this._partsByTable.has(resolvedTableId)) {
          this._partsByTable.set(resolvedTableId, []);
        }
        this._partsByTable.get(resolvedTableId).push(part);
      }

      if (!this._partsByGroup.has(part.group)) {
        this._partsByGroup.set(part.group, []);
      }
      this._partsByGroup.get(part.group).push(part);
    }
  }

  /**
   * Risolve il numero tavola di una parte nel tableId effettivo.
   * part.table e un numero (1-based) che indica la pagina di dettaglio.
   * Filtra le tavole di copertina _00_ perche la distinta del DB
   * non le considera (tavola 1 = prima tavola dettaglio = _01_).
   */
  _resolvePartTable(part) {
    if (!this.groups?.sections) return null;
    for (const section of this.groups.sections) {
      for (const group of section.groups || []) {
        if (group.code === part.group && group.tables && group.tables.length > 0) {
          // Esclude la copertina _00_: le tavole dettaglio iniziano da _01_
          const detailTables = group.tables.filter(t => !/_00_\d+$/.test(t));
          if (detailTables.length === 0) return group.tables[0];

          const idx = (parseInt(part.table) || 1) - 1;
          if (idx >= 0 && idx < detailTables.length) {
            return detailTables[idx];
          }
          return detailTables[0];
        }
      }
    }
    return null;
  }

  /**
   * Carica i file TXT con le posizioni sul disegno per ogni tavola.
   * Formato TXT: "{riga}\t{codice}:{x} {y} {w} {h} {posizione}"
   * Costruisce _posMap: "{tableId}|{codice}" → numero posizione (string).
   */
  async _loadTxtPositions(basePath) {
    this._posMap = new Map();
    if (!this.groups?.sections) return;

    const txtBase = `${basePath}/txt`;

    for (const section of this.groups.sections) {
      for (const group of section.groups || []) {
        const detailTables = (group.tables || []).filter(t => !/_00_\d+$/.test(t));
        detailTables.forEach(async (tableId, idx) => {
          // Nome file TXT: es. "01_G.TRSP.LNCT.000036_01.txt"
          const sezPad = String(section.id || '').replace('SEZ-', '').padStart(2, '0');
          const txtName = `${sezPad}_${group.code}_${String(idx + 1).padStart(2, '0')}.txt`;
          try {
            const txt = await window.catalog.readSvg(`${txtBase}/${txtName}`);
            if (!txt) return;
            for (const line of txt.split('\n')) {
              const colonIdx = line.indexOf(':');
              if (colonIdx < 0) continue;
              const code = line.substring(line.indexOf('\t') + 1, colonIdx).trim();
              const fields = line.substring(colonIdx + 1).trim().split(/\s+/);
              const pos = fields[4];
              if (code && pos && !isNaN(Number(pos))) {
                const key = `${tableId}|${code}`;
                if (!this._posMap.has(key)) {
                  // Salva posizione + coordinate label (x,y) per zoom miniatura
                  const x = parseFloat((fields[0] || '0').replace(',', '.'));
                  const y = parseFloat((fields[1] || '0').replace(',', '.'));
                  const h = parseFloat((fields[3] || '14').replace(',', '.'));
                  this._posMap.set(key, { pos, x: x + 5, y: y + h });
                }
              }
            }
          } catch (e) { /* TXT non trovato: fallback a idx+1 */ }
        });
      }
    }
  }

  /**
   * Ritorna il numero di posizione sul disegno per un pezzo in una tavola.
   * Fallback: null (il chiamante usa idx+1).
   */
  getPartPosition(tableId, partCode) {
    if (!this._posMap) return null;
    const entry = this._posMap.get(`${tableId}|${partCode}`);
    return entry?.pos || entry || null;
  }

  getPartPosData(tableId, partCode) {
    if (!this._posMap) return null;
    return this._posMap.get(`${tableId}|${partCode}`) || null;
  }

  getTreeData() {
    if (!this.groups?.sections) return [];
    const lang = this.currentLang;

    const sections = this.groups.sections.map(section => ({
      id: section.id,
      label: `${section.id} — ${section.name?.[lang] || section.name?.it || section.id}`,
      type: 'section',
      icon: 'folder',
      data: section,
      children: (section.groups || []).map(group => {
        // Filtra le tavole di copertina (_00_) dal treeview
        const nonCoverTables = (group.tables || []).filter(tid => !/_00_\d+$/.test(tid));
        return {
          id: group.id || group.code,
          label: `${group.code} — ${group.name?.[lang] || group.name?.it || group.code}`,
          type: 'group',
          icon: 'folder',
          data: { ...group, id: group.id || group.code },
          children: nonCoverTables.map((tableId, idx) => ({
            id: tableId,
            label: `Tavola ${idx + 1}`,
            type: 'table',
            icon: 'file',
            data: this._tableMap.get(tableId) || { id: tableId, svgPath: `models/${this.currentModel?.serial}/svg/${tableId}.svg` },
          })),
        };
      }),
    }));

    // Nodo root "Macchina" che contiene le sezioni
    return [{
      id: 'root',
      label: this.currentModel?.serial || this.currentModel?.name || 'Macchina',
      type: 'machine',
      icon: 'machine',
      data: { serial: this.currentModel?.serial },
      children: sections,
    }];
  }

  /**
   * Albero per la VISTA 3D: macchina -> sezioni -> gruppi -> PEZZI (distinta).
   * Stessa struttura di getTreeData() ma dentro il gruppo elenca i pezzi
   * invece delle tavole.
   */
  getTreeData3D() {
    if (!this.groups?.sections) return [];
    const lang = this.currentLang;

    // Codici che sono in realta GRUPPI/sotto-assiemi (non veri dettagli):
    // vanno esclusi dall'elenco pezzi dell'albero.
    const norm = s => (s || '').replace(/[.\-\s]/g, '').toUpperCase();
    const groupCodeSet = new Set();
    this.groups.sections.forEach(s =>
      (s.groups || []).forEach(gr => groupCodeSet.add(norm(gr.code))));

    const sections = this.groups.sections.map(section => ({
      id: section.id,
      label: `${section.id} — ${section.name?.[lang] || section.name?.it || section.id}`,
      type: 'section',
      icon: 'folder',
      data: section,
      children: (section.groups || []).map(group => {
        const gid = group.id || group.code;
        // Pezzi del gruppo: escludi i riferimenti tavola (TAV-...) e deduplica per codice
        const seen = new Set();
        const parts = this.getPartsForGroup(group.code).filter(p => {
          if (/^TAV-/i.test(p.code)) return false;     // riferimenti tavola
          if (groupCodeSet.has(norm(p.code))) return false; // sotto-gruppi
          if (seen.has(p.code)) return false;
          seen.add(p.code);
          return true;
        });
        return {
          id: gid,
          label: `${group.code} — ${group.name?.[lang] || group.name?.it || group.code}`,
          type: 'group',
          icon: 'folder',
          data: { ...group, id: gid },
          children: parts.map((part, idx) => ({
            id: `part:${gid}:${idx}`,
            label: `${part.code} — ${part.description?.[lang] || part.description?.it || ''}`,
            type: 'part',
            icon: 'part',
            data: part,
          })),
        };
      }),
    }));

    return [{
      id: 'root',
      label: this.currentModel?.serial || this.currentModel?.name || 'Macchina',
      type: 'machine',
      icon: 'machine',
      data: { serial: this.currentModel?.serial },
      children: sections,
    }];
  }

  /**
   * Mappe di supporto per la vista annidata:
   * - groupByCode: codice normalizzato -> gruppo
   * - childCodes: codici dei gruppi che sono SOTTO-gruppi (referenziati nella
   *   distinta di un altro gruppo)
   */
  _groupNestingMaps() {
    const norm = s => (s || '').replace(/[.\-\s]/g, '').toUpperCase();
    const groupByCode = new Map();
    this.groups.sections.forEach(s =>
      (s.groups || []).forEach(gr => groupByCode.set(norm(gr.code), gr)));
    const childCodes = new Set();
    this.groups.sections.forEach(s =>
      (s.groups || []).forEach(gr => {
        this.getPartsForGroup(gr.code).forEach(p => {
          const nc = norm(p.code);
          if (groupByCode.has(nc) && nc !== norm(gr.code)) childCodes.add(nc);
        });
      }));
    return { norm, groupByCode, childCodes };
  }

  /** Albero ANNIDATO per la vista 3D (foglie = particolari). */
  getTreeData3DNested() { return this._buildNestedTree('part'); }

  /** Albero ANNIDATO per la vista Esplosi (foglie = tavole). */
  getTreeDataNested() { return this._buildNestedTree('table'); }

  _buildNestedTree(leafType) {
    if (!this.groups?.sections) return [];
    const lang = this.currentLang;
    const { norm, groupByCode, childCodes } = this._groupNestingMaps();

    const buildGroup = (group, visited) => {
      const gcode = norm(group.code);
      if (visited.has(gcode)) return null; // guardia anti-ciclo
      const nextVisited = new Set(visited); nextVisited.add(gcode);
      const gid = group.id || group.code;

      // Sotto-gruppi referenziati nella distinta di questo gruppo
      const subNodes = [];
      const seenSub = new Set();
      this.getPartsForGroup(group.code).forEach(p => {
        const nc = norm(p.code);
        if (groupByCode.has(nc) && nc !== gcode && !seenSub.has(nc)) {
          seenSub.add(nc);
          const node = buildGroup(groupByCode.get(nc), nextVisited);
          if (node) subNodes.push(node);
        }
      });

      // Foglie: particolari o tavole
      let leaves = [];
      if (leafType === 'part') {
        const seen = new Set();
        leaves = this.getPartsForGroup(group.code).filter(p => {
          if (/^TAV-/i.test(p.code)) return false;
          if (groupByCode.has(norm(p.code))) return false; // e un sotto-gruppo
          if (seen.has(p.code)) return false;
          seen.add(p.code);
          return true;
        }).map((part, idx) => ({
          id: `part:${gid}:${idx}`,
          label: `${part.code} — ${part.description?.[lang] || part.description?.it || ''}`,
          type: 'part', icon: 'part', data: part,
        }));
      } else {
        const nonCover = (group.tables || []).filter(t => !/_00_\d+$/.test(t));
        leaves = nonCover.map((tid, idx) => ({
          id: tid, label: `Tavola ${idx + 1}`, type: 'table', icon: 'table',
          data: this._tableMap.get(tid) || { id: tid, svgPath: `models/${this.currentModel?.serial}/svg/${tid}.svg` },
        }));
      }

      return {
        id: gid,
        label: `${group.code} — ${group.name?.[lang] || group.name?.it || group.code}`,
        type: 'group', icon: 'group',
        data: { ...group, id: gid },
        children: [...subNodes, ...leaves],
      };
    };

    const sections = this.groups.sections.map(section => ({
      id: section.id,
      label: `${section.id} — ${section.name?.[lang] || section.name?.it || section.id}`,
      type: 'section', icon: 'section', data: section,
      // Solo i gruppi di primo livello (non sotto-gruppi di un altro gruppo)
      children: (section.groups || [])
        .filter(gr => !childCodes.has(norm(gr.code)))
        .map(gr => buildGroup(gr, new Set()))
        .filter(Boolean),
    }));

    return [{
      id: 'root',
      label: this.currentModel?.serial || this.currentModel?.name || 'Macchina',
      type: 'machine', icon: 'machine',
      data: { serial: this.currentModel?.serial },
      children: sections,
    }];
  }

  get3DModelPath() {
    if (!this.currentModel?.['3dModel']) return null;
    return `models/${this.currentModel.serial}/${this.currentModel['3dModel']}`;
  }

  getPartByCode(code) {
    return this._partsByCode.get(code) || null;
  }

  getPartsForTable(tableId) {
    return this._partsByTable.get(tableId) || [];
  }

  getPartsForGroup(groupCode) {
    return this._partsByGroup.get(groupCode) || [];
  }

  getTablesForGroup(groupId) {
    const tables = [];
    if (this.groups?.sections) {
      for (const section of this.groups.sections) {
        for (const group of section.groups || []) {
          if ((group.id || group.code) === groupId) {
            for (const tableId of group.tables || []) {
              tables.push(this._tableMap.get(tableId) || { id: tableId });
            }
          }
        }
      }
    }
    return tables;
  }

  getTableById(tableId) {
    return this._tableMap.get(tableId) || null;
  }

  getPathTo(node) {
    const path = [{
      type: 'home',
      label: this.currentModel?.name || 'Macchina',
      sublabel: this.currentModel?.serial || '',
    }];
    if (!node) return path;

    if (this.groups?.sections) {
      for (const section of this.groups.sections) {
        const sectionEntry = {
          type: 'section', id: section.id,
          label: section.id,
          sublabel: section.name?.[this.currentLang] || section.name?.it || '',
        };
        if (node.type === 'section' && node.id === section.id) {
          path.push(sectionEntry);
          return path;
        }
        for (const group of section.groups || []) {
          const gid = group.id || group.code;
          const groupEntry = {
            type: 'group', id: gid,
            label: group.code || gid,
            sublabel: group.name?.[this.currentLang] || group.name?.it || '',
          };
          if (node.type === 'group' && node.id === gid) {
            path.push(sectionEntry);
            path.push(groupEntry);
            return path;
          }
          if (node.type === 'table' && (group.tables || []).includes(node.id)) {
            path.push(sectionEntry);
            path.push(groupEntry);
            const detailTables = (group.tables || []).filter(t => !String(t).includes('_00_') && !String(t).startsWith('layout'));
            const tIdx = detailTables.indexOf(node.id);
            const tavola = tIdx >= 0 ? `Tavola ${tIdx + 1}` : '';
            path.push({ type: 'table', id: node.id, label: node.id, sublabel: tavola });
            return path;
          }
          if (node.type === 'part' && (node.data?.group === group.code || node.data?.group === gid)) {
            path.push(sectionEntry);
            path.push(groupEntry);
            const desc = node.data?.description;
            const descText = desc
              ? (typeof desc === 'string' ? desc : (desc[this.currentLang] || desc.it || desc.en || Object.values(desc)[0] || ''))
              : '';
            path.push({
              type: 'part', id: node.id,
              label: node.data?.code || node.id,
              sublabel: descText,
            });
            return path;
          }
        }
      }
    }
    return path;
  }

  toggleLanguage() {
    const langs = this.currentModel?.languages || ['it', 'en'];
    const idx = langs.indexOf(this.currentLang);
    this.currentLang = langs[(idx + 1) % langs.length];
    this._buildIndexes(); // Rebuild per aggiornare nomi
  }

  // ─── Dati demo per testing ───
  _loadDemoData() {
    this.currentModel = {
      serial: 'DEMO-001',
      name: 'Demo Machine',
      rev: '1.0',
      client: 'Test',
      languages: ['it', 'en'],
    };

    this.groups = {
      sections: [
        {
          id: 'SEZ-01',
          name: { it: 'Struttura', en: 'Structure' },
          '3dNode': 'G.STRT.CHDT.000000',
          groups: [
            {
              id: 'GRP-001',
              code: 'G.STRT.CHDT.000000',
              name: { it: 'Telaio Principale', en: 'Main Frame' },
              tables: ['TAV-001', 'TAV-002'],
            },
            {
              id: 'GRP-002',
              code: 'G.STRT.CHDT.000001',
              name: { it: 'Pannellatura', en: 'Paneling' },
              tables: ['TAV-003'],
            },
          ],
        },
        {
          id: 'SEZ-02',
          name: { it: 'Trasmissione', en: 'Transmission' },
          '3dNode': 'P.VRTX.CHSC.000002',
          groups: [
            {
              id: 'GRP-003',
              code: 'G.CHDT.TRSL.000000',
              name: { it: 'Trascinamento Laterale', en: 'Side Drive' },
              tables: ['TAV-004', 'TAV-005'],
            },
          ],
        },
      ],
    };

    this.parts = [
      { code: 'C.PRTZ.LCCH.000000', description: { it: 'Piastra chiusura', en: 'Closing plate' }, quantity: 2, group: 'G.STRT.CHDT.000000', section: 'SEZ-01', table: 'TAV-001' },
      { code: 'C.RSTT.PIAN.000009', description: { it: 'Rondella piana', en: 'Flat washer' }, quantity: 8, group: 'G.STRT.CHDT.000000', section: 'SEZ-01', table: 'TAV-001' },
      { code: 'C.VITI.VTTE.000047', description: { it: 'Vite TCEI M8x25', en: 'Screw SHCS M8x25' }, quantity: 16, group: 'G.STRT.CHDT.000000', section: 'SEZ-01', table: 'TAV-001' },
      { code: 'D.LAMI.LMPR.000806', description: { it: 'Lamiera protezione', en: 'Protection sheet' }, quantity: 1, group: 'G.STRT.CHDT.000001', section: 'SEZ-01', table: 'TAV-003' },
      { code: 'C.DADI.TBLC.074', description: { it: 'Dado autobloccante M10', en: 'Self-locking nut M10' }, quantity: 4, group: 'G.CHDT.TRSL.000000', section: 'SEZ-02', table: 'TAV-004' },
    ];

    this._buildIndexes();
  }
}
