#!/usr/bin/env node
/* =========================================================================
   DIAG·SAV — vérification des fichiers data/*.json (sans dépendance)
   Usage : node tools/validate.mjs [dossier]   (par défaut : data/)
   Code de sortie 1 s'il y a au moins une erreur ; les avertissements
   ne bloquent pas. Seuls les champs réellement utilisés par le site sont
   exigés : un champ facultatif absent n'est jamais une erreur.
   ========================================================================= */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.argv[2] || 'data');
const errors = [];
const warnings = [];
const err = (file, path, msg) => errors.push(`${file} › ${path} : ${msg}`);
const warn = (file, path, msg) => warnings.push(`${file} › ${path} : ${msg}`);

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = v => typeof v === 'string' && v.trim() !== '';
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9+]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lit un JSON ; renvoie null (avec erreur) si absent ou invalide. */
function load(name, required = true) {
  const p = join(DIR, name);
  if (!existsSync(p)) { if (required) err(name, '-', 'fichier absent'); return null; }
  const text = readFileSync(p, 'utf8');
  try { return JSON.parse(text); }
  catch (e) {
    const m = /position (\d+)/.exec(e.message);
    let where = '';
    if (m) { const before = text.slice(0, Number(m[1])); where = ` (ligne ${before.split('\n').length})`; }
    err(name, '-', 'JSON invalide' + where + ' — ' + e.message);
    return null;
  }
}

function need(file, path, obj, key, check = isStr, what = 'texte non vide') {
  if (!(key in obj)) { err(file, path, `champ « ${key} » manquant`); return false; }
  if (!check(obj[key])) { err(file, path, `champ « ${key} » : ${what} attendu`); return false; }
  return true;
}
function checkId(file, path, id) {
  if (!ID_RE.test(id)) err(file, path, `identifiant « ${id} » : minuscules, chiffres et tirets uniquement`);
}
/** Doublons dans une liste d'objets à identifiant. */
function uniqueIds(file, path, list, key = 'id') {
  const seen = new Set();
  list.forEach((x, i) => {
    if (!isObj(x)) return;
    const id = x[key];
    if (seen.has(id)) err(file, `${path}[${i}]`, `identifiant « ${id} » en double`);
    seen.add(id);
  });
  return seen;
}
const isLocalImage = s => isStr(s) && /^img\/[a-z0-9/_.-]+\.(svg|png|jpe?g|webp)$/i.test(s) && !s.includes('..');

