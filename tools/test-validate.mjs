#!/usr/bin/env node
/* Tests du validateur : chaque cas copie data/ dans un dossier temporaire,
   introduit une anomalie et vérifie que tools/validate.mjs la détecte.
   Usage : node tools/test-validate.mjs */
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATOR = join(ROOT, 'tools', 'validate.mjs');

function run(mutate) {
  const tmp = mkdtempSync(join(tmpdir(), 'diagsav-'));
  cpSync(join(ROOT, 'data'), join(tmp, 'data'), { recursive: true });
  mkdirSync(join(tmp, 'img'), { recursive: true });
  cpSync(join(ROOT, 'img'), join(tmp, 'img'), { recursive: true });
  const edit = (file, fn) => {
    const p = join(tmp, 'data', file);
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    fn(obj);
    writeFileSync(p, JSON.stringify(obj, null, 2));
  };
  const raw = (file, fn) => { const p = join(tmp, 'data', file); writeFileSync(p, fn(readFileSync(p, 'utf8'))); };
  mutate({ edit, raw });
  const r = spawnSync(process.execPath, [VALIDATOR, join(tmp, 'data')], { encoding: 'utf8' });
  rmSync(tmp, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr };
}

const firstNode = (d, type) => Object.keys(d.nodes).find(k => d.nodes[k].type === type);
const cases = [
  ['données réelles : aucune erreur', () => {}, 0, '0 erreur'],
  ['champ facultatif absent accepté (escalate, keywords, help)', ({ edit }) => edit('decisions.json', d => {
    for (const n of Object.values(d.nodes)) { delete n.escalate; delete n.help; }
    for (const s of d.symptoms) delete s.keywords;
  }), 0, '0 erreur'],
  ['JSON invalide (virgule en trop)', ({ raw }) => raw('news.json', t => t.replace(/\}\s*$/, ',}')), 1, 'JSON invalide'],
  ['champ requis manquant (titre de symptôme)', ({ edit }) => edit('decisions.json', d => { delete d.symptoms[0].title; }), 1, 'champ « title » manquant'],
  ['identifiant de symptôme en double', ({ edit }) => edit('decisions.json', d => { d.symptoms.push({ ...d.symptoms[0] }); }), 1, 'en double'],
  ['identifiant mal formé (majuscules, espace)', ({ edit }) => edit('news.json', n => { n.items[0].id = 'Mon Actu'; }), 1, 'minuscules'],
  ['étape suivante orpheline', ({ edit }) => edit('decisions.json', d => { d.nodes[firstNode(d, 'question')].options[0].next = 'n-existe-pas'; }), 1, 'introuvable'],
  ['symptôme lié introuvable', ({ edit }) => edit('decisions.json', d => { d.nodes[firstNode(d, 'result')].related = ['fantome']; }), 1, 'symptôme lié « fantome »'],
  ['produit inconnu dans une recommandation', ({ edit }) => edit('reco.json', r => { r.modules[0].regles[0].items[0].produit = 'produit-fantome'; }), 1, 'produit inconnu du catalogue (« produit-fantome »)'],
  ['formule de recommandation illisible', ({ edit }) => edit('reco.json', r => { r.calculs[0].formule = 'longueur * (largeur'; }), 1, 'formule illisible'],
  ['référence inconnue dans une formule', ({ edit }) => edit('reco.json', r => { r.calculs[0].formule = 'longueur * largeur_salle'; }), 1, '« largeur_salle » n\'est ni une question'],
  ['repère inconnu dans une formule', ({ edit }) => edit('reco.json', r => { r.calculs[0].formule = 'longueur * p.inexistant'; }), 1, 'paramètre « p.inexistant » inconnu'],
  ['liaison vers un repère absent', ({ edit }) => edit('reco.json', r => { r.liaisons[0].vers = 'repere_fantome'; }), 1, 'repère d\'arrivée « repere_fantome » absent des blocs'],
  ['type de liaison inconnu', ({ edit }) => edit('reco.json', r => { r.liaisons[0].type = 'laser'; }), 1, 'type « laser » inconnu'],
  ['zone inconnue sur une ligne', ({ edit }) => edit('reco.json', r => { const it = r.modules.flatMap(m => m.regles).flatMap(g => g.items).find(x => x.zone); it.zone = 'grenier'; }), 1, 'zone « grenier » inconnue'],
  ['ligne sans produit ni libellé', ({ edit }) => edit('reco.json', r => { const it = r.modules.flatMap(m => m.regles).flatMap(g => g.items).find(x => x.libelle); delete it.libelle; }), 1, 'ni produit du catalogue, ni libellé'],
  ['contrôle « unicite » sans rôle', ({ edit }) => edit('reco.json', r => { r.controles.find(c => c.type === 'unicite').role = ''; }), 1, 'rôle manquant'],
  ['connectique : type de port inconnu', ({ edit }) => edit('connectique.json', c => { c.produits['yealink-avhub'].ports[0].type = 'fibre_magique'; }), 1, 'type de port « fibre_magique » inconnu'],
  ['produit de source web sans lien', ({ edit }) => edit('decisions.json', d => { delete d.products['yealink-yps20'].url; }), 1, 'source web : « url » de la fiche constructeur obligatoire'],
  ['niveau inconnu dans une règle', ({ edit }) => edit('reco.json', r => { r.modules[0].regles[0].niveaux = ['luxe']; }), 1, 'niveau « luxe » inconnu'],
  ['produit en double (même marque et modèle)', ({ edit }) => edit('decisions.json', d => {
    const [id, p] = Object.entries(d.products)[0]; d.products[id + '-bis'] = { ...p };
  }), 1, 'doublon'],
  ['source de produit non déclarée', ({ edit }) => edit('decisions.json', d => { Object.values(d.products)[0].source = 'inconnue'; }), 1, 'non déclarée'],
  ['date d\'actualité mal formée', ({ edit }) => edit('news.json', n => { n.items[0].date = '24/11/2026'; }), 1, 'AAAA-MM-JJ'],
  ['image absente du dépôt', ({ edit }) => edit('decisions.json', d => {
    const k = Object.keys(d.nodes).find(x => d.nodes[x].images); d.nodes[k].images[0].src = 'img/schemas/absent.svg';
  }), 1, 'absente du dépôt'],
  ['caractéristique sans produit', ({ edit }) => edit('catalogue.json', c => { c.products['fantome-x1'] = { facts: ['x'] }; }), 1, 'absent de decisions.json'],
  ['quiz : bonne réponse hors des choix', ({ edit }) => edit('formation.json', f => { f.tutoriels[0].quiz[0].bonne = 9; }), 1, '« bonne »'],
  ['étape orpheline : avertissement seulement', ({ edit }) => edit('decisions.json', d => {
    d.nodes['test-orpheline'] = { type: 'result', severity: 'low', title: 'x', summary: 'x', actions: ['x'] };
  }), 0, 'orpheline']
];

let failed = 0;
for (const [name, mutate, expCode, expText] of cases) {
  const { code, out } = run(mutate);
  const ok = code === expCode && out.includes(expText);
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${ok ? '' : `\n      attendu code ${expCode} + « ${expText} », obtenu code ${code}\n${out.split('\n').slice(-6).join('\n')}`}`);
}
console.log(`\n${cases.length - failed}/${cases.length} cas réussis`);
process.exit(failed ? 1 : 0);
