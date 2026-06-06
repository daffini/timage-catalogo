/**
 * Viewer3D - Viewer Three.js per navigazione 3D
 * Carica glTF, navigazione gerarchica sezione → gruppo → pezzo.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export class Viewer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this._listeners = {};
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.model = null;         // gltf.scene
    this.rootNode = null;      // il nodo root reale del modello (es. M.VRTX.CLSR.000012)
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Navigazione gerarchica
    this.currentLevel = 'root'; // 'root' | 'section' | 'group'
    this.currentNode = null;
    this.sectionNodes = [];
    // Stessa palette degli SVG annotati (data-piece-color)
    this.sectionColors = [
      0xe6194b, // rosso
      0x3cb44b, // verde
      0x4363d8, // blu
      0xf58231, // arancio
      0x911eb4, // viola
      0x42d4f4, // ciano
      0xf032e6, // magenta
      0xbfef45, // lime
      0xfabed4, // rosa
      0x469990, // teal
      0xdcbeff, // lavanda
      0x9a6324, // marrone
      0x800000, // bordeaux
      0xaaffc3, // menta
      0x808000, // oliva
    ];

    // Mappa materiali originali per restore
    this._originalMaterials = new Map();

    // Ultimo oggetto hoverato per highlight
    this._hoveredSection = null;

    this._initScene();
    this._initEvents();
  }

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(cb => cb(data));
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f2f5);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    this.camera.position.set(0, 2000, 5000);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false; // ombre off - grande impatto performance
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Luci (nessuna ombra = veloce ma buona qualita)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5000, 8000, 5000);
    this.scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dirLight2.position.set(-3000, 4000, -3000);
    this.scene.add(dirLight2);

    const dirLight3 = new THREE.DirectionalLight(0xffffff, 0.2);
    dirLight3.position.set(0, -3000, 0);
    this.scene.add(dirLight3);

    // Controls
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.maxDistance = 50000;
    this.controls.minDistance = 0.01;

    this._animate();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    if (this.controls) this.controls.update();
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  _initEvents() {
    const resizeObserver = new ResizeObserver(() => this.resize());
    resizeObserver.observe(this.canvas.parentElement);

    // Doppio click: naviga dentro (macchina→sezione, sezione→gruppo)
    this.canvas.addEventListener('dblclick', (e) => this._onDblClick(e));
    // Click singolo: seleziona il pezzo a livello gruppo
    this.canvas.addEventListener('click', (e) => this._onClickGroup(e));
    this.canvas.addEventListener('mousemove', (e) => this._onHover(e));
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  async loadModel(relativePath) {
    const loadingEl = document.getElementById('three-loading');
    const progressEl = document.getElementById('three-progress');
    loadingEl.classList.remove('hidden');

    try {
      const absolutePath = await window.catalog.resolveDataPath(relativePath);
      const fileUrl = `file:///${absolutePath.replace(/\\/g, '/')}`;

      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);

      // Draco decoder per file .glb compressi (path relativo al dist/index.html)
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('./draco/');
      dracoLoader.setDecoderConfig({ type: 'js' }); // forza JS decoder (no WASM per Electron file://)
      loader.setDRACOLoader(dracoLoader);

      const gltf = await new Promise((resolve, reject) => {
        loader.load(
          fileUrl,
          (gltf) => resolve(gltf),
          (progress) => {
            if (progress.total > 0) {
              const pct = (progress.loaded / progress.total) * 100;
              progressEl.style.width = `${pct}%`;
            }
          },
          (error) => reject(error)
        );
      });

      this.model = gltf.scene;
      this.scene.add(this.model);

      // Trova il root node reale del modello
      // gltf.scene potrebbe avere nodi intermedi prima del vero root
      this.rootNode = this._findRealRoot(this.model);

      console.log('=== Struttura modello 3D ===');
      console.log('gltf.scene children:', this.model.children.map(c => `${c.name} (${c.children?.length || 0} figli)`));
      console.log('Root node trovato:', this.rootNode?.name);
      if (this.rootNode) {
        console.log('Sezioni (figli root):', this.rootNode.children.map(c =>
          `${c.name} (${c.children?.length || 0} figli)`
        ));
      }

      // Identifica le sezioni (mantenendo i materiali PBR originali)
      // Costruisci set di tutti i nomi nodi (normalizzati) per lookup rapido
      this._buildNodeIndex();

      // Forza tutto il modello in scala di grigi (nessun colore categorico)
      this._applyGrayscale();

      // Rileva i contenitori fisici (figli diretti del root del modello).
      // Le sezioni/gruppi NAVIGABILI vengono poi costruiti dal catalogo
      // tramite setCatalogHierarchy() (chiamato da app.js dopo il load).
      this._identifyContainers();

      // Fit camera
      this._fitCameraToModel();

      loadingEl.classList.add('hidden');
      console.log('Modello 3D caricato con successo');
    } catch (error) {
      console.error('Errore caricamento modello 3D:', error);
      loadingEl.innerHTML = `
        <p style="color: var(--danger);">Errore caricamento modello 3D</p>
        <p style="font-size: 12px; opacity: 0.7;">${error.message}</p>
      `;
    }
  }

  /**
   * Trova il vero nodo root del modello.
   * gltf.scene puo avere wrapper intermedi. Il root reale e il nodo
   * che ha figli con sotto-figli (la struttura gerarchica del CAD).
   */
  _findRealRoot(sceneNode) {
    // Caso 1: i figli diretti di scene sono gia le sezioni (hanno sotto-figli)
    const childrenWithKids = sceneNode.children.filter(
      c => c.children && c.children.length > 0 && !c.isMesh
    );

    if (childrenWithKids.length > 1) {
      // scene ha gia multiple sezioni come figli diretti
      return sceneNode;
    }

    if (childrenWithKids.length === 1) {
      // C'e un unico nodo intermedio - probabilmente il root CAD
      const candidate = childrenWithKids[0];
      const grandchildrenWithKids = candidate.children.filter(
        c => c.children && c.children.length > 0 && !c.isMesh
      );
      if (grandchildrenWithKids.length > 1) {
        // Questo nodo ha multiple sezioni come figli → e il root
        return candidate;
      }
      // Prova un livello piu in basso
      return this._findRealRoot(candidate);
    }

    // Fallback: usa sceneNode stesso
    return sceneNode;
  }

  /**
   * Rileva i contenitori fisici del modello: i figli diretti del root reale
   * che contengono mesh. Ogni sezione del catalogo verra mappata su uno di
   * questi contenitori in setCatalogHierarchy().
   */
  _identifyContainers() {
    this._containers = [];
    if (!this.rootNode) return;
    this.rootNode.children.forEach((child) => {
      if (this._countMeshes(child) > 0) this._containers.push(child);
    });
    console.log(`Contenitori fisici: ${this._containers.length}`,
      this._containers.map(c => c.name));
  }

  /**
   * Risale dalla mesh fino al figlio diretto del root reale (il contenitore
   * fisico della sezione). Ritorna null se la mesh non e sotto il root.
   */
  _rootChildAncestor(node) {
    let c = node;
    while (c && c.parent && c.parent !== this.rootNode) c = c.parent;
    return (c && c.parent === this.rootNode) ? c : null;
  }

  /**
   * Costruisce la gerarchia navigabile sezione -> gruppo dal CATALOGO
   * (groups.json), non dall'albero grezzo del glTF.
   * - Ogni sezione del catalogo viene mappata sul contenitore fisico glTF
   *   che la racchiude (figlio diretto del root).
   * - I gruppi sono SOLO quelli presenti in distinta e realmente nel modello.
   * Chiamato da app.js subito dopo loadModel().
   */
  setCatalogHierarchy(sections, lang = 'it', parts = []) {
    this.sectionNodes = [];
    this._lang = lang;

    // Codici che sono in realta GRUPPI/sotto-assiemi: non sono veri pezzi.
    const groupCodeSet = new Set();
    (sections || []).forEach(s =>
      (s.groups || []).forEach(gr => groupCodeSet.add(this._normalizeName(gr.code))));

    // Mappa gruppo -> set codici pezzo (normalizzati) della distinta.
    // Serve a limitare hover/click ai soli pezzi del gruppo corrente.
    this._groupPartCodes = new Map();
    (parts || []).forEach((p) => {
      if (!p || !p.group || !p.code) return;
      if (/^TAV-/i.test(p.code)) return; // i riferimenti tavola non sono pezzi
      if (groupCodeSet.has(this._normalizeName(p.code))) return; // sotto-gruppi
      if (!this._groupPartCodes.has(p.group)) this._groupPartCodes.set(p.group, new Set());
      this._groupPartCodes.get(p.group).add(this._normalizeName(p.code));
    });

    if (!this.model || !Array.isArray(sections)) return;

    sections.forEach((sec) => {
      // Risolvi i nodi glTF dei gruppi in distinta che esistono nel modello
      const groups = [];
      (sec.groups || []).forEach((g) => {
        const node = this.getNodeByCode(g['3dNode'] || g.code);
        if (node) {
          groups.push({
            name: g['3dNode'] || g.code,
            code: g.code,
            label: g.name,
            object: node,
          });
        }
      });

      // Contenitore fisico della sezione = figlio del root che la racchiude.
      // Provo dal 3dNode della sezione, poi dal primo gruppo risolto.
      let container = null;
      const secNode = this.getNodeByCode(sec['3dNode']);
      if (secNode) container = this._rootChildAncestor(secNode);
      if (!container && groups.length) container = this._rootChildAncestor(groups[0].object);
      if (!container && secNode) container = secNode;
      if (!container) {
        console.warn(`Sezione ${sec.id || sec.code}: nessun contenitore 3D trovato`);
        return;
      }

      this.sectionNodes.push({
        name: sec['3dNode'] || sec.id || sec.code,
        code: sec.id || sec.code,
        label: sec.name,
        object: container,
        groups,
        groupSet: new Set(groups.map(gr => gr.object)),
      });
    });

    console.log(`Gerarchia catalogo: ${this.sectionNodes.length} sezioni`,
      this.sectionNodes.map(s => `${s.code} -> ${s.object.name} (${s.groups.length} gruppi)`));
  }

  /**
   * True se il codice e un pezzo della distinta del GRUPPO corrente.
   * Usato per limitare hover/click ai soli pezzi del gruppo.
   */
  _isCurrentGroupPart(code) {
    if (!code || !this.currentGroup) return false;
    const set = this._groupPartCodes?.get(this.currentGroup.code);
    return !!set && set.has(this._normalizeName(code));
  }

  /**
   * Costruisce un indice di tutti i nomi nodi nel modello (normalizzati).
   * Chiamato una volta sola dopo il caricamento.
   */
  /**
   * Converte tutti i materiali del modello da PBR (MeshStandard) a Lambert.
   * Accelera il rendering di ~3x mantenendo una qualità visuale accettabile.
   */
  _convertMaterialsToLambert() {
    if (!this.model) return;
    const cache = new Map(); // Riusa materiali identici
    let converted = 0;

    this.model.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        const newMats = mats.map(m => {
          // Usa cache per materiali identici
          const key = `${m.color?.getHex() || 0}_${m.side || 0}`;
          if (cache.has(key)) return cache.get(key);

          const lambert = new THREE.MeshLambertMaterial({
            color: m.color || 0xffffff,
            side: THREE.DoubleSide,
          });
          cache.set(key, lambert);
          converted++;
          return lambert;
        });
        child.material = Array.isArray(child.material) ? newMats : newMats[0];
        // Frustum culling attivo
        child.frustumCulled = true;
      }
    });

    console.log(`Materiali convertiti a Lambert: ${converted} unici (cache hits: ottimizzata)`);
  }

  /**
   * Forza tutte le mesh del modello in scala di grigi neutra.
   * Sostituisce qualsiasi colore originale/categorico con un unico
   * materiale grigio condiviso: il rilievo resta visibile grazie
   * all'illuminazione, ma il disegno non e mai colorato.
   */
  _applyGrayscale() {
    if (!this.model) return;
    const grayMat = new THREE.MeshLambertMaterial({
      color: 0xbfbfbf,
      side: THREE.DoubleSide,
    });
    let count = 0;
    this.model.traverse((child) => {
      if (child.isMesh) {
        child.material = grayMat;
        child.frustumCulled = true;
        count++;
      }
    });
    this._baseMaterial = grayMat;

    // Materiale condiviso per l'highlight di hover (ambra chiaro).
    // La selezione col click resta arancione (_highlightPart).
    this._hoverMaterial = new THREE.MeshLambertMaterial({
      color: 0xf3b54a,
      emissive: 0x2e2000,
      side: THREE.DoubleSide,
    });

    console.log(`Scala di grigi applicata a ${count} mesh`);
  }

  _buildNodeIndex() {
    this._nodeNames = new Set();
    this._nodeMap = new Map(); // nome normalizzato → nodo Three.js (lookup O(1))
    if (!this.model) return;
    this.model.traverse((child) => {
      if (child.name) {
        const norm = this._normalizeName(child.name);
        this._nodeNames.add(norm);
        // Preferisci i mesh diretti; fallback sui contenitori
        if (!this._nodeMap.has(norm) || child.isMesh) {
          this._nodeMap.set(norm, child);
        }
      }
    });
    console.log(`Indice nodi 3D: ${this._nodeNames.size} nomi, ${this._nodeMap.size} nodi`);
  }

  /**
   * Controlla se un codice pezzo esiste nel modello 3D. O(1).
   */
  hasNode(code) {
    if (!this._nodeNames) return false;
    return this._nodeNames.has(this._normalizeName(code));
  }

  /**
   * Ritorna il nodo Three.js corrispondente a un codice. O(1).
   */
  getNodeByCode(code) {
    if (!this._nodeMap) return null;
    return this._nodeMap.get(this._normalizeName(code)) || null;
  }

  _countMeshes(node) {
    let count = 0;
    node.traverse((child) => {
      if (child.isMesh) count++;
    });
    return count;
  }

  // ─── Materiali ───

  _colorizeNode(node, color, opacity = 1) {
    node.traverse((child) => {
      if (child.isMesh) {
        if (!this._originalMaterials.has(child.uuid)) {
          this._originalMaterials.set(child.uuid, child.material.clone());
        }
        child.material = new THREE.MeshLambertMaterial({
          color: color,
          transparent: opacity < 1,
          opacity: opacity,
          side: THREE.DoubleSide,
        });
      }
    });
  }

  _restoreOriginalMaterials(node) {
    node.traverse((child) => {
      if (child.isMesh && this._originalMaterials.has(child.uuid)) {
        child.material = this._originalMaterials.get(child.uuid).clone();
      }
    });
  }

  // ─── Camera ───

  _fitCameraToModel() {
    if (!this.model) return;

    const box = new THREE.Box3().setFromObject(this.model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    this.camera.position.set(
      center.x + maxDim * 0.8,
      center.y + maxDim * 0.6,
      center.z + maxDim * 1.2
    );
    this.controls.target.copy(center);
    this.controls.update();
  }

  _fitCameraToNode(node) {
    this._fitCameraToBox(new THREE.Box3().setFromObject(node));
  }

  /**
   * Inquadra l'insieme di mesh passato (bounding box combinato).
   */
  _fitCameraToMeshes(meshes) {
    if (!meshes || !meshes.length) return;
    const box = new THREE.Box3();
    meshes.forEach(m => box.expandByObject(m));
    if (box.isEmpty()) return;
    this._fitCameraToBox(box);
  }

  _fitCameraToBox(box) {
    if (!box || box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Distanza: proporzionale alla dimensione ma con un minimo
    // per non entrare dentro pezzi piccoli
    const currentDist = this.camera.position.distanceTo(this.controls.target);
    const idealDist = maxDim * 3;
    // Non avvicinarsi più del 30% della distanza attuale per pezzi piccoli
    const minDist = currentDist * 0.3;
    const dist = Math.max(idealDist, minDist, 0.1);

    // Mantieni la direzione attuale della camera
    const camDir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    const targetPos = center.clone().addScaledVector(camDir, dist);

    this._animateCamera(targetPos, center, 600);
  }

  _animateCamera(targetPosition, targetLookAt, duration) {
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = t * (2 - t); // easeOutQuad

      this.camera.position.lerpVectors(startPos, targetPosition, ease);
      this.controls.target.lerpVectors(startTarget, targetLookAt, ease);
      this.controls.update();

      if (t < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }

  // ─── Interazione ───

  _getMouseCoords(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  // Doppio click: naviga dentro la gerarchia (macchina→sezione, sezione→gruppo)
  _onDblClick(event) {
    if (!this.model) return;

    this._getMouseCoords(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.model, true);
    if (intersects.length === 0) return;

    const hit = intersects[0].object;

    if (this.currentLevel === 'root') {
      const section = this._findAncestorSection(hit);
      if (section) this._enterSection(section);
    } else if (this.currentLevel === 'section') {
      const group = this._findChildGroup(hit);
      if (group) this._selectGroup(group);
    } else if (this.currentLevel === 'group') {
      // Doppio click a livello gruppo: chiudi tooltip e apri popup dettagli
      this._hideTooltip();
      const partHit = this._firstGroupPartHit(intersects);
      if (partHit) this._emit('open-part', partHit.code);
    }
  }

  // Click singolo: seleziona un pezzo a livello gruppo
  _onClickGroup(event) {
    if (!this.model || this.currentLevel !== 'group') return;

    this._getMouseCoords(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.model, true);
    if (intersects.length === 0) return;

    const partHit = this._firstGroupPartHit(intersects);
    if (!partHit) return;

    this.highlightPartByCode(partHit.code, false);
    this._emit('select-part', partHit.code);
  }

  /**
   * Risale dalla mesh al primo nodo con un nome (il codice del pezzo).
   */
  _nearestNamedName(node) {
    let n = node;
    while (n) {
      if (n.name) return n.name;
      n = n.parent;
    }
    return '';
  }

  _onHover(event) {
    if (!this.model) return;

    this._getMouseCoords(event);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.model, true);

    // Niente sotto il mouse: spegni hover e tooltip
    if (intersects.length === 0) {
      this._clearHoverUnit();
      this._hideTooltip();
      return;
    }

    const hit = intersects[0].object;

    if (this.currentLevel === 'root') {
      // Livello macchina: hover attivo solo sulle SEZIONI
      const section = this._findAncestorSection(hit);
      if (section) {
        this._setHoverUnit(section.object);
        // Tooltip sezione costruito dai dati catalogo (no lookup ambiguo sul 3dNode)
        this._showTooltipHtml(event, this._sectionTooltipHtml(section));
      } else {
        this._clearHoverUnit();
        this._hideTooltip();
      }
    } else if (this.currentLevel === 'section') {
      // Livello sezione: hover attivo solo sui GRUPPI
      const group = this._findChildGroup(hit);
      if (group) {
        this._setHoverUnit(group.object);
        this._showTooltip(event, group.name);
      } else {
        this._clearHoverUnit();
        this._hideTooltip();
      }
    } else if (this.currentLevel === 'group') {
      // Livello gruppo: hover attivo solo sui PEZZI della distinta di questo gruppo.
      // Scorri gli intersect: salta scatole/coperture che non sono pezzi.
      const partHit = this._firstGroupPartHit(intersects);
      if (partHit) {
        this._setHoverPartMeshes(partHit.code, this._partMeshesInGroup(partHit.code));
        this._showTooltip(event, partHit.code); // tooltip: codice + nome
      } else {
        this._clearHoverUnit();
        this._hideTooltip();
      }
    }
  }

  /**
   * Evidenzia in ambra l'unita sotto il mouse (sezione / gruppo / particolare
   * a seconda del livello). Scambio di materiale condiviso: ricalcolato solo
   * quando l'unita cambia, quindi leggero anche su sezioni con molte mesh.
   */
  _setHoverUnit(object) {
    if (!object) { this._clearHoverUnit(); return; }
    if (this._hoverKey === object) return; // gia evidenziato
    this._applyHover(object, this._meshesOf(object));
  }

  /**
   * Hover su un insieme specifico di mesh (es. tutte le mesh di un pezzo).
   * key = identificatore per evitare ri-applicazioni inutili (es. il codice).
   */
  _setHoverPartMeshes(key, meshes) {
    if (!key || !meshes || !meshes.length) { this._clearHoverUnit(); return; }
    if (this._hoverKey === key) return;
    this._applyHover(key, meshes);
  }

  _meshesOf(object) {
    const out = [];
    object.traverse(c => { if (c.isMesh) out.push(c); });
    return out;
  }

  _applyHover(key, meshes) {
    this._clearHoverUnit();
    this._hoverKey = key;
    this._hoverSaved = [];
    meshes.forEach((child) => {
      // Non sovrascrivere i pezzi selezionati (restano arancioni)
      if (this._isHighlighted(child)) return;
      this._hoverSaved.push({ mesh: child, material: child.material });
      child.material = this._hoverMaterial;
    });
    this.canvas.style.cursor = 'pointer';
  }

  _isHighlighted(mesh) {
    if (mesh === this._highlightedPart) return true;
    if (this._highlightedParts) return this._highlightedParts.some(h => h.mesh === mesh);
    return false;
  }

  _clearHoverUnit() {
    if (this._hoverSaved) {
      this._hoverSaved.forEach(({ mesh, material }) => {
        // Ripristina solo se ancora in stato hover (non alterato nel frattempo)
        if (mesh.material === this._hoverMaterial) mesh.material = material;
      });
      this._hoverSaved = null;
    }
    this._hoverKey = null;
    this.canvas.style.cursor = '';
  }

  /**
   * Evidenzia in ambra un pezzo (chiamato dall'hover sull'albero).
   * Ha effetto solo a livello gruppo, sui pezzi del gruppo corrente.
   */
  hoverPartByCode(code) {
    if (!this.model || !code) return;
    if (this.currentLevel !== 'group' || !this._currentGroupMeshes) return;
    const meshes = this._partMeshesInGroup(code);
    if (meshes.length) this._setHoverPartMeshes(code, meshes);
  }

  clearTreeHover() {
    this._clearHoverUnit();
    this._hideTooltip();
  }

  /**
   * Dato un mesh cliccato, risale la gerarchia fino a trovare
   * quale sezione lo contiene.
   */
  _findAncestorSection(mesh) {
    // La sezione e il contenitore fisico (figlio del root) che contiene la mesh
    const rc = this._rootChildAncestor(mesh);
    if (!rc) return null;
    return this.sectionNodes.find(s => s.object === rc) || null;
  }

  /**
   * Dato un mesh dentro la sezione corrente, trova il GRUPPO IN DISTINTA
   * piu interno che lo contiene. I gruppi del catalogo possono essere
   * annidati uno dentro l'altro nel glTF: si ritorna il piu specifico.
   * Se la mesh non e dentro nessun gruppo di distinta -> null (inerte).
   */
  _findChildGroup(mesh) {
    if (!this.currentNode || !this.currentNode.groupSet) return null;
    const set = this.currentNode.groupSet;
    const sectionObj = this.currentNode.object;

    let current = mesh;
    while (current && current !== sectionObj.parent) {
      if (set.has(current)) {
        return this.currentNode.groups.find(g => g.object === current) || null;
      }
      if (current === this.rootNode || current === this.model) break;
      current = current.parent;
    }
    return null;
  }

  // ─── Navigazione livelli ───

  _enterSection(section, emitEvent = true) {
    this._clearHoverUnit();
    this.currentLevel = 'section';
    this.currentNode = section;
    this._hoveredSection = null;

    // Mostra solo il contenitore di questa sezione, nascondi gli altri
    (this._containers || []).forEach(c => {
      const show = (c === section.object);
      c.visible = show;
      c.traverse(child => { child.visible = show; });
    });
    // Sicurezza: contenitore corrente e suoi parent visibili
    let n = section.object;
    while (n) { n.visible = true; n = n.parent; }

    this._fitCameraToNode(section.object);
    if (emitEvent) this._emit('select-section', section.name);
  }

  _selectGroup(group, emitEvent = true) {
    this._clearHoverUnit();
    this._clearPartHighlight();
    this._restoreGroupGhost();
    this.currentLevel = 'group';
    this.currentGroup = group;

    // Pezzi della distinta del gruppo (la loro geometria puo essere sparsa nel
    // modello, non solo sotto il nodo glTF del gruppo).
    const codes = this._groupPartCodes?.get(group.code) || new Set();
    const partMeshes = new Set();
    this.model.traverse((node) => {
      if (node.name && codes.has(this._normalizeName(node.name))) {
        if (node.isMesh) partMeshes.add(node);
        node.traverse(sub => { if (sub.isMesh) partMeshes.add(sub); });
      }
    });
    this._currentGroupMeshes = partMeshes;

    // Visibilita: mostra l'assieme del gruppo (contesto) + i pezzi sparsi;
    // nascondi le altre sezioni/gruppi.
    this.model.traverse((child) => { if (child.isMesh) child.visible = false; });
    const showSubtree = (root) => {
      if (!root) return;
      root.traverse(c => { c.visible = true; });
      let n = root; while (n) { n.visible = true; n = n.parent; }
    };
    showSubtree(group.object); // assieme del gruppo (contesto)
    partMeshes.forEach(m => {   // pezzi (anche fuori dal nodo del gruppo)
      m.visible = true;
      let n = m.parent; while (n) { n.visible = true; n = n.parent; }
    });

    // Materiali: il resto dell'assieme del gruppo (non-pezzi) va in trasparenza;
    // i pezzi della distinta restano opachi (selezionabili).
    this._groupGhostState = [];
    if (group.object) {
      const ghost = this._getGroupGhostMaterial();
      group.object.traverse((c) => {
        if (c.isMesh && !partMeshes.has(c)) {
          this._groupGhostState.push({ mesh: c, material: c.material });
          c.material = ghost;
        }
      });
    }
    // Rispetta lo stato del toggle "Trasparenza" (mostra/nasconde il contesto)
    this._applyTransparencyVisibility();

    this._fitCameraToNode(group.object || this.currentNode?.object);
    if (emitEvent) this._emit('select-group', group.name);
  }

  _getGroupGhostMaterial() {
    if (!this._groupGhostMaterial) {
      this._groupGhostMaterial = new THREE.MeshLambertMaterial({
        color: 0x999999,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    }
    return this._groupGhostMaterial;
  }

  _restoreGroupGhost() {
    if (this._groupGhostState) {
      this._groupGhostState.forEach(({ mesh, material }) => {
        if (mesh.material === this._groupGhostMaterial) mesh.material = material;
      });
      this._groupGhostState = null;
    }
  }

  /**
   * Nasconde tutti i figli di un nodo tranne uno specifico.
   * Usato per isolare un gruppo dentro una sezione.
   */
  _setVisibilityExcept(parentNode, keepVisible, visible) {
    parentNode.traverse((child) => {
      if (child === parentNode) return;
      // Controlla se child è o contiene keepVisible
      let isKeep = (child === keepVisible);
      if (!isKeep && keepVisible) {
        keepVisible.traverse((kc) => {
          if (kc === child) isKeep = true;
        });
      }
      if (!isKeep && child.isMesh) {
        child.visible = visible;
      }
    });
  }

  /**
   * Evidenzia un pezzo nel 3D cercandolo per codice (match fuzzy).
   * Chiamato dalla combo nel footer.
   */
  highlightPartByCode(code, fit = true) {
    if (!this.model) return;

    // Pulisci hover (per non catturare il materiale ambra come "originale")
    this._clearHoverUnit();
    // Rimuovi highlight precedente
    this._clearPartHighlight();

    // Raccogli le mesh del pezzo. A livello gruppo limita ai pezzi del gruppo
    // corrente (gia visibili), per non rivelare istanze omonime nascoste.
    let meshes;
    if (this.currentLevel === 'group' && this._currentGroupMeshes) {
      meshes = this._partMeshesInGroup(code);
    } else {
      meshes = this._collectMeshesByCode(code, this.model);
      // Rendi visibili le mesh e i loro parent (fuori contesto)
      meshes.forEach(m => {
        let n = m;
        while (n && n !== this.model) { n.visible = true; n = n.parent; }
      });
    }
    if (!meshes.length) return;

    this._highlightPartsWithAlpha(meshes);
    if (fit) this._fitCameraToMeshes(meshes);
  }

  /**
   * Raccoglie tutte le mesh appartenenti a un codice pezzo dentro `root`.
   * Considera ogni nodo il cui nome corrisponde al codice (anche piu nodi
   * con lo stesso nome) e tutte le mesh discendenti.
   */
  _collectMeshesByCode(code, root = this.model) {
    const meshes = new Set();
    if (!root || !code) return [];
    const norm = this._normalizeName(code);
    root.traverse((node) => {
      if (this._normalizeName(node.name) === norm) {
        if (node.isMesh) meshes.add(node);
        node.traverse(sub => { if (sub.isMesh) meshes.add(sub); });
      }
    });
    return [...meshes];
  }

  /**
   * Scorre la lista di intersezioni (ordinata per distanza) e ritorna la prima
   * che appartiene a un pezzo della distinta del gruppo corrente.
   * Permette di selezionare pezzi anche se davanti c'e una scatola/copertura
   * che non e un pezzo.
   */
  _firstGroupPartHit(intersects) {
    for (const it of intersects) {
      const code = this._groupPartCodeOf(it.object);
      if (code) return { object: it.object, code };
    }
    return null;
  }

  /**
   * Risale dalla mesh al primo nodo il cui nome e un codice pezzo della
   * distinta del gruppo corrente. Ritorna il codice, oppure '' se la mesh
   * non appartiene a un pezzo del gruppo.
   */
  _groupPartCodeOf(mesh) {
    const codes = this._groupPartCodes?.get(this.currentGroup?.code);
    if (!codes) return '';
    let n = mesh;
    while (n) {
      if (n.name && codes.has(this._normalizeName(n.name))) return n.name;
      n = n.parent;
    }
    return '';
  }

  /**
   * Mesh di un pezzo limitate al gruppo corrente (se siamo a livello gruppo).
   */
  _partMeshesInGroup(code) {
    const all = this._collectMeshesByCode(code, this.model);
    if (this._currentGroupMeshes) return all.filter(m => this._currentGroupMeshes.has(m));
    return all;
  }

  /**
   * Isola un pezzo: nasconde tutto il resto e mostra solo il pezzo.
   * Se già isolato, ripristina la vista.
   */
  toggleIsolatePart(code) {
    if (this._isolatedPart) {
      // Ripristina: mostra tutto
      this._restoreIsolation();
      return false;
    }

    if (!this.model || !code) return false;

    const normCode = this._normalizeName(code);
    let targetNode = null;

    this.model.traverse((child) => {
      if (!targetNode && this._normalizeName(child.name) === normCode) {
        targetNode = child;
      }
    });

    if (!targetNode) return false;

    // Salva lo stato di visibilità di tutti i nodi
    this._isolationState = [];
    this.model.traverse((child) => {
      this._isolationState.push({ obj: child, visible: child.visible });
    });

    // Nascondi tutto
    this.model.traverse((child) => {
      if (child.isMesh) child.visible = false;
    });

    // Mostra solo il pezzo selezionato e i suoi figli
    targetNode.visible = true;
    targetNode.traverse((child) => {
      child.visible = true;
    });

    // Assicura che i parent siano visibili (non mesh, solo contenitori)
    let parent = targetNode.parent;
    while (parent) {
      parent.visible = true;
      parent = parent.parent;
    }

    this._isolatedPart = targetNode;

    // Evidenzia solo, senza zoom né wireframe
    if (targetNode.isMesh) {
      this._highlightPart(targetNode);
    }

    return true;
  }

  _restoreIsolation() {
    if (!this._isolationState) return;

    // Ripristina la visibilità originale
    this._isolationState.forEach(({ obj, visible }) => {
      obj.visible = visible;
    });

    this._isolationState = null;
    this._isolatedPart = null;
    this._clearPartHighlight();

    // Zoom sul livello corrente
    if (this.currentGroup) {
      this._fitCameraToNode(this.currentGroup.object);
    } else if (this.currentNode) {
      this._fitCameraToNode(this.currentNode.object);
    } else {
      this._fitCameraToModel();
    }
  }

  _clearPartHighlight() {
    // Ripristina alpha degli altri pezzi
    this._clearPartAlpha();
    // Ripristina le mesh evidenziate (multiple)
    this._restoreHighlightedParts();
    // Ripristina materiale del pezzo evidenziato (singolo, da click viewport)
    if (this._highlightedPart && this._highlightedPartOrigMaterial) {
      this._highlightedPart.material = this._highlightedPartOrigMaterial;
      this._highlightedPart = null;
      this._highlightedPartOrigMaterial = null;
    }
  }

  _showTooltip(event, nodeName) {
    if (!nodeName) { this._hideTooltip(); return; }

    let tooltip = document.getElementById('three-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'three-tooltip';
      tooltip.className = 'three-tooltip';
      document.body.appendChild(tooltip);
    }

    // Cerca info dal catalogo tramite evento
    this._emit('tooltip-info', {
      nodeName,
      callback: (info) => {
        tooltip.innerHTML = info || nodeName;
        tooltip.style.left = (event.clientX + 15) + 'px';
        tooltip.style.top = (event.clientY - 10) + 'px';
        tooltip.style.display = 'block';
      }
    });
  }

  _hideTooltip() {
    const tooltip = document.getElementById('three-tooltip');
    if (tooltip) tooltip.style.display = 'none';
  }

  /**
   * Mostra un tooltip con HTML gia pronto (senza lookup nel catalogo).
   * Usato per le sezioni a livello macchina.
   */
  _showTooltipHtml(event, html) {
    if (!html) { this._hideTooltip(); return; }
    let tooltip = document.getElementById('three-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'three-tooltip';
      tooltip.className = 'three-tooltip';
      document.body.appendChild(tooltip);
    }
    tooltip.innerHTML = html;
    tooltip.style.left = (event.clientX + 15) + 'px';
    tooltip.style.top = (event.clientY - 10) + 'px';
    tooltip.style.display = 'block';
  }

  /**
   * Testo tooltip per una sezione: "Sezione {numero}" + descrizione sotto.
   */
  _sectionTooltipHtml(section) {
    if (!section) return '';
    const num = (section.code || '').replace(/^SEZ[-_]?/i, '') || section.code || '';
    const lang = this._lang || 'it';
    const desc = (section.label && (section.label[lang] || section.label.it)) || '';
    return `<b>Sezione ${num}</b>` + (desc ? `<br>${desc}` : '');
  }

  /**
   * Evidenzia una sezione: mantiene i materiali originali sulla selezionata,
   * rende ghost il resto del modello.
   */
  highlightSection(nodeName) {
    if (!this.model) return;

    // Trova quale sezione contiene questo nodo
    let targetSection = this.sectionNodes.find(s => this._namesMatch(s.name, nodeName));
    if (!targetSection) {
      targetSection = this._findSectionByName(nodeName);
    }

    if (!targetSection) return;

    // Rendi ghost tutto il modello
    this.model.traverse((child) => {
      if (child.isMesh) {
        if (!this._originalMaterials.has(child.uuid)) {
          this._originalMaterials.set(child.uuid, child.material.clone());
        }
        const wasWireframe = child.material?.wireframe || false;
        child.material = new THREE.MeshLambertMaterial({
          color: 0x999999,
          transparent: true,
          opacity: 0.08,
          wireframe: wasWireframe,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      }
    });

    // Ripristina i materiali originali della sezione selezionata (opaca)
    this._restoreOriginalMaterials(targetSection.object);
  }

  /**
   * Evidenzia un gruppo: il nodo esatto con colore pieno,
   * tutto il resto del modello grigio quasi invisibile.
   * Cerca in TUTTO il modello, non solo tra i figli della sezione corrente.
   */
  highlightGroup(nodeName) {
    if (!this.model) return;

    // Cerca il nodo esatto in tutto il modello
    let targetNode = null;
    this.model.traverse((child) => {
      if (!targetNode && this._namesMatch(child.name, nodeName)) {
        targetNode = child;
      }
    });

    if (!targetNode) {
      console.log('highlightGroup: nodo non trovato per', nodeName);
      return;
    }

    // Rendi tutto grigio trasparente
    this.model.traverse((child) => {
      if (child.isMesh) {
        if (!this._originalMaterials.has(child.uuid)) {
          this._originalMaterials.set(child.uuid, child.material.clone());
        }
        const wasWireframe = child.material?.wireframe || false;
        child.material = new THREE.MeshLambertMaterial({
          color: 0x999999,
          transparent: true,
          opacity: 0.08,
          wireframe: wasWireframe,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      }
    });

    // Ripristina i materiali originali del nodo target (opaco)
    this._restoreOriginalMaterials(targetNode);
  }

  /**
   * Rende un nodo grigio e quasi invisibile (ghost).
   * Usato per evidenziare la selezione a tutti i livelli.
   */
  _makeGhostNode(node, opacity) {
    node.traverse((child) => {
      if (child.isMesh) {
        const wasWireframe = child.material?.wireframe || false;
        if (!this._originalMaterials.has(child.uuid)) {
          this._originalMaterials.set(child.uuid, child.material.clone());
        }
        child.material = new THREE.MeshLambertMaterial({
          color: 0x999999,
          transparent: true,
          opacity: opacity,
          wireframe: wasWireframe,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      }
    });
  }

  /**
   * Evidenzia un pezzo riducendo l'alpha del resto (senza toccare wireframe).
   * Il pezzo selezionato diventa arancione opaco, il resto semi-trasparente.
   */
  _highlightPartsWithAlpha(meshes) {
    this._clearPartAlpha();

    const targetSet = new Set(meshes);

    // A livello gruppo: rende ghost le altre mesh dei pezzi (da _currentGroupMeshes).
    // Non tocchiamo il contesto trasparente (_groupGhostState) per non accumulare strati.
    // Fuori dal gruppo: usa il contenitore normale.
    const sourceMeshes = this._currentGroupMeshes
      ? [...this._currentGroupMeshes]
      : (() => {
          const out = [];
          const container = this.currentNode?.object || this.model;
          container.traverse(c => { if (c.isMesh && c.visible) out.push(c); });
          return out;
        })();

    const ghostMat = new THREE.MeshLambertMaterial({
      color: 0x999999,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this._alphaState = [];
    sourceMeshes.forEach(child => {
      if (!child.visible || targetSet.has(child)) return;
      this._alphaState.push({ mesh: child, origMaterial: child.material });
      child.material = ghostMat;
    });

    // Evidenzia le mesh del pezzo in arancione opaco
    this._highlightParts(meshes);
  }

  /**
   * Applica l'highlight arancione a un insieme di mesh, salvando i materiali
   * originali per il ripristino.
   */
  _highlightParts(meshes) {
    this._restoreHighlightedParts();
    this._highlightedParts = [];
    const orange = new THREE.MeshLambertMaterial({
      color: 0xff6600,
      emissive: 0x331100,
      side: THREE.DoubleSide,
    });
    meshes.forEach(mesh => {
      this._highlightedParts.push({ mesh, origMaterial: mesh.material });
      mesh.material = orange;
    });
  }

  _restoreHighlightedParts() {
    if (this._highlightedParts) {
      this._highlightedParts.forEach(({ mesh, origMaterial }) => {
        mesh.material = origMaterial;
      });
      this._highlightedParts = null;
    }
  }

  _clearPartAlpha() {
    if (this._alphaState) {
      this._alphaState.forEach(({ mesh, origMaterial }) => {
        mesh.material = origMaterial;
      });
      this._alphaState = null;
    }
  }

  _highlightPart(mesh) {
    // Ripristina highlight precedente
    if (this._highlightedPart && this._highlightedPart !== mesh) {
      if (this._highlightedPartOrigMaterial) {
        this._highlightedPart.material = this._highlightedPartOrigMaterial;
      }
    }
    // Salva materiale e applica highlight arancione
    this._highlightedPartOrigMaterial = mesh.material.clone();
    this._highlightedPart = mesh;
    mesh.material = new THREE.MeshLambertMaterial({
      color: 0xff6600,
      emissive: 0x331100,
      side: THREE.DoubleSide,
    });
  }

  // ─── Navigazione programmatica (da TreeView) ───

  /**
   * Naviga a una sezione per nome/codice 3D.
   * Cerca tra i sectionNodes e i loro figli ricorsivamente.
   */
  navigateToSection(nodeName) {
    if (!this.model || !nodeName) return false;

    // Prima torna al root se siamo in un altro livello
    while (this.currentLevel !== 'root') {
      this.goBack();
    }

    // Cerca la sezione che corrisponde o contiene questo nodeName
    const section = this._findSectionByName(nodeName);
    if (section) {
      this._enterSection(section, false); // false = non emettere evento (evita loop)
      return true;
    }
    return false;
  }

  /**
   * Naviga a un gruppo per nome/codice 3D.
   * Prima entra nella sezione giusta, poi seleziona il gruppo.
   */
  navigateToGroup(groupNodeName, sectionNodeName) {
    if (!this.model || !groupNodeName) return false;

    // Prima torna al root
    while (this.currentLevel !== 'root') {
      this.goBack();
    }

    // Trova la sezione che contiene questo gruppo
    let targetSection = null;
    if (sectionNodeName) {
      targetSection = this._findSectionByName(sectionNodeName);
    }
    if (!targetSection) {
      targetSection = this._findSectionContainingNode(groupNodeName);
    }

    if (targetSection) {
      this._enterSection(targetSection, false);

      // Cerca il gruppo tra i figli della sezione
      const group = this._findGroupInSection(groupNodeName, targetSection);
      if (group) {
        this._selectGroup(group, false);
        return true;
      }
    }
    return false;
  }

  /**
   * Normalizza un nome rimuovendo punti, trattini e spazi
   * per confronto fuzzy (il glTF puo alterare i nomi).
   */
  _normalizeName(name) {
    return (name || '').replace(/[.\-\s]/g, '').toUpperCase();
  }

  /**
   * Confronta due nomi in modo fuzzy (ignora punti, trattini, case).
   */
  _namesMatch(a, b) {
    return this._normalizeName(a) === this._normalizeName(b);
  }

  /**
   * Cerca una sezione per nome/codice.
   * Confronto fuzzy: "G.STRT.CHDT.000000" matcha "GSTRTCHDT000000".
   */
  _findSectionByName(name) {
    // Match esatto
    let found = this.sectionNodes.find(s => s.name === name);
    if (found) return found;

    // Match fuzzy (senza punti)
    found = this.sectionNodes.find(s => this._namesMatch(s.name, name));
    if (found) return found;

    // Cerca traverse: il nome potrebbe essere un nodo annidato dentro una sezione
    for (const section of this.sectionNodes) {
      let match = false;
      section.object.traverse((child) => {
        if (this._namesMatch(child.name, name)) match = true;
      });
      if (match) return section;
    }

    console.log(`_findSectionByName: "${name}" non trovato. Sezioni disponibili:`,
      this.sectionNodes.map(s => s.name));
    return null;
  }

  /**
   * Cerca in quale sezione si trova un nodo con un dato nome.
   */
  _findSectionContainingNode(nodeName) {
    for (const section of this.sectionNodes) {
      let found = false;
      section.object.traverse((child) => {
        if (this._namesMatch(child.name, nodeName)) found = true;
      });
      if (found) return section;
    }
    return null;
  }

  /**
   * Cerca un gruppo dentro una sezione per nome.
   * Cerca ricorsivamente con match fuzzy (senza punti).
   */
  _findGroupInSection(groupName, section) {
    // Preferisci i gruppi di distinta della sezione (match fuzzy su 3dNode/codice)
    if (section.groups) {
      const g = section.groups.find(gr =>
        this._namesMatch(gr.name, groupName) || this._namesMatch(gr.code, groupName));
      if (g) return g;
    }
    // Fallback: cerca il nodo per nome dentro il contenitore
    let result = null;
    section.object.traverse((child) => {
      if (!result && child !== section.object && this._namesMatch(child.name, groupName)) {
        result = { name: child.name, object: child };
      }
    });
    if (!result) {
      console.log(`_findGroupInSection: "${groupName}" non trovato nella sezione "${section.name}"`);
    }
    return result;
  }

  // Torna al livello superiore
  goBack() {
    this._clearHoverUnit();
    this._clearPartHighlight();
    this._restoreGroupGhost();
    if (this.currentLevel === 'group') {
      // Torna alla sezione: ripristina la vista sezione (solo il suo contenitore)
      this._currentGroupMeshes = null;
      if (this.currentNode) {
        (this._containers || []).forEach((c) => {
          const show = (c === this.currentNode.object);
          c.visible = show;
          c.traverse(ch => { ch.visible = show; });
        });
        let n = this.currentNode.object;
        while (n) { n.visible = true; n = n.parent; }
        this._restoreOriginalMaterials(this.currentNode.object);
        this._fitCameraToNode(this.currentNode.object);
      }
      this.currentGroup = null;
      this.currentLevel = 'section';
    } else if (this.currentLevel === 'section') {
      // Torna al root: mostra tutti i contenitori fisici
      (this._containers || []).forEach((c) => {
        c.visible = true;
        c.traverse((child) => { child.visible = true; });
      });
      this.currentNode = null;
      this.currentGroup = null;
      this.currentLevel = 'root';
      this._fitCameraToModel();
    }
  }

  // ─── Toolbar: Zoom ───

  zoomIn() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.camera.position.addScaledVector(dir, this._getZoomStep());
    this.controls.update();
  }

  zoomOut() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.camera.position.addScaledVector(dir, -this._getZoomStep());
    this.controls.update();
  }

  _getZoomStep() {
    return this.camera.position.distanceTo(this.controls.target) * 0.5;
  }

  zoomFit() {
    if (this.currentLevel === 'group' && this.currentGroup) {
      this._fitCameraToNode(this.currentGroup.object);
    } else if (this.currentLevel === 'section' && this.currentNode) {
      this._fitCameraToNode(this.currentNode.object);
    } else {
      this._fitCameraToModel();
    }
  }

  // ─── Toolbar: Viste predefinite ───

  setView(view) {
    const target = this.controls.target.clone();
    const box = new THREE.Box3();

    if (this.currentLevel === 'group' && this.currentGroup) {
      box.setFromObject(this.currentGroup.object);
    } else if (this.currentLevel === 'section' && this.currentNode) {
      box.setFromObject(this.currentNode.object);
    } else if (this.model) {
      box.setFromObject(this.model);
    } else {
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) * 1.5;

    let newPos;
    switch (view) {
      case 'front':
        newPos = new THREE.Vector3(center.x, center.y, center.z + maxDim);
        break;
      case 'top':
        newPos = new THREE.Vector3(center.x, center.y + maxDim, center.z);
        break;
      case 'side':
        newPos = new THREE.Vector3(center.x + maxDim, center.y, center.z);
        break;
    }

    if (newPos) {
      this._animateCamera(newPos, center, 600);
    }
  }

  // ─── Toolbar: Wireframe ───

  toggleWireframe() {
    this._wireframe = !this._wireframe;
    if (!this.model) return;

    this.model.traverse((child) => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => { m.wireframe = this._wireframe; });
        } else {
          child.material.wireframe = this._wireframe;
        }
      }
    });

    return this._wireframe;
  }

  // ─── Toolbar: Trasparenza ───

  /**
   * Mostra/nasconde le parti in trasparenza (il contesto del gruppo).
   * Ritorna true se ora sono visibili, false se nascoste.
   */
  toggleTransparency() {
    this._showTransparency = (this._showTransparency === false);
    this._applyTransparencyVisibility();
    return this._showTransparency;
  }

  _applyTransparencyVisibility() {
    if (!this._groupGhostState) return;
    const visible = this._showTransparency !== false;
    this._groupGhostState.forEach(({ mesh }) => { mesh.visible = visible; });
  }

  // ─── Toolbar: Esplosione ───

  /**
   * Esplode/compatta i componenti al livello corrente.
   * - Root: separa le sezioni
   * - Sezione: separa i gruppi
   * - Gruppo: separa i pezzi
   */
  /**
   * Esplode: mostra solo i pezzi della distinta (partCodes),
   * nasconde tutto il resto, e li separa nello spazio.
   * partCodes = array di codici pezzo dal catalogo.
   */
  toggleExplode(partCodes) {
    this._exploded = !this._exploded;

    if (!this.model) return this._exploded;

    if (this._exploded) {
      this._applyExplosion(partCodes || []);
    } else {
      this._resetExplosion();
      setTimeout(() => this.zoomFit(), 900);
    }

    return this._exploded;
  }

  _applyExplosion(partCodes) {
    if (!partCodes || partCodes.length === 0) return;

    this.model.updateMatrixWorld(true);

    // Normalizza i codici
    const normCodes = new Set(partCodes.map(c => this._normalizeName(c)));

    // Trova i mesh corrispondenti ai codici
    const matchedNodes = [];
    this.model.traverse((child) => {
      if (normCodes.has(this._normalizeName(child.name))) {
        matchedNodes.push(child);
      }
    });

    if (matchedNodes.length === 0) return;

    console.log(`Esplodi: ${matchedNodes.length} pezzi di ${partCodes.length} codici`);

    // Salva visibilità di tutto
    this._explodeVisibility = [];
    this.model.traverse((child) => {
      this._explodeVisibility.push({ obj: child, visible: child.visible });
    });

    // Nascondi TUTTO
    this.model.traverse((child) => {
      if (child.isMesh) child.visible = false;
    });

    // Mostra solo i mesh dei pezzi trovati e i loro parent
    matchedNodes.forEach(node => {
      node.visible = true;
      node.traverse(c => { c.visible = true; });
      // Parent visibili (contenitori)
      let p = node.parent;
      while (p) { p.visible = true; p = p.parent; }
    });

    // Calcola i centri dei pezzi trovati
    const nodeData = matchedNodes.map(node => {
      const box = new THREE.Box3().setFromObject(node);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      return { node, center, size: Math.max(size.x, size.y, size.z) };
    });

    // Centro complessivo
    const overallCenter = new THREE.Vector3();
    nodeData.forEach(d => overallCenter.add(d.center));
    overallCenter.divideScalar(nodeData.length);

    // Distribuzione radiale: disponi i pezzi su cerchi concentrici
    // Così anche pezzi sovrapposti vengono ben separati
    const count = nodeData.length;
    const avgSize = nodeData.reduce((s, d) => s + d.size, 0) / count;
    // Spaziatura = 3x la dimensione media di ogni pezzo
    const spacing = Math.max(avgSize * 3, 0.5);
    // Raggio del cerchio = abbastanza grande per contenere tutti i pezzi con spaziatura
    const radius = spacing * Math.max(Math.ceil(Math.sqrt(count)), 2);

    console.log(`Esplodi distinta: ${count} pezzi, avgSize=${avgSize.toFixed(3)}, spacing=${spacing.toFixed(3)}, radius=${radius.toFixed(3)}`);

    this._explodeWrappers = [];

    nodeData.forEach(({ node }, idx) => {
      // Disponi su spirale: ogni pezzo ha una posizione unica
      const rings = Math.ceil(Math.sqrt(count));
      const ring = Math.floor(idx / Math.max(rings, 1));
      const posInRing = idx % Math.max(rings, 1);
      const itemsInRing = Math.max(rings, 1);
      const angle = (posInRing / itemsInRing) * Math.PI * 2 + ring * 0.5;
      const r = radius * (0.5 + ring * 0.6);

      const targetPos = new THREE.Vector3(
        Math.cos(angle) * r,
        ring * spacing * 0.5,
        Math.sin(angle) * r
      );

      const wrapper = new THREE.Group();
      wrapper.name = `_explode_wrapper_${idx}`;
      wrapper.visible = true;

      const parent = node.parent;
      parent.remove(node);
      wrapper.add(node);
      parent.add(wrapper);

      this._explodeWrappers.push({ wrapper, node, parent });
      this._animatePosition(wrapper, targetPos, 800);
    });

    // Zoom out per vedere tutto
    setTimeout(() => {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.camera.position.addScaledVector(dir, -this._getZoomStep() * 4);
      this.controls.update();
    }, 900);
  }

  _resetExplosion() {
    // Ripristina wrapper
    if (this._explodeWrappers && this._explodeWrappers.length > 0) {
      this._explodeWrappers.forEach(({ wrapper, node, parent }) => {
        this._animatePosition(wrapper, new THREE.Vector3(0, 0, 0), 800);
      });

      setTimeout(() => {
        this._explodeWrappers.forEach(({ wrapper, node, parent }) => {
          wrapper.remove(node);
          parent.add(node);
          parent.remove(wrapper);
        });
        this._explodeWrappers = [];
      }, 850);
    }

    // Ripristina visibilità
    if (this._explodeVisibility) {
      setTimeout(() => {
        this._explodeVisibility.forEach(({ obj, visible }) => {
          obj.visible = visible;
        });
        this._explodeVisibility = null;
      }, 860);
    }
  }

  _animatePosition(object, targetPos, duration) {
    // Assicura che matrixAutoUpdate sia attivo
    object.matrixAutoUpdate = true;

    const startPos = object.position.clone();
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = t * (2 - t); // easeOutQuad

      object.position.lerpVectors(startPos, targetPos, ease);
      object.updateMatrix();
      object.updateMatrixWorld(true);

      if (t < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }
}