/* ---------------- decisions.json ---------------- */
const D = load('decisions.json');
const symptomIds = new Set();
const productIds = new Set();
if (D) {
  const F = 'decisions.json';
  for (const k of ['meta', 'severities', 'categories', 'symptoms', 'nodes']) if (!(k in D)) err(F, k, 'section manquante');
  const sev = isObj(D.severities) ? D.severities : {};
  const cats = Array.isArray(D.categories) ? D.categories : [];
  const catIds = uniqueIds(F, 'categories', cats);
  cats.forEach((c, i) => { need(F, `categories[${i}]`, c, 'id'); need(F, `categories[${i}]`, c, 'label'); });
  const nodes = isObj(D.nodes) ? D.nodes : {};
  const sources = isObj(D.sources) ? D.sources : {};
  const families = isObj(D.families) ? D.families : {};
  const products = isObj(D.products) ? D.products : {};
  Object.keys(products).forEach(id => productIds.add(id));
  const syms = Array.isArray(D.symptoms) ? D.symptoms : [];
  uniqueIds(F, 'symptoms', syms).forEach(id => symptomIds.add(id));

  syms.forEach((s, i) => {
    const p = `symptoms[${i}] (${s && s.id})`;
    if (!isObj(s)) return err(F, p, 'objet attendu');
    need(F, p, s, 'id') && checkId(F, p, s.id);
    need(F, p, s, 'title');
    if (need(F, p, s, 'category') && !catIds.has(s.category)) err(F, p, `catégorie « ${s.category} » inconnue`);
    if ('keywords' in s && !Array.isArray(s.keywords)) err(F, p, '« keywords » doit être une liste');
    if (need(F, p, s, 'start') && !nodes[s.start]) err(F, p, `étape de départ « ${s.start} » introuvable`);
  });

  const reached = new Set();
  for (const [id, n] of Object.entries(nodes)) {
    const p = `nodes.${id}`;
    checkId(F, p, id);
    if (!isObj(n)) { err(F, p, 'objet attendu'); continue; }
    if (n.status !== undefined && n.status !== 'draft') err(F, p, '« status » ne peut valoir que "draft"');
    if (n.type === 'question') {
      need(F, p, n, 'text');
      if (!Array.isArray(n.options) || n.options.length < 1) { err(F, p, 'au moins une réponse attendue dans « options »'); continue; }
      n.options.forEach((o, j) => {
        const q = `${p}.options[${j}]`;
        need(F, q, o, 'label');
        const hasNext = 'next' in o, hasSym = 'symptom' in o;
        if (hasNext === hasSym) err(F, q, 'il faut soit « next », soit « symptom »');
        else if (hasNext) { if (!nodes[o.next]) err(F, q, `étape suivante « ${o.next} » introuvable`); else reached.add(o.next); }
        else if (!symptomIds.has(o.symptom)) err(F, q, `symptôme « ${o.symptom} » introuvable`);
      });
    } else if (n.type === 'result') {
      need(F, p, n, 'title');
      if (need(F, p, n, 'severity') && !sev[n.severity]) err(F, p, `gravité « ${n.severity} » inconnue`);
      if (!Array.isArray(n.actions) || !n.actions.length) err(F, p, 'au moins une action attendue dans « actions »');
      (n.related || []).forEach(r => { if (!symptomIds.has(r)) err(F, p, `symptôme lié « ${r} » introuvable`); });
      (n.brandSteps || []).forEach((b, j) => {
        const q = `${p}.brandSteps[${j}]`;
        need(F, q, b, 'brand');
        (b.products || []).forEach(pid => { if (!productIds.has(pid)) err(F, q, `produit « ${pid} » introuvable`); });
        if (!Array.isArray(b.actions) || !b.actions.length) err(F, q, 'au moins une action attendue');
      });
    } else err(F, p, `type « ${n.type} » inconnu (question ou result)`);
    (n.products || []).forEach(pid => { if (!productIds.has(pid)) err(F, p, `produit « ${pid} » introuvable`); });
    (n.images || []).forEach((im, j) => {
      const q = `${p}.images[${j}]`;
      if (!isLocalImage(im.src)) err(F, q, `image « ${im.src} » : fichier local img/… attendu`);
      else if (!existsSync(join(DIR, '..', im.src))) err(F, q, `image « ${im.src} » absente du dépôt`);
      need(F, q, im, 'alt');
    });
  }
  syms.forEach(s => s && reached.add(s.start));
  for (const id of Object.keys(nodes)) if (!reached.has(id)) warn(F, `nodes.${id}`, 'étape jamais atteinte (orpheline)');

  for (const [fid, f] of Object.entries(families)) {
    const p = `families.${fid}`;
    checkId(F, p, fid);
    need(F, p, f, 'label');
    (f.symptoms || []).forEach(sid => { if (!symptomIds.has(sid)) err(F, p, `symptôme « ${sid} » introuvable`); });
  }
  const seenModel = new Map();
  for (const [pid, pr] of Object.entries(products)) {
    const p = `products.${pid}`;
    checkId(F, p, pid);
    if (!isObj(pr)) { err(F, p, 'objet attendu'); continue; }
    need(F, p, pr, 'brand'); need(F, p, pr, 'model'); need(F, p, pr, 'type');
    if (need(F, p, pr, 'family') && !families[pr.family]) err(F, p, `famille « ${pr.family} » introuvable`);
    if ('source' in pr && !sources[pr.source]) err(F, p, `source « ${pr.source} » non déclarée dans « sources »`);
    if ('page' in pr && !(Number.isInteger(pr.page) && pr.page > 0)) err(F, p, '« page » : entier positif attendu');
    if (pr.status !== undefined && pr.status !== 'draft') err(F, p, '« status » ne peut valoir que "draft"');
    const key = (pr.brand + ' ' + pr.model).toLowerCase().replace(/[^a-z0-9+]+/g, '');   // « + » distingue SLX-D et SLX-D+
    if (seenModel.has(key)) err(F, p, `même marque et modèle que « ${seenModel.get(key)} » (doublon)`);
    seenModel.set(key, pid);
  }
}

