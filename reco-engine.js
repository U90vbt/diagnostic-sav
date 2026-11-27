/* =========================================================================
   DIAG·SAV — moteur de recommandation avant-vente (reco.json, schéma 2)
   Partagé par le site (window.DIAGSAV_RECO) et le vérificateur Node
   (tools/validate.mjs). Aucune dépendance, aucun eval : les formules et
   conditions de reco.json sont lues par un petit analyseur dédié.

   Formules et conditions (texte simple, modifiable dans l'éditeur) :
     nombres 12 · 2.5 (point décimal) · textes "conf" · réponses jauge, type… ·
     paramètres p.micro_zone_m2 · calculs déjà faits surface…
     + - * /  ( )  ==  !=  <  <=  >  >=  et  ou  non  dans ["a","b"]
     fonctions : arrondi_sup(x) arrondi_inf(x) arrondi(x) min(a,b) max(a,b)
   Exemple : type == "conf" et jauge > 100 et niveau dans ["confort","premium"]
   ========================================================================= */
(function (root) {
  'use strict';

  /* ---------------- analyseur d'expressions ---------------- */
  const FUNCS = {
    arrondi_sup: Math.ceil, arrondi_inf: Math.floor, arrondi: Math.round,
    min: Math.min, max: Math.max, racine: Math.sqrt
  };
  const WORDS = { et: 'and', ou: 'or', non: 'not', dans: 'in', vrai: 'true', faux: 'false', and: 'and', or: 'or', not: 'not', in: 'in', true: 'true', false: 'false' };

  function tokenize(src) {
    const out = [];
    let i = 0;
    const s = String(src);
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
        const raw = s.slice(i, j);
        // décimales avec un point (2.5) : la virgule sépare les arguments de min(a, b)
        out.push({ t: 'num', v: Number(raw) });
        if (isNaN(out[out.length - 1].v)) throw new Error('nombre invalide « ' + raw + ' »');
        i = j; continue;
      }
      if (c === '"' || c === '\'' || c === '«') {
        const close = c === '«' ? '»' : c;
        const j = s.indexOf(close, i + 1);
        if (j < 0) throw new Error('texte non fermé');
        out.push({ t: 'str', v: s.slice(i + 1, j).trim() }); i = j + 1; continue;
      }
      if (/[A-Za-zÀ-ÿ_]/.test(c)) {
        let j = i; while (j < s.length && /[A-Za-zÀ-ÿ0-9_.]/.test(s[j])) j++;
        const w = s.slice(i, j);
        const kw = WORDS[w.toLowerCase()];
        out.push(kw ? { t: 'kw', v: kw } : { t: 'id', v: w });
        i = j; continue;
      }
      const two = s.slice(i, i + 2);
      if (['==', '!=', '<=', '>='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/<>()[],='.includes(c)) { out.push({ t: 'op', v: c === '=' ? '==' : c }); i++; continue; }
      throw new Error('caractère inattendu « ' + c + ' »');
    }
    return out;
  }

  function parse(src) {
    if (typeof src === 'number') return { k: 'num', v: src };
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = v => peek() && (peek().t === 'op' || peek().t === 'kw') && peek().v === v;
    const eat = v => { if (!isOp(v)) throw new Error('« ' + v + ' » attendu'); p++; };
    function primary() {
      const t = peek();
      if (!t) throw new Error('expression incomplète');
      if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
      if (t.t === 'str') { p++; return { k: 'str', v: t.v }; }
      if (t.t === 'kw' && (t.v === 'true' || t.v === 'false')) { p++; return { k: 'bool', v: t.v === 'true' }; }
      if (isOp('(')) { p++; const e = or(); eat(')'); return e; }
      if (isOp('[')) {
        p++; const items = [];
        if (!isOp(']')) { items.push(or()); while (isOp(',')) { p++; items.push(or()); } }
        eat(']'); return { k: 'list', items };
      }
      if (t.t === 'id') {
        p++;
        if (isOp('(')) {
          if (!FUNCS[t.v]) throw new Error('fonction inconnue « ' + t.v + ' »');
          p++; const args = [];
          if (!isOp(')')) { args.push(or()); while (isOp(',')) { p++; args.push(or()); } }
          eat(')'); return { k: 'call', f: t.v, args };
        }
        return { k: 'ref', v: t.v };
      }
      throw new Error('élément inattendu « ' + t.v + ' »');
    }
    function unary() {
      if (isOp('-')) { p++; return { k: 'neg', e: unary() }; }
      if (isOp('not')) { p++; return { k: 'not', e: unary() }; }
      return primary();
    }
    function mul() { let l = unary(); while (isOp('*') || isOp('/')) { const o = toks[p++].v; l = { k: 'bin', o, l, r: unary() }; } return l; }
    function add() { let l = mul(); while (isOp('+') || isOp('-')) { const o = toks[p++].v; l = { k: 'bin', o, l, r: mul() }; } return l; }
    function cmp() {
      let l = add();
      for (const o of ['==', '!=', '<=', '>=', '<', '>', 'in']) if (isOp(o)) { p++; return { k: 'bin', o, l, r: add() }; }
      return l;
    }
    function and() { let l = cmp(); while (isOp('and')) { p++; l = { k: 'and', l, r: cmp() }; } return l; }
    function or() { let l = and(); while (isOp('or')) { p++; l = { k: 'or', l, r: and() }; } return l; }
    const ast = or();
    if (p < toks.length) throw new Error('fin inattendue près de « ' + toks[p].v + ' »');
    return ast;
  }

  const cache = new Map();
  function compile(src) {
    const key = typeof src === 'number' ? '#' + src : String(src);
    if (!cache.has(key)) cache.set(key, parse(src));
    return cache.get(key);
  }

  /** Évalue ; une réponse absente vaut undefined (toute comparaison avec elle est fausse). */
  function evaluate(ast, env) {
    switch (ast.k) {
      case 'num': case 'str': case 'bool': return ast.v;
      case 'list': return ast.items.map(e => evaluate(e, env));
      case 'ref': return lookup(ast.v, env);
      case 'neg': { const v = evaluate(ast.e, env); return typeof v === 'number' ? -v : undefined; }
      case 'not': return !evaluate(ast.e, env);
      case 'and': return !!evaluate(ast.l, env) && !!evaluate(ast.r, env);
      case 'or': return !!evaluate(ast.l, env) || !!evaluate(ast.r, env);
      case 'call': {
        const args = ast.args.map(e => evaluate(e, env));
        if (args.some(a => typeof a !== 'number' || isNaN(a))) return undefined;
        return FUNCS[ast.f](...args);
      }
      case 'bin': {
        const l = evaluate(ast.l, env), r = evaluate(ast.r, env);
        if (ast.o === 'in') return Array.isArray(r) && r.includes(l);
        if (l === undefined || r === undefined) return ast.o === '!=' ? l !== r : (['==', '<', '>', '<=', '>='].includes(ast.o) ? false : undefined);
        switch (ast.o) {
          case '+': return l + r; case '-': return l - r; case '*': return l * r;
          case '/': return r === 0 ? undefined : l / r;
          case '==': return l == r; case '!=': return l != r; // eslint-disable-line eqeqeq
          case '<': return l < r; case '>': return l > r; case '<=': return l <= r; case '>=': return l >= r;
        }
      }
    }
    return undefined;
  }
  function lookup(name, env) {
    if (name.startsWith('p.')) { const prm = env.params[name.slice(2)]; return prm ? Number(prm.valeur) : undefined; }
    if (name === 'niveau') return env.niveau;
    if (name === 'salle') return env.salle;
    // dans un bloc « par salle », « surface » désigne la réponse de la salle en cours (surface_2…)
    if (env.salle !== undefined && (name + '_' + env.salle) in env.values) return env.values[name + '_' + env.salle];
    if (name in env.values) return env.values[name];
    return undefined;
  }
  /** Identifiants utilisés par une expression (pour le contrôle des références). */
  function refs(ast, out = []) {
    if (!ast || typeof ast !== 'object') return out;
    if (ast.k === 'ref') out.push(ast.v);
    for (const key of ['l', 'r', 'e']) if (ast[key]) refs(ast[key], out);
    for (const a of ast.items || ast.args || []) refs(a, out);
    return out;
  }
  function test(src, env) {
    if (src == null || src === '') return true;
    try { return !!evaluate(compile(src), env); } catch { return false; }
  }
  function value(src, env) {
    try { const v = evaluate(compile(src), env); return typeof v === 'number' && isFinite(v) ? v : undefined; } catch { return undefined; }
  }
  /** Remplace {jauge}, {p.marge}… dans un message. */
  function fill(text, env) {
    return String(text || '').replace(/\{([^}]+)\}/g, (m, expr) => {
      try {
        const v = evaluate(compile(expr), env);
        return v === undefined ? '?' : (typeof v === 'number' ? fmtNum(v) : String(v));
      } catch { return m; }
    });
  }
  const fmtNum = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('fr-FR');

  /* ---------------- salles multiples ---------------- */
  /** Nombre maximal de salles (meta.salles.max, 4 par défaut). */
  const roomsMax = data => Math.max(1, Math.min(8, Number(((data.meta || {}).salles || {}).max) || 4));
  /** Nombre de salles de la configuration (0 si le projet n'est pas multi-salles). */
  function roomsCount(data, env) {
    const cfg = (data.meta || {}).salles;
    if (!cfg || !cfg.nombre || !test(cfg.si, env)) return 0;
    const n = value(cfg.nombre, env);
    return n === undefined ? 0 : Math.max(0, Math.min(roomsMax(data), Math.round(n)));
  }
  const subRoom = (txt, k, maitre) => txt == null ? txt : String(txt).replace(/\{salle\}/g, String(k)).replace(/\{maitre\}/g, String(maitre));
  const qCache = new WeakMap();
  /** Questions avec les questions « par salle » dépliées (surface → surface_1, surface_2…). */
  function questions(data) {
    if (qCache.has(data)) return qCache.get(data);
    const nb = ((data.meta || {}).salles || {}).nombre;
    const out = [];
    for (const q of data.questions || []) {
      if (!q.par_salle) { out.push(q); continue; }
      for (let k = 1; k <= roomsMax(data); k++) {
        const cond = [q.si ? '(' + q.si + ')' : '', nb ? nb + ' >= ' + k : ''].filter(Boolean).join(' et ');
        out.push(Object.assign({}, q, { id: q.id + '_' + k, label: subRoom(q.label, k), texte: subRoom(q.texte, k), aide: subRoom(q.aide, k), si: cond, gabarit: q.id, par_salle: undefined }));
      }
    }
    qCache.set(data, out);
    return out;
  }

  /* ---------------- questions et réponses ---------------- */
  /** Réponses typées (nombres convertis), limitées aux questions connues. */
  function cleanAnswers(data, raw) {
    const out = {};
    for (const q of questions(data)) {
      if (!(q.id in raw)) continue;
      const v = raw[q.id];
      if (q.type === 'nombre') {
        const n = Number(String(v).replace(',', '.'));
        if (isFinite(n)) out[q.id] = n;
      } else if ((q.options || []).some(o => o.id === v)) out[q.id] = v;
    }
    return out;
  }
  /** Questions visibles compte tenu des réponses, dans l'ordre du fichier. */
  function visibleQuestions(data, answers) {
    const env = { values: answers, params: data.parametres || {}, niveau: undefined };
    return questions(data).filter(q => test(q.si, env));
  }

  /* ---------------- calcul d'une configuration ---------------- */
  /**
   * @param data   reco.json (schéma 2)
   * @param answers réponses typées
   * @param niveau  identifiant de niveau (essentiel, confort, premium…)
   * @param ctx    { products: Map, catalogue: {products}, outils, swaps: {clé: produit} }
   */
  function compute(data, answers, niveau, ctx = {}) {
    const params = data.parametres || {};
    const values = Object.assign({}, answers);
    const env = { values, params, niveau };
    const n = roomsCount(data, env);
    const maitre = Math.min(Math.max(1, Math.round(values.salle_maitre || 1)), Math.max(1, n));
    const rooms = Array.from({ length: n }, (_, i) => i + 1);
    const calculs = [];
    const brand = brandOf(data, answers);
    const pushCalc = (c, v, k) => calculs.push({ id: k ? c.id + '_' + k : c.id, label: k ? c.label + ' · salle ' + k : c.label, value: v,
      unite: c.unite || '', decimales: c.decimales == null ? 1 : c.decimales, source: c.source, status: c.status });
    for (const c of data.calculs || []) {
      if (c.par_salle) {
        for (const k of rooms) {
          const e = { values, params, niveau, salle: k };
          if (!test(c.si, e)) continue;
          const v = value(c.formule, e);
          if (v === undefined) continue;
          values[c.id + '_' + k] = v; pushCalc(c, v, k);
        }
        continue;
      }
      if (!test(c.si, env)) continue;
      const v = value(c.formule, env);
      if (v === undefined) continue;
      values[c.id] = v; pushCalc(c, v);
    }
    const modules = [];
    const alerts = [];
    const runModule = (m, e, k) => {
      const matched = (m.regles || []).filter(r => test(r.si, e) && (!r.niveaux || !r.niveaux.length || r.niveaux.includes(niveau)));
      const used = m.mode === 'toutes' ? matched : matched.slice(0, 1);
      const items = [];
      const notes = [];
      used.forEach(r => {
        (r.items || []).forEach((it, i) => {
          const q = value(it.qte == null ? 1 : it.qte, e);
          const qty = q === undefined ? 1 : Math.max(0, Math.round(q));
          if (!qty) return;
          const key = m.id + (k ? '@' + k : '') + ':' + (m.regles || []).indexOf(r) + ':' + i;
          let base = it.produit || null, auto = null;
          // marque imposée : remplacement automatique dans la même famille (blocs « filtre_marque »)
          if (base && brand && m.filtre_marque && ctx.products && ctx.products.get) {
            const pr = ctx.products.get(base);
            if (pr && String(pr.brand).toLowerCase() !== String(brand).toLowerCase()) {
              const alt = sameFamily(ctx.products, base, brand);
              if (alt) { auto = base; base = alt; }
              else alerts.push({ niveau: 'alerte', message: 'Pas d\'équivalent ' + brand + ' dans le catalogue pour ' + pr.brand + ' ' + pr.model + ' (' + m.titre + ').' });
            }
          }
          const swapped = base && ctx.swaps && ctx.swaps[niveau + '|' + key];
          items.push({ key, product: swapped || base, original: base, auto, qty, why: fill(it.pourquoi, e),
            libelle: it.libelle ? fill(it.libelle, e) : null, repere: subRoom(it.repere, k, maitre) || null, zone: subRoom(it.zone, k, maitre) || null,
            role: it.role || null, salle: k || null, inclus: it.inclus || null, source: it.source || null, status: it.status || null });
        });
        if (r.note) notes.push(fill(r.note, e));
      });
      if (items.length || notes.length) modules.push({ id: m.id + (k ? '@' + k : ''), titre: k ? m.titre + ' · salle ' + k : m.titre, salle: k || null, items, notes });
    };
    for (const m of data.modules || []) {
      if (m.par_salle) for (const k of rooms) runModule(m, { values, params, niveau, salle: k }, k);
      else runModule(m, env, null);
    }
    // ordre : blocs par salle groupés salle par salle, puis blocs communs
    modules.sort((x, y) => (x.salle || 99) - (y.salle || 99));
    const all = modules.flatMap(m => m.items);
    const liaisons = computeLinks(data, { values, params, niveau }, all, ctx, alerts, rooms, maitre);
    for (const c of data.controles || []) {
      try { alerts.push(...runCheck(c, { env, all, answers, ctx, liaisons, data })); }
      catch (err) { alerts.push({ niveau: 'info', message: 'Contrôle « ' + (c.type || '?') + ' » impossible : ' + err.message }); }
    }
    return { niveau, calculs, modules, alerts, values, liaisons, salles: n, maitre, zones: expandZones(data, n, maitre) };
  }

  /** Produit de la même famille et de la marque voulue (même type d'abord). */
  function sameFamily(products, pid, brand) {
    const pr = products.get(pid);
    const key = t => String(t || '').toLowerCase().split(/[ ,(·]/)[0];
    const list = [...products.entries()].filter(([id, p]) => id !== pid && p.family === pr.family && String(p.brand).toLowerCase() === String(brand).toLowerCase());
    list.sort((a, b) => (key(b[1].type) === key(pr.type)) - (key(a[1].type) === key(pr.type)));
    return list.length ? list[0][0] : null;
  }

  /** Zones du synoptique : les zones « par salle » dépliées, réparties de part et d'autre des zones communes. */
  function expandZones(data, n, maitre) {
    const fixed = [], rooms = [];
    for (const z of data.zones || []) {
      if (z.par_salle) for (let k = 1; k <= n; k++) rooms.push({ id: subRoom(z.id, k, maitre), label: subRoom(z.label, k, maitre) + (k === maitre && n > 1 && z.maitre ? ' · ' + z.maitre : ''), salle: k });
      else fixed.push({ id: z.id, label: z.label });
    }
    if (!rooms.length) return fixed;
    const left = rooms.filter((_, i) => i % 2 === 0), right = rooms.filter((_, i) => i % 2 === 1).reverse();
    return [...left, ...fixed, ...right];
  }

  /* ---------------- liaisons (synoptique) ---------------- */
  /** Liaisons dont les deux extrémités sont dans la configuration ; longueurs contrôlées. */
  function computeLinks(data, env, all, ctx, alerts, rooms = [], maitre = 1) {
    const byRef = new Map();
    for (const it of all) if (it.repere && !byRef.has(it.repere)) byRef.set(it.repere, it);
    const types = data.types_liaison || {};
    const ref = ((ctx.outils || {}).longueurs || {}).liaisons || [];
    const out = [];
    const one = (l, e, k) => {
      if (!test(l.si, e)) return;
      const a = byRef.get(subRoom(l.de, k, maitre)), b = byRef.get(subRoom(l.vers, k, maitre));
      if (!a || !b) return;
      const t = types[l.type] || {};
      const norme = ref.find(x => x.id === t.liaison);
      const max = t.max != null ? Number(t.max) : (norme ? norme.max : undefined);
      const len = l.longueur == null || l.longueur === '' ? undefined : value(l.longueur, e);
      out.push({ de: a, vers: b, portDe: l.port_de || '', portVers: l.port_vers || '', type: l.type, typeLabel: t.label || l.type,
        couleur: t.couleur || 0, longueur: len, max, over: len !== undefined && max !== undefined && len > max,
        solution: norme ? norme.solution : '', normeLabel: norme ? norme.label : '', note: fill(l.note, e), salle: k || null });
    };
    for (const l of data.liaisons || []) {
      if (l.par_salle) for (const k of rooms) one(l, Object.assign({}, env, { salle: k }), k);
      else one(l, env, null);
    }
    const groups = new Map();
    for (const l of out.filter(x => x.over)) {
      const g = groups.get(l.type) || { n: 0, len: 0, l };
      g.n++; g.len = Math.max(g.len, l.longueur); groups.set(l.type, g);
    }
    for (const { n, len, l } of groups.values()) {
      alerts.push({ niveau: 'erreur', message: n + ' liaison' + (n > 1 ? 's' : '') + ' « ' + l.typeLabel + ' » jusqu\'à ' + fmtNum(len, 0) + ' m : au-delà des ' + fmtNum(l.max, 0) + ' m ' + (l.normeLabel ? '(' + l.normeLabel + ')' : 'admis') + '. ' + (l.solution || '') });
    }
    return out;
  }

  /** Marque imposée par la réponse à la question désignée dans meta.question_marque (sinon null). */
  function brandOf(data, answers) {
    const qid = data.meta && data.meta.question_marque;
    if (!qid || !(qid in answers)) return null;
    const q = questions(data).find(x => x.id === qid);
    const o = q && (q.options || []).find(x => x.id === answers[qid]);
    return o && o.marque ? o.marque : null;
  }

  /* ---------------- contrôles de cohérence ---------------- */
  function poeWatts(pid, outils) {
    const poe = (outils && outils.poe) || {};
    const dev = (poe.appareils || []).find(a => a.product === pid);
    if (!dev) return 0;
    const n = (poe.normes || []).find(x => x.id === dev.norme);
    return n ? n.watts : 0;
  }
  /** Connectique d'un produit (connectique.json). */
  const conn = (ctx, pid) => (((ctx.connectique || {}).produits || {})[pid]) || null;
  const portCount = (ctx, pid, type) => { const c = conn(ctx, pid); const p = c && (c.ports || []).find(x => x.type === type); return p ? p.nombre : 0; };
  const itemLabel = (ctx, it) => { const p = it.product && ctx.products && ctx.products.get && ctx.products.get(it.product); return (it.libelle || (p ? p.brand + ' ' + p.model : it.product)) + (it.salle && !(it.libelle || '').includes('salle') ? ' (salle ' + it.salle + ')' : ''); };
  function runCheck(c, { env, all, answers, ctx, liaisons = [], data = {} }) {
    const out = [];
    const products = ctx.products || new Map();
    const label = pid => { const p = products.get && products.get(pid); return p ? (p.brand + ' ' + p.model) : pid; };
    if (c.type === 'regle') {
      if (test(c.si, env)) out.push({ niveau: c.niveau || 'alerte', message: fill(c.message, env), source: c.source });
      return out;
    }
    if (c.type === 'unicite') {
      if (!test(c.si, env)) return out;
      const n = all.filter(it => it.role === c.role).reduce((s, it) => s + it.qty, 0);
      if (n !== 1) out.push({ niveau: 'erreur', message: fill(c.message, env) + ' (' + n + ' trouvée' + (n > 1 ? 's' : '') + ')' });
      else if (c.ok) out.push({ niveau: 'ok', message: fill(c.ok, env) });
      return out;
    }
    if (c.type === 'ports') {
      // pour chaque équipement, liaisons arrivant sur un type de port comparées au nombre de ports (connectique.json)
      const types = data.types_liaison || {};
      const use = new Map();
      for (const l of liaisons) {
        const pt = (types[l.type] || {}).port;
        if (!pt) continue;
        for (const [host, other] of [[l.vers, l.de], [l.de, l.vers]]) {
          if (!host.product || !portCount(ctx, host.product, pt)) continue;
          const k = host.repere + '|' + pt;
          const u = use.get(k) || { it: host, pt, n: 0 };
          u.n += other.inclus ? 1 : other.qty; use.set(k, u);
          break;
        }
      }
      for (const { it, pt, n } of use.values()) {
        const cap = portCount(ctx, it.product, pt) * it.qty;
        const tl = ((ctx.connectique || {}).types_port || {})[pt] || pt;
        if (n > cap) out.push({ niveau: 'erreur', message: itemLabel(ctx, it) + ' : ' + n + ' raccordements « ' + tl + ' » pour ' + cap + ' port' + (cap > 1 ? 's' : '') + '.' });
      }
      return out;
    }
    if (c.type === 'poe' && ctx.connectique && liaisons.some(l => ((data.types_liaison || {})[l.type] || {}).poe)) {
      // budget exact : appareils raccordés en PoE à chaque switch, puissance selon leur norme (connectique.json, outils.json)
      const types = data.types_liaison || {};
      const normes = ((ctx.outils || {}).poe || {}).normes || [];
      const marge = ((ctx.outils || {}).poe || {}).marge || 0;
      const bySw = new Map();
      for (const l of liaisons) {
        if (!(types[l.type] || {}).poe) continue;
        const [sw, dev] = conn(ctx, l.vers.product) && conn(ctx, l.vers.product).poe_budget ? [l.vers, l.de] : [l.de, l.vers];
        const sc = conn(ctx, sw.product);
        if (!sc || !sc.poe_budget) continue;
        const g = bySw.get(sw.repere) || { sw, w: 0, unknown: [] };
        const dc = dev.product && conn(ctx, dev.product);
        const nm = dc && dc.poe ? normes.find(x => x.id === dc.poe) : null;
        if (nm) g.w += nm.watts * dev.qty;
        else if (!(dc && dc.poe === undefined && dc.ports)) g.unknown.push(itemLabel(ctx, dev) + (dev.qty > 1 ? ' × ' + dev.qty : ''));
        bySw.set(sw.repere, g);
      }
      for (const { sw, w, unknown } of bySw.values()) {
        const budget = conn(ctx, sw.product).poe_budget * sw.qty;
        const name = itemLabel(ctx, sw);
        if (w > budget) out.push({ niveau: 'erreur', message: name + ' : budget PoE dépassé, ' + fmtNum(w) + ' W réservés pour ' + fmtNum(budget, 0) + ' W.' });
        else if (w > budget * (1 - marge)) out.push({ niveau: 'alerte', message: name + ' : budget PoE juste, ' + fmtNum(w) + ' W sur ' + fmtNum(budget, 0) + ' W.' });
        else if (!unknown.length) out.push({ niveau: 'ok', message: name + ' : ' + fmtNum(w) + ' W PoE réservés sur ' + fmtNum(budget, 0) + ' W.' });
        if (unknown.length) out.push({ niveau: 'alerte', message: name + ' : budget PoE vérifiable en partie seulement (' + fmtNum(w) + ' W connus sur ' + fmtNum(budget, 0) + ' W). Consommation non renseignée pour ' + unknown.join(', ') + ' : à relever sur les notices, puis à saisir dans la connectique.' });
      }
      return out;
    }
    if (c.type === 'poe') {
      const outils = ctx.outils || {};
      const sw = ((outils.poe || {}).switchs || []);
      const powered = all.map(it => ({ it, w: poeWatts(it.product, outils) })).filter(x => x.w > 0);
      if (!powered.length) return out;
      const total = powered.reduce((s, x) => s + x.w * x.it.qty, 0);
      const ports = powered.reduce((s, x) => s + x.it.qty, 0);
      const switches = all.map(it => ({ it, s: sw.find(x => x.product === it.product) })).filter(x => x.s);
      if (!switches.length) {
        out.push({ niveau: 'alerte', message: ports + ' appareil(s) alimenté(s) en PoE (' + fmtNum(total) + ' W réservés au pire cas) sans switch PoE dans la configuration : prévoir un injecteur ou un switch PoE adapté.' });
        return out;
      }
      const budget = switches.reduce((s, x) => s + x.s.budget * x.it.qty, 0);
      const nports = switches.reduce((s, x) => s + x.s.ports * x.it.qty, 0);
      const marge = (outils.poe && outils.poe.marge) || 0;
      if (total > budget) out.push({ niveau: 'erreur', message: 'Budget PoE dépassé : ' + fmtNum(total) + ' W réservés pour ' + fmtNum(budget, 0) + ' W disponibles.' });
      else if (total > budget * (1 - marge)) out.push({ niveau: 'alerte', message: 'Budget PoE juste : ' + fmtNum(total) + ' W sur ' + fmtNum(budget, 0) + ' W, sans la marge de ' + Math.round(marge * 100) + ' % conseillée.' });
      else out.push({ niveau: 'ok', message: 'PoE : ' + fmtNum(total) + ' W réservés sur ' + fmtNum(budget, 0) + ' W disponibles.' });
      if (ports > nports) out.push({ niveau: 'erreur', message: 'Ports PoE insuffisants : ' + ports + ' appareils pour ' + nports + ' ports.' });
      return out;
    }
    if (c.type === 'reseau') {
      const ans = answers[c.question];
      if (ans === undefined || !(c.sans || []).includes(ans)) return out;
      const cat = (ctx.catalogue && ctx.catalogue.products) || {};
      const motif = new RegExp(c.motif || 'Dante|AES67|AV sur IP', 'i');
      const ip = [...new Set(all.filter(it => {
        const e = cat[it.product] || {};
        const facts = (e.facts || []).concat(...(e.extra || []).map(x => x.facts || []));
        return facts.some(f => motif.test(f));
      }).map(it => it.product))];
      if (ip.length) out.push({ niveau: 'alerte', message: (c.message || 'Ces produits utilisent l\'audio ou la vidéo sur IP alors qu\'aucun réseau dédié n\'est prévu : ') + ip.map(label).join(', ') + '.' });
      return out;
    }
    if (c.type === 'longueur') {
      const d = answers[c.question];
      const l = (((ctx.outils || {}).longueurs || {}).liaisons || []).find(x => x.id === c.liaison);
      if (d === undefined || !l) return out;
      if (d > l.max) out.push({ niveau: 'alerte', message: (c.libelle || 'Liaison') + ' de ' + fmtNum(d, 0) + ' m : au-delà des ' + l.max + ' m d\'une liaison « ' + l.label + ' ». ' + (l.solution || ''), source: l.source });
      return out;
    }
    throw new Error('type inconnu');
  }

  /* ---------------- contrôle du fichier ---------------- */
  /** Messages en français ; hasProduct(pid) → bool. */
  function validate(data, hasProduct = () => true) {
    const w = [];
    if (!data || typeof data !== 'object') return ['Le fichier reco.json est vide ou mal formé.'];
    if (data.meta && data.meta.schema !== 2) w.push('reco.json : « meta.schema » doit valoir 2.');
    const qs = data.questions || [];
    const known = new Set(['niveau', 'salle']);
    const sal = (data.meta || {}).salles;
    const qIds = new Set();
    const niveaux = new Set((data.niveaux || []).map(n => n.id));
    if (!niveaux.size) w.push('reco.json : aucun niveau défini (« niveaux »).');
    const ID = /^[a-z][a-z0-9_]*$/;
    const checkExpr = (src, where, allowed) => {
      if (src == null || src === '') return;
      try {
        const ast = compile(src);
        for (const r of refs(ast)) {
          if (r.startsWith('p.')) { if (!(data.parametres || {})[r.slice(2)]) w.push(where + ' : paramètre « ' + r + ' » inconnu.'); }
          else if (!allowed.has(r)) w.push(where + ' : « ' + r + ' » n\'est ni une question, ni un calcul déjà défini.');
        }
      } catch (e) { w.push(where + ' : formule illisible (« ' + src + ' ») — ' + e.message + '.'); }
    };
    if (!qs.length) w.push('reco.json : aucune question.');
    qs.forEach((q, i) => {
      const where = 'Question « ' + (q.label || q.id || i + 1) + ' »';
      if (!q.id || !ID.test(q.id)) w.push(where + ' : identifiant invalide (minuscules, chiffres et _ ; commence par une lettre).');
      else if (qIds.has(q.id)) w.push(where + ' : identifiant « ' + q.id + ' » en double.');
      if (!q.texte) w.push(where + ' : texte de la question manquant.');
      if (q.type === 'choix') {
        if (!(q.options || []).length) w.push(where + ' : aucune réponse proposée.');
        const ids = new Set();
        (q.options || []).forEach(o => {
          if (!o.id || !o.label) w.push(where + ' : réponse sans identifiant ou sans libellé.');
          if (ids.has(o.id)) w.push(where + ' : réponse « ' + o.id + ' » en double.');
          ids.add(o.id);
        });
      } else if (q.type === 'nombre') {
        if (q.min != null && q.max != null && Number(q.min) > Number(q.max)) w.push(where + ' : minimum supérieur au maximum.');
      } else w.push(where + ' : type « ' + q.type + ' » inconnu (choix ou nombre).');
      checkExpr(q.si, where + ' (condition d\'affichage)', known);
      qIds.add(q.id); known.add(q.id);
      if (q.par_salle) for (let k = 1; k <= roomsMax(data); k++) { known.add(q.id + '_' + k); qIds.add(q.id + '_' + k); }
    });
    if (sal && sal.nombre) { checkExpr(sal.nombre, 'meta.salles.nombre', known); checkExpr(sal.si, 'meta.salles.si', known); }
    for (const [id, prm] of Object.entries(data.parametres || {})) {
      if (!ID.test(id)) w.push('Paramètre « ' + id + ' » : identifiant invalide.');
      if (typeof prm.valeur !== 'number' || !isFinite(prm.valeur)) w.push('Paramètre « ' + id + ' » : valeur numérique attendue.');
    }
    (data.calculs || []).forEach((c, i) => {
      const where = 'Calcul « ' + (c.label || c.id || i + 1) + ' »';
      if (!c.id || !ID.test(c.id)) w.push(where + ' : identifiant invalide.');
      else if (known.has(c.id)) w.push(where + ' : identifiant « ' + c.id + ' » déjà utilisé.');
      if (c.formule == null || c.formule === '') w.push(where + ' : formule manquante.');
      checkExpr(c.si, where + ' (condition)', known);
      checkExpr(c.formule, where, known);
      known.add(c.id);
      if (c.par_salle) for (let k = 1; k <= roomsMax(data); k++) known.add(c.id + '_' + k);
    });
    const mIds = new Set();
    const reperes = new Set();
    const zones = new Set((data.zones || []).map(z => z.id));
    (data.zones || []).forEach((z, i) => { if (!z.id || !/^[a-z][a-z0-9_]*(\{salle\})?[a-z0-9_]*$/.test(z.id)) w.push('Zone ' + (i + 1) + ' : identifiant invalide.'); if (z.par_salle && !String(z.id).includes('{salle}')) w.push('Zone « ' + z.id + ' » : une zone par salle doit contenir {salle} dans son identifiant.'); if (!z.label) w.push('Zone « ' + (z.id || i + 1) + ' » : libellé manquant.'); });
    (data.modules || []).forEach((m, i) => {
      const where = 'Bloc « ' + (m.titre || m.id || i + 1) + ' »';
      if (!m.id) w.push(where + ' : identifiant manquant.');
      else if (mIds.has(m.id)) w.push(where + ' : identifiant « ' + m.id + ' » en double.');
      mIds.add(m.id);
      if (!m.titre) w.push(where + ' : titre manquant.');
      (m.regles || []).forEach((r, j) => {
        const rw = where + ', règle ' + (j + 1);
        checkExpr(r.si, rw + ' (condition)', known);
        for (const n of r.niveaux || []) if (!niveaux.has(n)) w.push(rw + ' : niveau « ' + n + ' » inconnu.');
        if (!(r.items || []).length && !r.note) w.push(rw + ' : ni produit, ni remarque.');
        (r.items || []).forEach((it, k) => {
          const lw = rw + ', ligne ' + (k + 1);
          if (!it.produit && !it.libelle) w.push(lw + ' : ni produit du catalogue, ni libellé hors catalogue.');
          else if (it.produit && !hasProduct(it.produit)) w.push(rw + ' : produit inconnu du catalogue (« ' + it.produit + ' »).');
          if (it.produit && it.libelle) w.push(lw + ' : choisir un produit du catalogue OU un libellé hors catalogue, pas les deux.');
          if (it.repere != null && !/^[a-z][a-z0-9_]*$/.test(String(it.repere).replace(/\{(salle|maitre)\}/g, 'x'))) w.push(lw + ' : repère « ' + it.repere + ' » invalide (minuscules, chiffres et _).');
          if (it.repere) reperes.add(String(it.repere).replace(/\{maitre\}/g, '{salle}'));
          if (it.zone && !zones.has(String(it.zone).replace(/\{maitre\}/g, '{salle}'))) w.push(lw + ' : zone « ' + it.zone + ' » inconnue.');
          if (it.repere && /\{salle\}/.test(it.repere) && !m.par_salle) w.push(lw + ' : « {salle} » dans le repère d\'un bloc qui n\'est pas « par salle ».');
          if (it.inclus && it.produit === it.inclus) w.push(lw + ' : un produit ne peut pas être inclus dans lui-même.');
          checkExpr(it.qte, rw + ', quantité', known);
        });
      });
    });
    (data.controles || []).forEach((c, i) => {
      const where = 'Contrôle ' + (i + 1) + ' (' + (c.type || '?') + ')';
      if (c.type === 'regle') { checkExpr(c.si, where, known); if (!c.message) w.push(where + ' : message manquant.'); }
      else if (c.type === 'reseau' || c.type === 'longueur') { if (!qIds.has(c.question)) w.push(where + ' : question « ' + c.question + ' » inconnue.'); }
      else if (c.type === 'unicite') { if (!c.role) w.push(where + ' : rôle manquant.'); if (!c.message) w.push(where + ' : message manquant.'); checkExpr(c.si, where, known); }
      else if (c.type !== 'poe' && c.type !== 'ports') w.push(where + ' : type inconnu (poe, ports, unicite, reseau, longueur, regle).');
    });
    const types = data.types_liaison || {};
    for (const [id, t] of Object.entries(types)) {
      if (!/^[a-z][a-z0-9_]*$/.test(id)) w.push('Type de liaison « ' + id + ' » : identifiant invalide.');
      if (!t.label) w.push('Type de liaison « ' + id + ' » : libellé manquant.');
    }
    (data.liaisons || []).forEach((l, i) => {
      const where = 'Liaison ' + (i + 1) + ' (' + (l.de || '?') + ' → ' + (l.vers || '?') + ')';
      const norm = x => String(x || '').replace(/\{maitre\}/g, '{salle}');
      if (!l.de || !reperes.has(norm(l.de))) w.push(where + ' : repère de départ « ' + (l.de || '') + ' » absent des blocs.');
      if (!l.vers || !reperes.has(norm(l.vers))) w.push(where + ' : repère d\'arrivée « ' + (l.vers || '') + ' » absent des blocs.');
      if (l.de && l.de === l.vers) w.push(where + ' : départ et arrivée identiques.');
      if (!types[l.type]) w.push(where + ' : type « ' + (l.type || '') + ' » inconnu.');
      checkExpr(l.si, where + ' (condition)', known);
      checkExpr(l.longueur, where + ' (longueur)', known);
    });
    const mq = data.meta && data.meta.question_marque;
    if (mq && !qIds.has(mq)) w.push('meta.question_marque : question « ' + mq + ' » inconnue.');
    return w;
  }

  const API = { questions, roomsCount, expandZones, brandOf, parse: compile, evaluate, refs, test, value, fill, cleanAnswers, visibleQuestions, compute, validate, fmtNum };
  root.DIAGSAV_RECO = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
