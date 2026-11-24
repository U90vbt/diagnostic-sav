/* =========================================================================
   DIAG·SAV — pages secondaires (chargées à la demande par app.js)
   Le projet · Visite guidée · Outils réseau · Formation · Comparer · Démos et prêt
   Données : data/projet.json, data/outils.json, data/formation.json, data/demos.json
   Tout reste sur l'appareil : aucun envoi, aucun cookie.
   ========================================================================= */
(function () {
  'use strict';

  const A = window.DIAGSAV;
  const { h, toast, navigate } = A;

  /* ---------- utilitaires ---------- */
  /** replaceChildren sans « null » affiché (les enfants absents sont ignorés). */
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
  const store = {
    get(key, fallback) {
      try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast('Enregistrement impossible sur cet appareil'); return false; }
    }
  };
  const today = () => { const d = new Date(); const z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); };
  const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return d + '/' + m + '/' + y; };
  const fmtNum = (n, dec = 1) => n.toLocaleString('fr-FR', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
  const num2 = (i) => String(i + 1).padStart(2, '0');
  const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const toCsv = (rows) => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');

  function header(eyebrow, title, lead) {
    return h('div', { class: 'phead pp-head' },
      eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null,
      h('h1', { class: 'phead__title', tabindex: '-1', 'data-focus': true }, title),
      lead ? h('p', { class: 'phead__lead' }, lead) : null);
  }
  const section = (title, ...children) => h('section', { class: 'pp-section' }, h('h2', { class: 'pp-h2' }, title), ...children);
  function tabs(items, current, label) {
    return h('nav', { class: 'filters filters--text pp-tabs', 'aria-label': label },
      items.map(([href, text, id]) => h('a', { class: 'ftext', href, 'aria-current': id === current ? 'true' : null }, text)));
  }
  function errorBox(err) {
    console.error('[DIAG·SAV]', err);
    return h('div', { class: 'panel pp-error' }, h('p', null, 'Données indisponibles. '), h('code', null, err.message || String(err)));
  }

  /** Liste déroulante de produits, groupée par famille (ordre de decisions.json). */
  function productSelect(attrs, selected, filter) {
    const { products, families } = A.data();
    const groups = [...families.entries()].map(([fid, f]) => {
      const items = [...products.entries()].filter(([, p]) => p.family === fid && (!filter || filter(p)));
      if (!items.length) return null;
      return h('optgroup', { label: f.label },
        items.sort((a, b) => A.productLabel(a[1]).localeCompare(A.productLabel(b[1]), 'fr'))
          .map(([id, p]) => h('option', { value: id, selected: id === selected }, A.productLabel(p))));
    });
    return h('select', Object.assign({ class: 'pp-select' }, attrs), h('option', { value: '' }, attrs.placeholder || 'Choisir un produit…'), groups);
  }
  const productLink = (id) => {
    const p = A.data().products.get(id);
    return p ? h('a', { href: '#/produits/' + encodeURIComponent(id) }, A.productLabel(p)) : id;
  };

  function focusTitle(root) {
    const t = root.querySelector('[data-focus]');
    if (t && document.activeElement === document.body) t.focus({ preventScroll: true });
  }

  /* =======================================================================
     Le projet
     ======================================================================= */
  async function pageProjet(root) {
    A.renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Le projet' }]);
    let P;
    try { P = await A.loadJson('data/projet.json'); } catch (err) { fill(root, errorBox(err)); return; }
    const d = A.data();
    const nodes = Object.values(d.nodes);
    const opt = async (path) => { try { return await A.loadJson(path); } catch { return null; } };
    const [reco, news, form] = await Promise.all([opt('data/reco.json'), opt('data/news.json'), opt('data/formation.json')]);
    const stats = [
      [d.symptoms.size, 'symptômes'],
      [nodes.filter(n => n.type === 'question').length, 'questions'],
      [nodes.filter(n => n.type === 'result').length, 'résultats'],
      [d.products.size, 'produits'],
      [reco ? Object.values(reco.nodes).filter(n => n.type === 'result').length : 0, 'recommandations'],
      [news ? news.items.length : 0, 'actualités'],
      [form ? form.tutoriels.length : 0, 'tutoriels']
    ];
    const a = P.auteur || {};
    const c = P.candidature || {};
    fill(root, 
      header('Le projet', 'Un assistant de terrain pour le support technique audiovisuel', P.accroche),
      h('div', { class: 'pp-intro' },
        h('p', { class: 'pp-intro__text' }, c.texte),
        h('p', { class: 'pp-intro__who' },
          h('strong', null, a.nom), a.titre ? ' · ' + a.titre : '',
          c.poste ? h('span', { class: 'pp-intro__job' }, 'Candidature : ' + c.poste + (c.entreprise ? ' — ' + c.entreprise : '')) : null,
          a.lien ? h('a', { href: a.lien, rel: 'noopener', target: '_blank' }, a.lienLabel || a.lien) : null),
        h('div', { class: 'pp-actions' },
          h('a', { class: 'btn btn--primary', href: '#/visite' }, 'Visite guidée (6 scénarios)'),
          h('a', { class: 'btn btn--ghost', href: '#/' }, 'Explorer le site'))),
      h('ul', { class: 'pp-stats', 'aria-label': 'Le site en chiffres' },
        stats.map(([n, l]) => h('li', null, h('span', { class: 'pp-stats__n' }, String(n)), h('span', { class: 'pp-stats__l' }, l)))),
      (P.missions || []).length ? section('Missions couvertes',
        h('p', { class: 'pp-p' }, 'Les six missions du poste, et où les voir dans le site.'),
        h('ol', { class: 'pp-grid pp-grid--3 pp-missions' }, P.missions.map((m, i) => {
          const tour = m.visite && (P.visite || []).find(v => v.id === m.visite);
          return h('li', { class: 'pp-card' },
            h('span', { class: 'hcard__num' }, num2(i)),
            h('h3', { class: 'pp-card__title' }, m.titre),
            h('p', { class: 'pp-card__text' }, m.texte),
            h('p', { class: 'pp-card__links' }, (m.liens || []).map((l, j) => [j ? ' · ' : '', h('a', { href: l.hash }, l.label)])),
            tour ? h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: () => startTour(tour.id),
              'aria-label': 'Visite guidée : ' + tour.titre }, 'Visite · ' + tour.etapes.length + ' étapes') : null);
        }))) : null,
      section('Le besoin', (P.besoin || []).map(t => h('p', { class: 'pp-p' }, t))),
      section('Les choix',
        h('ol', { class: 'pp-grid' }, (P.choix || []).map((x, i) => h('li', { class: 'pp-card' },
          h('span', { class: 'hcard__num' }, num2(i)), h('h3', { class: 'pp-card__title' }, x.titre), h('p', { class: 'pp-card__text' }, x.texte))))),
      section('Détail, mission par mission',
        h('div', { class: 'pp-table-wrap' },
          h('table', { class: 'pp-table' },
            h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Mission'), h('th', { scope: 'col' }, 'Dans le site'), h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Lien')))),
            h('tbody', null, (P.competences || []).map(x => h('tr', null,
              h('th', { scope: 'row' }, x.exigence), h('td', null, x.preuve),
              h('td', null, x.lien ? h('a', { class: 'pp-go', href: x.lien, 'aria-label': 'Voir : ' + x.exigence }, 'Voir →') : null))))))),
      P.methode ? section('Méthode', h('p', { class: 'pp-p' }, P.methode)) : null,
      section('Historique',
        h('ol', { class: 'pp-timeline' }, (P.versions || []).map(v => h('li', null,
          h('time', { datetime: v.date }, fmtDate(v.date)), h('strong', null, v.titre), h('span', null, v.texte))))));
    focusTitle(root);
  }

  /* =======================================================================
     Visite guidée : une barre suit la navigation sur les vraies pages
     ======================================================================= */
  const TOUR_KEY = 'diagsav.tour';
  const getTour = () => { try { return JSON.parse(sessionStorage.getItem(TOUR_KEY)); } catch { return null; } };
  const setTour = (t) => { try { if (t) sessionStorage.setItem(TOUR_KEY, JSON.stringify(t)); else sessionStorage.removeItem(TOUR_KEY); } catch { /* */ } };

  async function pageVisite(root) {
    A.renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Visite guidée' }]);
    let P;
    try { P = await A.loadJson('data/projet.json'); } catch (err) { fill(root, errorBox(err)); return; }
    fill(root, 
      header('Visite guidée', (P.visite || []).length + ' situations du métier, en deux minutes chacune',
        'Chaque scénario vous emmène sur les vraies pages du site. Une barre en bas de l\'écran explique chaque étape.'),
      h('ol', { class: 'pp-grid pp-grid--3' }, (P.visite || []).map((s, i) => h('li', { class: 'pp-card' },
        h('span', { class: 'hcard__num' }, num2(i)),
        h('p', { class: 'pp-card__ctx' }, s.contexte),
        h('h2', { class: 'pp-card__title' }, s.titre),
        h('p', { class: 'pp-card__text' }, s.etapes.length + ' étapes'),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => startTour(s.id) }, 'Démarrer')))));
    focusTitle(root);
  }

  async function startTour(id) {
    const P = await A.loadJson('data/projet.json');
    const s = (P.visite || []).find(x => x.id === id);
    if (!s) return;
    setTour({ id, i: 0 });
    navigate(s.etapes[0].hash);
  }

  const sameHash = (a, b) => { try { return decodeURIComponent(a) === decodeURIComponent(b); } catch { return a === b; } };

  async function updateTour() {
    const t = getTour();
    let bar = document.getElementById('tourbar');
    if (!t) { if (bar) bar.remove(); document.body.classList.remove('has-tour'); return; }
    let P;
    try { P = await A.loadJson('data/projet.json'); } catch { return; }
    const s = (P.visite || []).find(x => x.id === t.id);
    if (!s) { setTour(null); return updateTour(); }
    const step = s.etapes[t.i];
    const n = s.etapes.length;
    const go = (i) => { setTour({ id: t.id, i }); navigate(s.etapes[i].hash); };
    const quit = (done) => { setTour(null); updateTour(); if (done) { toast('Visite terminée'); navigate('#/visite'); } };
    if (!bar) {
      bar = h('div', { id: 'tourbar', class: 'tourbar', role: 'region', 'aria-label': 'Visite guidée' });
      document.body.append(bar);
    }
    document.body.classList.add('has-tour');
    const onStep = sameHash(location.hash, step.hash);
    fill(bar, 
      h('div', { class: 'tourbar__inner' },
        h('p', { class: 'tourbar__meta' }, s.titre + ' · étape ' + (t.i + 1) + '/' + n),
        h('p', { class: 'tourbar__text', 'aria-live': 'polite' }, step.texte),
        h('div', { class: 'tourbar__actions' },
          onStep ? null : h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: () => navigate(step.hash) }, 'Revenir à l\'étape'),
          t.i > 0 ? h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: () => go(t.i - 1) }, '← Précédent') : null,
          t.i < n - 1
            ? h('button', { type: 'button', class: 'btn btn--small btn--primary', onclick: () => go(t.i + 1) }, 'Suivant →')
            : h('button', { type: 'button', class: 'btn btn--small btn--primary', onclick: () => quit(true) }, 'Terminer'),
          h('button', { type: 'button', class: 'btn btn--small btn--ghost tourbar__quit', 'aria-label': 'Quitter la visite', onclick: () => quit(false) }, 'Quitter'))));
  }

  /* =======================================================================
     Outils réseau AV
     ======================================================================= */
  async function pageOutils(root, sub) {
    const tool = ['poe', 'video', 'longueurs'].includes(sub[0]) ? sub[0] : 'poe';
    const names = { poe: 'Budget PoE', video: 'Débit vidéo', longueurs: 'Longueurs de liaison' };
    A.renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Outils réseau', href: '#/outils' }, { label: names[tool] }]);
    let O;
    try { O = await A.loadJson('data/outils.json'); } catch (err) { fill(root, errorBox(err)); return; }
    const body = h('div', { class: 'pp-tool' });
    fill(root, 
      header('Outils réseau', 'Vérifier une installation avant de la proposer', 'Calculs faits sur l\'appareil, avec des valeurs de référence modifiables (data/outils.json).'),
      tabs([['#/outils/poe', names.poe, 'poe'], ['#/outils/video', names.video, 'video'], ['#/outils/longueurs', names.longueurs, 'longueurs']], tool, 'Outils'),
      body);
    if (tool === 'poe') toolPoe(body, O.poe);
    else if (tool === 'video') toolVideo(body, O.video);
    else toolLength(body, O.longueurs);
    focusTitle(root);
  }

  function verdict(level, text) {
    return h('p', { class: 'pp-verdict pp-verdict--' + level, role: 'status' }, text);
  }

  function toolPoe(box, cfg) {
    const KEY = 'diagsav.outils.poe';
    const st = store.get(KEY, { sw: cfg.switchs[0] ? cfg.switchs[0].product : '', custom: 370, ports: 24, rows: [] });
    const norme = (id) => cfg.normes.find(n => n.id === id) || cfg.normes[0];
    const watts = (row) => {
      if (row.product) { const a = cfg.appareils.find(x => x.product === row.product); return norme(a ? a.norme : row.norme).watts; }
      return norme(row.norme).watts;
    };
    const out = h('div', { class: 'pp-result', 'aria-live': 'polite' });
    const list = h('div', { class: 'pp-rows' });
    const save = () => { store.set(KEY, st); draw(); };

    const swSel = h('select', { class: 'pp-select', id: 'poe-switch', onchange: e => { st.sw = e.target.value; save(); } },
      cfg.switchs.map(s => { const p = A.data().products.get(s.product); return h('option', { value: s.product, selected: st.sw === s.product }, (p ? A.productLabel(p) : s.product) + ' — ' + s.budget + ' W, ' + s.ports + ' ports PoE'); }),
      h('option', { value: '', selected: !st.sw }, 'Autre switch (saisir le budget)'));
    const customBox = h('div', { class: 'pp-inline' });
    const addSel = productSelect({ id: 'poe-add', placeholder: '+ Ajouter un appareil du catalogue…' }, '', p => cfg.appareils.some(a => A.data().products.get(a.product) === p));
    addSel.addEventListener('change', () => { if (addSel.value) { st.rows.push({ product: addSel.value, qty: 1 }); addSel.value = ''; save(); } });

    function draw() {
      const sw = cfg.switchs.find(s => s.product === st.sw);
      fill(customBox, sw ? '' : [
        h('label', { class: 'pp-field' }, 'Budget PoE (W)', h('input', { class: 'pp-input', type: 'number', min: '0', inputmode: 'numeric', value: String(st.custom), onchange: e => { st.custom = Math.max(0, Number(e.target.value) || 0); save(); } })),
        h('label', { class: 'pp-field' }, 'Ports PoE', h('input', { class: 'pp-input', type: 'number', min: '1', inputmode: 'numeric', value: String(st.ports), onchange: e => { st.ports = Math.max(1, Number(e.target.value) || 1); save(); } }))]);
      fill(list, ...st.rows.map((r, i) => {
        const p = r.product && A.data().products.get(r.product);
        return h('div', { class: 'pp-row' },
          h('span', { class: 'pp-row__name' }, p ? A.productLabel(p) : h('select', { class: 'pp-select pp-select--small', 'aria-label': 'Norme PoE', onchange: e => { r.norme = e.target.value; save(); } },
            cfg.normes.map(n => h('option', { value: n.id, selected: n.id === r.norme }, 'Autre appareil — ' + n.label)))),
          h('span', { class: 'pp-row__w' }, fmtNum(watts(r)) + ' W'),
          h('label', { class: 'pp-qty' }, h('span', { class: 'visually-hidden' }, 'Quantité'),
            h('input', { class: 'pp-input pp-input--qty', type: 'number', min: '0', inputmode: 'numeric', value: String(r.qty), onchange: e => { r.qty = Math.max(0, Math.round(Number(e.target.value) || 0)); save(); } })),
          h('button', { type: 'button', class: 'btn btn--small btn--ghost', 'aria-label': 'Retirer', onclick: () => { st.rows.splice(i, 1); save(); } }, '✕'));
      }));
      const budget = sw ? sw.budget : st.custom;
      const ports = sw ? sw.ports : st.ports;
      const total = st.rows.reduce((t, r) => t + watts(r) * r.qty, 0);
      const used = st.rows.reduce((t, r) => t + r.qty, 0);
      const safe = budget * (1 - cfg.marge);
      const pct = budget ? Math.round(total / budget * 100) : 0;
      let v;
      if (!st.rows.length) v = verdict('info', 'Ajoutez les appareils alimentés par le switch.');
      else if (total > budget || used > ports) v = verdict('bad', total > budget ? 'Budget dépassé : répartir sur deux switchs, ajouter une alimentation ou utiliser des injecteurs.' : 'Pas assez de ports PoE sur ce switch.');
      else if (total > safe) v = verdict('warn', 'Ça passe, mais sans la marge de ' + Math.round(cfg.marge * 100) + ' % conseillée.');
      else v = verdict('ok', 'Ça passe, avec de la marge.');
      fill(out, 
        h('div', { class: 'pp-meter', role: 'img', 'aria-label': pct + ' % du budget PoE' },
          h('span', { class: 'pp-meter__bar' + (pct > 100 ? ' is-over' : pct > (1 - cfg.marge) * 100 ? ' is-warn' : ''), style: 'width:' + Math.min(100, pct) + '%' })),
        h('dl', { class: 'pp-kv' },
          h('dt', null, 'Puissance réservée'), h('dd', null, fmtNum(total) + ' W sur ' + fmtNum(budget, 0) + ' W (' + pct + ' %)'),
          h('dt', null, 'Ports utilisés'), h('dd', null, used + ' sur ' + ports)),
        v,
        sw && sw.note ? h('p', { class: 'pp-note' }, sw.note) : null,
        st.rows.length ? h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: () => A.copyText(
          'Budget PoE — ' + (sw ? A.productLabel(A.data().products.get(sw.product)) : 'switch ' + budget + ' W') + '\n' +
          st.rows.map(r => '- ' + r.qty + ' × ' + (r.product ? A.productLabel(A.data().products.get(r.product)) : 'appareil ' + norme(r.norme).label) + ' : ' + fmtNum(watts(r) * r.qty) + ' W').join('\n') +
          '\nTotal réservé : ' + fmtNum(total) + ' W / ' + fmtNum(budget, 0) + ' W (' + pct + ' %), ' + used + '/' + ports + ' ports', 'Résumé copié') }, 'Copier le résumé') : null);
    }
    fill(box, 
      h('div', { class: 'pp-form' },
        h('label', { class: 'pp-field', for: 'poe-switch' }, 'Switch'), swSel, customBox,
        h('label', { class: 'pp-field', for: 'poe-add' }, 'Appareils alimentés'), list, addSel,
        h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: () => { st.rows.push({ norme: cfg.normes[1].id, qty: 1 }); save(); } }, '+ Autre appareil (norme PoE)')),
      out,
      h('p', { class: 'pp-note' }, 'Calcul au pire cas : chaque appareil compte pour la puissance maximale de sa norme PoE, celle que le switch lui réserve. Le budget réel dépend aussi du réglage du switch (allocation par classe ou par consommation).'));
    draw();
  }

  function toolVideo(box, cfg) {
    const KEY = 'diagsav.outils.video';
    const st = store.get(KEY, { r: 2, f: 3, e: 0 });
    const out = h('div', { class: 'pp-result', 'aria-live': 'polite' });
    const sel = (id, label, items, key, fmt) => [h('label', { class: 'pp-field', for: id }, label),
      h('select', { class: 'pp-select', id, onchange: e => { st[key] = Number(e.target.value); store.set(KEY, st); draw(); } },
        items.map((x, i) => h('option', { value: String(i), selected: i === st[key] }, fmt(x))))];
    function draw() {
      const r = cfg.resolutions[st.r] || cfg.resolutions[0];
      const fps = cfg.frequences[st.f] || cfg.frequences[0];
      const e = cfg.echantillonnages[st.e] || cfg.echantillonnages[0];
      const gbps = r.w * r.h * fps * e.bpp / 1e9;
      fill(out, 
        h('p', { class: 'pp-big' }, fmtNum(gbps, 2) + ' Gbit/s', h('span', null, ' non compressé')),
        h('ul', { class: 'pp-links' }, cfg.liens.map(l => {
          const fits = gbps <= l.gbps * 0.9;
          return h('li', null, h('strong', null, l.label), ' : ',
            fits ? h('span', { class: 'pp-ok' }, 'passe sans compression')
              : h('span', { class: 'pp-warn' }, 'compression ' + fmtNum(Math.ceil(gbps / (l.gbps * 0.9) * 10) / 10, 1) + ':1 minimum (codec léger type JPEG XS, ou H.264/H.265)'));
        })),
        h('p', { class: 'pp-note' }, cfg.note + ' Les liens sont comptés à 90 % de leur capacité.'));
    }
    fill(box, h('div', { class: 'pp-form' },
      sel('v-res', 'Résolution', cfg.resolutions, 'r', x => x.label),
      sel('v-fps', 'Images par seconde', cfg.frequences, 'f', x => x + ' i/s'),
      sel('v-ech', 'Échantillonnage et profondeur', cfg.echantillonnages, 'e', x => x.label)), out);
    draw();
  }

  function toolLength(box, cfg) {
    const KEY = 'diagsav.outils.longueurs';
    const st = store.get(KEY, { l: cfg.liaisons[0].id, m: 30 });
    const out = h('div', { class: 'pp-result', 'aria-live': 'polite' });
    function draw() {
      const l = cfg.liaisons.find(x => x.id === st.l) || cfg.liaisons[0];
      const ok = st.m <= l.max;
      fill(out, 
        ok ? verdict(st.m > l.max * 0.9 ? 'warn' : 'ok', (st.m > l.max * 0.9 ? 'Juste : ' : 'Ça passe : ') + fmtNum(st.m, 0) + ' m pour ' + fmtNum(l.max, 0) + ' m maximum.')
          : verdict('bad', 'Trop long : ' + fmtNum(st.m, 0) + ' m pour ' + fmtNum(l.max, 0) + ' m maximum. ' + l.solution),
        h('p', { class: 'pp-note' }, 'Référence : ' + l.source),
        l.produits && l.produits.length ? h('p', { class: 'pp-note' }, 'Dans le catalogue : ', l.produits.map((id, i) => [i ? ', ' : '', productLink(id)])) : null);
    }
    fill(box, h('div', { class: 'pp-form' },
      h('label', { class: 'pp-field', for: 'l-type' }, 'Type de liaison'),
      h('select', { class: 'pp-select', id: 'l-type', onchange: e => { st.l = e.target.value; store.set(KEY, st); draw(); } },
        cfg.liaisons.map(x => h('option', { value: x.id, selected: x.id === st.l }, x.label + ' — ' + x.max + ' m'))),
      h('label', { class: 'pp-field', for: 'l-m' }, 'Distance (m)'),
      h('input', { class: 'pp-input', id: 'l-m', type: 'number', min: '0', inputmode: 'numeric', value: String(st.m),
        oninput: e => { st.m = Math.max(0, Number(e.target.value) || 0); store.set(KEY, st); draw(); } })), out);
    draw();
  }

  /* =======================================================================
     Formation : tutoriels, quiz, techniciens formés
     ======================================================================= */
  const TRAINED_KEY = 'diagsav.formes.v1';

  async function pageFormation(root, sub) {
    let F;
    try { F = await A.loadJson('data/formation.json'); } catch (err) { fill(root, errorBox(err)); return; }
    const tuto = sub[0] && F.tutoriels.find(t => t.id === sub[0]);
    if (sub[0] === 'suivi') return formationSuivi(root, F);
    if (tuto) return formationTuto(root, F, tuto);
    A.renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Formation' }]);
    const trained = store.get(TRAINED_KEY, []);
    fill(root, 
      header('Formation', 'Tutoriels courts et ciblés', 'Une étape par écran, un quiz pour vérifier, et le suivi des techniciens formés.'),
      h('ol', { class: 'pp-grid' }, F.tutoriels.map((t, i) => h('li', null, h('a', { class: 'pp-card pp-card--link', href: '#/formation/' + t.id },
        h('span', { class: 'hcard__num' }, num2(i)),
        h('p', { class: 'pp-card__ctx' }, t.gamme + ' · ' + t.duree),
        h('h2', { class: 'pp-card__title' }, t.titre),
        h('p', { class: 'pp-card__text' }, t.objectif),
        t.status === 'draft' ? h('span', { class: 'badge badge--draft' }, 'À valider') : null)))),
      h('p', { class: 'pp-actions' }, h('a', { class: 'btn btn--ghost', href: '#/formation/suivi' }, 'Techniciens formés (' + trained.length + ')')));
    focusTitle(root);
  }

  function formationTuto(root, F, t) {
    A.renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Formation', href: '#/formation' }, { label: t.titre }]);
    const d = A.data();
    const sym = t.liens && d.symptoms.get(t.liens.symptome);
    const answers = new Array(t.quiz.length).fill(null);
    const result = h('div', { class: 'pp-result', 'aria-live': 'polite' });
    const quiz = h('form', { class: 'pp-quiz', onsubmit: (e) => {
      e.preventDefault();
      if (answers.some(a => a == null)) { toast('Répondez à toutes les questions'); return; }
      const score = answers.filter((a, i) => a === t.quiz[i].bonne).length;
      quiz.querySelectorAll('fieldset').forEach((fs, i) => {
        fs.classList.toggle('is-ok', answers[i] === t.quiz[i].bonne);
        fs.classList.toggle('is-ko', answers[i] !== t.quiz[i].bonne);
      });
      const name = h('input', { class: 'pp-input', id: 'tr-name', autocomplete: 'off', placeholder: 'Prénom Nom' });
      const org = h('input', { class: 'pp-input', id: 'tr-org', autocomplete: 'off', placeholder: 'Société (facultatif)' });
      fill(result, 
        verdict(score === t.quiz.length ? 'ok' : score ? 'warn' : 'bad', 'Score : ' + score + '/' + t.quiz.length + (score === t.quiz.length ? ' — validé.' : ' — revoir les réponses en rouge.')),
        h('div', { class: 'pp-form' },
          h('p', { class: 'pp-field' }, 'Enregistrer le technicien formé (sur cet appareil uniquement)'),
          h('label', { class: 'visually-hidden', for: 'tr-name' }, 'Nom du technicien'), name,
          h('label', { class: 'visually-hidden', for: 'tr-org' }, 'Société'), org,
          h('button', { type: 'button', class: 'btn btn--primary', onclick: () => {
            if (!name.value.trim()) { toast('Indiquez le nom du technicien'); name.focus(); return; }
            const list = store.get(TRAINED_KEY, []);
            list.unshift({ nom: name.value.trim(), societe: org.value.trim(), tuto: t.id, titre: t.titre, score: score + '/' + t.quiz.length, date: today() });
            if (store.set(TRAINED_KEY, list)) { toast('Technicien enregistré'); navigate('#/formation/suivi'); }
          } }, 'Enregistrer')));
    } },
      t.quiz.map((q, i) => h('fieldset', { class: 'pp-q' },
        h('legend', null, (i + 1) + '. ' + q.q),
        q.choix.map((c, j) => h('label', { class: 'pp-choice' },
          h('input', { type: 'radio', name: 'q' + i, value: String(j), onchange: () => { answers[i] = j; } }), h('span', null, c))))),
      h('button', { type: 'submit', class: 'btn btn--primary' }, 'Valider le quiz'));
    fill(root, 
      header(t.gamme + ' · ' + t.duree, t.titre, t.objectif),
      t.status === 'draft' ? h('p', null, h('span', { class: 'badge badge--draft' }, 'À valider'), ' ', h('span', { class: 'pp-note' }, 'Contenu à faire relire par un technicien confirmé.')) : null,
      section('Étapes', h('ol', { class: 'pp-steps' }, t.etapes.map(s => h('li', null, s)))),
      (sym || (t.liens && t.liens.produits && t.liens.produits.length)) ? section('Pour aller plus loin',
        h('ul', { class: 'pp-list' },
          sym ? h('li', null, 'Diagnostic : ', h('a', { href: A.diagHash(sym.id, [sym.start]) }, sym.title)) : null,
          (t.liens.produits || []).map(id => h('li', null, 'Produit : ', productLink(id))))) : null,
      section('Quiz', quiz, result));
    focusTitle(root);
  }

  function formationSuivi(root) {
    A.renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Formation', href: '#/formation' }, { label: 'Techniciens formés' }]);
    const draw = () => {
      const list = store.get(TRAINED_KEY, []);
      fill(root, 
        header('Formation', 'Techniciens formés', 'Enregistré sur cet appareil uniquement. Exportez la liste pour la partager.'),
        list.length ? h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table' },
          h('thead', null, h('tr', null, ['Date', 'Technicien', 'Société', 'Tutoriel', 'Score', ''].map(x => h('th', { scope: 'col' }, x)))),
          h('tbody', null, list.map((x, i) => h('tr', null,
            h('td', null, fmtDate(x.date)), h('th', { scope: 'row' }, x.nom), h('td', null, x.societe || '—'),
            h('td', null, h('a', { href: '#/formation/' + x.tuto }, x.titre)), h('td', null, x.score),
            h('td', null, h('button', { type: 'button', class: 'btn btn--small btn--ghost', 'aria-label': 'Supprimer ' + x.nom, onclick: () => {
              const l = store.get(TRAINED_KEY, []); l.splice(i, 1); store.set(TRAINED_KEY, l); draw();
            } }, '✕'))))))) : h('p', { class: 'empty' }, 'Aucun technicien enregistré pour l\'instant. Terminez un quiz pour en ajouter.'),
        h('p', { class: 'pp-actions' },
          list.length ? h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => A.downloadFile('techniciens-formes-' + today() + '.csv',
            toCsv([['Date', 'Technicien', 'Société', 'Tutoriel', 'Score'], ...list.map(x => [x.date, x.nom, x.societe, x.titre, x.score])]), 'text/csv;charset=utf-8') }, 'Exporter (tableur CSV)') : null,
          h('a', { class: 'btn btn--ghost', href: '#/formation' }, '← Tutoriels')));
      focusTitle(root);
    };
    draw();
  }

  /* =======================================================================
     Comparer 2 ou 3 produits
     ======================================================================= */
  async function pageComparer(root, params) {
    A.renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Assistant produit', href: '#/produits' }, { label: 'Comparer' }]);
    let cat;
    try { cat = await A.loadCatalogue(); } catch (err) { fill(root, errorBox(err)); return; }
    let news = null;
    try { news = await A.loadJson('data/news.json'); } catch { /* facultatif */ }
    const d = A.data();
    const ids = (params.ids || '').split(',').filter(id => d.products.has(id)).slice(0, 3);
    const setIds = (next) => navigate('#/comparer' + (next.filter(Boolean).length ? '?ids=' + next.filter(Boolean).map(encodeURIComponent).join(',') : ''), { replace: true });
    const slots = [0, 1, 2].map(i => {
      const s = productSelect({ id: 'cmp-' + i, 'aria-label': 'Produit ' + (i + 1), placeholder: 'Produit ' + (i + 1) + '…' }, ids[i] || '');
      s.addEventListener('change', () => { const next = [...ids]; next[i] = s.value; setIds(next); });
      return s;
    });
    const cols = ids.map(id => ({ id, p: d.products.get(id), facts: (cat.products[id] && cat.products[id].facts) || [] }));
    const row = (label, fn) => h('tr', null, h('th', { scope: 'row' }, label), cols.map(c => h('td', null, fn(c))));
    const symLinks = (c) => {
      const fam = d.families.get(c.p.family);
      const list = ((fam && fam.symptoms) || []).map(sid => d.symptoms.get(sid)).filter(Boolean);
      return list.length ? h('ul', { class: 'pp-list' }, list.map(s => h('li', null, h('a', { href: A.diagHash(s.id, [s.start]) }, s.title)))) : '—';
    };
    const newsFor = (c) => {
      const items = news ? news.items.filter(n => (n.products || []).includes(c.id)) : [];
      return items.length ? h('ul', { class: 'pp-list' }, items.map(n => h('li', null, h('a', { href: '#/veille' }, n.title)))) : '—';
    };
    fill(root, 
      header('Assistant produit', 'Comparer des produits', 'Choisissez deux ou trois produits du catalogue : caractéristiques sourcées, diagnostics et actualités liés.'),
      h('div', { class: 'pp-cmp-pick' }, slots),
      cols.length ? h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table pp-cmp' },
        h('thead', null, h('tr', null, h('td', null), cols.map(c => h('th', { scope: 'col' }, h('a', { href: '#/produits/' + encodeURIComponent(c.id) }, A.productLabel(c.p)))))),
        h('tbody', null,
          row('Famille', c => (d.families.get(c.p.family) || {}).label || '—'),
          row('Type', c => c.p.type),
          row('Caractéristiques', c => c.facts.length ? h('ul', { class: 'pp-list' }, c.facts.map(f => h('li', null, f))) : '—'),
          row('Source', c => A.productSourceLabel(c.p) + (c.p.ref ? ' · réf. ' + c.p.ref : '')),
          row('Diagnostics', symLinks),
          row('Veille', newsFor)))) : h('p', { class: 'empty' }, 'Choisissez au moins un produit.'),
      cols.length ? h('p', { class: 'pp-actions' }, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => A.copyText(
        'Comparaison\n' + cols.map(c => '\n' + A.productLabel(c.p) + ' (' + c.p.type + ', ' + A.productSourceLabel(c.p) + ')\n' + c.facts.map(f => '- ' + f).join('\n')).join('\n'), 'Comparaison copiée') }, 'Copier la comparaison')) : null);
    focusTitle(root);
  }

  /* =======================================================================
     Démos et parc de prêt
     ======================================================================= */
  const CHECK_KEY = 'diagsav.demo.check';
  const LOAN_KEY = 'diagsav.pret.v1';

  async function pageDemos(root, sub) {
    const tab = sub[0] === 'pret' ? 'pret' : 'checklist';
    A.renderCrumbs([{ label: 'Accueil', href: '#/' }, { label: 'Démos et prêt', href: '#/demos' }, { label: tab === 'pret' ? 'Parc de prêt' : 'Préparer une démo' }]);
    let D;
    try { D = await A.loadJson('data/demos.json'); } catch (err) { fill(root, errorBox(err)); return; }
    const body = h('div');
    fill(root, 
      header('Démos et prêt', tab === 'pret' ? 'Suivre le matériel prêté' : 'Préparer une démonstration',
        tab === 'pret' ? 'Qui a quoi, jusqu\'à quand, dans quel état. Enregistré sur cet appareil uniquement.' : 'Une checklist pour que la démonstration parte du besoin du client, et que le matériel revienne prêt.'),
      tabs([['#/demos', 'Préparer une démo', 'checklist'], ['#/demos/pret', 'Parc de prêt', 'pret']], tab, 'Démos et prêt'),
      body);
    if (tab === 'pret') loans(body, D); else checklist(body, D);
    focusTitle(root);
  }

  function checklist(box, D) {
    const done = store.get(CHECK_KEY, {});
    const total = D.checklist.reduce((t, s) => t + s.items.length, 0);
    const count = h('p', { class: 'pp-note', 'aria-live': 'polite' });
    const upd = () => { count.textContent = Object.values(done).filter(Boolean).length + ' sur ' + total + ' fait'; };
    fill(box, 
      ...D.checklist.map((s, si) => section(s.titre, h('ul', { class: 'pp-check' }, s.items.map((it, ii) => {
        const key = si + ':' + ii;
        return h('li', null, h('label', { class: 'pp-choice' },
          h('input', { type: 'checkbox', checked: !!done[key], onchange: e => { done[key] = e.target.checked; store.set(CHECK_KEY, done); upd(); } }),
          h('span', null, it)));
      })))),
      count,
      h('p', { class: 'pp-actions' }, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { store.set(CHECK_KEY, {}); checklist(box, D); toast('Checklist remise à zéro'); } }, 'Nouvelle démo (tout décocher)')));
    upd();
  }

  function loans(box, D) {
    const list = store.get(LOAN_KEY, []);
    const save = () => { store.set(LOAN_KEY, list); loans(box, D); };
    const status = (x) => x.rendu ? 'Rendu le ' + fmtDate(x.rendu) : (x.retour && x.retour < today() ? 'En retard' : 'En prêt');
    const pSel = productSelect({ id: 'loan-p', placeholder: 'Produit…' }, '');
    const serial = h('input', { class: 'pp-input', id: 'loan-sn', autocomplete: 'off', placeholder: 'N° de série' });
    const who = h('input', { class: 'pp-input', id: 'loan-who', autocomplete: 'off', placeholder: 'Client ou société' });
    const out = h('input', { class: 'pp-input', id: 'loan-out', type: 'date', value: today() });
    const back = h('input', { class: 'pp-input', id: 'loan-back', type: 'date' });
    const etat = h('select', { class: 'pp-select', id: 'loan-etat' }, D.etats.map(e => h('option', { value: e }, e)));
    const open = list.filter(x => !x.rendu);
    fill(box, 
      section('Nouveau prêt', h('form', { class: 'pp-form pp-form--grid', onsubmit: (e) => {
        e.preventDefault();
        if (!pSel.value || !who.value.trim()) { toast('Choisissez le produit et indiquez l\'emprunteur'); return; }
        list.unshift({ product: pSel.value, sn: serial.value.trim(), qui: who.value.trim(), sortie: out.value || today(), retour: back.value, etat: etat.value });
        save(); toast('Prêt enregistré');
      } },
        h('label', { class: 'pp-field', for: 'loan-p' }, 'Produit'), pSel,
        h('label', { class: 'pp-field', for: 'loan-sn' }, 'N° de série'), serial,
        h('label', { class: 'pp-field', for: 'loan-who' }, 'Emprunteur'), who,
        h('label', { class: 'pp-field', for: 'loan-out' }, 'Sortie'), out,
        h('label', { class: 'pp-field', for: 'loan-back' }, 'Retour prévu'), back,
        h('label', { class: 'pp-field', for: 'loan-etat' }, 'État au départ'), etat,
        h('button', { type: 'submit', class: 'btn btn--primary' }, 'Enregistrer le prêt'))),
      section('Matériel prêté (' + open.length + ' en cours)',
        list.length ? h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table' },
          h('thead', null, h('tr', null, ['Produit', 'Emprunteur', 'Sortie', 'Retour prévu', 'Statut', ''].map(x => h('th', { scope: 'col' }, x)))),
          h('tbody', null, list.map((x, i) => h('tr', { class: status(x) === 'En retard' ? 'is-late' : null },
            h('th', { scope: 'row' }, productLink(x.product), x.sn ? h('span', { class: 'pp-note' }, ' · ' + x.sn) : null),
            h('td', null, x.qui), h('td', null, fmtDate(x.sortie)), h('td', null, fmtDate(x.retour)),
            h('td', null, status(x)),
            h('td', { class: 'pp-cell-actions' },
              x.rendu ? null : h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: () => { x.rendu = today(); save(); toast('Retour enregistré'); } }, 'Rendu'),
              h('button', { type: 'button', class: 'btn btn--small btn--ghost', 'aria-label': 'Supprimer', onclick: () => { list.splice(i, 1); save(); } }, '✕'))))))) : h('p', { class: 'empty' }, 'Aucun prêt enregistré.'),
        list.length ? h('p', { class: 'pp-actions' }, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => A.downloadFile('parc-de-pret-' + today() + '.csv',
          toCsv([['Produit', 'N° de série', 'Emprunteur', 'Sortie', 'Retour prévu', 'État au départ', 'Statut'],
            ...list.map(x => { const p = A.data().products.get(x.product); return [p ? A.productLabel(p) : x.product, x.sn, x.qui, x.sortie, x.retour, x.etat, status(x)]; })]), 'text/csv;charset=utf-8') }, 'Exporter (tableur CSV)')) : null));
  }

  /* =======================================================================
     Aiguillage
     ======================================================================= */
  async function render(route, root) {
    fill(root, h('p', { class: 'pstatus' }, 'Chargement…'));
    const sub = route.sub || [];
    switch (route.page) {
      case 'projet': return pageProjet(root);
      case 'visite': return pageVisite(root);
      case 'outils': return pageOutils(root, sub);
      case 'formation': return pageFormation(root, sub);
      case 'comparer': return pageComparer(root, route.params || {});
      case 'demos': return pageDemos(root, sub);
      default: fill(root, errorBox(new Error('Page inconnue')));
    }
  }

  window.DIAGSAV_PAGES = { render, updateTour, startTour };
})();