/* ---------------- catalogue.json ---------------- */
const C = load('catalogue.json');
if (C && D) {
  const F = 'catalogue.json';
  const prods = isObj(C.products) ? C.products : (err(F, 'products', 'section manquante'), {});
  const sources = isObj(D.sources) ? D.sources : {};
  for (const [pid, x] of Object.entries(prods)) {
    const p = `products.${pid}`;
    if (!productIds.has(pid)) err(F, p, 'produit absent de decisions.json');
    if (!Array.isArray(x.facts) || x.facts.some(f => !isStr(f))) err(F, p, '« facts » : liste de textes attendue');
    (x.extra || []).forEach((e, i) => {
      const q = `${p}.extra[${i}]`;
      if (!sources[e.source]) err(F, q, `source « ${e.source} » non déclarée dans decisions.json`);
      if (!(Number.isInteger(e.page) && e.page > 0)) err(F, q, '« page » : entier positif attendu');
      if (e.status !== undefined && e.status !== 'draft') err(F, q, '« status » ne peut valoir que "draft"');
      if (!Array.isArray(e.facts) || !e.facts.length || e.facts.some(f => !isStr(f))) err(F, q, '« facts » : liste de textes attendue');
    });
  }
  for (const pid of productIds) if (!prods[pid]) warn(F, `products.${pid}`, 'aucune caractéristique pour ce produit');
}

/* ---------------- reco.json ---------------- */
const R = load('reco.json');
if (R) {
  const F = 'reco.json';
  const nodes = isObj(R.nodes) ? R.nodes : (err(F, 'nodes', 'section manquante'), {});
  if (need(F, 'start', R, 'start') && !nodes[R.start]) err(F, 'start', `nœud de départ « ${R.start} » introuvable`);
  const reached = new Set([R.start]);
  for (const [id, n] of Object.entries(nodes)) {
    const p = `nodes.${id}`;
    checkId(F, p, id);
    if (n.type === 'question') {
      need(F, p, n, 'text');
      if (!Array.isArray(n.options) || !n.options.length) { err(F, p, 'au moins une réponse attendue'); continue; }
      n.options.forEach((o, j) => {
        need(F, `${p}.options[${j}]`, o, 'label');
        if (!nodes[o.next]) err(F, `${p}.options[${j}]`, `nœud suivant « ${o.next} » introuvable`); else reached.add(o.next);
      });
    } else if (n.type === 'result') {
      need(F, p, n, 'title');
      if (!Array.isArray(n.items) || !n.items.length) err(F, p, 'au moins un produit attendu dans « items »');
      (n.items || []).forEach((it, j) => {
        const q = `${p}.items[${j}]`;
        if (D && !productIds.has(it.product)) err(F, q, `produit « ${it.product} » introuvable`);
        if (!(Number.isInteger(it.qty) && it.qty > 0)) err(F, q, '« qty » : entier positif attendu');
      });
      if (n.status !== undefined && n.status !== 'draft') err(F, p, '« status » ne peut valoir que "draft"');
    } else err(F, p, `type « ${n.type} » inconnu`);
  }
  for (const id of Object.keys(nodes)) if (!reached.has(id)) warn(F, `nodes.${id}`, 'nœud jamais atteint (orphelin)');
}

/* ---------------- news.json ---------------- */
const N = load('news.json');
if (N) {
  const F = 'news.json';
  const cats = new Set((N.categories || []).map(c => c.id));
  const impacts = isObj(N.impacts) ? N.impacts : {};
  const items = Array.isArray(N.items) ? N.items : (err(F, 'items', 'liste attendue'), []);
  uniqueIds(F, 'items', items);
  items.forEach((x, i) => {
    const p = `items[${i}] (${x.id})`;
    need(F, p, x, 'id') && checkId(F, p, x.id);
    need(F, p, x, 'title');
    if (need(F, p, x, 'category') && !cats.has(x.category)) err(F, p, `catégorie « ${x.category} » inconnue`);
    if (need(F, p, x, 'impact') && !impacts[x.impact]) err(F, p, `impact « ${x.impact} » inconnu`);
    if (need(F, p, x, 'date') && !DATE_RE.test(x.date)) err(F, p, 'date au format AAAA-MM-JJ attendue');
    (x.products || []).forEach(pid => { if (D && !productIds.has(pid)) err(F, p, `produit « ${pid} » introuvable`); });
    if (x.source !== undefined && !(isObj(x.source) && isStr(x.source.name))) err(F, p, '« source » : { name, url } attendu');
  });
}

