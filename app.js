/* =========================================================================
   DIAG·SAV — logique de l'assistant de diagnostic
   JavaScript vanilla, aucune dépendance, aucun appel réseau externe.

   Routage par hash (compatible GitHub Pages, partage de lien, bouton retour) :
     #/                               → accueil
     #/d/<symptome>/<n1>/<n2>/…       → diagnostic : liste des nœuds parcourus
   ========================================================================= */
(() => {
  'use strict';

  /* Chemin du fichier de procédures, résolu par rapport à app.js (et non à l'adresse
     de la page) : fonctionne même si l'URL est appelée sans « / » final
     (ex. …/diagnostic-sav au lieu de …/diagnostic-sav/). */
  const SCRIPT_URL = (document.currentScript && document.currentScript.src) || document.baseURI;
  const DATA_PATH = 'data/decisions.json';
  const DATA_URL = new URL(DATA_PATH, SCRIPT_URL).href;
  const RECENTS_KEY = 'diagsav.recents.v1';
  const RECENTS_MAX = 6;

  const SEVERITY_ORDER = ['low', 'moderate', 'high'];
  const SEVERITY_FALLBACK = {
    low: { label: 'Faible' },
    moderate: { label: 'Modéré' },
    high: { label: 'Élevé' }
  };

  /* Icônes de catégories (constantes internes, jamais issues du JSON) */
  const ICONS = {
    power:     '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    audio:     '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    video:     '<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M8 21h8M12 17v4"/>',
    network:   '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
    thermal:   '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
    stability: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    usb:       '<path d="M12 3v14"/><path d="m9 6 3-3 3 3"/><path d="M12 13 7 10V8M12 15l5-3v-2"/><circle cx="12" cy="19" r="2"/><rect x="5.5" y="6" width="3" height="2"/><circle cx="17" cy="9" r="1.2"/>',
    mic:       '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>',
    headset:   '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20c0 1.5-2 2-5 2"/>',
    ledwall:   '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M9 4v13M15 4v13M3 10.5h18M8 21h8M12 17v4"/>',
    switcher:  '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="7" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><path d="M16 10h3M16 14h3"/>',
    chip:      '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    default:   '<circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 16h.01"/>'
  };

  const STOP_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'un', 'une', 'et', 'ou', 'a', 'en', 'ne', 's', 'j', 'y', 'il', 'est', 'mon', 'ma', 'mes', 'sur', 'au', 'aux']);

  /* ---------------------------------------------------------------------
     État
     --------------------------------------------------------------------- */
  const state = {
    data: null,
    symptoms: new Map(),     // id → symptôme
    categories: new Map(),   // id → catégorie
    nodes: {},               // id → nœud
    products: new Map(),     // id → fiche produit
    families: new Map(),     // id → famille de produits
    sources: {},             // id → document de référence
    productsBySymptom: new Map(), // id symptôme → [id produit]
    searchHints: new Map(),  // id symptôme → id produit trouvé par la dernière recherche
    focusProduct: null,      // produit choisi depuis la recherche
    severities: SEVERITY_FALLBACK,
    depthMemo: new Map(),
    searchIndex: [],
    query: '',
    filter: 'all',
    lastRenderedHash: null,
    navStack: []             // hashes visités dans cette session (pour un retour cohérent avec le navigateur)
  };

  /* ---------------------------------------------------------------------
     Utilitaires DOM
     --------------------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);

  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function icon(name) {
    const span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.style.display = 'inline-flex';
    // ICONS est une constante interne : innerHTML sans risque ici.
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || ICONS.default) + '</svg>';
    return span;
  }

  function truncate(text, max) {
    const t = String(text || '');
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
  }

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[’'`]/g, ' ')
      .replace(/[^a-z0-9.]+/g, ' ')
      .trim();
  }

  function tokenize(text) {
    return normalize(text).split(/\s+/).filter(t => t && !STOP_WORDS.has(t));
  }

  let toastTimer = null;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth; // relance l'animation
    el.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function severityInfo(key) {
    return state.severities[key] || SEVERITY_FALLBACK[key] || { label: key };
  }

  function categoryOf(symptom) {
    return state.categories.get(symptom && symptom.category) || { id: 'autre', label: 'Autre', icon: 'default' };
  }

  /* ---------------------------------------------------------------------
     Stockage local (diagnostics récents) — reste sur l'appareil
     --------------------------------------------------------------------- */
  const store = {
    read() {
      try {
        const raw = localStorage.getItem(RECENTS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
      } catch { return []; }
    },
    write(list) {
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list)); } catch { /* stockage indisponible : ignoré */ }
    },
    clear() {
      try { localStorage.removeItem(RECENTS_KEY); } catch { /* ignoré */ }
    }
  };

  function recordRecent(entry) {
    const list = store.read().filter(e => e && e.hash !== entry.hash);
    list.unshift(entry);
    store.write(list.slice(0, RECENTS_MAX));
  }

  /* ---------------------------------------------------------------------
     Chargement & validation des données
     --------------------------------------------------------------------- */
  /** Affiche l'écran d'erreur : un message clair + le détail technique (adresse, statut HTTP). */
  function showLoadError(message, detail, hint) {
    $('#error-message').textContent = message;
    $('#error-detail').textContent = detail || '';
    $('#error-detail').hidden = !detail;
    $('#error-hint').textContent = hint || '';
    $('#error-hint').hidden = !hint;
    showView('error');
  }

  /** Numéro de ligne / colonne d'une erreur JSON, à partir de la position donnée par le navigateur. */
  function jsonErrorPosition(text, err) {
    const lc = /line (\d+) column (\d+)/i.exec(err.message);   // Chrome, Firefox
    if (lc) return ' (ligne ' + lc[1] + ', colonne ' + lc[2] + ')';
    const m = /position (\d+)/i.exec(err.message);
    if (!m) return '';
    const pos = Number(m[1]);
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    return ' (ligne ' + line + ', colonne ' + col + ')';
  }

  async function loadData() {
    showView('loading');
    const fileHint = location.protocol === 'file:'
      ? 'La page est ouverte depuis un fichier local (file://) : les navigateurs y bloquent la lecture du JSON. Lancez un petit serveur local (voir README) ou utilisez l\'adresse GitHub Pages.'
      : '';

    // 1. Téléchargement
    let res;
    try {
      res = await fetch(DATA_URL, { cache: 'no-cache' });
    } catch (err) {
      console.error('[DIAG·SAV] Requête impossible :', DATA_URL, err);
      return showLoadError(
        'Le fichier de procédures n\'a pas pu être téléchargé.',
        'Adresse : ' + DATA_URL + '\nErreur réseau : ' + (err && err.message || err),
        fileHint || (!navigator.onLine
          ? 'L\'appareil est hors ligne et les procédures ne sont pas encore en cache : ouvrez le site une fois avec du réseau.'
          : 'Vérifiez la connexion, puis réessayez.'));
    }
    if (!res.ok) {
      console.error('[DIAG·SAV] Réponse HTTP', res.status, DATA_URL);
      return showLoadError(
        'Le fichier de procédures n\'a pas pu être chargé (HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + ').',
        'Adresse : ' + DATA_URL + '\nStatut HTTP : ' + res.status + (res.statusText ? ' ' + res.statusText : ''),
        res.status === 404
          ? 'Le fichier est introuvable à cette adresse : vérifiez qu\'il est bien publié dans le dossier data/ du dépôt, ou attendez la fin du déploiement GitHub Pages (1 à 2 minutes).'
          : 'Le serveur a refusé ou n\'a pas pu servir le fichier. Réessayez dans un instant.');
    }

    // 2. Lecture du JSON
    let text, data;
    try {
      text = await res.text();
      data = JSON.parse(text);
    } catch (err) {
      console.error('[DIAG·SAV] JSON invalide :', err);
      return showLoadError(
        'Le fichier data/decisions.json contient une erreur de syntaxe' + (text ? jsonErrorPosition(text, err) : '') + '.',
        'Adresse : ' + DATA_URL + '\nStatut HTTP : ' + res.status + '\nDétail : ' + err.message,
        'Cause fréquente : virgule en trop ou manquante, guillemet oublié. Vérifiez le fichier avec VS Code ou un validateur JSON.');
    }

    // 3. Traitement des données
    try {
      ingest(data);
    } catch (err) {
      console.error('[DIAG·SAV] Données inexploitables :', err);
      return showLoadError(
        'Le fichier de procédures a bien été chargé, mais son contenu ne peut pas être exploité.',
        'Adresse : ' + DATA_URL + '\nStatut HTTP : ' + res.status + '\nDétail : ' + err.message,
        'Une section obligatoire est peut-être absente ou mal formée (symptoms, nodes). Comparez avec le format décrit dans le README.');
    }
    onRoute();
  }

  /**
   * Migration du schéma : les fichiers sans meta.schemaVersion sont en version 1.
   * v1 → v2 : ajout facultatif de sources, families, products et brandSteps.
   * Rien n'est perdu ni renommé : on complète simplement les sections manquantes.
   */
  const SCHEMA_VERSION = 2;
  function migrate(data) {
    data.meta = data.meta || {};
    const from = Number(data.meta.schemaVersion) || 1;
    if (from > SCHEMA_VERSION) {
      console.warn('[DIAG·SAV] decisions.json utilise un schéma plus récent (v' + from + ') que cette version de l\'application (v' + SCHEMA_VERSION + ').');
    }
    if (from < 2) {
      data.sources = data.sources || {};
      data.families = data.families || {};
      data.products = data.products || {};
    }
    data.meta.schemaVersion = Math.max(from, SCHEMA_VERSION);
    return data;
  }

  function productLabel(prod) {
    return prod.brand + ' ' + prod.model;
  }

  function productSourceLabel(prod) {
    const src = state.sources[prod.source];
    const name = src ? src.title + (src.edition ? ' ' + src.edition.toLowerCase() : '') : '';
    return [name, prod.page ? 'p. ' + prod.page : ''].filter(Boolean).join(', ');
  }

  function ingest(data) {
    data = migrate(data);
    state.data = data;
    state.nodes = data.nodes || {};
    state.severities = Object.assign({}, SEVERITY_FALLBACK, data.severities || {});
    state.symptoms = new Map((data.symptoms || []).map(s => [s.id, s]));
    state.categories = new Map((data.categories || []).map(c => [c.id, c]));
    state.depthMemo.clear();

    state.sources = data.sources || {};
    state.families = new Map(Object.entries(data.families || {}));
    state.products = new Map(Object.entries(data.products || {}));
    state.productsBySymptom = new Map();
    for (const [pid, prod] of state.products) {
      const fam = state.families.get(prod.family);
      for (const sid of (fam && fam.symptoms) || []) {
        if (!state.productsBySymptom.has(sid)) state.productsBySymptom.set(sid, []);
        state.productsBySymptom.get(sid).push(pid);
      }
    }

    state.searchIndex = (data.symptoms || []).map((s, order) => ({
      symptom: s,
      order,
      title: normalize(s.title),
      keywords: (s.keywords || []).map(normalize),
      summary: normalize(s.summary),
      category: normalize(categoryOf(s).label),
      products: (state.productsBySymptom.get(s.id) || []).map(pid => {
        const pr = state.products.get(pid);
        return { id: pid, text: normalize([pr.brand, pr.model, pr.ref].filter(Boolean).join(' ')) };
      })
    }));

    const meta = data.meta || {};
    $('#data-version').textContent = 'v' + (meta.version || '?');
    if (meta.disclaimer) $('#footer-disclaimer').textContent = meta.disclaimer;
    if (meta.title) document.title = 'DIAG·SAV — ' + meta.title;

    const warnings = validate(data);
    const warnEl = $('#data-warnings');
    if (warnings.length) {
      console.warn('[DIAG·SAV] Anomalies dans decisions.json :\n- ' + warnings.join('\n- '));
      warnEl.hidden = false;
      warnEl.textContent = '⚠ ' + warnings.length + ' anomalie(s) dans les données (voir console)';
      warnEl.title = warnings.slice(0, 10).join('\n');
    } else {
      warnEl.hidden = true;
    }

    renderFilters();
  }

  /** Contrôle de cohérence de l'arbre : aide les équipes SAV qui éditent le JSON. */
  function validate(data) {
    const w = [];
    const nodes = data.nodes || {};
    const symptomIds = new Set();
    const catIds = new Set((data.categories || []).map(c => c.id));
    const reached = new Set();

    for (const s of data.symptoms || []) {
      if (!s.id) { w.push('Symptôme sans identifiant : ' + (s.title || '?')); continue; }
      if (symptomIds.has(s.id)) w.push('Identifiant de symptôme dupliqué : ' + s.id);
      symptomIds.add(s.id);
      if (!nodes[s.start]) w.push('Symptôme « ' + s.id + ' » : nœud de départ introuvable (' + s.start + ')');
      if (s.category && !catIds.has(s.category)) w.push('Symptôme « ' + s.id + ' » : catégorie inconnue (' + s.category + ')');
    }

    for (const [id, n] of Object.entries(nodes)) {
      if (n.type === 'question') {
        if (!Array.isArray(n.options) || n.options.length === 0) w.push('Question « ' + id + ' » sans option');
        if (n.options && n.options.length > 9) w.push('Question « ' + id + ' » : plus de 9 options (raccourcis clavier limités)');
        for (const o of n.options || []) {
          if (o.next && !nodes[o.next]) w.push('Question « ' + id + ' » : nœud suivant introuvable (' + o.next + ')');
          if (o.symptom && !symptomIds.has(o.symptom) && !(data.symptoms || []).some(s => s.id === o.symptom)) w.push('Question « ' + id + ' » : symptôme cible introuvable (' + o.symptom + ')');
          if (!o.next && !o.symptom) w.push('Question « ' + id + ' » : option sans destination (' + (o.label || '?') + ')');
        }
      } else if (n.type === 'result') {
        if (!SEVERITY_ORDER.includes(n.severity)) w.push('Résultat « ' + id + ' » : gravité invalide (' + n.severity + '), attendu low / moderate / high');
        if (!Array.isArray(n.actions) || n.actions.length === 0) w.push('Résultat « ' + id + ' » sans action');
      } else {
        w.push('Nœud « ' + id + ' » : type inconnu (' + n.type + ')');
      }
    }

    // Les symptômes « related » doivent exister (vérifié après collecte complète)
    for (const [id, n] of Object.entries(nodes)) {
      for (const r of n.related || []) {
        if (!symptomIds.has(r)) w.push('Résultat « ' + id + ' » : symptôme lié introuvable (' + r + ')');
      }
    }

    // Produits, familles, sources
    const products = data.products || {};
    const families = data.families || {};
    const sources = data.sources || {};
    for (const [fid, f] of Object.entries(families)) {
      if (!f.label) w.push('Famille « ' + fid + ' » sans libellé (label)');
      for (const sid of f.symptoms || []) {
        if (!symptomIds.has(sid)) w.push('Famille « ' + fid + ' » : symptôme introuvable (' + sid + ')');
      }
    }
    for (const [pid, pr] of Object.entries(products)) {
      if (!pr.brand || !pr.model) w.push('Produit « ' + pid + ' » : marque (brand) ou modèle (model) manquant');
      if (!families[pr.family]) w.push('Produit « ' + pid + ' » : famille inconnue (' + pr.family + ')');
      if (pr.source && !sources[pr.source]) w.push('Produit « ' + pid + ' » : source inconnue (' + pr.source + ')');
      if (pr.page != null && !(Number.isInteger(pr.page) && pr.page > 0)) w.push('Produit « ' + pid + ' » : la page doit être un nombre entier (' + pr.page + ')');
    }
    const STATUSES = ['draft', 'validated'];
    for (const [id, n] of Object.entries(nodes)) {
      if (n.status && !STATUSES.includes(n.status)) w.push('Nœud « ' + id + ' » : statut invalide (' + n.status + '), attendu draft ou validated');
      for (const pid of n.products || []) {
        if (!products[pid]) w.push('Nœud « ' + id + ' » : produit introuvable (' + pid + ')');
      }
      (n.brandSteps || []).forEach((b, i) => {
        const where = 'Résultat « ' + id + ' », étapes ' + (b.brand || '#' + (i + 1));
        if (!b.brand) w.push(where + ' : marque (brand) manquante');
        if (!Array.isArray(b.actions) || !b.actions.length) w.push(where + ' : aucune action');
        if (b.status && !STATUSES.includes(b.status)) w.push(where + ' : statut invalide (' + b.status + ')');
        for (const pid of b.products || []) {
          if (!products[pid]) w.push(where + ' : produit introuvable (' + pid + ')');
        }
      });
    }

    // Nœuds orphelins
    const walk = (id) => {
      if (!id || reached.has(id) || !nodes[id]) return;
      reached.add(id);
      for (const o of nodes[id].options || []) walk(o.next);
    };
    for (const s of data.symptoms || []) walk(s.start);
    for (const id of Object.keys(nodes)) {
      if (!reached.has(id)) w.push('Nœud « ' + id + ' » inaccessible depuis les symptômes');
    }
    return w;
  }

  /* ---------------------------------------------------------------------
     Arbre : navigation
     --------------------------------------------------------------------- */
  function targetOf(option) {
    if (option.next) return option.next;
    if (option.symptom) {
      const s = state.symptoms.get(option.symptom);
      return s ? s.start : null;
    }
    return null;
  }

  /** Option (et son index) du nœud `fromId` menant à `toId`. */
  function optionLinking(fromId, toId) {
    const node = state.nodes[fromId];
    if (!node || node.type !== 'question') return null;
    const idx = (node.options || []).findIndex(o => targetOf(o) === toId);
    return idx >= 0 ? { option: node.options[idx], index: idx } : null;
  }

  /** Nombre maximal d'étapes restantes jusqu'à un résultat (protégé contre les cycles). */
  function maxRemaining(id, visiting = new Set()) {
    if (state.depthMemo.has(id)) return state.depthMemo.get(id);
    const node = state.nodes[id];
    if (!node || node.type !== 'question' || visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const o of node.options || []) {
      const t = targetOf(o);
      if (t) best = Math.max(best, maxRemaining(t, visiting));
    }
    visiting.delete(id);
    const value = 1 + best;
    state.depthMemo.set(id, value);
    return value;
  }

  /** Nettoie un chemin issu de l'URL : chaque étape doit découler de la précédente. */
  function sanitizePath(symptom, rawPath) {
    const path = [symptom.start];
    for (let i = 1; i < rawPath.length; i++) {
      const prev = path[path.length - 1];
      if (state.nodes[prev] && state.nodes[prev].type === 'result') break;
      if (!optionLinking(prev, rawPath[i])) break;
      path.push(rawPath[i]);
    }
    return path;
  }

  function diagHash(symptomId, path) {
    return '#/d/' + [symptomId, ...path].map(encodeURIComponent).join('/');
  }

  function parseHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean).map(p => {
      try { return decodeURIComponent(p); } catch { return p; }
    });
    if (parts[0] === 'd' && parts[1]) {
      return { view: 'diag', symptomId: parts[1], path: parts.slice(2) };
    }
    if (parts[0] && parts[0].split('?')[0] === 'produits') {
      const q = (raw.split('?')[1] || '').match(/(?:^|&)q=([^&]*)/);
      let query = '';
      if (q) { try { query = decodeURIComponent(q[1].replace(/\+/g, ' ')); } catch { query = q[1]; } }
      const id = parts[1] ? parts[1].split('?')[0] : null;
      return { view: 'products', productId: id, query };
    }
    return { view: 'home' };
  }

  function navigate(hash, { replace = false } = {}) {
    if (replace) {
      history.replaceState(null, '', hash);
      onRoute();
    } else if (location.hash === hash) {
      onRoute();
    } else {
      location.hash = hash;
    }
  }

  /* ---------------------------------------------------------------------
     Routage
     --------------------------------------------------------------------- */
  function trackNav() {
    const hash = location.hash || '#/';
    const st = state.navStack;
    if (st[st.length - 1] === hash) return;
    if (st[st.length - 2] === hash) st.pop();
    else st.push(hash);
  }

  /** Revient à `hash` : via l'historique du navigateur si c'est l'entrée précédente. */
  function navigateBack(hash) {
    const st = state.navStack;
    if (st.length >= 2 && st[st.length - 2] === hash) history.back();
    else navigate(hash);
  }

  function onRoute() {
    if (!state.data) return;
    const route = parseHash();

    setActiveTab(route.view === 'products' ? 'products' : 'diag');
    if (route.view === 'products') {
      trackNav();
      renderProducts(route);
      return;
    }
    if (route.view === 'diag') {
      const symptom = state.symptoms.get(route.symptomId);
      if (!symptom || !state.nodes[symptom.start]) {
        toast('Symptôme introuvable');
        navigate('#/', { replace: true });
        return;
      }
      const path = sanitizePath(symptom, route.path.length ? route.path : [symptom.start]);
      const canonical = diagHash(symptom.id, path);
      if (canonical !== location.hash) {
        history.replaceState(null, '', canonical);
      }
      trackNav();
      renderDiag(symptom, path);
    } else {
      trackNav();
      renderHome();
    }
  }

  function setActiveTab(tab) {
    for (const a of document.querySelectorAll('.tabs__tab')) {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  function showView(name) {
    for (const v of ['loading', 'error', 'home', 'diag', 'products']) {
      const el = $('#view-' + v);
      if (el) el.hidden = v !== name;
    }
    document.body.classList.toggle('is-home', name === 'home');
  }

  /* ---------------------------------------------------------------------
     Fil d'Ariane
     --------------------------------------------------------------------- */
  function renderCrumbs(items) {
    const ol = $('#crumbs');
    ol.replaceChildren();
    items.forEach((item, i) => {
      const last = i === items.length - 1;
      const li = h('li', { class: 'crumbs__item', 'aria-current': last ? 'page' : null });
      if (last) {
        li.append(h('span', { class: 'crumbs__current', title: item.title || item.label }, item.label));
      } else if (item.href) {
        li.append(h('a', { class: 'crumbs__link', href: item.href, title: item.title || item.label }, item.label));
      }
      ol.append(li);
    });
    // garde l'élément courant visible sur mobile
    ol.scrollLeft = ol.scrollWidth;
  }

  /* ---------------------------------------------------------------------
     Accueil
     --------------------------------------------------------------------- */
  function search(query, filter) {
    const tokens = tokenize(query);
    const phrase = normalize(query);
    const results = [];
    state.searchHints = new Map();

    for (const entry of state.searchIndex) {
      if (filter !== 'all' && entry.symptom.category !== filter) continue;
      if (!tokens.length) { results.push({ entry, score: 0 }); continue; }

      let score = 0;
      let allMatch = true;
      for (const t of tokens) {
        let s = 0;
        if (entry.title.includes(t)) s += 3;
        if (entry.keywords.some(k => k.includes(t))) s += 2;
        if (entry.summary.includes(t)) s += 1;
        if (entry.category.includes(t)) s += 1;
        if (entry.products.some(pr => pr.text.includes(t))) s += 2;
        if (!s) { allMatch = false; break; }
        score += s;
      }
      if (!allMatch) continue;
      if (phrase.length > 2 && (entry.title.includes(phrase) || entry.keywords.some(k => k.includes(phrase)))) score += 6;
      // produit le plus pertinent pour ce symptôme (tous les mots trouvés dans sa fiche)
      const hit = entry.products.find(pr => tokens.every(t => pr.text.includes(t)));
      if (hit) {
        state.searchHints.set(entry.symptom.id, hit.id);
        // le premier symptôme listé dans la famille du produit est considéré comme le principal
        const fam = state.families.get(state.products.get(hit.id).family);
        const rank = fam ? (fam.symptoms || []).indexOf(entry.symptom.id) : -1;
        score += 4 + (rank === 0 ? 4 : rank > 0 ? Math.max(0, 3 - rank) : 0);
      }
      results.push({ entry, score });
    }
    results.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order);
    return results.map(r => r.entry.symptom);
  }

  function renderFilters() {
    const wrap = $('#filters');
    wrap.replaceChildren();
    const make = (id, label, iconName) => h('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(state.filter === id),
      dataset: { filter: id },
      onclick: () => { state.filter = id; renderHome(); }
    }, iconName ? icon(iconName) : null, label, h('span', { class: 'chip__count', dataset: { countFor: id } }));

    wrap.append(make('all', 'Tous', null));
    for (const c of state.categories.values()) wrap.append(make(c.id, c.label, c.icon));
  }

  function updateFilterCounts() {
    const base = search(state.query, 'all');
    for (const btn of document.querySelectorAll('#filters .chip')) {
      const id = btn.dataset.filter;
      btn.setAttribute('aria-pressed', String(state.filter === id));
      const n = id === 'all' ? base.length : base.filter(s => s.category === id).length;
      const counter = btn.querySelector('.chip__count');
      if (counter) counter.textContent = n;
      btn.hidden = id !== 'all' && n === 0 && state.filter !== id;
    }
  }

  function renderGrid() {
    const list = search(state.query, state.filter);
    const grid = $('#symptom-grid');
    grid.replaceChildren(...list.map(symptomCard));
    $('#empty-state').hidden = list.length > 0;
    $('#result-count').textContent = list.length + ' / ' + state.symptoms.size;
    updateFilterCounts();
  }

  function symptomCard(s) {
    const cat = categoryOf(s);
    const hintId = state.searchHints.get(s.id);
    const hint = hintId && state.products.get(hintId);
    const count = (state.productsBySymptom.get(s.id) || []).length;
    return h('li', null,
      h('a', {
        class: 'card', href: diagHash(s.id, [s.start]),
        onclick: () => { state.focusProduct = hintId || null; }
      },
        h('span', { class: 'card__top' },
          h('span', { class: 'card__cat' }, icon(cat.icon), cat.label),
          h('span', { class: 'card__id' }, s.id.toUpperCase())
        ),
        h('h3', { class: 'card__title' }, s.title),
        s.summary ? h('p', { class: 'card__summary' }, s.summary) : null,
        hint ? h('p', { class: 'card__gear' }, h('strong', null, productLabel(hint)), ' · ' + productSourceLabel(hint))
             : count ? h('p', { class: 'card__count' }, count + ' produit' + (count > 1 ? 's' : '') + ' du catalogue') : null,
        h('span', { class: 'card__go', 'aria-hidden': 'true' }, 'Démarrer le diagnostic →')
      )
    );
  }

  function renderRecents() {
    const list = store.read();
    const section = $('#recents');
    const ul = $('#recents-list');
    section.hidden = list.length === 0;
    ul.replaceChildren(...list.map(e => {
      const sev = SEVERITY_ORDER.includes(e.severity) ? e.severity : 'low';
      return h('li', null,
        h('a', { class: 'recent', href: e.hash },
          h('span', { class: 'badge badge--' + sev }, severityInfo(sev).label),
          h('span', null,
            h('span', { class: 'recent__title' }, e.resultTitle || '—'),
            h('span', { class: 'recent__sub' }, e.symptomTitle || '')
          ),
          h('span', { class: 'recent__time' }, formatTime(e.ts))
        )
      );
    }));
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  }

  function renderHome() {
    showView('home');
    state.focusProduct = null;
    renderCrumbs([{ label: 'Accueil', href: '#/' }]);
    const input = $('#search-input');
    if (input.value !== state.query) input.value = state.query;
    renderGrid();
    renderRecents();
    state.lastRenderedHash = null;
    setActiveTab('diag');
  }

  /* ---------------------------------------------------------------------
     Diagnostic
     --------------------------------------------------------------------- */
  function renderDiag(rootSymptom, path) {
    showView('diag');

    const currentId = path[path.length - 1];
    const current = state.nodes[currentId];
    const isResult = current.type === 'result';
    const hashNow = diagHash(rootSymptom.id, path);
    const isNewStep = state.lastRenderedHash !== hashNow;
    state.lastRenderedHash = hashNow;

    // Reconstitution du parcours : réponses données et éventuelles bascules de symptôme
    const steps = [];
    let active = rootSymptom;
    for (let i = 0; i < path.length - 1; i++) {
      const link = optionLinking(path[i], path[i + 1]);
      const jump = link && link.option.symptom ? state.symptoms.get(link.option.symptom) : null;
      steps.push({ index: i, node: state.nodes[path[i]], option: link && link.option, jump, symptomBefore: active });
      if (jump) active = jump;
    }

    // En-tête
    const cat = categoryOf(active);
    $('#diag-category').textContent = cat.label +
      (active !== rootSymptom ? ' · depuis « ' + rootSymptom.title + ' »' : '');
    $('#diag-symptom').textContent = active.title;
    renderGear(active);

    // Fil d'Ariane
    const crumbs = [{ label: 'Accueil', href: '#/' }];
    path.forEach((id, i) => {
      const node = state.nodes[id];
      const prevStep = steps[i - 1];
      let label;
      if (i === 0) label = rootSymptom.title;
      else if (prevStep && prevStep.jump) label = prevStep.jump.title;
      else if (node.type === 'result') label = 'Résultat';
      else label = 'Étape ' + (i + 1);
      crumbs.push({
        label: truncate(label, 32),
        title: node.type === 'result' ? node.title : node.text,
        href: diagHash(rootSymptom.id, path.slice(0, i + 1))
      });
    });
    renderCrumbs(crumbs);

    renderProgress(path, current);
    renderJournal(rootSymptom, path, steps, current);

    // Scène
    const stage = $('#diag-stage');
    stage.replaceChildren(isResult
      ? renderResult(current, rootSymptom, active, steps)
      : renderQuestion(current, rootSymptom, path));
    if (isNewStep) {
      stage.classList.remove('is-entering');
      void stage.offsetWidth;
      stage.classList.add('is-entering');
      const heading = stage.querySelector('[data-focus]');
      if (heading) heading.focus({ preventScroll: true });
      if (window.scrollY > 120) window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    $('#btn-back').disabled = false;

    if (isResult) {
      recordRecent({
        hash: hashNow,
        symptomTitle: rootSymptom.title + (active !== rootSymptom ? ' → ' + active.title : ''),
        resultTitle: current.title,
        severity: current.severity,
        ts: Date.now()
      });
    }
  }

  /** Liste « Matériel couvert » du symptôme actif, regroupée par marque. */
  function renderGear(symptom) {
    const ids = state.productsBySymptom.get(symptom.id) || [];
    const box = $('#gear');
    const focus = state.focusProduct && state.products.get(state.focusProduct);
    const chip = $('#focus-product');
    chip.hidden = !focus;
    if (focus) chip.replaceChildren('Matériel : ', h('strong', null, productLabel(focus)), ' · ' + productSourceLabel(focus));

    box.hidden = ids.length === 0;
    if (!ids.length) return;
    $('#gear-count').textContent = String(ids.length);
    const byBrand = new Map();
    for (const pid of ids) {
      const pr = state.products.get(pid);
      if (!byBrand.has(pr.brand)) byBrand.set(pr.brand, []);
      byBrand.get(pr.brand).push({ pid, pr });
    }
    const brands = [...byBrand.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
    $('#gear-list').replaceChildren(...brands.map(brand => h('li', { class: 'gear__brand' },
      h('span', { class: 'gear__name' }, brand),
      h('ul', { class: 'gear__models' }, byBrand.get(brand).map(({ pid, pr }) =>
        h('li', { class: 'gear__model' + (pid === state.focusProduct ? ' is-focus' : ''), title: pr.type + (pr.ref ? ' · réf. ' + pr.ref : '') },
          pr.model, h('span', { class: 'gear__page' }, pr.page ? ' p. ' + pr.page : ''))
      ))
    )));
  }

  function renderProgress(path, current) {
    const done = path.length - 1;
    const remaining = current.type === 'result' ? 0 : maxRemaining(path[path.length - 1]) - 1;
    const total = path.length + remaining;
    const track = $('#progress-track');
    const segs = [];
    for (let i = 0; i < total; i++) {
      let cls = 'progress__seg';
      if (i < done) cls += ' is-done';
      else if (i === done) cls += current.type === 'result' ? ' is-result-' + current.severity : ' is-current';
      segs.push(h('span', { class: cls }));
    }
    track.replaceChildren(...segs);

    const pct = Math.round((path.length / total) * 100);
    const bar = $('#progress');
    bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-valuetext', current.type === 'result'
      ? 'Diagnostic terminé'
      : 'Étape ' + path.length + ', au plus ' + remaining + ' étape(s) restante(s)');

    $('#progress-step').textContent = current.type === 'result'
      ? 'Diagnostic terminé · ' + done + ' réponse' + (done > 1 ? 's' : '')
      : 'Étape ' + path.length;
    $('#progress-remaining').textContent = current.type === 'result'
      ? ''
      : remaining === 0 ? 'Dernière question' : 'au plus ' + remaining + ' restante' + (remaining > 1 ? 's' : '');
  }

  function renderJournal(rootSymptom, path, steps, current) {
    const list = $('#journal-list');
    const items = steps.map(step => h('li', null,
      h('button', {
        type: 'button',
        class: 'jentry' + (step.jump ? ' jentry--jump' : ''),
        title: 'Revenir à cette question',
        onclick: () => navigate(diagHash(rootSymptom.id, path.slice(0, step.index + 1)))
      },
        h('span', { class: 'jentry__q' }, (step.index + 1) + '. ' + step.node.text),
        h('span', { class: 'jentry__a' }, step.option ? step.option.label : '?'),
        step.jump ? h('span', { class: 'jentry__q' }, '↪ Bascule vers « ' + step.jump.title + ' »') : null
      )
    ));
    if (current.type === 'result') {
      items.push(h('li', null,
        h('div', { class: 'jentry jentry--result', style: '--sev-color: var(--sev-' + current.severity + ')' },
          h('span', { class: 'jentry__q' }, 'Résultat · gravité ' + severityInfo(current.severity).label.toLowerCase()),
          h('span', { class: 'jentry__a' }, current.title)
        )
      ));
    }
    list.replaceChildren(...items);
    $('#journal-empty').hidden = items.length > 0;
    $('#journal-count').textContent = String(steps.length).padStart(2, '0');
    list.scrollTop = list.scrollHeight;
  }

  function renderQuestion(node, rootSymptom, path) {
    const options = (node.options || []).map((opt, i) => {
      const jumpTarget = opt.symptom ? state.symptoms.get(opt.symptom) : null;
      return h('li', null,
        h('button', {
          type: 'button',
          class: 'option',
          dataset: { index: String(i) },
          onclick: () => choose(rootSymptom, path, i)
        },
          h('span', { class: 'option__key', 'aria-hidden': 'true' }, String(i + 1)),
          h('span', null,
            opt.label,
            jumpTarget ? h('span', { class: 'option__jump' }, '↪ Diagnostic « ' + jumpTarget.title + ' »') : null
          ),
          h('span', { class: 'option__arrow', 'aria-hidden': 'true' }, '→')
        )
      );
    });

    return h('article', { class: 'panel question' },
      h('header', { class: 'panel__head' },
        h('span', { class: 'panel__tag' }, 'Q' + String(path.length).padStart(2, '0')),
        h('span', null, 'Question')
      ),
      h('div', { class: 'panel__body' },
        h('h2', { class: 'question__text', tabindex: '-1', 'data-focus': true }, node.text),
        draftBadge(node.status),
        node.help ? h('p', { class: 'question__help' }, node.help) : null,
        productChips(node.products),
        h('ul', { class: 'options', role: 'list' }, options)
      )
    );
  }

  function draftBadge(status) {
    return status === 'draft'
      ? h('span', { class: 'badge badge--draft', title: 'Procédure rédigée sans notice constructeur : à faire relire par un technicien.' }, 'À valider')
      : null;
  }

  function productChips(ids) {
    const list = (ids || []).map(pid => state.products.get(pid)).filter(Boolean);
    if (!list.length) return null;
    return h('p', { class: 'node-products' }, 'Matériel : ',
      list.map((pr, i) => [i ? ', ' : '', h('span', { title: productSourceLabel(pr) }, productLabel(pr))]));
  }

  function renderBrandSteps(node) {
    const list = node.brandSteps || [];
    if (!list.length) return null;
    const focus = state.focusProduct && state.products.get(state.focusProduct);
    return [
      h('h3', { class: 'block-title' }, 'Selon le matériel'),
      h('div', { class: 'brandsteps' }, list.map(b => {
        const prods = (b.products || []).map(pid => state.products.get(pid)).filter(Boolean);
        const isFocus = focus && ((b.products || []).includes(state.focusProduct) || b.brand.includes(focus.brand));
        return h('details', { class: 'brandstep', open: isFocus || list.length === 1 },
          h('summary', { class: 'brandstep__head' },
            h('span', { class: 'brandstep__brand' }, b.brand),
            draftBadge(b.status),
            prods.length ? h('span', { class: 'brandstep__models' }, prods.map(p => p.model).join(', ')) : null
          ),
          h('ul', { class: 'brandstep__actions' }, (b.actions || []).map(a => h('li', null, a))),
          prods.length ? h('p', { class: 'brandstep__src' }, 'Références : ' + prods.map(p => productLabel(p) + (p.page ? ' (p. ' + p.page + ')' : '')).join(' · ')) : null
        );
      }))
    ];
  }

  function renderResult(node, rootSymptom, active, steps) {
    const sev = SEVERITY_ORDER.includes(node.severity) ? node.severity : 'moderate';
    const info = severityInfo(sev);

    const actions = (node.actions || []).map((text, i) => {
      const id = 'act-' + i;
      const input = h('input', { type: 'checkbox', id });
      const li = h('li', null,
        h('label', { class: 'action', for: id }, input, h('span', { class: 'action__box', 'aria-hidden': 'true' }), h('span', { class: 'action__text' }, text))
      );
      input.addEventListener('change', () => li.firstChild.classList.toggle('is-done', input.checked));
      return li;
    });

    const related = (node.related || [])
      .map(id => state.symptoms.get(id))
      .filter(Boolean)
      .map(s => h('a', { class: 'chip', href: diagHash(s.id, [s.start]) }, icon(categoryOf(s).icon), s.title));

    return h('article', { class: 'panel result result--' + sev },
      h('header', { class: 'panel__head' },
        h('span', { class: 'panel__tag' }, 'Résultat'),
        h('span', null, 'Recommandation')
      ),
      h('div', { class: 'panel__body' },
        h('div', { class: 'result__head' },
          h('span', { class: 'badge badge--' + sev }, 'Gravité · ' + info.label),
          draftBadge(node.status)
        ),
        h('h2', { class: 'result__title', tabindex: '-1', 'data-focus': true }, node.title),
        node.summary ? h('p', { class: 'result__summary' }, node.summary) : null,
        info.description ? h('p', { class: 'result__sevdesc' }, info.description) : null,

        productChips(node.products),
        h('h3', { class: 'block-title' }, 'Actions recommandées'),
        h('ol', { class: 'actions' }, actions),

        renderBrandSteps(node),

        node.warning ? h('p', { class: 'callout callout--warn' }, h('span', { class: 'callout__icon', 'aria-hidden': 'true' }, '⚠'), h('span', null, h('strong', null, 'Attention : '), node.warning)) : null,
        node.escalate ? h('p', { class: 'callout callout--escalate' }, h('span', { class: 'callout__icon', 'aria-hidden': 'true' }, '⇪'), h('span', null, h('strong', null, 'Escalade : '), node.escalate)) : null,

        related.length ? h('h3', { class: 'block-title' }, 'Diagnostics liés') : null,
        related.length ? h('div', { class: 'related' }, related) : null,

        h('div', { class: 'result__footer' },
          h('button', { type: 'button', class: 'btn btn--success', onclick: () => copyReport(node, rootSymptom, active, steps) }, 'Copier le rapport'),
          h('button', { type: 'button', class: 'btn', onclick: () => window.print() }, 'Imprimer'),
          h('a', { class: 'btn btn--primary', href: '#/' }, 'Nouveau diagnostic')
        )
      )
    );
  }

  function choose(rootSymptom, path, index) {
    const node = state.nodes[path[path.length - 1]];
    if (!node || node.type !== 'question') return;
    const option = node.options[index];
    if (!option) return;
    const next = targetOf(option);
    if (!next || !state.nodes[next]) {
      toast('Étape suivante introuvable dans les données');
      return;
    }
    navigate(diagHash(rootSymptom.id, [...path, next]));
  }

  function goBack() {
    const route = parseHash();
    if (route.view !== 'diag') return;
    const symptom = state.symptoms.get(route.symptomId);
    if (!symptom) return navigate('#/');
    const path = sanitizePath(symptom, route.path);
    navigateBack(path.length > 1 ? diagHash(symptom.id, path.slice(0, -1)) : '#/');
  }

  function restart() {
    const route = parseHash();
    const symptom = route.view === 'diag' && state.symptoms.get(route.symptomId);
    if (symptom) navigate(diagHash(symptom.id, [symptom.start]));
  }

  /* ---------------------------------------------------------------------
     Assistant produit
     --------------------------------------------------------------------- */
  const CATALOGUE_URL = new URL('data/catalogue.json', SCRIPT_URL).href;
  let cataloguePromise = null;

  /** Charge data/catalogue.json une seule fois ; l'erreur précise (statut HTTP) est conservée. */
  function loadCatalogue() {
    if (!cataloguePromise) {
      cataloguePromise = (async () => {
        let res;
        try { res = await fetch(CATALOGUE_URL, { cache: 'no-cache' }); }
        catch (err) { throw new Error('Téléchargement impossible (' + (err && err.message || err) + ') — adresse : ' + CATALOGUE_URL); }
        if (!res.ok) throw new Error('HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + ' — adresse : ' + CATALOGUE_URL);
        let cat;
        try { cat = await res.json(); }
        catch (err) { throw new Error('Erreur de syntaxe dans data/catalogue.json : ' + err.message); }
        buildCatalogueIndex(cat);
        return cat;
      })();
      cataloguePromise.catch(() => { cataloguePromise = null; }); // nouvelle tentative possible
    }
    return cataloguePromise;
  }

  function buildCatalogueIndex(cat) {
    state.catalogue = cat;
  }

  async function renderProducts(route) {
    showView('products');
    const crumbs = [{ label: 'Accueil', href: '#/' }, { label: 'Assistant produit', href: '#/produits' }];
    renderCrumbs(crumbs);
    const statusEl = $('#products-status');
    statusEl.textContent = 'Chargement du catalogue…';
    try {
      await loadCatalogue();
    } catch (err) {
      console.error('[DIAG·SAV] Catalogue :', err);
      statusEl.replaceChildren(h('p', { class: 'pstatus__error' }, 'Le catalogue produit n\'a pas pu être chargé. ', h('code', null, err.message)));
      return;
    }
    statusEl.textContent = Object.keys(state.catalogue.products || {}).length + ' produits indexés.';
  }

  /* ---------------------------------------------------------------------
     Rapport texte (à coller dans un ticket)
     --------------------------------------------------------------------- */
  function buildReport(node, rootSymptom, active, steps) {
    const now = new Date();
    const lines = [];
    lines.push('=== DIAGNOSTIC SAV N1 ===');
    lines.push('Date      : ' + now.toLocaleString('fr-FR'));
    lines.push('Procédure : v' + ((state.data.meta && state.data.meta.version) || '?'));
    lines.push('Symptôme  : ' + rootSymptom.title + (active !== rootSymptom ? ' → ' + active.title : ''));
    const focus = state.focusProduct && state.products.get(state.focusProduct);
    if (focus) lines.push('Matériel  : ' + productLabel(focus) + (focus.ref ? ' (réf. ' + focus.ref + ')' : '') + ' — ' + productSourceLabel(focus));
    lines.push('');
    lines.push('Parcours :');
    steps.forEach((s, i) => {
      lines.push('  ' + (i + 1) + '. ' + s.node.text);
      lines.push('     → ' + (s.option ? s.option.label : '?'));
    });
    lines.push('');
    lines.push('Résultat  : ' + node.title + ' [GRAVITÉ ' + severityInfo(node.severity).label.toUpperCase() + ']');
    if (node.summary) lines.push('            ' + node.summary);
    lines.push('');
    lines.push('Actions :');
    const checks = document.querySelectorAll('#diag-stage .action input');
    (node.actions || []).forEach((a, i) => {
      const done = checks[i] && checks[i].checked;
      lines.push('  [' + (done ? 'x' : ' ') + '] ' + a);
    });
    for (const b of node.brandSteps || []) {
      if (focus && !((b.products || []).includes(state.focusProduct) || b.brand.includes(focus.brand))) continue;
      lines.push('', 'Selon le matériel — ' + b.brand + (b.status === 'draft' ? ' (procédure à valider)' : '') + ' :');
      (b.actions || []).forEach(a => lines.push('  - ' + a));
    }
    if (node.warning) lines.push('', 'Attention : ' + node.warning);
    if (node.escalate) lines.push('Escalade  : ' + node.escalate);
    lines.push('', 'Lien : ' + location.href);
    return lines.join('\n');
  }

  async function copyReport(node, rootSymptom, active, steps) {
    const text = buildReport(node, rootSymptom, active, steps);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = h('textarea', { style: 'position:fixed;opacity:0;left:-9999px', readonly: true });
        ta.value = text;
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('execCommand');
      }
      toast('✓ Rapport copié dans le presse-papiers');
    } catch {
      toast('Copie impossible sur ce navigateur');
    }
  }

  /* ---------------------------------------------------------------------
     Événements
     --------------------------------------------------------------------- */
  function bindEvents() {
    window.addEventListener('hashchange', onRoute);

    const input = $('#search-input');
    input.addEventListener('input', () => { state.query = input.value; renderGrid(); });
    $('#search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      // Entrée : ouvre directement le premier résultat
      const first = search(state.query, state.filter)[0];
      if (first && state.query.trim()) {
        state.focusProduct = state.searchHints.get(first.id) || null;
        navigate(diagHash(first.id, [first.start]));
      }
    });

    document.querySelectorAll('[data-suggest]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.query = btn.dataset.suggest;
        input.value = state.query;
        renderGrid();
        input.focus();
      });
    });

    // reflet qui suit le pointeur sur les cartes
    $('#symptom-grid').addEventListener('pointermove', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });

    $('#btn-back').addEventListener('click', goBack);
    $('#btn-restart').addEventListener('click', restart);
    $('#btn-retry').addEventListener('click', loadData);
    $('#btn-clear-recents').addEventListener('click', () => {
      store.clear();
      renderRecents();
      toast('Historique local effacé');
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const route = parseHash();

      if (typing) {
        if (e.key === 'Escape' && t.id === 'search-input') {
          if (t.value) { t.value = ''; state.query = ''; renderGrid(); } else t.blur();
        }
        return;
      }

      if (route.view === 'home') {
        if (e.key === '/') { e.preventDefault(); input.focus(); input.select(); }
        return;
      }

      if (route.view === 'diag') {
        if (e.key === 'Escape') { e.preventDefault(); navigate('#/'); return; }
        if (e.key === 'Backspace') { e.preventDefault(); goBack(); return; }
        if (/^[1-9]$/.test(e.key)) {
          const btn = document.querySelector('#diag-stage .option[data-index="' + (Number(e.key) - 1) + '"]');
          if (btn) { e.preventDefault(); btn.click(); }
        }
      }
    });

    const updateNet = () => {
      const online = navigator.onLine;
      $('#net-led').classList.toggle('is-offline', !online);
      $('#net-label').textContent = online ? 'En ligne' : 'Hors ligne';
    };
    window.addEventListener('online', updateNet);
    window.addEventListener('offline', updateNet);
    updateNet();
  }

  /* ---------------------------------------------------------------------
     Mode hors ligne (service worker, uniquement en http/https)
     --------------------------------------------------------------------- */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('[DIAG·SAV] Service worker non enregistré :', err));
    });
  }

  /* ---------------------------------------------------------------------
     Démarrage
     --------------------------------------------------------------------- */
  window.DIAGSAV_STARTED = true;
  bindEvents();
  registerServiceWorker();
  loadData();
})();
