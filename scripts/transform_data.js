/**
 * Trasforma i dati raw estratti dal database SQLite nei JSON
 * strutturati per l'app Electron.
 */
const fs = require('fs');
const path = require('path');

const modelDir = path.join(__dirname, '..', 'data', 'models', 'M.VRTX.CLSR.000012');
const svgSourceDir = 'C:/Progetti/Timage/3D/x CT PACK - PROVA/RIC_M.VRTX.CLSR.000012_REV 1.3_250929/RIC_M.VRTX.CLSR.000012_REV 1.3_250929/Data/M.VRTX.CLSR.000012/SVG';

function readJ(f) {
  let s = fs.readFileSync(path.join(modelDir, f), 'utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return JSON.parse(s);
}

const rawParts = readJ('anagrafica_raw.json');
const rawGroups = readJ('indice_gruppi_raw.json');
const rawSections = readJ('indice_sezioni_raw.json');
const rawMatricola = readJ('matricola_raw.json');
const rawSettings = readJ('impostazioni_raw.json');

// ─── Analizza file SVG disponibili ───
const svgFiles = fs.readdirSync(svgSourceDir).filter(f => f.endsWith('.svg'));
console.log(`SVG files trovati: ${svgFiles.length}`);

// Raggruppa SVG per codice gruppo: G.TRSP.LNCT.000035_00_12.svg -> G.TRSP.LNCT.000035
const svgByGroup = {};
for (const file of svgFiles) {
  // Pattern: CODICE_PAGINA_TOTALEPAGINE.svg oppure 01.svg, 02.svg (sezioni)
  const match = file.match(/^(.+?)_(\d+)_(\d+)\.svg$/);
  if (match) {
    const groupCode = match[1];
    const pageNum = parseInt(match[2]);
    const totalPages = parseInt(match[3]);
    if (!svgByGroup[groupCode]) svgByGroup[groupCode] = [];
    svgByGroup[groupCode].push({ file, page: pageNum, total: totalPages });
  }
}

// Ordina pagine per ogni gruppo
for (const code in svgByGroup) {
  svgByGroup[code].sort((a, b) => a.page - b.page);
}

console.log('Gruppi con SVG:', Object.keys(svgByGroup));

// ─── Mappa sezioni ───
// Le sezioni nel DB hanno 2 lingue: descrizione_sezione (IT) e lingua_sezione (ES)
const sectionMap = {};
for (const s of rawSections) {
  sectionMap[s.numero_sezione] = {
    id: `SEZ-${s.numero_sezione}`,
    name: {
      it: s.descrizione_sezione,
      es: s.lingua_sezione,
    },
  };
}
console.log('Sezioni:', Object.values(sectionMap).map(s => `${s.id}: ${s.name.it}`));

// ─── Mappa gruppi ───
const groupMap = {};
for (const g of rawGroups) {
  const code = g.codice_gruppo;
  groupMap[code] = {
    id: code,
    code: code,
    name: {
      it: g.descrizione_gruppo,
      es: g.lingua_gruppo,
    },
    sectionNum: g.sezione_gruppo,
    totalTables: parseInt(g.qta_tavole_gruppo) || 0,
    tables: (svgByGroup[code] || []).map(s => s.file.replace('.svg', '')),
    '3dNode': code,
  };
}

// ─── Costruisci groups.json (struttura gerarchica) ───
const groupsJson = {
  sections: Object.values(sectionMap).map(section => {
    const sezNum = section.id.replace('SEZ-', '');
    const sectionGroups = Object.values(groupMap).filter(g => g.sectionNum === sezNum);

    // Trova il nodo 3D per la sezione
    // Il primo gruppo con un nodo 3D che corrisponde alla sezione potrebbe servire
    // Oppure usiamo il codice del gruppo "master" della sezione
    let node3d = '';
    if (sectionGroups.length > 0) {
      // Cerca se c'e un gruppo che corrisponde al nodo 3D della sezione
      node3d = sectionGroups[0].code;
    }

    return {
      id: section.id,
      name: section.name,
      '3dNode': node3d,
      groups: sectionGroups.map(g => ({
        id: g.id,
        code: g.code,
        name: g.name,
        '3dNode': g['3dNode'],
        tables: g.tables,
      })),
    };
  }),
};

fs.writeFileSync(path.join(modelDir, 'groups.json'), JSON.stringify(groupsJson, null, 2));
console.log('\nScritto groups.json');

// ─── Costruisci parts.json ───
const partsJson = rawParts.map(p => ({
  code: p.codice_anagrafica,
  description: {
    it: p.descrizione_anagrafica,
    es: p.lingua_anagrafica,
  },
  extraCode: p.codice_extra || '',
  quantity: parseFloat(p.qta_anagrafica) || 0,
  dimensions: p.dimensioni_anagrafica || '',
  group: p.gruppo_anagrafica,
  section: `SEZ-${String(p.sezione_anagrafica).padStart(2, '0')}`,
  table: p.tavola_anagrafica,
  id: parseInt(p.id_anagrafica) || 0, // id progressivo dal DB
  maintenance: p.manutenzione || '',
}));

fs.writeFileSync(path.join(modelDir, 'parts.json'), JSON.stringify(partsJson, null, 2));
console.log(`Scritto parts.json (${partsJson.length} parti)`);

// ─── Aggiorna catalog.json ───
const mat = rawMatricola[0] || {};
const settingsMap = {};
for (const s of rawSettings) settingsMap[s.Key] = s.Value;

const catalogJson = {
  models: [{
    serial: mat.numero || 'M.VRTX.CLSR.000012',
    name: settingsMap.Name || mat.modello || 'CT PACK',
    rev: mat.rev || '1.3',
    client: mat.cliente || '',
    languages: ['it', 'es'],
    '3dModel': '3d/M.VRTX.CLSR.000012.gltf',
    version: mat.versione || '',
  }],
};

fs.writeFileSync(path.join(modelDir, '..', '..', 'catalog.json'), JSON.stringify(catalogJson, null, 2));
console.log('Scritto catalog.json');

// ─── Traduzioni UI ───
const transJson = {};
// Mantieni le traduzioni UI precedenti e aggiungi quelle dal DB
const existingTrans = readJ('translations.json');
Object.assign(transJson, existingTrans);

fs.writeFileSync(path.join(modelDir, 'translations.json'), JSON.stringify(transJson, null, 2));
console.log('Aggiornato translations.json');

// ─── Copia SVG nella cartella dati ───
const svgDestDir = path.join(modelDir, 'svg');
fs.mkdirSync(svgDestDir, { recursive: true });

let copiedCount = 0;
for (const file of svgFiles) {
  const src = path.join(svgSourceDir, file);
  const dest = path.join(svgDestDir, file);
  fs.copyFileSync(src, dest);
  copiedCount++;
}
console.log(`\nCopiati ${copiedCount} file SVG in ${svgDestDir}`);

// ─── Riepilogo ───
console.log('\n=== RIEPILOGO ===');
console.log(`Modello: ${catalogJson.models[0].name} (${mat.numero})`);
console.log(`Cliente: ${mat.cliente}`);
console.log(`Rev: ${mat.rev}, Versione: ${mat.versione}`);
console.log(`Sezioni: ${groupsJson.sections.length}`);
console.log(`Gruppi: ${Object.keys(groupMap).length}`);
console.log(`Parti: ${partsJson.length}`);
console.log(`Tavole SVG: ${copiedCount}`);
groupsJson.sections.forEach(s => {
  console.log(`  ${s.id} "${s.name.it}" - ${s.groups.length} gruppi`);
  s.groups.forEach(g => {
    console.log(`    ${g.code} "${g.name.it}" - ${g.tables.length} tavole`);
  });
});