/* ---------------- formation.json ---------------- */
const T = load('formation.json', false);
if (T) {
  const F = 'formation.json';
  const tutos = Array.isArray(T.tutoriels) ? T.tutoriels : (err(F, 'tutoriels', 'liste attendue'), []);
  uniqueIds(F, 'tutoriels', tutos);
  tutos.forEach((t, i) => {
    const p = `tutoriels[${i}] (${t.id})`;
    need(F, p, t, 'id') && checkId(F, p, t.id);
    need(F, p, t, 'titre');
    if (!Array.isArray(t.etapes) || !t.etapes.length) err(F, p, 'au moins une étape attendue');
    const l = t.liens || {};
    if (l.symptome && !symptomIds.has(l.symptome)) err(F, p, `symptôme « ${l.symptome} » introuvable`);
    (l.produits || []).forEach(pid => { if (!productIds.has(pid)) err(F, p, `produit « ${pid} » introuvable`); });
    (t.quiz || []).forEach((q, j) => {
      if (!Array.isArray(q.choix) || !Number.isInteger(q.bonne) || q.bonne < 0 || q.bonne >= q.choix.length)
        err(F, `${p}.quiz[${j}]`, '« bonne » doit désigner un des « choix »');
    });
  });
}

/* ---------------- outils.json ---------------- */
const O = load('outils.json', false);
if (O) {
  const F = 'outils.json';
  const normes = new Set(((O.poe || {}).normes || []).map(n => n.id));
  ((O.poe || {}).switchs || []).forEach((s, i) => {
    if (!productIds.has(s.product)) err(F, `poe.switchs[${i}]`, `produit « ${s.product} » introuvable`);
    if (!(typeof s.budget === 'number' && s.budget > 0)) err(F, `poe.switchs[${i}]`, '« budget » : nombre positif attendu');
  });
  ((O.poe || {}).appareils || []).forEach((a, i) => {
    if (!productIds.has(a.product)) err(F, `poe.appareils[${i}]`, `produit « ${a.product} » introuvable`);
    if (!normes.has(a.norme)) err(F, `poe.appareils[${i}]`, `norme « ${a.norme} » inconnue`);
  });
  ((O.longueurs || {}).liaisons || []).forEach((l, i) => {
    if (!(typeof l.max === 'number' && l.max > 0)) err(F, `longueurs.liaisons[${i}]`, '« max » : nombre positif attendu');
    (l.produits || []).forEach(pid => { if (!productIds.has(pid)) err(F, `longueurs.liaisons[${i}]`, `produit « ${pid} » introuvable`); });
  });
}

/* ---------------- projet.json ---------------- */
const P = load('projet.json', false);
if (P) {
  const F = 'projet.json';
  uniqueIds(F, 'visite', P.visite || []);
  (P.visite || []).forEach((s, i) => {
    if (!Array.isArray(s.etapes) || !s.etapes.length) err(F, `visite[${i}]`, 'au moins une étape attendue');
    (s.etapes || []).forEach((e, j) => { if (!isStr(e.hash) || !e.hash.startsWith('#/')) err(F, `visite[${i}].etapes[${j}]`, '« hash » doit commencer par #/'); });
  });
  (P.missions || []).forEach((m, i) => {
    need(F, `missions[${i}]`, m, 'titre');
    if (m.visite && !(P.visite || []).some(v => v.id === m.visite)) err(F, `missions[${i}]`, `scénario « ${m.visite} » introuvable`);
  });
}

/* ---------------- demos.json ---------------- */
const M = load('demos.json', false);
if (M) {
  const F = 'demos.json';
  if (!Array.isArray(M.checklist)) err(F, 'checklist', 'liste attendue');
  else M.checklist.forEach((s, i) => { need(F, `checklist[${i}]`, s, 'titre'); if (!Array.isArray(s.items)) err(F, `checklist[${i}]`, '« items » : liste attendue'); });
}

/* ---------------- bilan ---------------- */
for (const w of warnings) console.log('avertissement · ' + w);
for (const e of errors) console.log('ERREUR · ' + e);
console.log(`\n${errors.length} erreur(s), ${warnings.length} avertissement(s) — ${DIR}`);
process.exit(errors.length ? 1 : 0);
