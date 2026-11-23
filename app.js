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

  /* Notes du technicien : une note par symptôme et par jour, sur cet appareil.
     Les notes de plus de 30 jours sont supprimées automatiquement. */
  const NOTES_KEY = 'diagsav.notes.v1';
  const NOTES_MAX_AGE = 30 * 24 * 3600 * 1000;
  const localDate = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const notes = {
    all() {
      try { const o = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; }
      catch { return {}; }
    },
    key: symptomId => localDate() + '|' + symptomId,
    get(symptomId) { const e = this.all()[this.key(symptomId)]; return e ? e.text : ''; },
    set(symptomId, text) {
      const all = this.all();
      const now = Date.now();
      for (const k of Object.keys(all)) if (!all[k] || now - all[k].updated > NOTES_MAX_AGE) delete all[k];
      if (text.trim()) all[this.key(symptomId)] = { text, updated: now };
      else delete all[this.key(symptomId)];
      try { localStorage.setItem(NOTES_KEY, JSON.stringify(all)); return true; } catch { return false; }
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
      state.published = JSON.parse(text);   // copie intacte du fichier publié (éditeur, sortie du mode test)
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
   * v2 → v3 : images facultatives sur les étapes.
   * v3 → v4 : suppression du mode salon (section checklists retirée si présente).
   * Rien n'est perdu ni renommé : on complète simplement les sections manquantes.
   */
  const SCHEMA_VERSION = 4;
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
    if (from < 4) delete data.checklists;
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
      words: [...new Set(normalize([s.title, ...(s.keywords || []), s.summary].join(' ')).split(' ').filter(w => w.length >= 3))],
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

  /**
   * Contrôle de cohérence des données, avec des messages en français courant.
   * Renvoie [{ msg, ref: { kind: 'symptom' | 'node' | 'product' | 'family', id } }].
   * Utilisé par le pied de page (diagnostic) et par l'éditeur (liens « Corriger »).
   */
  function validateDetailed(data) {
    const w = [];
    const add = (msg, kind, id) => w.push({ msg: msg.replace(/\bde le\b/g, 'du').replace(/\bDe le\b/g, 'Du'), ref: kind ? { kind, id } : null });
    const nodes = data.nodes || {};
    const symptoms = Array.isArray(data.symptoms) ? data.symptoms : [];
    const symptomIds = new Set();
    const catIds = new Set((data.categories || []).map(c => c.id));
    const products = data.products || {};
    const families = data.families || {};
    const sources = data.sources || {};
    const STATUSES = ['draft', 'validated'];
    const q = t => '« ' + truncate(t || '?', 70) + ' »';
    const nodeName = id => {
      const n = nodes[id];
      if (!n) return '« ' + id + ' »';
      return n.type === 'result' ? 'le résultat ' + q(n.title) : 'la question ' + q(n.text);
    };

    for (const s of symptoms) {
      if (!s.id) { add('Un symptôme n\'a pas d\'identifiant (' + q(s.title) + ').'); continue; }
      if (symptomIds.has(s.id)) add('Deux symptômes portent le même identifiant « ' + s.id + ' ».', 'symptom', s.id);
      symptomIds.add(s.id);
      if (!s.title) add('Le symptôme « ' + s.id + ' » n\'a pas de titre.', 'symptom', s.id);
      if (!s.start) add('Le symptôme ' + q(s.title || s.id) + ' n\'a pas de question de départ.', 'symptom', s.id);
      else if (!nodes[s.start]) add('Le symptôme ' + q(s.title || s.id) + ' commence par une étape qui n\'existe pas (« ' + s.start + ' »).', 'symptom', s.id);
      if (s.category && !catIds.has(s.category)) add('Le symptôme ' + q(s.title || s.id) + ' utilise une catégorie inconnue (« ' + s.category + ' »).', 'symptom', s.id);
    }

    for (const [id, n] of Object.entries(nodes)) {
      if (n.type === 'question') {
        if (!n.text) add('Une question n\'a pas de texte (« ' + id + ' »).', 'node', id);
        if (!Array.isArray(n.options) || n.options.length === 0) add(cap(nodeName(id)) + ' n\'a aucune réponse possible.', 'node', id);
        if (n.options && n.options.length > 9) add(cap(nodeName(id)) + ' a plus de 9 réponses (les raccourcis clavier s\'arrêtent à 9).', 'node', id);
        for (const o of n.options || []) {
          const lbl = q(o.label || '(sans libellé)');
          if (!o.label) add(cap(nodeName(id)) + ' a une réponse sans libellé.', 'node', id);
          if (o.next && !nodes[o.next]) add('La réponse ' + lbl + ' de ' + nodeName(id) + ' mène vers une étape qui n\'existe plus (« ' + o.next + ' »).', 'node', id);
          if (o.symptom && !symptoms.some(s => s.id === o.symptom)) add('La réponse ' + lbl + ' de ' + nodeName(id) + ' renvoie vers un symptôme inconnu (« ' + o.symptom + ' »).', 'node', id);
          if (!o.next && !o.symptom) add('La réponse ' + lbl + ' de ' + nodeName(id) + ' ne mène nulle part : choisissez l\'étape suivante.', 'node', id);
        }
      } else if (n.type === 'result') {
        if (!n.title) add('Un résultat n\'a pas de titre (« ' + id + ' »).', 'node', id);
        if (!SEVERITY_ORDER.includes(n.severity)) add(cap(nodeName(id)) + ' a une gravité invalide (« ' + n.severity + ' ») : choisissez Faible, Modéré ou Élevé.', 'node', id);
        if (!Array.isArray(n.actions) || !n.actions.filter(a => String(a).trim()).length) add(cap(nodeName(id)) + ' ne contient aucune action.', 'node', id);
        for (const r of n.related || []) {
          if (!symptomIds.has(r) && !symptoms.some(s => s.id === r)) add(cap(nodeName(id)) + ' propose un diagnostic lié inconnu (« ' + r + ' »).', 'node', id);
        }
      } else {
        add('L\'étape « ' + id + ' » a un type inconnu (« ' + n.type + ' ») : attendu question ou result.', 'node', id);
      }
      (n.images || []).forEach((img, i) => {
        const where = 'L\'image n° ' + (i + 1) + ' de ' + nodeName(id);
        if (!img || !img.src) add(where + ' n\'a pas de fichier.', 'node', id);
        else if (!isLocalImage(img.src)) add(where + ' doit être un fichier du dossier img/ du site (« ' + img.src + ' ») : aucune image externe.', 'node', id);
        if (!img || !String(img.alt || '').trim()) add(where + ' n\'a pas de description (texte alternatif, utile si l\'image ne s\'affiche pas).', 'node', id);
      });
      if (n.status && !STATUSES.includes(n.status)) add(cap(nodeName(id)) + ' a un statut invalide (« ' + n.status + ' ») : attendu draft ou validated.', 'node', id);
      for (const pid of n.products || []) {
        if (!products[pid]) add(cap(nodeName(id)) + ' cite un produit inconnu (« ' + pid + ' »).', 'node', id);
      }
      (n.brandSteps || []).forEach((b, i) => {
        const where = 'Les étapes « ' + (b.brand || 'marque n° ' + (i + 1)) + ' » de ' + nodeName(id);
        if (!b.brand) add(where + ' n\'indiquent pas de marque.', 'node', id);
        if (!Array.isArray(b.actions) || !b.actions.filter(a => String(a).trim()).length) add(where + ' ne contiennent aucune action.', 'node', id);
        if (b.status && !STATUSES.includes(b.status)) add(where + ' ont un statut invalide (« ' + b.status + ' »).', 'node', id);
        for (const pid of b.products || []) if (!products[pid]) add(where + ' citent un produit inconnu (« ' + pid + ' »).', 'node', id);
      });
    }

    for (const [fid, f] of Object.entries(families)) {
      if (!f.label) add('La famille « ' + fid + ' » n\'a pas de nom.', 'family', fid);
      for (const sid of f.symptoms || []) {
        if (!symptomIds.has(sid)) add('La famille ' + q(f.label || fid) + ' est reliée à un symptôme inconnu (« ' + sid + ' »).', 'family', fid);
      }
    }
    for (const [pid, pr] of Object.entries(products)) {
      const name = q([pr.brand, pr.model].filter(Boolean).join(' ') || pid);
      if (!pr.brand || !pr.model) add('Le produit ' + name + ' n\'a pas de marque ou de modèle.', 'product', pid);
      if (!families[pr.family]) add('Le produit ' + name + ' appartient à une famille inconnue (« ' + pr.family + ' »).', 'product', pid);
      if (pr.source && !sources[pr.source]) add('Le produit ' + name + ' cite une source inconnue (« ' + pr.source + ' »).', 'product', pid);
      if (pr.page != null && !(Number.isInteger(pr.page) && pr.page > 0)) add('La page du produit ' + name + ' doit être un nombre entier (actuellement « ' + pr.page + ' »).', 'product', pid);
    }

    // Étapes jamais atteintes
    const reached = new Set();
    const walk = (id) => {
      if (!id || reached.has(id) || !nodes[id]) return;
      reached.add(id);
      for (const o of nodes[id].options || []) walk(o.next);
    };
    for (const s of symptoms) walk(s.start);
    for (const id of Object.keys(nodes)) {
      if (!reached.has(id)) add(cap(nodeName(id)) + ' n\'est atteinte depuis aucun symptôme.', 'node', id);
    }
    return w;
  }

  /** Seules les images du dossier img/ du site sont autorisées (aucun appel externe). */
  function isLocalImage(src) {
    return /^img\/[\w\-./]+\.(webp|jpe?g|png|svg|gif)$/i.test(String(src || '')) && !String(src).includes('..');
  }

  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  /** Version texte (pied de page, console). */
  function validate(data) {
    return validateDetailed(data).map(x => x.msg);
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
    if (parts[0] === 'diagnostic') return { view: 'home' };
    if (parts[0] && parts[0].split('?')[0] === 'veille') {
      const f = (raw.split('?')[1] || '').match(/(?:^|&)f=([^&]*)/);
      return { view: 'news', filter: f ? decodeURIComponent(f[1]) : 'all' };
    }
    if (parts[0] === 'journal') return { view: 'journal' };
    if (EXTRA_PAGES.includes(parts[0] && parts[0].split('?')[0])) {
      const qs = raw.split('?')[1] || '';
      const params = {};
      for (const kv of qs.split('&').filter(Boolean)) {
        const [k, v = ''] = kv.split('=');
        try { params[k] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch { params[k] = v; }
      }
      return { view: 'page', page: parts[0].split('?')[0], sub: parts.slice(1).map(x => x.split('?')[0]), params };
    }
    if (parts[0] === 'recommander') {
      return { view: 'reco', path: parts.slice(1) };
    }
    if (parts[0] === 'editeur') {
      return { view: 'editor', sub: parts.slice(1) };
    }
    if (parts[0] && parts[0].split('?')[0] === 'produits') {
      const qs = raw.split('?')[1] || '';
      const param = (k) => {
        const m = qs.match(new RegExp('(?:^|&)' + k + '=([^&]*)'));
        if (!m) return '';
        try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch { return m[1]; }
      };
      const id = parts[1] ? parts[1].split('?')[0] : null;
      return { view: 'products', productId: id, query: param('q'), group: param('rayon'), brand: param('marque') };
    }
    return { view: 'hub' };
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

  /** Pages secondaires (portfolio, outils, formation…) : pages.js, chargé à la demande. */
  const EXTRA_PAGES = ['projet', 'visite', 'outils', 'formation', 'comparer', 'demos'];
  const loadPages = () => loadScript('pages.js', 'DIAGSAV_PAGES');

  function onRoute() {
    onRouteInner();
    // visite guidée en cours : la barre de guidage suit la navigation
    let tour = null;
    try { tour = sessionStorage.getItem('diagsav.tour'); } catch { /* stockage indisponible */ }
    if (tour || window.DIAGSAV_PAGES) loadPages().then(P => P.updateTour && P.updateTour()).catch(() => {});
  }

  function renderPage(route) {
    showView('page');
    const root = $('#page-root');
    loadPages()
      .then(P => P.render(route, root))
      .catch(err => {
        console.error('[DIAG·SAV] pages.js :', err);
        root.replaceChildren(h('div', { class: 'panel' }, h('h1', null, 'Page indisponible'),
          h('p', null, 'Le module n\'a pas pu être chargé. ', h('code', null, err.message)),
          h('a', { class: 'btn btn--ghost', href: '#/' }, '← Accueil')));
      });
  }

  function onRouteInner() {
    if (!state.data) return;
    const route = parseHash();

    setActiveTab({ hub: 'home', home: 'diag', diag: 'diag', reco: 'reco', news: 'news' }[route.view] || null);
    if (route.view === 'hub') {
      trackNav();
      renderHub();
      return;
    }
    if (route.view === 'news') {
      trackNav();
      renderNews(route);
      return;
    }
    if (route.view === 'page') {
      trackNav();
      renderPage(route);
      return;
    }
    if (route.view === 'journal') {
      trackNav();
      renderJournalPage();
      return;
    }
    if (route.view === 'reco') {
      trackNav();
      renderReco(route);
      return;
    }
    if (route.view === 'editor') {
      trackNav();
      renderEditor(route);
      return;
    }
    if (route.view === 'products') {
      trackNav();
      renderProducts(route);
      return;
    }
    if (route.view === 'diag') {
      const symptom = state.symptoms.get(route.symptomId);
      if (!symptom || !state.nodes[symptom.start]) {
        toast('Symptôme introuvable');
        navigate('#/diagnostic', { replace: true });
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
    for (const a of document.querySelectorAll('.nav__link')) {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  /* ---------------------------------------------------------------------
     Animations : fondu entre les pages (View Transitions) et apparition
     des cartes. Rien si le système demande de réduire les animations.
     --------------------------------------------------------------------- */
  const motionOk = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canTransition = () => typeof document.startViewTransition === 'function' && motionOk();
  if (canTransition()) document.documentElement.classList.add('has-vt');

  /** Clé de « page » : on n'anime pas une saisie de recherche ni une étape de diagnostic (déjà animée). */
  function pageKey() {
    const r = parseHash();
    if (r.view === 'products') return 'products:' + (r.productId || '');
    if (r.view === 'reco') return 'reco:' + (r.path || []).join('/');
    if (r.view === 'editor') return 'editor:' + (r.sub || []).join('/');
    if (r.view === 'page') return 'page:' + r.page + '/' + (r.sub || []).join('/');
    return r.view;
  }

  function routeWithTransition() {
    const key = pageKey();
    const changed = key !== state.pageKey;
    state.pageKey = key;
    if (!changed || !state.data || !canTransition()) { onRoute(); return; }
    try {
      const vt = document.startViewTransition(() => { onRoute(); });
      vt.finished.catch(() => {});
    } catch { onRoute(); }
  }

  const RISE = '.hcard, .card, .news, .crow, .option, .presults > li';
  /** Fait apparaître en cascade les cartes de la vue qu'on vient d'ouvrir. */
  function riseIn(view) {
    if (!motionOk() || !view) return;
    requestAnimationFrame(() => {
      const items = [...view.querySelectorAll(RISE)].slice(0, 14);
      items.forEach((el, i) => {
        el.style.setProperty('--i', String(i));
        el.classList.remove('rise');
        void el.offsetWidth;            // relance l'animation
        el.classList.add('rise');
        el.addEventListener('animationend', () => el.classList.remove('rise'), { once: true });
      });
    });
  }

  function showView(name) {
    const entering = name !== state.currentView;
    state.currentView = name;
    if (entering) riseIn($('#view-' + name));
    for (const v of ['loading', 'error', 'hub', 'home', 'diag', 'products', 'editor', 'reco', 'news', 'journal', 'page']) {
      const el = $('#view-' + v);
      if (el) el.hidden = v !== name;
    }
    document.body.classList.toggle('is-home', name === 'hub');
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
        if (!s && t.length >= 4 && entry.words.some(w => closeEnough(t, w))) s += 1;   // faute de frappe
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

  /** Vrai si a et b ne diffèrent que d'une faute (deux pour les mots longs) : lettre en trop, en moins, remplacée ou inversée. */
  function closeEnough(a, b) {
    const max = a.length >= 7 ? 2 : 1;
    if (Math.abs(a.length - b.length) > max) return false;
    // le début d'un mot plus long compte aussi (« alimenta » → « alimentation »)
    if (b.length > a.length) b = b.slice(0, a.length + max);
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    let best = Infinity;
    for (let j = Math.max(0, a.length - max); j <= b.length; j++) best = Math.min(best, d[a.length][j]);
    return best <= max;
  }

  function renderFilters() {
    const wrap = $('#filters');
    wrap.replaceChildren();
    const make = (id, label) => h('button', {
      type: 'button',
      class: 'ftext',
      'aria-pressed': String(state.filter === id),
      dataset: { filter: id },
      onclick: () => { state.filter = id; renderHome(); }
    }, label, h('span', { class: 'ftext__n', dataset: { countFor: id } }));

    wrap.append(make('all', 'Tous'));
    for (const c of state.categories.values()) wrap.append(make(c.id, c.label));
  }

  function updateFilterCounts() {
    const base = search(state.query, 'all');
    for (const btn of document.querySelectorAll('#filters .ftext')) {
      const id = btn.dataset.filter;
      btn.setAttribute('aria-pressed', String(state.filter === id));
      const n = id === 'all' ? base.length : base.filter(s => s.category === id).length;
      const counter = btn.querySelector('.ftext__n');
      if (counter) counter.textContent = n;
      btn.hidden = id !== 'all' && n === 0 && state.filter !== id;
    }
  }

  function renderGrid() {
    const list = search(state.query, state.filter);
    const grid = $('#symptom-grid');
    grid.replaceChildren(...list.map((s, i) => symptomCard(s, i)));
    $('#empty-state').hidden = list.length > 0;
    $('#result-count').textContent = list.length + ' / ' + state.symptoms.size;
    updateFilterCounts();
  }

  function symptomCard(s, index = 0) {
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
          h('span', { class: 'card__num' }, String(index + 1).padStart(2, '0')),
          h('span', { class: 'card__cat' }, icon(cat.icon), cat.label)
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
    renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Diagnostic' }]);
    const input = $('#search-input');
    if (input.value !== state.query) input.value = state.query;
    renderGrid();
    renderRecents();
    renderQuickLinks();
    state.lastRenderedHash = null;
    setActiveTab('diag');
  }

  /* ---------------------------------------------------------------------
     Accueil (hub) : recherche globale + cartes de sections
     --------------------------------------------------------------------- */
  function renderHub() {
    showView('hub');
    renderCrumbs([{ label: 'Accueil' }]);
    renderQuickLinks();
    state.lastRenderedHash = null;
    if (state.focusSearch) { state.focusSearch = false; $('#gsearch-input').focus(); $('#gsearch-input').select(); }
    const q = $('#gsearch-input').value;
    if (q.trim()) runGlobalSearch(q);
  }

  let gTimer = null, gSeq = 0;
  async function runGlobalSearch(query) {
    const box = $('#gsearch-results');
    const q = query.trim();
    const seq = ++gSeq;
    $('#hub-quick').hidden = !!q;
    if (!q) { box.replaceChildren(); return; }
    const groups = [];
    // symptômes (déjà en mémoire)
    const sym = search(q, 'all').slice(0, 5);
    if (sym.length) groups.push({ title: 'Diagnostic', items: sym.map(s => ({ href: diagHash(s.id, [s.start]), label: s.title, sub: categoryOf(s).label, pid: state.searchHints.get(s.id) })) });
    // produits (catalogue chargé à la demande)
    try {
      await loadCatalogue();
      const pr = productSearch(q);
      if (pr.results.length && !pr.partial) groups.push({ title: 'Produits', items: pr.results.slice(0, 5).map(r => ({ href: '#/produits/' + encodeURIComponent(r.entry.id), label: productLabel(r.entry.pr), sub: r.entry.pr.type + ' · ' + productSourceLabel(r.entry.pr) })) });
    } catch { /* catalogue indisponible : on ignore */ }
    // veille
    try {
      const news = state.preview && state.previewNews ? state.previewNews : await loadJson('data/news.json');
      const toks = tokenize(q);
      const hits = (news.items || []).filter(it => { const t = normalize([it.title, it.summary, it.action].join(' ')); return toks.length && toks.every(k => t.includes(k)); });
      if (hits.length) groups.push({ title: 'Veille', items: hits.slice(0, 5).map(it => ({ href: '#/veille' + (it.category ? '?f=' + encodeURIComponent(it.category) : ''), label: it.title, sub: fmtDate(it.date) })) });
    } catch { /* veille indisponible : on ignore */ }
    if (seq !== gSeq) return;   // une recherche plus récente est en cours
    const all = groups.flatMap(g => g.items);
    state.gFirst = all[0] ? all[0].href : null;
    if (!groups.length) {
      box.replaceChildren(h('p', { class: 'gresults__none' }, 'Aucun résultat pour « ' + q + ' ».'));
      return;
    }
    box.replaceChildren(...groups.map(g => h('section', { class: 'gresults__group' },
      h('h2', { class: 'gresults__title' }, g.title),
      h('ul', { class: 'gresults__list' }, g.items.map(it => h('li', null,
        h('a', { class: 'gresults__item', href: it.href, onclick: () => { state.focusProduct = it.pid || null; } },
          h('span', { class: 'gresults__label' }, it.label),
          it.sub ? h('span', { class: 'gresults__sub' }, it.sub) : null)))))));
  }

  /* ---------------------------------------------------------------------
     Diagnostic
     --------------------------------------------------------------------- */
  function renderDiag(rootSymptom, path) {
    showView('diag');

    // le produit mis en avant ne vaut que pour les symptômes de sa famille
    if (state.focusProduct) {
      const fp = state.products.get(state.focusProduct);
      const fam = fp && state.families.get(fp.family);
      if (!fam || !(fam.symptoms || []).includes(rootSymptom.id)) state.focusProduct = null;
    }

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
    const crumbs = [{ label: 'Accueil', href: '#/' }, { label: 'Diagnostic', href: '#/diagnostic' }];
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
    renderNotes(rootSymptom);

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

    if (isResult && !state.preview) {
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
        h('li', null, h('a', { class: 'gear__model' + (pid === state.focusProduct ? ' is-focus' : ''), href: '#/produits/' + encodeURIComponent(pid),
          title: pr.type + (pr.ref ? ' · réf. ' + pr.ref : '') + ' — voir la fiche' },
          pr.model, h('span', { class: 'gear__page' }, pr.page ? ' p. ' + pr.page : '')))
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
      : 'Étape ' + path.length + ' sur ' + total + ' au plus');

    $('#progress-step').textContent = current.type === 'result'
      ? 'Résultat · ' + done + ' réponse' + (done > 1 ? 's' : '')
      : 'Étape ' + path.length + '/' + total;
    $('#progress-remaining').textContent = current.type === 'result'
      ? ''
      : remaining === 0 ? 'Dernière question' : 'au plus ' + remaining + ' restante' + (remaining > 1 ? 's' : '');
  }

  function renderNotes(rootSymptom) {
    const input = $('#notes-input');
    if (state.notesSymptom !== rootSymptom.id || document.activeElement !== input) {
      input.value = notes.get(rootSymptom.id);
    }
    state.notesSymptom = rootSymptom.id;
    $('#notes-state').textContent = input.value.trim() ? 'enregistrées' : '';
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
        renderImages(node),
        productChips(node.products),
        h('ul', { class: 'options', role: 'list' }, options)
      )
    );
  }

  /** Photos / schémas d'une étape : chargement différé, agrandissement au toucher. */
  function renderImages(node) {
    const list = (node.images || []).filter(img => img && isLocalImage(img.src));
    if (!list.length) return null;
    return h('div', { class: 'figs' + (list.length > 1 ? ' figs--multi' : '') }, list.map(img => {
      const url = new URL(img.src, SCRIPT_URL).href;
      const pic = h('img', { src: url, alt: img.alt || '', loading: 'lazy', decoding: 'async',
        width: img.width ? String(img.width) : null, height: img.height ? String(img.height) : null });
      const fig = h('figure', { class: 'fig' },
        h('button', { type: 'button', class: 'fig__btn', 'aria-label': 'Agrandir : ' + (img.alt || 'image'), onclick: () => openLightbox(url, img) }, pic),
        img.caption ? h('figcaption', { class: 'fig__cap' }, img.caption) : null);
      pic.addEventListener('error', () => {
        fig.replaceChildren(h('div', { class: 'fig__missing' },
          h('strong', null, 'Image indisponible'), ' — ' + (img.alt || img.src),
          h('span', { class: 'fig__path' }, img.src + (navigator.onLine ? ' (pas encore publiée ?)' : ' (hors ligne, jamais consultée)'))));
      }, { once: true });
      return fig;
    }));
  }

  let lightboxReturn = null;
  function openLightbox(url, img) {
    const box = $('#lightbox');
    lightboxReturn = document.activeElement;
    $('#lightbox-img').src = url;
    $('#lightbox-img').alt = img.alt || '';
    $('#lightbox-cap').textContent = img.caption || img.alt || '';
    box.hidden = false;
    document.body.classList.add('has-lightbox');
    $('#lightbox-close').focus();
  }
  function closeLightbox() {
    const box = $('#lightbox');
    if (box.hidden) return false;
    box.hidden = true;
    document.body.classList.remove('has-lightbox');
    $('#lightbox-img').removeAttribute('src');
    if (lightboxReturn && lightboxReturn.focus) lightboxReturn.focus();
    return true;
  }

  /** Télécharge d'avance tout ce qui sert hors ligne (le service worker le met en cache). */
  async function prepareOffline() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      toast('Mode hors ligne pas encore actif : rechargez la page une fois, puis réessayez');
      return;
    }
    const urls = new Set(['data/decisions.json', 'data/catalogue.json', 'pdf.js', 'editor.js']);
    for (const n of Object.values(state.nodes)) for (const img of n.images || []) if (img && isLocalImage(img.src)) urls.add(img.src);
    let ok = 0, fail = 0;
    toast('Préparation du hors-ligne…');
    await Promise.all([...urls].map(u => fetch(new URL(u, SCRIPT_URL).href).then(r => { if (r.ok) ok++; else fail++; }).catch(() => { fail++; })));
    toast(fail ? '⚠ ' + ok + ' éléments prêts, ' + fail + ' indisponibles' : '✓ ' + ok + ' éléments prêts pour le hors-ligne');
  }

  function draftBadge(status) {
    return status === 'draft'
      ? h('span', { class: 'badge badge--draft', title: 'Procédure rédigée sans notice constructeur : à faire relire par un technicien.' }, 'À valider')
      : null;
  }

  function productChips(ids) {
    const list = (ids || []).filter(pid => state.products.has(pid)).map(pid => Object.assign({ id: pid }, state.products.get(pid)));
    if (!list.length) return null;
    return h('p', { class: 'node-products' }, 'Matériel : ',
      list.map((pr, i) => [i ? ', ' : '', h('a', { class: 'node-products__link', href: '#/produits/' + encodeURIComponent(pr.id), title: productSourceLabel(pr) + ' — voir la fiche' }, productLabel(pr))]));
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
          prods.length ? h('p', { class: 'brandstep__src' }, 'Fiches : ', (b.products || []).filter(pid => state.products.has(pid)).map((pid, i) => {
            const p = state.products.get(pid);
            return [i ? ' · ' : '', h('a', { href: '#/produits/' + encodeURIComponent(pid) }, productLabel(p) + (p.page ? ' (p. ' + p.page + ')' : ''))];
          })) : null
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
        renderImages(node),
        info.description ? h('p', { class: 'result__sevdesc' }, info.description) : null,

        productChips(node.products),
        h('h3', { class: 'block-title' }, 'Actions recommandées'),
        h('ol', { class: 'actions' }, actions),

        renderBrandSteps(node),

        node.warning ? h('p', { class: 'callout callout--warn' }, h('span', { class: 'callout__icon', 'aria-hidden': 'true' }, '⚠'), h('span', null, h('strong', null, 'Attention : '), node.warning)) : null,
        node.escalate ? h('p', { class: 'callout callout--escalate' }, h('span', { class: 'callout__icon', 'aria-hidden': 'true' }, '⇪'), h('span', null, h('strong', null, 'Escalade : '), node.escalate)) : null,

        related.length ? h('h3', { class: 'block-title' }, 'Diagnostics liés') : null,
        related.length ? h('div', { class: 'related' }, related) : null,

        renderOutcome(node, rootSymptom, active),

        h('div', { class: 'result__footer' },
          h('button', { type: 'button', class: 'btn btn--success', onclick: () => copyReport(node, rootSymptom, active, steps) }, 'Copier le rapport'),
          h('button', { type: 'button', class: 'btn', onclick: () => exportPdf(node, rootSymptom, active, steps) }, 'Télécharger le PDF'),
          h('button', { type: 'button', class: 'btn', onclick: () => window.print() }, 'Imprimer'),
          h('a', { class: 'btn btn--primary', href: '#/diagnostic' }, 'Nouveau diagnostic')
        )
      )
    );
  }

  /* ---------------------------------------------------------------------
     Journal des diagnostics : sur cet appareil uniquement, rien n'est envoyé.
     Le technicien indique « Résolu » ou « Pas résolu » ; le responsable SAV
     regroupe les fichiers exportés pour repérer les procédures qui échouent.
     --------------------------------------------------------------------- */
  const LOG_KEY = 'diagsav.journal.v1';
  const LOG_MAX = 500;
  const LOG_MAX_AGE = 180 * 24 * 3600 * 1000;
  const journal = {
    all() {
      try {
        const list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
        const limit = Date.now() - LOG_MAX_AGE;
        return Array.isArray(list) ? list.filter(e => e && e.ts > limit) : [];
      } catch { return []; }
    },
    save(list) {
      try { localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-LOG_MAX))); return true; } catch { return false; }
    },
    /** Une seule entrée par diagnostic (même chemin, moins de 2 h) : un nouveau clic la corrige. */
    record(entry) {
      const list = this.all();
      const prev = list.findIndex(e => e.hash === entry.hash && entry.ts - e.ts < 2 * 3600 * 1000);
      if (prev >= 0) list.splice(prev, 1);
      list.push(entry);
      return this.save(list);
    },
    find(hash) {
      const now = Date.now();
      return this.all().reverse().find(e => e.hash === hash && now - e.ts < 2 * 3600 * 1000) || null;
    },
    clear() { try { localStorage.removeItem(LOG_KEY); } catch { /* ignoré */ } }
  };

  function renderOutcome(node, rootSymptom, active) {
    if (state.preview) return null;
    const hash = location.hash;
    const box = h('section', { class: 'outcome', 'aria-labelledby': 'outcome-title' });
    const draw = () => {
      const entry = journal.find(hash);
      const pick = (outcome) => {
        const ok = journal.record({
          ts: Date.now(), hash, outcome,
          symptom: rootSymptom.id, symptomTitle: rootSymptom.title,
          active: active.id !== rootSymptom.id ? active.id : undefined,
          result: parseHash().path.slice(-1)[0], resultTitle: node.title, severity: node.severity,
          product: state.focusProduct || undefined,
          version: (state.data.meta && state.data.meta.version) || ''
        });
        if (!ok) toast('Journal non enregistré : stockage indisponible sur cet appareil');
        draw();
        $('#outcome-live').textContent = outcome === 'resolu' ? 'Noté : problème résolu.' : 'Noté : problème non résolu.';
      };
      const btn = (outcome, label, cls) => h('button', {
        type: 'button', class: 'btn outcome__btn ' + cls, 'aria-pressed': String(!!entry && entry.outcome === outcome), onclick: () => pick(outcome)
      }, label);
      const unresolved = entry && entry.outcome === 'non-resolu';
      box.replaceChildren(...[
        h('h3', { class: 'block-title', id: 'outcome-title' }, 'Le problème est-il résolu ?'),
        h('div', { class: 'outcome__btns' }, btn('resolu', 'Résolu', 'outcome__btn--ok'), btn('non-resolu', 'Pas résolu', 'outcome__btn--ko')),
        unresolved ? h('div', { class: 'outcome__next' },
          h('p', null, h('strong', null, 'Suite : '), node.escalate || 'Escalader au support de niveau 2 avec le rapport (bouton « Copier le rapport » ci-dessous).'),
          (node.related || []).length ? h('p', { class: 'muted' }, 'Essayez aussi un diagnostic lié ci-dessus.') : null) : null,
        h('p', { class: 'outcome__note muted' }, 'Noté dans ', h('a', { href: '#/journal' }, 'votre journal'), ', sur cet appareil uniquement.'),
        h('p', { class: 'visually-hidden', id: 'outcome-live', 'aria-live': 'polite' })
      ].filter(Boolean));
    };
    draw();
    return box;
  }

  function renderJournalPage() {
    showView('journal');
    renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Mon journal' }]);
    const box = $('#journal-root');
    const list = journal.all().reverse();
    const ok = list.filter(e => e.outcome === 'resolu').length;
    // procédures qui échouent le plus
    const bySym = new Map();
    for (const e of list) {
      const k = e.symptomTitle || e.symptom;
      const s = bySym.get(k) || { total: 0, ko: 0 };
      s.total++; if (e.outcome !== 'resolu') s.ko++;
      bySym.set(k, s);
    }
    const worst = [...bySym.entries()].filter(([, s]) => s.ko).sort((a, b) => b[1].ko - a[1].ko).slice(0, 5);
    const fmt = ts => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    box.replaceChildren(...[
      h('div', { class: 'phead' },
        h('p', { class: 'eyebrow' }, 'Sur cet appareil'),
        h('h1', { class: 'phead__title' }, 'Mon journal'),
        h('p', { class: 'phead__lead' }, 'Les diagnostics que vous avez marqués « Résolu » ou « Pas résolu ». Rien n\'est envoyé : exportez le fichier et transmettez-le à votre responsable SAV si besoin. Conservé ' + Math.round(LOG_MAX_AGE / 86400000) + ' jours.')),
      list.length ? h('dl', { class: 'jstats' },
        h('div', null, h('dt', null, 'Diagnostics'), h('dd', null, String(list.length))),
        h('div', null, h('dt', null, 'Résolus'), h('dd', null, Math.round(ok / list.length * 100) + ' %')),
        h('div', null, h('dt', null, 'Non résolus'), h('dd', null, String(list.length - ok)))) : null,
      worst.length ? h('section', { class: 'pdetail__block' },
        h('h2', { class: 'block-title' }, 'Procédures les plus souvent sans solution'),
        h('ul', { class: 'plinks' }, worst.map(([k, s]) => h('li', null, k, h('span', { class: 'muted' }, ' · ' + s.ko + ' sur ' + s.total))))) : null,
      list.length ? h('div', { class: 'result__footer' },
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => downloadFile('journal-diagnostics-' + localDate() + '.csv', journalCsv(list), 'text/csv;charset=utf-8') }, 'Exporter (tableur CSV)'),
        h('button', { type: 'button', class: 'btn', onclick: () => downloadFile('journal-diagnostics-' + localDate() + '.json', JSON.stringify(list, null, 2), 'application/json') }, 'Exporter (JSON)'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => {
          if (!confirmClear()) return;
          journal.clear(); toast('Journal effacé'); renderJournalPage();
        } }, 'Effacer le journal')) : null,
      list.length
        ? h('ol', { class: 'jlist' }, list.map(e => h('li', { class: 'jitem' },
            h('span', { class: 'jitem__badge ' + (e.outcome === 'resolu' ? 'is-ok' : 'is-ko') }, e.outcome === 'resolu' ? 'Résolu' : 'Pas résolu'),
            h('a', { class: 'jitem__title', href: e.hash }, e.symptomTitle + ' → ' + e.resultTitle),
            h('span', { class: 'jitem__meta muted' }, fmt(e.ts) + (e.product && state.products.get(e.product) ? ' · ' + productLabel(state.products.get(e.product)) : '') + (e.version ? ' · procédures v' + e.version : '')))))
        : h('div', { class: 'empty' }, 'Aucun diagnostic noté pour l\'instant. À la fin d\'un diagnostic, indiquez « Résolu » ou « Pas résolu ».', h('br'), h('a', { href: '#/diagnostic' }, 'Commencer un diagnostic →'))
    ].filter(Boolean));
  }

  /* Effacement en deux clics (pas de boîte de dialogue bloquante) */
  let clearArmed = 0;
  function confirmClear() {
    if (Date.now() - clearArmed < 4000) { clearArmed = 0; return true; }
    clearArmed = Date.now();
    toast('Cliquez à nouveau pour effacer définitivement le journal');
    return false;
  }

  function journalCsv(list) {
    const cols = [['Date', e => { const d = new Date(e.ts); const z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()); }], ['Résultat', e => e.outcome === 'resolu' ? 'Résolu' : 'Pas résolu'],
      ['Symptôme', e => e.symptomTitle], ['Recommandation', e => e.resultTitle], ['Gravité', e => severityInfo(e.severity).label || e.severity],
      ['Produit', e => (e.product && state.products.get(e.product)) ? productLabel(state.products.get(e.product)) : ''],
      ['Procédures', e => e.version], ['Lien', e => location.origin + location.pathname + e.hash]];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    // BOM + point-virgule : ouverture directe dans Excel en français
    return '\ufeff' + [cols.map(c => q(c[0])).join(';'), ...list.map(e => cols.map(c => q(c[1](e))).join(';'))].join('\r\n');
  }

  function downloadFile(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Fichier « ' + name + ' » téléchargé');
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
    if (!symptom) return navigate('#/diagnostic');
    const path = sanitizePath(symptom, route.path);
    navigateBack(path.length > 1 ? diagHash(symptom.id, path.slice(0, -1)) : '#/diagnostic');
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

  /* ----- Moteur de recherche produit (100 % local) ----- */
  const P_STOP = new Set([...STOP_WORDS, 'quel', 'quels', 'quelle', 'quelles', 'produit', 'produits', 'avec', 'pour',
    'qui', 'que', 'quoi', 'sont', 'existe', 'avez', 'a', 'un', 'une', 'des', 'les', 'catalogue', 'modele', 'modeles',
    'compatible', 'supporte', 'gere', 'faut', 'cherche', 'besoin', 'je', 'me', 'on', 'il', 'plus', 'moins', 'minimum', 'au']);
  const UNITS = { lumen: 'lumens', nit: 'cd/m² / nits', port: 'ports', w: 'W', canal: 'canaux', canaux: 'canaux', m: 'm', pouce: 'pouces' };
  // Unités comparées en « au moins » (luminosité, ports…) ; les tailles d'écran sont comparées à l'identique.
  const EXACT_UNITS = new Set(['pouce']);

  /** Normalise un texte pour l'index : minuscules, sans accents, milliers recollés, synonymes, singulier. */
  function pNormalize(text, syn) {
    let t = String(text || '')
      .replace(/(\d)[\s\u00a0\u202f](?=\d{3}\b)/g, '$1')             // 8 000 → 8000
      .replace(/(\d),(\d)/g, '$1.$2')                                   // 1,5 → 1.5
      .replace(/(\d)\s*(?:"|”|''|’’|pouces?\b)/gi, '$1 pouce ')          // 98" → 98 pouce
      .replace(/(\d)\s*V\b/g, '$1v');                                   // 100 V → 100v
    t = ' ' + normalize(t).replace(/\bcd m2?\b/g, 'nit') + ' ';
    for (const [k, v] of syn.phrases) t = t.split(' ' + k + ' ').join(' ' + v + ' ');
    const singular = w => (w.length > 3 && /[a-z][sx]$/.test(w) && !/(ss|us|is)$/.test(w)) ? w.slice(0, -1) : w;
    return t.trim().split(/\s+/).filter(Boolean)
      .flatMap(w => (syn.words.get(w) || syn.words.get(singular(w)) || w).split(' '))   // un synonyme peut valoir plusieurs mots
      .map(singular);
  }

  /** Valeurs numériques avec unité : « 5200 à 8200 lumens » → [5200 lumen, 8200 lumen]. */
  function extractNumbers(tokens) {
    const out = [];
    let pending = [];
    for (const t of tokens) {
      if (/^\d+(\.\d+)?$/.test(t)) { pending.push(Number(t)); continue; }
      if (UNITS[t] && pending.length) { for (const v of pending) out.push({ v, unit: t === 'canaux' ? 'canal' : t }); }
      if (!['a', 'et', 'ou', 'de', 'jusqu', 'x'].includes(t)) pending = [];
    }
    return out;
  }

  function buildCatalogueIndex(cat) {
    const syn = { words: new Map(), phrases: [] };
    for (const [k, v] of Object.entries(cat.synonyms || {})) {
      const nk = normalize(k), nv = normalize(v);
      if (!nk) continue;
      if (nk.includes(' ')) syn.phrases.push([nk, nv]); else syn.words.set(nk, nv);
    }
    syn.phrases.sort((a, b) => b[0].length - a[0].length);
    state.pSyn = syn;

    state.pIndex = [];
    for (const [id, entry] of Object.entries(cat.products || {})) {
      const pr = state.products.get(id);
      if (!pr) { console.warn('[DIAG·SAV] catalogue.json : produit inconnu dans decisions.json (' + id + ')'); continue; }
      const fam = state.families.get(pr.family);
      const facts = (entry.facts || []).map(text => {
        const tokens = pNormalize(text, syn);
        return { text, tokens, nums: extractNumbers(tokens) };
      });
      state.pIndex.push({
        id, pr, facts,
        fields: [
          { w: 6, tokens: pNormalize(pr.brand, syn) },
          { w: 6, tokens: pNormalize(pr.model, syn) },
          { w: 6, tokens: pNormalize(pr.ref, syn) },
          { w: 4, tokens: pNormalize(pr.type, syn) },
          { w: 3, tokens: pNormalize(fam ? fam.label : '', syn) }
        ]
      });
    }
    state.catalogue = cat;
  }

  const tokenHit = (tokens, q) => tokens.some(t => t === q || (q.length >= 3 && t.startsWith(q)));

  /**
   * Recherche : renvoie { results, partial }.
   * results : [{ entry, score, matchedFacts:Set<index> }] ; partial = aucun produit ne couvre tous les critères.
   */
  function productSearch(query) {
    const raw = pNormalize(query, state.pSyn).filter(t => !P_STOP.has(t));
    // contraintes numériques « 48 port », « 8000 lumen »
    const constraints = [];
    const words = [];
    for (let i = 0; i < raw.length; i++) {
      if (/^\d+(\.\d+)?$/.test(raw[i]) && UNITS[raw[i + 1]]) {
        constraints.push({ v: Number(raw[i]), unit: raw[i + 1] === 'canaux' ? 'canal' : raw[i + 1] });
        i++;
      } else words.push(raw[i]);
    }
    const total = words.length + constraints.length;
    if (!total) return { results: [], partial: false, criteria: 0 };

    const scored = [];
    for (const entry of state.pIndex) {
      let score = 0, hits = 0;
      const matchedFacts = new Set();
      words.forEach((q, qi) => {
        let best = 0;
        for (const f of entry.fields) if (f.w > best && tokenHit(f.tokens, q)) best = f.w;
        // le premier mot désigne souvent le type de produit cherché (« micro Dante PoE »)
        if (qi === 0 && (tokenHit(entry.fields[3].tokens, q) || tokenHit(entry.fields[4].tokens, q))) best += 3;
        entry.facts.forEach((f, i) => { if (tokenHit(f.tokens, q)) { matchedFacts.add(i); if (best < 2) best = 2; } });
        if (best) { score += best; hits++; }
      });
      for (const c of constraints) {
        let ok = false;
        entry.facts.forEach((f, i) => {
          const fits = n => n.unit === c.unit && (EXACT_UNITS.has(c.unit) ? Math.abs(n.v - c.v) < 0.5 : n.v >= c.v * 0.98);
          if (f.nums.some(fits)) { ok = true; matchedFacts.add(i); }
        });
        if (ok) { score += 5; hits++; }
      }
      if (hits) scored.push({ entry, score, hits, matchedFacts });
    }
    const full = scored.filter(r => r.hits === total);
    const sorter = (a, b) => b.score - a.score || a.entry.pr.brand.localeCompare(b.entry.pr.brand, 'fr');
    if (full.length) return { results: full.sort(sorter), partial: false, criteria: total };
    // correspondance partielle seulement si au moins 2 critères sont remplis (évite « sys » → « système »)
    const half = scored.filter(r => total > 2 && r.hits >= Math.max(2, Math.ceil(total / 2))).sort((a, b) => b.hits - a.hits || sorter(a, b));
    return { results: half, partial: half.length > 0, criteria: total };
  }

  function productCard(r) {
    const { pr, facts, id } = r.entry;
    const fam = state.families.get(pr.family);
    return h('li', null,
      h('article', { class: 'pcard' },
        h('header', { class: 'pcard__head' },
          h('h3', { class: 'pcard__title' }, h('a', { href: '#/produits/' + encodeURIComponent(id) }, productLabel(pr))),
          h('p', { class: 'pcard__type' }, pr.type + (fam ? ' · ' + fam.label : ''))
        ),
        h('ul', { class: 'pcard__facts' }, facts.map((f, i) =>
          h('li', { class: r.matchedFacts.has(i) ? 'is-match' : null }, f.text))),
        h('p', { class: 'pcard__src' },
          'Source : ' + productSourceLabel(pr) + (pr.ref ? ' · réf. ' + pr.ref : '')),
        h('div', { class: 'pcard__actions' },
          h('a', { class: 'btn btn--small btn--ghost', href: '#/produits/' + encodeURIComponent(id) }, 'Fiche et diagnostic →'))
      )
    );
  }

  /* ---------------------------------------------------------------------
     Catalogue : parcours par rayon, marque et famille (quand la recherche est vide)
     --------------------------------------------------------------------- */
  function catalogueHash(b) {
    const p = [];
    if (b.group) p.push('rayon=' + encodeURIComponent(b.group));
    if (b.brand) p.push('marque=' + encodeURIComponent(b.brand));
    return '#/produits' + (p.length ? '?' + p.join('&') : '');
  }

  function renderCatalogue(box) {
    const b = state.pBrowse || { group: '', brand: '' };
    const groupOf = (pr) => { const f = state.families.get(pr.family); return (f && f.group) || 'Autres'; };
    const all = state.pIndex.map(e => e.pr && { id: e.id, pr: e.pr, facts: e.facts }).filter(Boolean);
    const groups = [...new Set([...state.families.values()].map(f => f.group || 'Autres'))]
      .filter(g => all.some(x => groupOf(x.pr) === g));
    const inGroup = all.filter(x => !b.group || groupOf(x.pr) === b.group);
    const brands = [...new Set(inGroup.map(x => x.pr.brand))].sort((x, y) => x.localeCompare(y, 'fr'));
    const brand = brands.includes(b.brand) ? b.brand : '';
    const list = inGroup.filter(x => !brand || x.pr.brand === brand);
    const go = (next) => navigate(catalogueHash(next), { replace: true });

    const filters = h('div', { class: 'filters filters--text catalog__groups', role: 'group', 'aria-label': 'Rayons du catalogue' },
      [['', 'Tout'], ...groups.map(g => [g, g])].map(([id, label]) => h('button', {
        type: 'button', class: 'ftext', 'aria-pressed': String(b.group === id),
        dataset: { focusKey: 'g:' + id },
        onclick: () => { state.pFocusKey = 'g:' + id; go({ group: id, brand: '' }); }
      }, label, h('span', { class: 'ftext__n' }, String(all.filter(x => !id || groupOf(x.pr) === id).length)))));

    const sel = h('select', { id: 'catalog-brand', class: 'catalog__select', dataset: { focusKey: 'brand' }, onchange: (e) => { state.pFocusKey = 'brand'; go({ group: b.group, brand: e.target.value }); } },
      h('option', { value: '' }, 'Toutes les marques (' + brands.length + ')'),
      brands.map(br => h('option', { value: br, selected: br === brand },
        br + ' (' + inGroup.filter(x => x.pr.brand === br).length + ')')));

    // regroupement par famille, dans l'ordre des familles de decisions.json
    const famOrder = [...state.families.keys()];
    const byFam = new Map();
    for (const x of list) {
      if (!byFam.has(x.pr.family)) byFam.set(x.pr.family, []);
      byFam.get(x.pr.family).push(x);
    }
    const fams = [...byFam.keys()].sort((x, y) => famOrder.indexOf(x) - famOrder.indexOf(y));
    const row = (x) => h('li', null,
      h('a', { class: 'crow', href: '#/produits/' + encodeURIComponent(x.id) },
        h('span', { class: 'crow__name' }, h('span', { class: 'crow__brand' }, x.pr.brand), ' ', x.pr.model),
        h('span', { class: 'crow__type' }, x.pr.type),
        h('span', { class: 'crow__page' }, x.pr.page ? 'p. ' + x.pr.page : '')));
    const sections = fams.map(fid => {
      const f = state.families.get(fid);
      const items = byFam.get(fid).sort((x, y) => (x.pr.brand + x.pr.model).localeCompare(y.pr.brand + y.pr.model, 'fr'));
      return h('section', { class: 'catalog__fam', 'aria-labelledby': 'cf-' + fid },
        h('h2', { class: 'catalog__famtitle', id: 'cf-' + fid }, f ? f.label : fid, h('span', { class: 'catalog__n' }, String(items.length))),
        h('ul', { class: 'catalog__list' }, items.map(row)));
    });

    box.replaceChildren(
      h('div', { class: 'catalog' },
        h('div', { class: 'catalog__bar' },
          h('h2', { class: 'catalog__title' }, 'Parcourir le catalogue'),
          h('label', { class: 'visually-hidden', for: 'catalog-brand' }, 'Filtrer par marque'), sel),
        filters,
        h('p', { class: 'catalog__count', 'aria-live': 'polite' },
          list.length + ' produit' + (list.length > 1 ? 's' : '') + (b.group ? ' · ' + b.group : '') + (brand ? ' · ' + brand : '') +
          ' · ' + fams.length + ' famille' + (fams.length > 1 ? 's' : '')),
        ...sections));
    // le focus clavier reste sur le filtre utilisé
    if (state.pFocusKey) {
      const el = box.querySelector('[data-focus-key="' + state.pFocusKey + '"]');
      state.pFocusKey = null;
      if (el) el.focus({ preventScroll: true });
    }
  }

  const P_PAGE = 20;
  function renderProductResults(query, limit = P_PAGE) {
    const box = $('#products-results');
    const statusEl = $('#products-status');
    const q = query.trim();
    if (!q) {
      statusEl.replaceChildren();
      renderCatalogue(box);
      return;
    }
    const { results, partial } = productSearch(q);
    if (!results.length) {
      statusEl.replaceChildren(h('p', { class: 'pstatus__none' },
        'Aucun produit du catalogue ne correspond à « ' + q + ' ». ',
        'Essayez avec moins de mots, une marque ou une référence.'));
      box.replaceChildren();
      return;
    }
    statusEl.replaceChildren(h('p', { class: partial ? 'pstatus__partial' : null },
      partial
        ? 'Aucun produit ne remplit tous les critères. ' + results.length + ' produit' + (results.length > 1 ? 's' : '') + ' en remplissent une partie :'
        : results.length + ' produit' + (results.length > 1 ? 's' : '') + ' correspond' + (results.length > 1 ? 'ent' : '') + ' à « ' + q + ' » :'));
    const list = h('ul', { class: 'presults' }, results.slice(0, limit).map(productCard));
    const more = results.length > limit
      ? h('button', { type: 'button', class: 'btn btn--ghost presults__more', onclick: () => renderProductResults(query, limit + P_PAGE) },
          'Afficher ' + Math.min(P_PAGE, results.length - limit) + ' de plus (' + (results.length - limit) + ' restants)')
      : null;
    box.replaceChildren(list, more || '');
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
    const input = $('#psearch-input');
    if (route.productId) {
      renderProductDetail(route.productId);
      return;
    }
    $('#view-products').classList.remove('is-detail');
    if (route.query !== undefined && input.value !== route.query) input.value = route.query;
    state.lastPQuery = input.value;
    state.pBrowse = { group: route.group || '', brand: route.brand || '' };
    $('#product-detail').replaceChildren();
    renderProductResults(input.value);
  }

  /** Chemin le plus court (en suivant « next ») du départ d'un symptôme jusqu'à un nœud. */
  function findPath(symptom, targetId) {
    const queue = [[symptom.start]];
    const seen = new Set([symptom.start]);
    while (queue.length) {
      const path = queue.shift();
      const last = path[path.length - 1];
      if (last === targetId) return path;
      for (const o of (state.nodes[last] && state.nodes[last].options) || []) {
        if (o.next && !seen.has(o.next)) { seen.add(o.next); queue.push([...path, o.next]); }
      }
    }
    return null;
  }

  /** Résultats d'arbre ayant des étapes spécifiques pour ce produit (ou sa marque). */
  function brandStepLinks(pid, pr, symptomIds) {
    const links = [];
    for (const [nid, n] of Object.entries(state.nodes)) {
      const b = (n.brandSteps || []).find(x => (x.products || []).includes(pid));
      if (!b) continue;
      for (const sid of [...symptomIds, ...state.symptoms.keys()]) {
        const sym = state.symptoms.get(sid);
        const path = sym && findPath(sym, nid);
        if (path) { links.push({ sym, node: n, path, status: b.status }); break; }
      }
    }
    return links;
  }

  function renderProductDetail(pid) {
    const pr = state.products.get(pid);
    const box = $('#product-detail');
    box.dataset.pid = pid;
    $('#products-results').replaceChildren();
    $('#view-products').classList.add('is-detail');
    const back = h('a', { class: 'btn btn--small btn--ghost', href: state.lastPQuery ? '#/produits?q=' + encodeURIComponent(state.lastPQuery) : catalogueHash(state.pBrowse || {}) },
      '← ' + (state.lastPQuery ? 'Résultats pour « ' + state.lastPQuery + ' »' : 'Catalogue'));
    if (!pr) {
      $('#products-status').textContent = '';
      box.replaceChildren(h('div', { class: 'empty' }, 'Ce produit n\'existe pas dans le catalogue. ', back));
      return;
    }
    renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Assistant produit', href: '#/produits' }, { label: productLabel(pr) }]);
    $('#products-status').textContent = '';
    const fam = state.families.get(pr.family);
    const entry = state.catalogue.products[pid];
    const symptomIds = ((fam && fam.symptoms) || []).filter(id => state.symptoms.has(id));
    const steps = brandStepLinks(pid, pr, symptomIds);
    const siblings = [...state.products.entries()].filter(([id, p]) => p.family === pr.family && id !== pid);

    const diagCard = (sid, i) => {
      const sym = state.symptoms.get(sid);
      const cat = categoryOf(sym);
      return h('li', null, h('a', {
        class: 'card card--compact', href: diagHash(sym.id, [sym.start]),
        onclick: () => { state.focusProduct = pid; }
      },
        h('span', { class: 'card__top' }, h('span', { class: 'card__cat' }, icon(cat.icon), cat.label),
          i === 0 ? h('span', { class: 'badge badge--low' }, 'Symptôme principal') : null),
        h('h3', { class: 'card__title' }, sym.title),
        h('span', { class: 'card__go', 'aria-hidden': 'true' }, 'Démarrer le diagnostic →')));
    };

    box.replaceChildren(h('article', { class: 'pdetail' },
      h('div', { class: 'pdetail__nav' }, back, h('a', { class: 'btn btn--small btn--ghost', href: '#/comparer?ids=' + encodeURIComponent(pid) }, 'Comparer avec…')),
      h('header', { class: 'pdetail__head' },
        h('p', { class: 'eyebrow' }, pr.type),
        h('h2', { class: 'pdetail__title', tabindex: '-1', 'data-focus': true }, productLabel(pr)),
        h('dl', { class: 'pdetail__meta' },
          h('dt', null, 'Famille'), h('dd', null, fam ? fam.label : '—'),
          pr.ref ? [h('dt', null, 'Référence'), h('dd', null, pr.ref)] : null,
          h('dt', null, 'Source'), h('dd', null, productSourceLabel(pr) || '—'))
      ),
      h('section', { class: 'panel pdetail__block' },
        h('div', { class: 'panel__body' },
          h('h3', { class: 'block-title' }, 'Caractéristiques'),
          entry && entry.facts && entry.facts.length
            ? h('ul', { class: 'pcard__facts' }, entry.facts.map(f => h('li', null, f)))
            : h('p', { class: 'muted' }, 'Aucune caractéristique saisie pour ce produit.'),
          h('p', { class: 'pcard__src' }, 'Source : ' + productSourceLabel(pr) + (pr.ref ? ' · réf. ' + pr.ref : '')))),
      h('section', { class: 'pdetail__block' },
        h('h3', { class: 'section-title' }, 'Diagnostiquer ce produit'),
        symptomIds.length
          ? h('ul', { class: 'grid' }, symptomIds.map(diagCard))
          : h('p', { class: 'muted' }, 'Aucun arbre de décision n\'est encore rattaché à cette famille.')),
      steps.length ? h('section', { class: 'pdetail__block' },
        h('h3', { class: 'block-title' }, 'Étapes spécifiques à ce produit'),
        h('ul', { class: 'pdetail__steps' }, steps.map(st => h('li', null,
          h('a', { href: diagHash(st.sym.id, st.path), onclick: () => { state.focusProduct = pid; } },
            st.node.title, h('span', { class: 'muted' }, ' — ' + st.sym.title)),
          st.status === 'draft' ? [' ', h('span', { class: 'badge badge--draft' }, 'À valider')] : null)))) : null,
      h('div', { id: 'pdetail-links' }),
      siblings.length ? h('section', { class: 'pdetail__block' },
        h('h3', { class: 'block-title' }, 'Même famille (' + siblings.length + ')'),
        h('div', { class: 'related' }, siblings.map(([id, p]) =>
          h('a', { class: 'chip', href: '#/produits/' + encodeURIComponent(id) }, productLabel(p))))) : null
    ));
    const heading = box.querySelector('[data-focus]');
    if (heading) heading.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    renderProductLinks(pid);
  }

  /** Fiche produit : recommandations et actualités qui citent ce produit (fichiers facultatifs). */
  async function renderProductLinks(pid) {
    const [reco, news] = await Promise.all([
      loadJson('data/reco.json').catch(() => null),
      loadJson('data/news.json').catch(() => null)]);
    const slot = $('#pdetail-links');
    if (!slot || $('#product-detail').dataset.pid !== pid) return;
    const recos = reco ? Object.entries(reco.nodes || {}).filter(([, n]) => n.type === 'result' && (n.items || []).some(it => it.product === pid)) : [];
    const recoPaths = recos.map(([id, n]) => ({ n, path: recoPathTo(reco, id) })).filter(x => x.path);
    const items = news ? (news.items || []).filter(it => (it.products || []).includes(pid)).sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];
    slot.replaceChildren(...[
      items.length ? h('section', { class: 'pdetail__block' },
        h('h3', { class: 'block-title' }, 'Dans la veille (' + items.length + ')'),
        h('ul', { class: 'plinks' }, items.map(it => h('li', null,
          h('a', { href: '#/veille?f=' + encodeURIComponent(it.category) }, it.title),
          h('span', { class: 'muted' }, ' · ' + fmtDate(it.date) + ' · impact ' + String(((news.impacts || {})[it.impact] || {}).label || it.impact || '?').toLowerCase()))))) : null,
      recoPaths.length ? h('section', { class: 'pdetail__block' },
        h('h3', { class: 'block-title' }, 'Recommandé pour'),
        h('ul', { class: 'plinks' }, recoPaths.map(({ n, path }) => h('li', null, h('a', { href: recoHash(path) }, n.title))))) : null].filter(Boolean));
  }

  /** Chemin (sans le départ) qui mène du départ de reco.json au nœud id. */
  function recoPathTo(data, target) {
    const nodes = data.nodes || {};
    const queue = [[data.start, []]];
    const seen = new Set();
    while (queue.length) {
      const [id, path] = queue.shift();
      if (id === target) return path;
      if (seen.has(id) || !nodes[id] || nodes[id].type !== 'question') continue;
      seen.add(id);
      for (const o of nodes[id].options || []) queue.push([o.next, [...path, o.next]]);
    }
    return null;
  }

  let pTimer = null;
  function onProductInput() {
    clearTimeout(pTimer);
    pTimer = setTimeout(() => {
      const q = $('#psearch-input').value;
      history.replaceState(null, '', '#/produits' + (q.trim() ? '?q=' + encodeURIComponent(q.trim()) : ''));
      if ($('#view-products').classList.contains('is-detail')) onRoute();   // on quitte la fiche pour les résultats
      else if (state.pIndex) { state.lastPQuery = q; renderProductResults(q); }
    }, 120);
  }

  /* ---------------------------------------------------------------------
     Éditeur (editor.js, chargé seulement à la demande) et mode test
     --------------------------------------------------------------------- */
  /** Charge un script du site une seule fois (editor.js, pdf.js) et renvoie l'objet global qu'il définit. */
  const scriptPromises = {};
  function loadScript(file, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (!scriptPromises[file]) {
      scriptPromises[file] = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = new URL(file, SCRIPT_URL).href;
        sc.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error(file + ' chargé mais inactif'));
        sc.onerror = () => reject(new Error(file + ' introuvable (' + sc.src + ')'));
        document.head.append(sc);
      });
      scriptPromises[file].catch(() => { delete scriptPromises[file]; });
    }
    return scriptPromises[file];
  }
  const loadEditor = () => loadScript('editor.js', 'DIAGSAV_EDITOR');

  async function renderEditor(route) {
    if (state.preview) stopPreview(false);
    showView('editor');
    renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Éditeur des procédures', href: '#/editeur' }]);
    const root = $('#editor-root');
    try {
      const ed = await loadEditor();
      ed.render(route, root);
    } catch (err) {
      console.error('[DIAG·SAV] Éditeur :', err);
      root.replaceChildren(h('p', { class: 'pstatus__error' }, 'L\'éditeur n\'a pas pu être chargé. ', h('code', null, err.message)));
    }
  }

  /** Mode test : l'application tourne sur les données de l'éditeur, sans rien publier. */
  function startPreview(decisions, catalogue, hash, extra = {}) {
    state.preview = true;
    state.previewReco = extra.reco ? JSON.parse(JSON.stringify(extra.reco)) : null;
    state.previewNews = extra.news ? JSON.parse(JSON.stringify(extra.news)) : null;
    state.recoChecked = null; state.newsChecked = null;
    ingest(JSON.parse(JSON.stringify(decisions)));
    if (catalogue) {
      buildCatalogueIndex(JSON.parse(JSON.stringify(catalogue)));
      cataloguePromise = Promise.resolve(state.catalogue);
    }
    $('#preview-banner').hidden = false;
    document.body.classList.add('is-preview');
    navigate(hash || '#/');
  }

  function stopPreview(goBack = true) {
    if (!state.preview) return;
    state.preview = false;
    ingest(JSON.parse(JSON.stringify(state.published)));
    state.pIndex = null; state.catalogue = null; cataloguePromise = null;
    state.previewReco = null; state.previewNews = null; state.recoChecked = null; state.newsChecked = null;
    $('#preview-banner').hidden = true;
    document.body.classList.remove('is-preview');
    if (goBack) navigate('#/editeur');
  }

  /* Interface exposée à editor.js (même origine, aucun appel externe). */
  window.DIAGSAV = {
    h, icon, normalize, truncate, toast, jsonErrorPosition, validateDetailed, severityInfo, SEVERITY_ORDER, isLocalImage,
    published: () => state.published,
    loadPublishedJson: path => loadJson(path).then(o => JSON.parse(JSON.stringify(o))),
    validateReco, validateNews,
    loadPublishedCatalogue: async () => {
      const res = await fetch(CATALOGUE_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + CATALOGUE_URL);
      return res.json();
    },
    startPreview, stopPreview, navigate,
    // pour pages.js
    loadJson, loadCatalogue, renderCrumbs, diagHash, productLabel, productSourceLabel, copyText, downloadFile,
    data: () => ({ products: state.products, families: state.families, symptoms: state.symptoms, nodes: state.nodes, productsBySymptom: state.productsBySymptom, categories: state.categories }),
    reducedMotion: () => !motionOk()
  };

  /* ---------------------------------------------------------------------
     Données JSON secondaires (reco.json, news.json) : chargées à la demande,
     erreurs détaillées (adresse, statut HTTP, ligne de l'erreur de syntaxe).
     --------------------------------------------------------------------- */
  const jsonPromises = {};
  function loadJson(path) {
    if (!jsonPromises[path]) {
      const url = new URL(path, SCRIPT_URL).href;
      jsonPromises[path] = (async () => {
        let res;
        try { res = await fetch(url, { cache: 'no-cache' }); }
        catch (err) { throw new Error('Téléchargement impossible (' + (err && err.message || err) + ') — ' + url); }
        if (!res.ok) throw new Error('HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '') + ' — ' + url);
        const text = await res.text();
        try { return JSON.parse(text); }
        catch (err) { throw new Error('Erreur de syntaxe dans ' + path + jsonErrorPosition(text, err) + ' : ' + err.message); }
      })();
      jsonPromises[path].catch(() => { delete jsonPromises[path]; });
    }
    return jsonPromises[path];
  }

  function loadError(box, what, err) {
    console.error('[DIAG·SAV] ' + what + ' :', err);
    box.replaceChildren(h('div', { class: 'pstatus' }, h('p', { class: 'pstatus__error' }, what + ' n\'a pas pu être chargé. ', h('code', null, err.message))));
  }

  /* ---------------------------------------------------------------------
     Recommander (avant-vente) : arbre de questions → carte de recommandation
     --------------------------------------------------------------------- */
  /** Contrôle de reco.json, messages en français. */
  function validateReco(data, hasProduct = pid => state.products.has(pid)) {
    const w = [];
    const nodes = (data && data.nodes) || {};
    if (!data || typeof data !== 'object') return ['Le fichier reco.json est vide ou mal formé.'];
    if (!data.start) w.push('reco.json : aucune question de départ (champ « start »).');
    else if (!nodes[data.start]) w.push('reco.json : la question de départ « ' + data.start + ' » n\'existe pas.');
    for (const [id, n] of Object.entries(nodes)) {
      const name = n.type === 'result' ? 'la recommandation « ' + truncate(n.title || id, 60) + ' »' : 'la question « ' + truncate(n.text || id, 60) + ' »';
      if (n.type === 'question') {
        if (!n.text) w.push('Une question de reco.json n\'a pas de texte (« ' + id + ' »).');
        if (!Array.isArray(n.options) || !n.options.length) w.push(cap(name) + ' n\'a aucune réponse.');
        for (const o of n.options || []) {
          if (!o.label) w.push(cap(name) + ' a une réponse sans libellé.');
          if (!o.next) w.push('La réponse « ' + (o.label || '?') + ' » de ' + name + ' ne mène nulle part.');
          else if (!nodes[o.next]) w.push('La réponse « ' + (o.label || '?') + ' » de ' + name + ' mène vers « ' + o.next + ' », qui n\'existe pas.');
        }
      } else if (n.type === 'result') {
        if (!n.title) w.push('Une recommandation n\'a pas de titre (« ' + id + ' »).');
        if (!Array.isArray(n.items) || !n.items.length) w.push(cap(name) + ' ne propose aucun produit.');
        (n.items || []).forEach((it, i) => {
          if (!it.product) w.push(cap(name) + ' : la ligne ' + (i + 1) + ' n\'indique pas de produit.');
          else if (!hasProduct(it.product)) w.push(cap(name) + ' cite un produit inconnu du catalogue (« ' + it.product + ' »).');
          if (it.qty != null && !(Number.isInteger(it.qty) && it.qty > 0)) w.push(cap(name) + ' : la quantité de la ligne ' + (i + 1) + ' doit être un nombre entier positif.');
        });
      } else {
        w.push('reco.json : l\'étape « ' + id + ' » a un type inconnu (« ' + n.type + ' ») : attendu question ou result.');
      }
    }
    return w;
  }

  function recoHash(path) { return '#/recommander' + (path.length ? '/' + path.map(encodeURIComponent).join('/') : ''); }

  /** Nombre maximal de questions restantes, question courante comprise (protégé contre les cycles). */
  function recoDepth(nodes, id, seen = new Set()) {
    const n = nodes[id];
    if (!n || n.type !== 'question' || seen.has(id)) return 0;
    seen.add(id);
    const best = Math.max(0, ...(n.options || []).map(o => recoDepth(nodes, o.next, seen)));
    seen.delete(id);
    return 1 + best;
  }

  /** Liens directs vers les symptômes fréquents (champ « frequent » de decisions.json). */
  function renderQuickLinks() {
    const all = [...state.symptoms.values()];
    let list = all.filter(s => s.frequent);
    if (!list.length) list = all.slice(0, 4);
    for (const box of [$('#hub-quick'), $('#search-hint')]) {
      if (!box) continue;
      box.replaceChildren(h('span', { class: 'quick__label' }, 'Fréquents :'),
        ...list.map(s => h('a', { class: 'slink', href: diagHash(s.id, [s.start]) }, s.title)));
    }
  }

  async function renderReco(route) {
    showView('reco');
    const box = $('#reco-root');
    let data;
    try { data = await loadJson('data/reco.json'); }
    catch (err) { renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Recommander' }]); return loadError(box, 'Le fichier des recommandations (data/reco.json)', err); }
    if (state.preview && state.previewReco) data = state.previewReco;
    const nodes = data.nodes || {};
    if (!state.recoChecked || state.recoChecked !== data) {
      state.recoChecked = data;
      state.recoIssues = validateReco(data);
      if (state.recoIssues.length) console.warn('[DIAG·SAV] Anomalies dans reco.json :\n- ' + state.recoIssues.join('\n- '));
    }
    if (!nodes[data.start]) {
      renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Recommander' }]);
      box.replaceChildren(h('div', { class: 'empty' }, 'Aucune recommandation n\'est encore configurée (data/reco.json).'));
      return;
    }
    // chemin : départ + étapes reliées
    const path = [data.start];
    for (const id of route.path || []) {
      const prev = nodes[path[path.length - 1]];
      if (!prev || prev.type !== 'question' || !(prev.options || []).some(o => o.next === id) || !nodes[id]) break;
      path.push(id);
    }
    const canonical = recoHash(path.slice(1));
    if (location.hash !== canonical && (route.path || []).length !== path.length - 1) history.replaceState(null, '', canonical);

    const current = nodes[path[path.length - 1]];
    const answers = path.slice(0, -1).map((id, i) => {
      const q = nodes[id];
      const o = (q.options || []).find(x => x.next === path[i + 1]);
      return { q, label: q.label || q.text, answer: o ? o.label : '?', index: i };
    });

    renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Recommander', href: '#/recommander' },
      ...path.slice(1).map((id, i) => ({ label: nodes[id].type === 'result' ? 'Recommandation' : (nodes[id].label || 'Étape ' + (i + 2)), href: recoHash(path.slice(1, i + 2)) }))]);

    const recap = answers.length ? h('ol', { class: 'reco-recap' }, answers.map(a => h('li', null,
      h('a', { href: recoHash(path.slice(1, a.index + 1)), title: 'Modifier cette réponse' },
        h('span', { class: 'reco-recap__q' }, a.label), h('span', { class: 'reco-recap__a' }, a.answer))))) : null;

    let stage;
    if (current.type === 'question') {
      stage = h('article', { class: 'panel question' },
        h('header', { class: 'panel__head' }, h('span', { class: 'panel__tag' }, 'Étape ' + path.length + '/' + (path.length - 1 + recoDepth(nodes, path[path.length - 1]))), h('span', null, current.label || 'Question')),
        h('div', { class: 'panel__body' },
          h('h2', { class: 'question__text', tabindex: '-1', 'data-focus': true }, current.text),
          current.help ? h('p', { class: 'question__help' }, current.help) : null,
          h('ul', { class: 'options', role: 'list' }, (current.options || []).map((o, i) => h('li', null,
            h('button', { type: 'button', class: 'option', dataset: { index: String(i) }, disabled: nodes[o.next] ? null : true,
              onclick: () => navigate(recoHash([...path.slice(1), o.next])) },
              h('span', { class: 'option__key', 'aria-hidden': 'true' }, String(i + 1)),
              h('span', null, o.label),
              h('span', { class: 'option__arrow', 'aria-hidden': 'true' }, '→')))))));
    } else {
      const items = (current.items || []).map(it => ({ it, pr: state.products.get(it.product) }));
      stage = h('article', { class: 'panel reco-result' },
        h('header', { class: 'panel__head' }, h('span', { class: 'panel__tag' }, 'Recommandation')),
        h('div', { class: 'panel__body' },
          h('h2', { class: 'result__title', tabindex: '-1', 'data-focus': true }, current.title),
          draftBadge(current.status),
          current.summary ? h('p', { class: 'result__summary' }, current.summary) : null,
          h('ul', { class: 'reco-items' }, items.map(({ it, pr }) => h('li', { class: 'reco-item' },
            h('span', { class: 'reco-item__qty' }, (it.qty || 1) + ' ×'),
            h('div', { class: 'reco-item__main' },
              pr ? h('a', { class: 'reco-item__name', href: '#/produits/' + encodeURIComponent(it.product) }, productLabel(pr))
                 : h('span', { class: 'reco-item__name is-bad' }, '⚠ Produit inconnu : ' + it.product),
              pr ? h('span', { class: 'reco-item__type' }, pr.type + (productSourceLabel(pr) ? ' · ' + productSourceLabel(pr) : '')) : null,
              it.why ? h('span', { class: 'reco-item__why' }, it.why) : null)))),
          current.notes ? h('p', { class: 'callout callout--escalate' }, h('span', { class: 'callout__icon', 'aria-hidden': 'true' }, 'i'), h('span', null, current.notes)) : null,
          (data.meta && data.meta.disclaimer) ? h('p', { class: 'result__sevdesc' }, data.meta.disclaimer) : null,
          h('div', { class: 'result__footer' },
            h('button', { type: 'button', class: 'btn btn--primary', onclick: () => copyText(buildQuote(data, current, answers, items), '✓ Devis copié dans le presse-papiers') }, 'Copier le devis'),
            h('a', { class: 'btn', href: '#/recommander' }, 'Nouvelle recommandation'))));
    }

    box.replaceChildren(...[
      h('div', { class: 'phead' },
        h('p', { class: 'eyebrow' }, 'Avant-vente'),
        h('h1', { class: 'phead__title' }, (data.meta && data.meta.title) || 'Recommander')),
      state.recoIssues.length ? h('p', { class: 'reco-warn' }, '⚠ ' + state.recoIssues.length + ' anomalie(s) dans data/reco.json (détail dans la console).') : null,
      h('div', { class: 'reco' },
        h('div', { class: 'reco__main' }, stage,
          h('div', { class: 'diag__controls' },
            path.length > 1 ? h('a', { class: 'btn btn--ghost', href: recoHash(path.slice(1, -1)) }, '← Étape précédente') : null,
            path.length > 1 ? h('a', { class: 'btn btn--ghost', href: '#/recommander' }, '↺ Recommencer') : null)),
        recap ? h('aside', { class: 'reco__aside' }, h('h2', { class: 'reco-aside__title' }, 'Vos réponses'), recap) : null)
    ].filter(Boolean));
    const heading = box.querySelector('[data-focus]');
    if (heading) heading.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------------
     Veille technologique (news.json) : cartes filtrables
     --------------------------------------------------------------------- */
  const IMPACT_SEV = { faible: 'low', moyen: 'moderate', eleve: 'high' };

  function validateNews(data, hasProduct = pid => state.products.has(pid)) {
    const w = [];
    if (!data || !Array.isArray(data.items)) return ['news.json : la liste « items » est absente.'];
    const cats = new Set((data.categories || []).map(c => c.id));
    const ids = new Set();
    data.items.forEach((it, i) => {
      const name = '« ' + truncate(it.title || it.id || 'n° ' + (i + 1), 60) + ' »';
      if (!it.id) w.push('L\'actualité ' + name + ' n\'a pas d\'identifiant.');
      else if (ids.has(it.id)) w.push('Deux actualités portent l\'identifiant « ' + it.id + ' ».');
      ids.add(it.id);
      if (!it.title) w.push('Une actualité n\'a pas de titre (« ' + it.id + ' »).');
      if (!cats.has(it.category)) w.push('L\'actualité ' + name + ' a une catégorie inconnue (« ' + it.category + ' ») : attendu ' + [...cats].join(', ') + '.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date || '') || isNaN(Date.parse(it.date))) w.push('L\'actualité ' + name + ' a une date invalide (« ' + it.date + ' ») : format AAAA-MM-JJ.');
      if (!IMPACT_SEV[it.impact]) w.push('L\'actualité ' + name + ' a un impact SAV invalide (« ' + it.impact + ' ») : faible, moyen ou eleve.');
      if (!it.source || !it.source.name) w.push('L\'actualité ' + name + ' n\'indique pas sa source.');
      else if (it.source.url && !/^https:\/\//.test(it.source.url)) w.push('Le lien de la source de ' + name + ' doit commencer par https://.');
      for (const pid of it.products || []) if (!hasProduct(pid)) w.push('L\'actualité ' + name + ' cite un produit inconnu du catalogue (« ' + pid + ' »).');
    });
    return w;
  }

  const fmtDate = iso => { const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? iso : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); };

  async function renderNews(route) {
    showView('news');
    renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Veille' }]);
    const box = $('#news-root');
    let data;
    try { data = await loadJson('data/news.json'); }
    catch (err) { return loadError(box, 'Le fichier de veille (data/news.json)', err); }
    if (state.preview && state.previewNews) data = state.previewNews;
    if (state.newsChecked !== data) {
      state.newsChecked = data;
      state.newsIssues = validateNews(data);
      if (state.newsIssues.length) console.warn('[DIAG·SAV] Anomalies dans news.json :\n- ' + state.newsIssues.join('\n- '));
    }
    const cats = data.categories || [];
    const items = [...(data.items || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const filter = cats.some(c => c.id === route.filter) ? route.filter : 'all';
    const shown = filter === 'all' ? items : items.filter(it => it.category === filter);
    const impacts = data.impacts || {};
    const catLabel = id => (cats.find(c => c.id === id) || {}).label || id;

    const filters = h('nav', { class: 'filters filters--text', 'aria-label': 'Filtrer la veille' },
      [{ id: 'all', label: 'Tout' }, ...cats].map(c => {
        const n = c.id === 'all' ? items.length : items.filter(it => it.category === c.id).length;
        return h('a', { class: 'ftext', href: '#/veille' + (c.id === 'all' ? '' : '?f=' + encodeURIComponent(c.id)), 'aria-current': c.id === filter ? 'true' : null },
          c.label, h('span', { class: 'ftext__n' }, String(n)));
      }));

    const card = it => {
      const sev = IMPACT_SEV[it.impact] || 'low';
      const imp = impacts[it.impact] || {};
      const prods = (it.products || []).map(pid => [pid, state.products.get(pid)]);
      return h('li', null, h('article', { class: 'news' },
        h('div', { class: 'news__meta' },
          h('span', { class: 'news__cat' }, catLabel(it.category)),
          h('time', { class: 'news__date', datetime: it.date }, fmtDate(it.date))),
        h('h2', { class: 'news__title' }, it.title),
        h('p', { class: 'news__impact' }, h('span', { class: 'badge badge--' + sev, title: imp.description || null }, 'Impact SAV · ' + (imp.label || it.impact))),
        it.summary ? h('p', { class: 'news__summary' }, it.summary) : null,
        it.action ? h('p', { class: 'news__action' }, h('strong', null, 'À faire : '), it.action) : null,
        prods.length ? h('p', { class: 'news__products' }, 'Matériel : ', prods.map(([pid, pr], i) => [i ? ', ' : '',
          pr ? h('a', { href: '#/produits/' + encodeURIComponent(pid) }, productLabel(pr)) : h('span', { class: 'is-bad' }, '⚠ ' + pid)])) : null,
        it.source ? h('p', { class: 'news__source' }, 'Source : ',
          it.source.url && /^https:\/\//.test(it.source.url)
            ? h('a', { href: it.source.url, target: '_blank', rel: 'noopener noreferrer' }, it.source.name || it.source.url, h('span', { class: 'visually-hidden' }, ' (ouvre un nouvel onglet)'))
            : it.source.name) : null));
    };

    box.replaceChildren(...[
      h('div', { class: 'phead' }, h('p', { class: 'eyebrow' }, 'Mise à jour ' + fmtDate((data.meta && data.meta.updated) || '')), h('h1', { class: 'phead__title' }, (data.meta && data.meta.title) || 'Veille')),
      state.newsIssues.length ? h('p', { class: 'reco-warn' }, '⚠ ' + state.newsIssues.length + ' anomalie(s) dans data/news.json (détail dans la console).') : null,
      filters,
      h('p', { class: 'visually-hidden', 'aria-live': 'polite' }, shown.length + ' actualité' + (shown.length > 1 ? 's' : '') + ' affichée' + (shown.length > 1 ? 's' : '')),
      shown.length ? h('ul', { class: 'news-list' }, shown.map(card)) : h('p', { class: 'empty' }, 'Aucune actualité dans cette catégorie.'),
      (data.meta && data.meta.note) ? h('p', { class: 'muted news-note' }, data.meta.note) : null
    ].filter(Boolean));
  }

  /** Texte de devis pré-rempli, sans prix (le catalogue n'en contient pas). */
  function buildQuote(data, result, answers, items) {
    const now = new Date();
    const L = [];
    L.push('=== DEVIS — RECOMMANDATION AVANT-VENTE ===');
    L.push('Date : ' + now.toLocaleDateString('fr-FR'));
    L.push('Client : ____________________   Événement : ____________________   Date(s) : __________');
    L.push('');
    L.push('Besoin exprimé :');
    answers.forEach(a => L.push('  - ' + a.label + ' : ' + a.answer));
    L.push('');
    L.push('Proposition : ' + result.title);
    if (result.summary) L.push('  ' + result.summary);
    L.push('');
    L.push('Matériel :');
    items.forEach(({ it, pr }) => {
      const name = pr ? productLabel(pr) : '(produit inconnu : ' + it.product + ')';
      const ref = pr && pr.ref ? ' — réf. ' + pr.ref : '';
      const src = pr && productSourceLabel(pr) ? ' (' + productSourceLabel(pr) + ')' : '';
      L.push('  ' + (it.qty || 1) + ' × ' + name + ref + src);
      if (it.why) L.push('      ' + it.why);
      L.push('      Prix unitaire : à compléter');
    });
    if (result.notes) { L.push(''); L.push('Remarques : ' + result.notes); }
    L.push('');
    L.push('Prestations (installation, exploitation, transport) : à compléter');
    L.push('Total HT : à compléter');
    L.push('');
    L.push((data.meta && data.meta.disclaimer) || 'Recommandation indicative, à valider.');
    return L.join('\n');
  }

  async function copyText(text, okMsg) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const ta = h('textarea', { style: 'position:fixed;opacity:0;left:-9999px', readonly: true });
        ta.value = text; document.body.append(ta); ta.select();
        const ok = document.execCommand('copy'); ta.remove();
        if (!ok) throw new Error('execCommand');
      }
      toast(okMsg);
    } catch { toast('Copie impossible sur ce navigateur'); }
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
    const noteText = notes.get(rootSymptom.id).trim();
    if (noteText) { lines.push('', 'Notes du technicien :'); noteText.split('\n').forEach(l => lines.push('  ' + l)); }
    if (node.escalate) lines.push('Escalade  : ' + node.escalate);
    lines.push('', 'Lien : ' + location.href);
    return lines.join('\n');
  }

  /* ---------------------------------------------------------------------
     Rapport PDF (pdf.js, généré dans le navigateur, hors ligne)
     --------------------------------------------------------------------- */
  const SEV_COLOR = { low: '#4f7a26', moderate: '#b8741a', high: '#c23b33' };

  async function exportPdf(node, rootSymptom, active, steps) {
    let PDF;
    try { PDF = await loadScript('pdf.js', 'DIAGSAV_PDF'); }
    catch (err) { toast('Export PDF indisponible : ' + err.message); return; }

    const now = new Date();
    const meta = state.data.meta || {};
    const focus = state.focusProduct && state.products.get(state.focusProduct);
    const sev = SEVERITY_ORDER.includes(node.severity) ? node.severity : 'moderate';
    const checks = document.querySelectorAll('#diag-stage .action input');
    const doc = PDF.create({ title: 'Diagnostic SAV — ' + node.title, footer: 'DIAG·SAV — rapport de diagnostic du ' + now.toLocaleDateString('fr-FR') });

    doc.text('Rapport de diagnostic', { size: 20, bold: true, after: 4 });
    doc.text(rootSymptom.title + (active !== rootSymptom ? ' → ' + active.title : ''), { size: 12, color: '#555555', after: 8 });
    doc.row('Date', now.toLocaleString('fr-FR'));
    doc.row('Procédures', 'v' + (meta.version || '?') + (meta.updated ? ' du ' + meta.updated : ''));
    if (focus) doc.row('Matériel', productLabel(focus) + (focus.ref ? ' — réf. ' + focus.ref : '') + ' (' + productSourceLabel(focus) + ')');
    if (state.preview) doc.row('Attention', 'rapport établi en mode test (procédures non publiées)', { color: '#b8741a' });

    doc.heading('Résultat');
    doc.band('Gravité ' + severityInfo(sev).label + '  —  ' + node.title, SEV_COLOR[sev]);
    if (node.summary) doc.text(node.summary, { after: 2 });
    if (severityInfo(sev).description) doc.text(severityInfo(sev).description, { size: 9.5, color: '#666666' });

    doc.heading('Actions recommandées');
    (node.actions || []).forEach((a, i) => {
      const done = checks[i] && checks[i].checked;
      doc.item(done ? '[x]' : '[  ]', (i + 1) + '. ' + a, { markerBold: true, markerColor: done ? '#4f7a26' : '#999999', color: done ? '#555555' : '#111111' });
    });
    if (node.warning) { doc.space(4); doc.text('Attention : ' + node.warning, { bold: true, color: '#c23b33' }); }
    if (node.escalate) { doc.space(4); doc.text('Escalade : ' + node.escalate, { color: '#1f5f86' }); }

    const brands = (node.brandSteps || []).filter(b => !focus || (b.products || []).includes(state.focusProduct) || b.brand.includes(focus.brand));
    if (brands.length) {
      doc.heading('Selon le matériel');
      for (const b of brands) {
        doc.text(b.brand + (b.status === 'draft' ? ' (procédure à valider)' : ''), { bold: true, after: 2 });
        (b.actions || []).forEach(a => doc.item('•', a));
        const prods = (b.products || []).map(pid => state.products.get(pid)).filter(Boolean);
        if (prods.length) doc.text('Références : ' + prods.map(p => productLabel(p) + (p.page ? ' (p. ' + p.page + ')' : '')).join(', '), { size: 8.5, color: '#777777', after: 6 });
      }
    }

    doc.heading('Parcours');
    steps.forEach((st, i) => {
      doc.item((i + 1) + '.', st.node.text, { markerBold: true, after: 0 });
      doc.text('→ ' + (st.option ? st.option.label : '?') + (st.jump ? '  (bascule vers « ' + st.jump.title + ' »)' : ''), { indent: 18, bold: true, color: '#333333', after: 4 });
    });

    const noteText = notes.get(rootSymptom.id).trim();
    if (noteText) {
      doc.heading('Notes du technicien');
      doc.text(noteText);
    }

    doc.rule();
    doc.text('Lien vers ce diagnostic : ' + location.href, { size: 8, color: '#777777' });
    doc.text((meta.disclaimer || ''), { size: 8, color: '#777777' });

    const pad = n => String(n).padStart(2, '0');
    const name = 'rapport-diagnostic-' + localDate(now) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + '.pdf';
    const url = URL.createObjectURL(doc.toBlob());
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('✓ ' + name);
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
    window.addEventListener('hashchange', routeWithTransition);

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


    // reflet qui suit le pointeur sur les cartes
    $('#symptom-grid').addEventListener('pointermove', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });

    $('#psearch-input').addEventListener('input', onProductInput);
    $('#psearch-form').addEventListener('submit', (e) => { e.preventDefault(); onProductInput(); $('#psearch-input').blur(); });
    document.querySelectorAll('[data-psuggest]').forEach(btn => btn.addEventListener('click', () => {
      $('#psearch-input').value = btn.dataset.psuggest;
      onProductInput();
    }));

    $('#btn-exit-preview').addEventListener('click', () => stopPreview(true));
    $('#gsearch-input').addEventListener('input', () => {
      clearTimeout(gTimer);
      gTimer = setTimeout(() => runGlobalSearch($('#gsearch-input').value), 150);
    });
    $('#gsearch-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await runGlobalSearch($('#gsearch-input').value);
      if (state.gFirst) navigate(state.gFirst);
    });
    $('#lightbox-close').addEventListener('click', closeLightbox);
    $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
    $('#btn-prepare-offline').addEventListener('click', prepareOffline);

    let notesTimer = null;
    $('#notes-input').addEventListener('input', () => {
      clearTimeout(notesTimer);
      $('#notes-state').textContent = '…';
      notesTimer = setTimeout(() => {
        if (!state.notesSymptom) return;
        const ok = notes.set(state.notesSymptom, $('#notes-input').value);
        $('#notes-state').textContent = ok ? ($('#notes-input').value.trim() ? 'enregistrées' : '') : 'non enregistrées';
      }, 400);
    });
    $('#btn-clear-notes').addEventListener('click', () => {
      if (!state.notesSymptom) return;
      $('#notes-input').value = '';
      notes.set(state.notesSymptom, '');
      $('#notes-state').textContent = '';
      toast('Notes effacées');
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
      if (e.key === 'Escape' && closeLightbox()) { e.preventDefault(); return; }
      if (!$('#lightbox').hidden) return;
      const route = parseHash();
      // Ctrl+K / Cmd+K : recherche, depuis n'importe quelle page (sauf l'éditeur)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        if (route.view === 'editor') return;
        e.preventDefault();
        const target = route.view === 'home' ? '#search-input' : route.view === 'products' ? '#psearch-input' : '#gsearch-input';
        if (target === '#gsearch-input' && route.view !== 'hub') { state.focusSearch = true; navigate('#/'); return; }
        const el = $(target); if (el) { el.focus(); el.select(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      // Flèches : parcourir les résultats, cartes et réponses de la page
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && t.tagName !== 'TEXTAREA' && t.tagName !== 'SELECT') {
        const sel = {
          hub: '#gsearch-results .gresults__item, #hub-quick .slink, .hcard',
          home: '#search-hint .slink, #symptom-grid .card',
          diag: '#diag-stage .option, #diag-stage .outcome__btn',
          reco: '#reco-root .option:not([disabled])',
          products: '#products-results a.pcard__title, #products-results .pcard a',
          news: '#news-root .ftext, #news-root .ncard a'
        }[route.view];
        if (sel) {
          const items = [...document.querySelectorAll(sel)].filter(el => el.offsetParent !== null);
          const i = items.indexOf(t);
          const searchInput = { hub: '#gsearch-input', home: '#search-input', products: '#psearch-input' }[route.view];
          let next = null;
          if (i === -1) { if (e.key === 'ArrowDown' && (!typing || t.matches(searchInput || 'x'))) next = items[0]; }
          else if (e.key === 'ArrowDown') next = items[i + 1] || null;
          else next = items[i - 1] || (searchInput ? $(searchInput) : null);
          if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest' }); return; }
        }
      }

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
      if (route.view === 'editor') return;
      if (route.view === 'hub') {
        if (e.key === '/') { e.preventDefault(); $('#gsearch-input').focus(); $('#gsearch-input').select(); }
        return;
      }
      if (route.view === 'reco') {
        if (e.key === 'Escape') { e.preventDefault(); navigate('#/'); return; }
        if (e.key === 'Backspace' && (route.path || []).length) { e.preventDefault(); navigate(recoHash(route.path.slice(0, -1))); return; }
        if (/^[1-9]$/.test(e.key)) {
          const btn = document.querySelector('#reco-root .option[data-index="' + (Number(e.key) - 1) + '"]');
          if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
        }
        return;
      }
      if (route.view === 'products') {
        if (e.key === '/') { e.preventDefault(); $('#psearch-input').focus(); $('#psearch-input').select(); }
        return;
      }

      if (route.view === 'diag') {
        if (e.key === 'Escape') { e.preventDefault(); navigate('#/diagnostic'); return; }
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

  /* index.html et app.js doivent être de la même version. Juste après une publication,
     le cache de GitHub Pages peut servir un mélange des deux pendant quelques minutes :
     on recharge une fois, puis on prévient au lieu de planter. */
  const APP_VERSION = '1.18.0';
  const pageVersion = (document.querySelector('meta[name="diagsav-version"]') || {}).content;
  if (pageVersion !== APP_VERSION) {
    let retried = false;
    try { retried = sessionStorage.getItem('diagsav.reload') === APP_VERSION; sessionStorage.setItem('diagsav.reload', APP_VERSION); } catch { /* ignoré */ }
    const v = document.getElementById('view-loading');
    if (v) v.innerHTML = retried
      ? '<p><strong>Mise à jour du site en cours.</strong></p><p>Le serveur publie une nouvelle version : réessayez dans quelques minutes.</p>'
      : '<p>Mise à jour du site…</p>';
    console.warn('[DIAG·SAV] Versions différentes : page ' + pageVersion + ', script ' + APP_VERSION);
    if (!retried) setTimeout(() => location.reload(), 1200);
    return;
  }
  try { sessionStorage.removeItem('diagsav.reload'); } catch { /* ignoré */ }
  try { localStorage.removeItem('diagsav.salon.v1'); } catch { /* ignoré : ancien mode salon */ }

  bindEvents();
  registerServiceWorker();
  loadData();
})();
