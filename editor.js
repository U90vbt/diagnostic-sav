/* =========================================================================
   DIAG·SAV — Éditeur des procédures
   Chargé à la demande par app.js (onglet « Éditeur »). 100 % local :
   - lit le decisions.json / catalogue.json publiés ou un fichier choisi sur l'ordinateur ;
   - enregistre un brouillon sur l'appareil (localStorage) ;
   - exporte des fichiers à publier via l'interface web de GitHub.
   Aucun appel réseau sortant, aucun jeton, aucune écriture dans le dépôt.
   ========================================================================= */
(() => {
  'use strict';

  const A = window.DIAGSAV;
  if (!A) { console.error('[DIAG·SAV] editor.js doit être chargé par app.js'); return; }
  const { h, toast, truncate, normalize } = A;

  const DRAFT_KEY = 'diagsav.editor.draft.v1';
  const SEV_LABEL = { low: 'Faible', moderate: 'Modéré', high: 'Élevé' };

  const E = {
    ready: false,
    dec: null, cat: null,          // données en cours d'édition
    base: null,                    // { dec, cat } : fichiers publiés au moment de l'ouverture
    savedAt: null,
    conflict: false,               // le fichier publié a changé depuis le brouillon
    root: null, route: null,
    pendingDelete: null            // suppression en attente de confirmation (clé)
  };

  /* ---------------------------------------------------------------------
     Utilitaires
     --------------------------------------------------------------------- */
  const clone = o => JSON.parse(JSON.stringify(o));
  const fmt = o => JSON.stringify(o, null, 2);
  const today = () => new Date().toISOString().slice(0, 10);

  function slug(text) {
    return normalize(text).replace(/\./g, ' ').trim().replace(/\s+/g, '-').slice(0, 40).replace(/-+$/, '') || 'element';
  }

  function hashStr(str) {
    let x = 5381;
    for (let i = 0; i < str.length; i++) x = ((x << 5) + x + str.charCodeAt(i)) | 0;
    return (x >>> 0).toString(36);
  }
  const stamp = dec => hashStr(fmt(dec));

  /** Identifiant libre : base, base-2, base-3… */
  function uniqueId(base, taken) {
    let id = base, n = 2;
    while (taken(id)) id = base + '-' + n++;
    return id;
  }

  function nodeLabel(id) {
    const n = E.dec.nodes[id];
    if (!n) return '⚠ étape introuvable (' + id + ')';
    return n.type === 'result'
      ? 'Résultat · ' + truncate(n.title || '(sans titre)', 70)
      : 'Question · ' + truncate(n.text || '(sans texte)', 70);
  }

  function symptomById(id) { return (E.dec.symptoms || []).find(s => s.id === id); }

  /** Étapes atteignables depuis un symptôme (ordre de parcours). */
  function reachable(startId) {
    const out = [], seen = new Set(), stack = [startId];
    while (stack.length) {
      const id = stack.shift();
      if (!id || seen.has(id) || !E.dec.nodes[id]) continue;
      seen.add(id); out.push(id);
      for (const o of E.dec.nodes[id].options || []) if (o.next) stack.push(o.next);
    }
    return out;
  }

  /** Symptôme « propriétaire » de chaque étape (le premier qui l'atteint). */
  function ownerMap() {
    const map = new Map();
    for (const s of E.dec.symptoms || []) for (const id of reachable(s.start)) if (!map.has(id)) map.set(id, s);
    return map;
  }

  /* ---------------------------------------------------------------------
     Brouillon (localStorage, sur cet appareil uniquement)
     --------------------------------------------------------------------- */
  function readDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      return d && d.dec && d.cat ? d : null;
    } catch { return null; }
  }
  let saveTimer = null;
  function saveDraftSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        E.savedAt = Date.now();
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, savedAt: E.savedAt, baseStamp: stamp(E.base.dec), dec: E.dec, cat: E.cat }));
      } catch (err) {
        toast('Brouillon non enregistré : stockage du navigateur indisponible ou plein');
      }
      updateChrome();
    }, 400);
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignoré */ }
  }

  /** À appeler après toute modification. rerender = reconstruire l'écran (ajout / suppression). */
  function changed(rerender) {
    saveDraftSoon();
    if (rerender) render(E.route, E.root);
    else updateChrome();
  }

  /* ---------------------------------------------------------------------
     Différences avec les fichiers publiés
     --------------------------------------------------------------------- */
  function diffCollection(before, after) {
    const b = before || {}, a = after || {};
    const res = { added: [], removed: [], modified: [] };
    for (const k of Object.keys(a)) {
      if (!(k in b)) res.added.push(k);
      else if (fmt(a[k]) !== fmt(b[k])) res.modified.push(k);
    }
    for (const k of Object.keys(b)) if (!(k in a)) res.removed.push(k);
    return res;
  }
  const byId = list => Object.fromEntries((list || []).map(x => [x.id, x]));

  function computeDiff() {
    const d = {
      symptoms: diffCollection(byId(E.base.dec.symptoms), byId(E.dec.symptoms)),
      nodes: diffCollection(E.base.dec.nodes, E.dec.nodes),
      products: diffCollection(E.base.dec.products, E.dec.products),
      families: diffCollection(E.base.dec.families, E.dec.families),
      facts: diffCollection(E.base.cat.products, E.cat.products)
    };
    const metaChanged = fmt(E.base.dec.meta) !== fmt(E.dec.meta) || fmt(E.base.dec.categories) !== fmt(E.dec.categories);
    d.total = ['symptoms', 'nodes', 'products', 'families', 'facts']
      .reduce((n, k) => n + d[k].added.length + d[k].removed.length + d[k].modified.length, 0) + (metaChanged ? 1 : 0);
    d.decChanged = fmt(E.base.dec) !== fmt(E.dec);
    d.catChanged = fmt(E.base.cat) !== fmt(E.cat);
    return d;
  }

  /* ---------------------------------------------------------------------
     Validation (decisions.json via app.js + contrôles du catalogue)
     --------------------------------------------------------------------- */
  function issues() {
    const list = A.validateDetailed(E.dec);
    for (const [pid, entry] of Object.entries(E.cat.products || {})) {
      const pr = (E.dec.products || {})[pid];
      if (!pr) list.push({ msg: 'Le catalogue contient des caractéristiques pour un produit qui n\'existe plus (« ' + pid + ' »).', ref: null });
      else if (!(entry.facts || []).filter(f => String(f).trim()).length) list.push({ msg: 'Le produit « ' + pr.brand + ' ' + pr.model + ' » n\'a aucune caractéristique.', ref: { kind: 'product', id: pid } });
    }
    return list;
  }

  function refHref(ref) {
    if (!ref) return null;
    if (ref.kind === 'symptom') return '#/editeur/symptome/' + encodeURIComponent(ref.id);
    if (ref.kind === 'node') return '#/editeur/etape/' + encodeURIComponent(ref.id);
    if (ref.kind === 'product') return '#/editeur/produit/' + encodeURIComponent(ref.id);
    if (ref.kind === 'family') return '#/editeur/produits#famille-' + encodeURIComponent(ref.id);
    return null;
  }

  /* ---------------------------------------------------------------------
     Petits composants de formulaire
     --------------------------------------------------------------------- */
  let fieldSeq = 0;
  function field(label, control, hint) {
    const id = control.id || ('f' + (++fieldSeq));
    control.id = id;
    return h('div', { class: 'ed-field' },
      h('label', { class: 'ed-label', for: id }, label),
      control,
      hint ? h('p', { class: 'ed-hint' }, hint) : null);
  }

  function textInput(value, onInput, opts = {}) {
    const el = h(opts.multiline ? 'textarea' : 'input', {
      class: 'ed-input' + (opts.multiline ? ' ed-input--area' : ''),
      type: opts.multiline ? null : (opts.type || 'text'),
      rows: opts.multiline ? String(opts.rows || 3) : null,
      placeholder: opts.placeholder || null,
      readonly: opts.readonly || null,
      inputmode: opts.inputmode || null
    });
    el.value = value == null ? '' : value;
    el.addEventListener('input', () => onInput(el.value));
    return el;
  }

  function selectInput(options, value, onChange, opts = {}) {
    const el = h('select', { class: 'ed-input ed-select' });
    const addOpt = (parent, o) => {
      const opt = h('option', { value: o.value }, o.label);
      if (o.value === value) opt.selected = true;
      parent.append(opt);
    };
    if (opts.placeholder) addOpt(el, { value: '', label: opts.placeholder });
    for (const o of options) {
      if (o.group) {
        const g = h('optgroup', { label: o.group });
        o.options.forEach(x => addOpt(g, x));
        el.append(g);
      } else addOpt(el, o);
    }
    if (value && ![...el.options].some(o => o.value === value)) {
      addOpt(el, { value, label: '⚠ ' + value + ' (introuvable)' });
      el.value = value;
    }
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  /** Liste de textes éditable (actions, mots-clés, caractéristiques). */
  function listEditor(items, onChange, opts = {}) {
    const wrap = h('div', { class: 'ed-list' });
    const draw = () => {
      wrap.replaceChildren(...items.map((val, i) => h('div', { class: 'ed-list__row' },
        h('span', { class: 'ed-list__n', 'aria-hidden': 'true' }, String(i + 1)),
        textInput(val, v => { items[i] = v; onChange(items, false); }, { multiline: !!opts.multiline, rows: 2, placeholder: opts.placeholder }),
        h('div', { class: 'ed-list__tools' },
          h('button', { type: 'button', class: 'ed-icon', title: 'Monter', 'aria-label': 'Monter l\'élément ' + (i + 1), disabled: i === 0 || null,
            onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; onChange(items, false); draw(); } }, '↑'),
          h('button', { type: 'button', class: 'ed-icon', title: 'Descendre', 'aria-label': 'Descendre l\'élément ' + (i + 1), disabled: i === items.length - 1 || null,
            onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; onChange(items, false); draw(); } }, '↓'),
          h('button', { type: 'button', class: 'ed-icon ed-icon--danger', title: 'Supprimer', 'aria-label': 'Supprimer l\'élément ' + (i + 1),
            onclick: () => { items.splice(i, 1); onChange(items, false); draw(); } }, '✕')
        ))),
        h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: () => { items.push(''); onChange(items, false); draw(); const last = wrap.querySelectorAll('.ed-input'); last[last.length - 1] && last[last.length - 1].focus(); } },
          '+ ' + (opts.addLabel || 'Ajouter')));
    };
    draw();
    return wrap;
  }

  /** Bouton de suppression en deux temps (pas de boîte de dialogue bloquante). */
  function deleteButton(key, label, onConfirm) {
    const armed = E.pendingDelete === key;
    return h('button', {
      type: 'button', class: 'btn btn--small ' + (armed ? 'btn--danger' : 'btn--ghost'),
      onclick: () => {
        if (E.pendingDelete === key) { E.pendingDelete = null; onConfirm(); }
        else { E.pendingDelete = key; render(E.route, E.root); }
      }
    }, armed ? 'Confirmer la suppression' : label);
  }

  /* ---------------------------------------------------------------------
     Cadre de l'éditeur
     --------------------------------------------------------------------- */
  function chrome(active, content) {
    const iss = issues();
    const diff = computeDiff();
    const tab = (id, href, label, badge) => h('a', { class: 'ed-tab', href, 'aria-current': active === id ? 'page' : null },
      label, badge != null ? h('span', { class: 'ed-tab__badge' + (id === 'verif' && badge ? ' is-warn' : '') }, String(badge)) : null);
    return h('div', { class: 'ed' },
      h('header', { class: 'ed-head' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'Procédures v' + ((E.dec.meta && E.dec.meta.version) || '?')),
          h('h1', { class: 'ed-title' }, 'Éditeur des procédures')),
        h('div', { class: 'ed-head__actions' },
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => A.startPreview(E.dec, E.cat, '#/') }, 'Tester mes modifications'),
          h('a', { class: 'btn btn--light', href: '#/editeur/export' }, 'Exporter'))),
      h('p', { class: 'ed-status', id: 'ed-status' }, statusText(diff, iss)),
      E.conflict ? h('p', { class: 'ed-alert' },
        'Le fichier publié a changé depuis votre brouillon. Vos modifications sont conservées, mais vérifiez qu\'elles n\'écrasent pas le travail d\'un collègue. ',
        h('a', { href: '#/editeur/export' }, 'Voir les options')) : null,
      h('nav', { class: 'ed-tabs', 'aria-label': 'Sections de l\'éditeur' },
        tab('symptoms', '#/editeur', 'Symptômes', (E.dec.symptoms || []).length),
        tab('products', '#/editeur/produits', 'Produits', Object.keys(E.dec.products || {}).length),
        tab('verif', '#/editeur/verif', 'Vérification', iss.length),
        tab('export', '#/editeur/export', 'Exporter', diff.total || null)),
      h('div', { class: 'ed-body' }, content));
  }

  function statusText(diff, iss) {
    const parts = [];
    parts.push(diff.total ? diff.total + ' modification' + (diff.total > 1 ? 's' : '') + ' non publiée' + (diff.total > 1 ? 's' : '') : 'Aucune modification');
    parts.push(iss.length ? iss.length + ' point' + (iss.length > 1 ? 's' : '') + ' à corriger' : 'aucune anomalie');
    if (E.savedAt) parts.push('brouillon enregistré à ' + new Date(E.savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    return parts.join(' · ');
  }

  function updateChrome() {
    const el = document.getElementById('ed-status');
    if (!el) return;
    const iss = issues(), diff = computeDiff();
    el.textContent = statusText(diff, iss);
    const badges = E.root.querySelectorAll('.ed-tab__badge');
    if (badges[2]) { badges[2].textContent = String(iss.length); badges[2].classList.toggle('is-warn', iss.length > 0); }
    if (badges[3]) { badges[3].textContent = diff.total ? String(diff.total) : ''; badges[3].hidden = !diff.total; }
  }

  /* ---------------------------------------------------------------------
     Écran : liste des symptômes
     --------------------------------------------------------------------- */
  function screenSymptoms() {
    const cats = E.dec.categories || [];
    const iss = issues();
    const owner = ownerMap();
    const issuesFor = s => iss.filter(x => x.ref && ((x.ref.kind === 'symptom' && x.ref.id === s.id) || (x.ref.kind === 'node' && owner.get(x.ref.id) === s))).length;

    let newTitle = '', newCat = cats[0] ? cats[0].id : '';
    const create = () => {
      const title = newTitle.trim();
      if (!title) { toast('Donnez un titre au symptôme'); return; }
      const id = uniqueId(slug(title), x => !!symptomById(x));
      const startId = uniqueId(id + '-q1', x => !!E.dec.nodes[x]);
      E.dec.nodes[startId] = { type: 'question', text: 'Première question', options: [{ label: 'Oui', next: '' }, { label: 'Non', next: '' }] };
      E.dec.symptoms.push({ id, title, category: newCat, summary: '', keywords: [], start: startId });
      changed(false);
      A.navigate('#/editeur/symptome/' + encodeURIComponent(id));
    };

    const titleIn = textInput('', v => { newTitle = v; }, { placeholder: 'ex. Pas de signal sur le retour scène' });
    titleIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); create(); } });

    return h('div', null,
      h('section', { class: 'ed-card ed-new' },
        h('h2', { class: 'ed-h2' }, 'Nouveau symptôme'),
        h('div', { class: 'ed-row' },
          field('Titre', titleIn),
          field('Catégorie', selectInput(cats.map(c => ({ value: c.id, label: c.label })), newCat, v => { newCat = v; }))),
        h('button', { type: 'button', class: 'btn btn--light', onclick: create }, 'Créer le symptôme')),
      h('ul', { class: 'ed-items' }, (E.dec.symptoms || []).map(s => {
        const cat = cats.find(c => c.id === s.category);
        const n = issuesFor(s);
        return h('li', null, h('a', { class: 'ed-item', href: '#/editeur/symptome/' + encodeURIComponent(s.id) },
          h('span', { class: 'ed-item__main' },
            h('span', { class: 'ed-item__title' }, s.title || '(sans titre)'),
            h('span', { class: 'ed-item__sub' }, (cat ? cat.label : 'Sans catégorie') + ' · ' + reachable(s.start).length + ' étapes')),
          n ? h('span', { class: 'ed-pill is-warn' }, n + ' à corriger') : h('span', { class: 'ed-pill' }, 'OK')));
      })));
  }

  /* ---------------------------------------------------------------------
     Écran : un symptôme
     --------------------------------------------------------------------- */
  function screenSymptom(id) {
    const s = symptomById(id);
    if (!s) return notFound('Ce symptôme n\'existe pas (ou plus).', '#/editeur');
    const cats = E.dec.categories || [];
    const questions = Object.entries(E.dec.nodes).filter(([, n]) => n.type === 'question');
    const owner = ownerMap();

    return h('div', null,
      h('p', null, h('a', { class: 'btn btn--small btn--ghost', href: '#/editeur' }, '← Tous les symptômes')),
      h('section', { class: 'ed-card' },
        h('h2', { class: 'ed-h2' }, s.title || '(sans titre)'),
        field('Titre affiché', textInput(s.title, v => { s.title = v; changed(false); })),
        h('div', { class: 'ed-row' },
          field('Catégorie', selectInput(cats.map(c => ({ value: c.id, label: c.label })), s.category, v => { s.category = v; changed(false); })),
          field('Identifiant', textInput(s.id, () => {}, { readonly: true }), 'Fixé à la création (il figure dans les liens partagés).')),
        field('Résumé', textInput(s.summary, v => { s.summary = v; changed(false); }, { multiline: true, rows: 2 }), 'Une phrase affichée sur la carte d\'accueil.'),
        field('Mots-clés de recherche', textInput((s.keywords || []).join(', '), v => {
          s.keywords = v.split(',').map(x => x.trim()).filter(Boolean); changed(false);
        }, { multiline: true, rows: 2 }), 'Séparés par des virgules : les mots que les techniciens tapent vraiment (« pas de son », « muet »…).'),
        field('Question de départ', selectInput(
          groupNodes(questions.map(([qid]) => qid), owner),
          s.start, v => { s.start = v; changed(true); }, { placeholder: '— choisir —' })),
        h('div', { class: 'ed-actions' },
          h('a', { class: 'btn btn--small btn--ghost', href: '#/editeur/etape/' + encodeURIComponent(s.start) }, 'Modifier la question de départ'),
          deleteButton('sym:' + s.id, 'Supprimer ce symptôme', () => {
            E.dec.symptoms = E.dec.symptoms.filter(x => x !== s);
            changed(false);
            A.navigate('#/editeur');
          }))),
      typeof treeView === 'function' ? treeView(s) : null);
  }

  /** Options de liste déroulante d'étapes, regroupées par symptôme. */
  function groupNodes(ids, owner) {
    const groups = new Map();
    for (const id of ids) {
      const s = owner.get(id);
      const key = s ? s.title : 'Étapes non rattachées';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ value: id, label: nodeLabel(id) });
    }
    return [...groups.entries()].map(([group, options]) => ({ group, options }));
  }

  function notFound(msg, back) {
    return h('div', { class: 'empty' }, msg, ' ', h('a', { href: back }, 'Retour'));
  }

  /* ---------------------------------------------------------------------
     Écran : vérification
     --------------------------------------------------------------------- */
  function screenVerif() {
    const list = issues();
    if (!list.length) return h('section', { class: 'ed-card' }, h('p', { class: 'ed-ok' }, '✓ Aucune anomalie : les fichiers peuvent être exportés.'));
    return h('section', { class: 'ed-card' },
      h('h2', { class: 'ed-h2' }, list.length + ' point' + (list.length > 1 ? 's' : '') + ' à corriger'),
      h('p', { class: 'ed-hint' }, 'Le site fonctionne malgré ces anomalies, mais les techniciens risquent de tomber sur une impasse.'),
      h('ul', { class: 'ed-issues' }, list.map(x => h('li', null,
        h('span', null, x.msg),
        refHref(x.ref) ? h('a', { class: 'btn btn--small btn--ghost', href: refHref(x.ref) }, 'Corriger') : null))));
  }

  /* ---------------------------------------------------------------------
     Écran : export / import
     --------------------------------------------------------------------- */
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('✓ Copié dans le presse-papiers'); }
    catch { toast('Copie impossible : utilisez le téléchargement'); }
  }

  function exportedDecisions(version) {
    const d = computeDiff();
    if (!d.decChanged && !d.catChanged) return fmt(E.dec);
    const out = clone(E.dec);
    out.meta = out.meta || {};
    out.meta.version = version || out.meta.version;
    out.meta.updated = today();
    return fmt(out);
  }
  function exportedCatalogue() {
    const d = computeDiff();
    if (!d.catChanged) return fmt(E.cat);
    const out = clone(E.cat);
    out.meta = out.meta || {};
    out.meta.updated = today();
    return fmt(out);
  }

  function bumpVersion(v) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v || '');
    return m ? m[1] + '.' + m[2] + '.' + (Number(m[3]) + 1) : (v || '1.0.0');
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      let data;
      try { data = JSON.parse(text); }
      catch (err) {
        toast('Fichier illisible : erreur de syntaxe' + A.jsonErrorPosition(text, err));
        return;
      }
      if (Array.isArray(data.symptoms) && data.nodes) {
        E.dec = data; toast('✓ ' + file.name + ' chargé comme procédures (decisions.json)');
      } else if (data.products && !data.nodes) {
        E.cat = data; toast('✓ ' + file.name + ' chargé comme catalogue (catalogue.json)');
      } else {
        toast('Ce fichier ne ressemble ni à decisions.json ni à catalogue.json');
        return;
      }
      changed(true);
    };
    reader.readAsText(file, 'utf-8');
  }

  function screenExport() {
    const d = computeDiff();
    const iss = issues();
    let version = d.decChanged || d.catChanged ? bumpVersion(E.base.dec.meta && E.base.dec.meta.version) : ((E.dec.meta && E.dec.meta.version) || '');

    const line = (label, c) => {
      const n = c.added.length + c.removed.length + c.modified.length;
      if (!n) return null;
      const bits = [];
      if (c.added.length) bits.push(c.added.length + ' ajouté' + (c.added.length > 1 ? 's' : ''));
      if (c.modified.length) bits.push(c.modified.length + ' modifié' + (c.modified.length > 1 ? 's' : ''));
      if (c.removed.length) bits.push(c.removed.length + ' supprimé' + (c.removed.length > 1 ? 's' : ''));
      return h('li', null, h('strong', null, label + ' : '), bits.join(', '));
    };
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'ed-import' });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) importFile(fileInput.files[0]); fileInput.value = ''; });

    return h('div', { class: 'ed-grid' },
      h('section', { class: 'ed-card' },
        h('h2', { class: 'ed-h2' }, 'Modifications à publier'),
        d.total ? h('ul', { class: 'ed-summary' },
          line('Symptômes', d.symptoms), line('Questions et résultats', d.nodes), line('Produits', d.products),
          line('Familles', d.families), line('Caractéristiques (catalogue)', d.facts))
          : h('p', { class: 'ed-hint' }, 'Aucune modification par rapport aux fichiers publiés.'),
        iss.length ? h('p', { class: 'ed-alert' }, iss.length + ' point' + (iss.length > 1 ? 's' : '') + ' à corriger avant publication. ', h('a', { href: '#/editeur/verif' }, 'Voir la vérification')) : null,
        d.decChanged || d.catChanged ? field('Numéro de version', textInput(version, v => { version = v; }), 'Affiché en haut à droite du site (« Procédures v… ») pour vérifier que les tablettes sont à jour.') : null,
        h('div', { class: 'ed-actions' },
          h('button', { type: 'button', class: 'btn btn--light', onclick: () => download('decisions.json', exportedDecisions(version)) }, 'Télécharger decisions.json'),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => download('catalogue.json', exportedCatalogue()) }, 'Télécharger catalogue.json'),
          h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: () => copy(exportedDecisions(version)) }, 'Copier decisions.json'))),
      h('section', { class: 'ed-card' },
        h('h2', { class: 'ed-h2' }, 'Publier sur le site'),
        h('ol', { class: 'ed-steps' },
          h('li', null, 'Téléchargez le ou les fichiers modifiés ci-contre.'),
          h('li', null, 'Sur GitHub, ouvrez le dossier ', h('code', null, 'data'), ' du dépôt.'),
          h('li', null, 'Cliquez sur ', h('strong', null, 'Add file → Upload files'), ' et déposez le fichier : il remplace l\'ancien.'),
          h('li', null, 'Décrivez la modification (ex. « Ajout du symptôme intercom ») puis ', h('strong', null, 'Commit changes'), '.'),
          h('li', null, 'Le site est à jour en 1 à 2 minutes. Vérifiez la version affichée en haut à droite.')),
        h('p', { class: 'ed-hint' }, 'Les fichiers doivent garder exactement leur nom : decisions.json et catalogue.json.')),
      h('section', { class: 'ed-card' },
        h('h2', { class: 'ed-h2' }, 'Brouillon et fichiers'),
        h('p', { class: 'ed-hint' }, 'Le brouillon est enregistré automatiquement sur cet appareil uniquement. Il n\'est envoyé nulle part.'),
        h('div', { class: 'ed-actions' },
          fileInput,
          h('label', { class: 'btn btn--small btn--ghost', for: 'ed-import' }, 'Importer un fichier JSON…'),
          deleteButton('reset', 'Abandonner le brouillon', () => {
            clearDraft();
            E.dec = clone(E.base.dec); E.cat = clone(E.base.cat); E.savedAt = null; E.conflict = false;
            toast('Brouillon abandonné : retour aux fichiers publiés');
            render(E.route, E.root);
          }))));
  }

  /* ---------------------------------------------------------------------
     Initialisation et routage interne
     --------------------------------------------------------------------- */
  async function init() {
    const pubDec = clone(A.published());
    let pubCat;
    try { pubCat = await A.loadPublishedCatalogue(); }
    catch (err) { console.warn('[DIAG·SAV] Éditeur : catalogue indisponible', err); pubCat = { meta: {}, synonyms: {}, products: {} }; }
    E.base = { dec: pubDec, cat: pubCat };
    const draft = readDraft();
    if (draft) {
      E.dec = draft.dec; E.cat = draft.cat; E.savedAt = draft.savedAt;
      E.conflict = draft.baseStamp !== stamp(pubDec);
    } else {
      E.dec = clone(pubDec); E.cat = clone(pubCat);
    }
    E.dec.nodes = E.dec.nodes || {};
    E.dec.symptoms = E.dec.symptoms || [];
    E.ready = true;
  }

  // Écrans ajoutés par les sous-étapes suivantes (questions/résultats, produits).
  const screens = {};
  let treeView = null;

  async function render(route, root) {
    E.route = route; E.root = root;
    if (!E.ready) {
      root.replaceChildren(h('p', { class: 'pstatus' }, 'Préparation de l\'éditeur…'));
      await init();
    }
    const [section, id] = (route.sub || []).map(x => { try { return decodeURIComponent(x); } catch { return x; } });
    let active = 'symptoms', content;
    if (!section) content = screenSymptoms();
    else if (section === 'symptome') content = screenSymptom(id);
    else if (section === 'etape' && screens.node) content = screens.node(id);
    else if (section === 'produits' && screens.products) { active = 'products'; content = screens.products(); }
    else if (section === 'produit' && screens.product) { active = 'products'; content = screens.product(id); }
    else if (section === 'verif') { active = 'verif'; content = screenVerif(); }
    else if (section === 'export') { active = 'export'; content = screenExport(); }
    else content = notFound('Cette page de l\'éditeur n\'existe pas.', '#/editeur');
    root.replaceChildren(chrome(active, content));
  }

  window.DIAGSAV_EDITOR = { render };
})();
