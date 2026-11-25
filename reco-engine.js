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

  /* ---------------- questions et réponses ---------------- */
  /** Réponses typées (nombres convertis), limitées aux questions connues. */
  function cleanAnswers(data, raw) {
    const out = {};
    for (const q of data.questions || []) {
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
    return (data.questions || []).filter(q => test(q.si, env));
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
    const calculs = [];
    for (const c of data.calculs || []) {
      if (!test(c.si, env)) continue;
      const v = value(c.formule, env);
      if (v === undefined) continue;
      values[c.id] = v;
      calculs.push({ id: c.id, label: c.label, value: v, unite: c.unite || '', decimales: c.decimales == null ? 1 : c.decimales, source: c.source, status: c.status });
    }
    const modules = [];
    for (const m of data.modules || []) {
      const matched = (m.regles || []).filter(r => test(r.si, env) && (!r.niveaux || !r.niveaux.length || r.niveaux.includes(niveau)));
      const used = m.mode === 'toutes' ? matched : matched.slice(0, 1);
      const items = [];
      const notes = [];
      used.forEach(r => {
        (r.items || []).forEach((it, i) => {
          const q = value(it.qte == null ? 1 : it.qte, env);
          const qty = q === undefined ? 1 : Math.max(0, Math.round(q));
          if (!qty) return;
          const key = m.id + ':' + (m.regles || []).indexOf(r) + ':' + i;
          const swapped = ctx.swaps && ctx.swaps[niveau + '|' + key];
          items.push({ key, product: swapped || it.produit, original: it.produit, qty, why: fill(it.pourquoi, env) });
        });
        if (r.note) notes.push(fill(r.note, env));
      });
      if (items.length || notes.length) modules.push({ id: m.id, titre: m.titre, items, notes });
    }
    const all = modules.flatMap(m => m.items);
    const alerts = [];
    for (const c of data.controles || []) {
      try { alerts.push(...runCheck(c, { env, all, answers, ctx })); }
      catch (err) { alerts.push({ niveau: 'info', message: 'Contrôle « ' + (c.type || '?') + ' » impossible : ' + err.message }); }
    }
    return { niveau, calculs, modules, alerts, values };
  }

  /* ---------------- contrôles de cohérence ---------------- */
  function poeWatts(pid, outils) {
    const poe = (outils && outils.poe) || {};
    const dev = (poe.appareils || []).find(a => a.product === pid);
    if (!dev) return 0;
    const n = (poe.normes || []).find(x => x.id === dev.norme);
    return n ? n.watts : 0;
  }
  function runCheck(c, { env, all, answers, ctx }) {
    const out = [];
    const products = ctx.products || new Map();
    const label = pid => { const p = products.get && products.get(pid); return p ? (p.brand + ' ' + p.model) : pid; };
    if (c.type === 'regle') {
      if (test(c.si, env)) out.push({ niveau: c.niveau || 'alerte', message: fill(c.message, env), source: c.source });
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
    const known = new Set(['niveau']);
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
    });
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
    });
    const mIds = new Set();
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
          if (!it.produit) w.push(rw + ', ligne ' + (k + 1) + ' : produit manquant.');
          else if (!hasProduct(it.produit)) w.push(rw + ' : produit inconnu du catalogue (« ' + it.produit + ' »).');
          checkExpr(it.qte, rw + ', quantité', known);
        });
      });
    });
    (data.controles || []).forEach((c, i) => {
      const where = 'Contrôle ' + (i + 1) + ' (' + (c.type || '?') + ')';
      if (c.type === 'regle') { checkExpr(c.si, where, known); if (!c.message) w.push(where + ' : message manquant.'); }
      else if (c.type === 'reseau' || c.type === 'longueur') { if (!qIds.has(c.question)) w.push(where + ' : question « ' + c.question + ' » inconnue.'); }
      else if (c.type !== 'poe') w.push(where + ' : type inconnu (poe, reseau, longueur, regle).');
    });
    return w;
  }

  const API = { parse: compile, evaluate, refs, test, value, fill, cleanAnswers, visibleQuestions, compute, validate, fmtNum };
  root.DIAGSAV_RECO = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
