# Assistant AV — Assistant de diagnostic de premier niveau

Site web statique qui remplace les procédures papier par un arbre de décision interactif pour les techniciens terrain.

- 100 % statique : HTML, CSS et JavaScript vanilla. Aucun framework, aucune étape de build.
- Procédures dans un fichier JSON séparé (`data/decisions.json`), modifiable sans toucher au code.
- Pensé mobile et tablette d'abord : thème sombre, grosses zones tactiles, lisible en atelier.
- Fonctionne hors ligne après le premier chargement (service worker).
- Aucun tracking, aucun cookie, aucun appel vers un service externe.

---

## Arborescence

```
.
├── index.html             Structure de la page
├── styles.css             Thème sombre épuré
├── app.js                 Navigation, recherche, diagnostic, assistant produit
├── reco-engine.js         Moteur avant-vente : formules, salles, liaisons, contrôles (site et vérificateur)
├── reco-export.js         Export du dossier avant-vente en PDF et en .xlsx (chargé à la demande)
├── editor.js              Éditeur des procédures (chargé seulement à l'ouverture de l'onglet)
├── pdf.js                 Générateur PDF minimal (chargé seulement à l'export)
├── sw.js                  Service worker (mode hors ligne)
├── manifest.webmanifest   Installation sur l'écran d'accueil (tablette)
├── icon.svg               Icône de l'application
├── .nojekyll              Désactive Jekyll sur GitHub Pages
├── img/                   Photos et schémas des étapes (img/schemas/ : exemples)
└── data/
    ├── decisions.json     Arbre de décision + fiches produits (marque, modèle, page)
    ├── reco.json          Règles de recommandation avant-vente (onglet Recommander)
    ├── connectique.json   Ports, PoE et budgets PoE des produits (avant-vente), sourcés
    ├── news.json          Veille technologique (onglet Veille)
    └── catalogue.json     Caractéristiques produits et synonymes (Assistant produit)
```

---

## Tester en local

Les navigateurs refusent de lire un fichier JSON quand la page est ouverte directement depuis le disque (`file://`). Il faut lancer un petit serveur local depuis le dossier du projet :

```bash
# Python 3 (préinstallé sur macOS et la plupart des Linux)
python3 -m http.server 8000

# ou Node.js
npx serve .
```

Puis ouvrir http://localhost:8000.

---

## Déploiement sur GitHub Pages

### 1. Créer le dépôt et pousser les fichiers

```bash
git init
git add .
git commit -m "Assistant de diagnostic SAV v1.0.0"
git branch -M main
git remote add origin git@github.com:<organisation>/diagnostic-sav.git
git push -u origin main
```

### 2. Activer GitHub Pages

1. Dans le dépôt : **Settings → Pages**.
2. **Source** : *Deploy from a branch*.
3. **Branch** : `main`, dossier `/ (root)`, puis **Save**.
4. Après une à deux minutes, le site est disponible à l'adresse `https://<organisation>.github.io/diagnostic-sav/`.

Tous les chemins du site sont relatifs : il fonctionne tel quel dans un sous-dossier ou avec un domaine personnalisé.

### 3. Rendre le site privé : à lire avant de publier

Un **dépôt** privé ne rend **pas** automatiquement le **site** privé.

| Offre GitHub | Pages depuis un dépôt privé | Accès au site |
|---|---|---|
| Free | Non disponible | — |
| Pro / Team | Oui | **Public** : toute personne qui a l'URL peut voir le site |
| Enterprise Cloud | Oui | **Public ou privé**, au choix |

**Avec GitHub Enterprise Cloud** : dans **Settings → Pages**, menu **Visibility**, choisir **Private**. Seules les personnes ayant un accès en lecture au dépôt peuvent alors ouvrir le site, après connexion à GitHub. Pour donner l'accès à un technicien, ajoutez-le au dépôt (ou à une équipe) avec le rôle *Read*.

**Sans Enterprise Cloud**, le site sera public. La balise `noindex` limite son référencement par les moteurs de recherche, mais ce n'est **pas** une protection. Dans ce cas :
- ne mettez dans `decisions.json` aucune information confidentielle (adresses IP de clients, mots de passe, noms de sites…), ou
- hébergez les mêmes fichiers derrière une authentification : serveur intranet, Cloudflare Pages + Cloudflare Access, Azure Static Web Apps avec authentification, etc. Le site étant purement statique, il suffit de copier les fichiers.

---

## Éditeur des procédures (sans toucher au code)

L'onglet **Éditeur** (ou le lien « Éditer les procédures » en pied de page, `#/editeur`) permet à l'équipe SAV de modifier les procédures **par formulaires**, sans écrire de JSON. Il fonctionne dans le navigateur, hors ligne, et n'envoie rien nulle part.

**Pourquoi un éditeur plutôt qu'un fichier par symptôme ?** Fusionner plusieurs fichiers demanderait de lancer un script (Python, Node) ou une GitHub Action avant chaque publication : c'est une étape de build, que l'équipe SAV n'a pas à gérer. Et la difficulté n'est pas la taille du fichier mais les virgules, guillemets et identifiants à recopier : les formulaires suppriment ces erreurs à la source.

### Ce qu'on peut faire

| Écran | Contenu |
|---|---|
| **Symptômes** | Créer un symptôme (sa question de départ est créée automatiquement), modifier titre, catégorie, résumé, mots-clés ; **arbre de décision** du symptôme, étapes à corriger en rouge ; **Tester ce symptôme** |
| **Étape (question)** | Texte, aide, réponses : chacune mène à une étape choisie **dans une liste** ou au diagnostic d'un autre symptôme ; **+ Créer une question / un résultat** pour construire la suite ; **Tester à partir d'ici** |
| **Étape (résultat)** | Titre, gravité, résumé, actions dans l'ordre, mise en garde, escalade, diagnostics liés, **étapes selon le matériel** (marque, produits, statut « À valider ») |
| **Produits** | Fiche produit et ses caractéristiques (Assistant produit) sur le même écran ; familles et symptôme principal (★) |
| **Avant-vente** | Règles de recommandation (`reco.json`) : questions (choix ou nombre, condition d'affichage), repères sourcés, calculs, blocs de produits à règles (condition, niveaux, quantité en formule), contrôles de cohérence ; les formules sont vérifiées pendant la saisie ; **Tester le parcours** |
| **Veille** | Actualités (`news.json`) : catégorie, date, impact SAV, résumé, action, matériel concerné, source et lien |
| **Vérification** | Tous les points à corriger, en français courant, avec un bouton **Corriger** qui ouvre le bon formulaire |
| **Exporter** | Résumé des modifications, numéro de version, téléchargement de `decisions.json`, `catalogue.json`, `reco.json` et `news.json` |

- **Brouillon automatique** : chaque modification est enregistrée sur l'appareil (stockage local du navigateur). On peut fermer la page et reprendre plus tard, sur le même appareil et le même navigateur. Si le fichier publié a changé entre-temps (un collègue a publié), un avertissement s'affiche.
- **Tester mes modifications** : le site passe en **mode test** (bandeau orange) et fonctionne avec vos modifications, Assistant produit compris, sans rien publier. « Revenir à l'éditeur » rétablit les données publiées.
- **Importer un fichier JSON** : pour reprendre un fichier envoyé par un collègue.
- Un fichier exporté **sans modification est identique** au fichier publié : seules vos modifications apparaissent dans l'historique GitHub.

### Publier les modifications

1. Dans l'éditeur, onglet **Exporter** : téléchargez les fichiers modifiés (`decisions.json`, `catalogue.json`, `reco.json`, `news.json` : le résumé indique lesquels ont changé).
2. Sur GitHub, ouvrez le dossier `data` du dépôt.
3. **Add file → Upload files**, déposez le fichier : il remplace l'ancien (le nom doit rester exactement le même).
4. Décrivez la modification (ex. « Ajout du symptôme intercom ») puis **Commit changes**.
5. Le site est à jour en 1 à 2 minutes : vérifiez la version affichée en haut à droite. Une fois la publication faite, cliquez sur **Abandonner le brouillon** dans l'éditeur pour repartir du fichier publié.

> Pour deux personnes qui éditent en même temps : chacune a son propre brouillon. Publiez l'une après l'autre, et la seconde importe d'abord le fichier publié par la première (ou refait ses modifications) avant d'exporter, pour ne pas écraser le travail de l'autre.

---

## Modifier les procédures à la main (format JSON de référence)

L'éditeur suffit pour l'usage courant. Le format est décrit ci-dessous pour les cas particuliers.

Tout le contenu métier se trouve dans `data/decisions.json`. Le code n'a pas besoin d'être modifié.

### Structure du fichier

```jsonc
{
  "meta":       { "version": "1.0.0", "updated": "2026-11-21", "disclaimer": "…" },
  "severities": { "low": {…}, "moderate": {…}, "high": {…} },
  "categories": [ { "id": "audio", "label": "Audio", "icon": "audio" } ],
  "symptoms":   [ … ],   // points d'entrée affichés sur l'accueil
  "nodes":      { … }    // questions et résultats, indexés par identifiant
}
```

### Ajouter un symptôme

```json
{
  "id": "pas-de-son",
  "title": "Pas de son",
  "category": "audio",
  "summary": "Aucun son sur une zone, une sortie ou une enceinte.",
  "keywords": ["muet", "silence", "mute", "enceinte"],
  "start": "audio-q1"
}
```

- `id` : identifiant unique, en minuscules et sans espace. Il apparaît dans l'URL.
- `keywords` : mots utilisés par la recherche. Les accents et majuscules sont ignorés. Ajoutez les termes que les techniciens tapent vraiment.
- `start` : identifiant de la première question dans `nodes`.

### Question

```json
"audio-q1": {
  "type": "question",
  "text": "L'absence de son concerne :",
  "help": "Texte d'aide facultatif.",
  "options": [
    { "label": "Toute la zone", "next": "audio-q2" },
    { "label": "Un seul canal", "next": "audio-q5" },
    { "label": "L'ampli est éteint", "symptom": "pas-alimentation" }
  ]
}
```

Chaque option contient **soit** `next` (nœud suivant), **soit** `symptom` (bascule vers l'arbre d'un autre symptôme, en gardant l'historique). Maximum 9 options par question (raccourcis clavier 1 à 9).

### Résultat

```json
"audio-r-ampli": {
  "type": "result",
  "severity": "high",
  "title": "Amplificateur en protection",
  "summary": "Court-circuit, impédance trop basse ou surchauffe.",
  "actions": ["Action 1", "Action 2"],
  "warning": "Facultatif : mise en garde affichée en rouge.",
  "escalate": "Facultatif : à qui transmettre.",
  "related": ["surchauffe"]
}
```

- `severity` : `low` (Faible), `moderate` (Modéré) ou `high` (Élevé).
- `related` : identifiants de symptômes proposés en fin de diagnostic.

### Matériel couvert : sources, familles, produits (schéma v2)

Le matériel couvert vient du **catalogue Focus, été 2025** (171 produits électroniques, 40 marques ; supports, chariots, câbles et lampes exclus). Seuls la marque, le modèle, la référence et la page sont repris : ni les descriptions, ni les prix.

Trois sections, toutes facultatives :

```json
"sources": {
  "focus-ete-2025": { "title": "Catalogue Focus", "edition": "Été 2025", "publisher": "Focus (groupe Midwich)" }
},
"families": {
  "led-controleur": { "label": "Contrôleurs LED", "symptoms": ["mur-led", "firmware-echec", "firmware-incompatible"] }
},
"products": {
  "novastar-mctrl4k": { "brand": "Novastar", "model": "MCTRL4K", "type": "Contrôleur LED 4K",
                        "family": "led-controleur", "ref": "MCTRL4K", "source": "focus-ete-2025", "page": 27 }
}
```

- **Une famille** regroupe des produits qui tombent en panne de la même façon. Elle liste, **une seule fois**, les symptômes concernés. Le **premier** symptôme de la liste est le principal : c'est lui qui sort en tête quand on cherche une référence.
- **Ajouter un produit** = ajouter une fiche dans `products` et choisir sa famille. Il apparaît automatiquement dans « Matériel couvert » des symptômes de la famille, et la recherche le trouve par marque, modèle ou référence.
- `ref` et `page` sont facultatifs ; `page` est un nombre entier.

### Étapes propres à une marque

Sur un résultat, `brandSteps` ajoute un bloc repliable « Selon le matériel » :

```json
"brandSteps": [
  { "brand": "Novastar",
    "products": ["novastar-mctrl4k", "novastar-serie-coex"],
    "status": "draft",
    "actions": ["Ouvrir NovaLCT (MCTRL4K) ou VMP (série COEX)…", "…"] }
]
```

- `"status": "draft"` affiche le badge **« À valider »** : étape rédigée sans notice constructeur, à faire relire par un technicien. Une fois relue, passer à `"validated"` (ou supprimer le champ).
- Le même champ `status` peut être mis sur n'importe quelle question ou résultat.
- `products` (facultatif) sur une question ou un résultat affiche une ligne « Matériel : … ».
- Si le technicien a trouvé le diagnostic en cherchant un produit (ex. « MCTRL4K »), le bloc de sa marque s'ouvre directement et le rapport copié mentionne le produit.

**État actuel** : 17 résultats ont des étapes par marque (Novastar, Shure, Biamp, Powersoft, Netgear, Kramer, Lindy, Visionary, Datapath, BrightSign, Barco ClickShare, vidéoprojecteurs). **Toutes sont en brouillon** et doivent être validées avec les notices constructeur.

### Photos et schémas dans les étapes

Une question ou un résultat peut afficher des images (champ facultatif `images`) :

```json
"images": [
  { "src": "img/schemas/led-chainage.svg", "alt": "Schéma : contrôleur relié à deux lignes de caissons…",
    "caption": "Le défaut est sur le dernier caisson allumé…", "width": 800, "height": 450 }
]
```

- `src` : un fichier du dossier **`img/`** du dépôt (WebP, JPEG, PNG, SVG). Les images externes (`https://…`) sont refusées : le site ne fait aucun appel extérieur.
- `alt` (obligatoire) : ce que montre l'image, affiché si elle ne peut pas être chargée. `caption` : légende facultative.
- `width` / `height` : dimensions, pour réserver la place et éviter que la page saute pendant le chargement.
- **Dans l'éditeur** : « + Ajouter une photo ou un schéma ». La photo est réduite (1280 px au maximum) et compressée en WebP de moins de 150 Ko **dans le navigateur**, puis téléchargée. Déposez-la dans `img/` sur GitHub (l'onglet Exporter liste les images à déposer).
- Utilisez vos propres photos ou des schémas, jamais les visuels du catalogue (droits).
- Hors ligne : une image vue une fois reste disponible. Le lien **Préparer le hors-ligne** (pied de page) télécharge d'avance toutes les images et les données.
- Deux schémas d'exemple sont fournis : `img/schemas/led-chainage.svg` (question « Le défaut suit-il une ligne… » du mur LED) et `img/schemas/hf-antennes.svg` (résultat « Réception insuffisante » des micros HF).

### Migration du schéma

`meta.schemaVersion` indique la version du format (actuellement `4`). Un fichier plus ancien est complété automatiquement au chargement : v1 → v2 ajoute `sources`, `families`, `products` vides ; v3 (images facultatives) ; v4 retire l'ancienne section `checklists` du mode salon, supprimé. Un ancien `decisions.json` fonctionne sans modification.

### Contrôler ses modifications

1. Vérifier que le JSON est valide (VS Code le signale, ou https://jsonlint.com en local).
2. Ouvrir le site : en cas d'incohérence (nœud introuvable, gravité invalide, nœud jamais atteint…), un message **« ⚠ N anomalie(s) dans les données »** apparaît en pied de page. Le détail s'affiche dans la console du navigateur (F12).
3. Si le JSON est mal formé, l'application affiche l'erreur de syntaxe au lieu de la page.
4. Incrémenter `meta.version` : elle s'affiche en haut à droite (`DATA v…`), ce qui permet de vérifier que les techniciens ont la bonne version.

Convention d'identifiants conseillée : `<préfixe>-q<n>` pour les questions et `<préfixe>-r-<nom>` pour les résultats (ex. `video-q3`, `video-r-edid`).

---

## Journal des diagnostics (retours terrain, sans tracking)

En fin de diagnostic, le technicien indique **Résolu** ou **Pas résolu**. Chaque réponse est notée dans **Mon journal** (lien en pied de page), **sur l'appareil uniquement** : rien n'est envoyé. « Pas résolu » affiche la suite à donner (escalade).

Le journal s'exporte en **CSV** (s'ouvre dans Excel) ou en **JSON**. Le responsable SAV regroupe les fichiers des techniciens pour repérer les procédures qui échouent le plus souvent. Les entrées de plus de 180 jours sont effacées automatiquement.

## Symptômes fréquents, jargon et brouillons

- `"frequent": true` sur un symptôme le place en **lien direct** sous les champs de recherche (case « Symptôme fréquent » dans l'éditeur).
- Les **mots-clés** d'un symptôme acceptent le jargon terrain (« ça crache », « plus de HF ») ; la recherche tolère aussi une faute de frappe par mot.
- `"status": "draft"` sur une étape, un résultat ou une recommandation affiche un badge **À valider**. Le contenu rédigé sans notice constructeur (nouveaux symptômes, recommandations avant-vente) est marqué ainsi : à relire par un technicien, puis à passer en « Validée » dans l'éditeur.

## Portfolio et boîte à outils (pages.js, chargé à la demande)

| Page | Adresse | Données |
|---|---|---|
| Le projet (étude de cas, missions du poste → preuves, historique) | `#/projet` | `data/projet.json` |
| Visite guidée (3 scénarios, barre de guidage sur les vraies pages) | `#/visite` | `data/projet.json` (`visite`) |
| Outils réseau : budget PoE, débit vidéo, longueurs de liaison | `#/outils` | `data/outils.json` |
| Formation : tutoriels, quiz, techniciens formés (export CSV) | `#/formation` | `data/formation.json` |
| Comparer 2 ou 3 produits | `#/comparer?ids=a,b,c` | catalogue |
| Démos et parc de prêt (checklist, suivi, export CSV) | `#/demos` | `data/demos.json` |

Les listes saisies (techniciens formés, prêts, checklist) restent **sur l'appareil** (localStorage) et ne sont jamais envoyées.

## Vérification automatique des données

`tools/validate.mjs` (Node, sans dépendance) vérifie tous les fichiers `data/*.json` : syntaxe, champs requis réellement utilisés par le site, identifiants en double ou mal formés, liens orphelins (étapes, symptômes, produits, sources, images), doublons marque + modèle. Les champs facultatifs absents ne sont jamais des erreurs ; les étapes jamais atteintes sont de simples avertissements.

```
node tools/validate.mjs          # vérifie data/
node tools/test-validate.mjs     # 16 cas d'erreur volontaires
```

La GitHub Action `.github/workflows/validate.yml` lance ces deux commandes à chaque push et pull request touchant `data/`, `img/` ou `tools/`. Elle ne compile ni ne publie rien.

## Thème clair à fort contraste

Pied de page › **Thème : Sombre · Clair · Système**. Sombre reste le thème par défaut ; « Système » suit le réglage de l'appareil. Le choix est mémorisé sur l'appareil (localStorage `diagsav.theme`) et appliqué dès le `<head>`, sans flash. Le bleu #56a7d5 reste l'accent (boutons, soulignements, icônes) ; en clair, le texte bleu utilise une teinte plus foncée (`--blue-ink`) pour atteindre un contraste d'au moins 4,5. Toutes les couleurs passent par des variables CSS (`:root` et `:root[data-theme="light"]`).

## Sources multiples et données « à valider »

`decisions.json › sources` déclare chaque document source (ex. `focus-ete-2025`, `cata-uc-2026`). Un produit indique sa `source` et sa `page` ; `"status": "draft"` affiche un badge **À valider** (catalogue, fiche, comparateur). Dans `catalogue.json`, le champ facultatif `extra` ajoute à un produit existant des caractéristiques tirées d'une autre source, affichées à part avec leur page : `"extra": [{ "source": "cata-uc-2026", "page": 47, "status": "draft", "facts": [ … ] }]`. Dans l'éditeur (fiche produit), le statut se change en « Validé » et un complément vérifié s'intègre aux caractéristiques d'un clic.

## Recommander (avant-vente)

L'onglet **Recommander** (`#/recommander`) pose des questions **chiffrées** (type d'événement, jauge, dimensions de la salle, nombre de micros HF, distance régie, réseau…) puis compose la configuration :

1. **Dimensionnement calculé** : surface, hauteur et diagonale d'image, nombre d'enceintes, de micros de plafond, de distributeurs d'antennes. Chaque calcul affiche sa source ; les repères non issus d'une notice sont marqués **À valider**.
2. **Composition par blocs** : micros, traitement, sonorisation, affichage, visio, captation, réseau… Dans chaque bloc, une règle (condition + niveaux) choisit les produits et leurs quantités (nombre ou formule).
3. **Contrôles de cohérence**, affichés en alertes avec une solution : budget et ports PoE des switchs (tables de `outils.json`), produits audio/vidéo sur IP sans réseau dédié, nombre de micros HF par bande de 44 MHz, longueur de liaison au-delà de 100 m en Ethernet, règles libres.
4. **Trois niveaux côte à côte** (Essentiel, Confort, Premium ; onglets sur mobile). Chaque produit se **remplace** par un autre de la même famille (le même type en premier) et se **compare** dans le comparateur. **Copier le devis** produit le texte du niveau choisi, sans prix.

5. **Projets à plusieurs salles** : nombre de salles (1 à 4), surface et distance à la baie de chacune, cloisons amovibles et salle maître. Les blocs « par salle » sont calculés salle par salle ; le bloc « Fusion » ajoute un capteur par cloison et relie les AVHub. Contrôles : une seule tablette maître, ports disponibles de chaque équipement (ex. ports VCH et Codec de l'AVHub), 8 caméras au plus, fusion de plus de deux salles à valider.
6. **Marque imposée** : la réponse à « Écosystème souhaité » oriente les règles ; dans les blocs « filtre_marque », un produit d'une autre marque est remplacé automatiquement par un produit de la même famille, et les remplacements proposés restent dans la marque.
7. **Connectique sourcée** (`data/connectique.json`) : ports, alimentation PoE et budget PoE des produits, avec document et page (ou fiche web, « À valider »). Elle alimente le **contrôle des ports** et un **budget PoE exact** par switch (appareils réellement raccordés) ; les consommations inconnues sont listées.
8. **Synoptique, liaisons et baie** : synoptique SVG (salles de part et d'autre de la baie), liste des liaisons (de, port, vers, port, type, longueur) contrôlées une à une contre les longueurs maximales (HDMI, USB, Ethernet 100 m, HDBaseT…), contenu de la baie.
9. **Export complet du dossier** : **PDF** (besoin, dimensionnement, nomenclature, baie, synoptique vectoriel, liaisons, points à valider) et **tableur .xlsx** (une feuille par partie), générés dans le navigateur, sans librairie.


Toutes les réponses sont dans l'adresse (`#/recommander?type=conf&jauge=300…`) : un lien se partage et chaque réponse se modifie depuis « Vos réponses ».

### Format de `data/reco.json` (schéma 2)

```json
{
  "meta": { "version": "1.0.0", "schema": 2, "title": "Recommandation avant-vente", "disclaimer": "…" },
  "niveaux": [ { "id": "essentiel", "label": "Essentiel", "description": "…" } ],
  "questions": [
    { "id": "type", "label": "Type d'événement", "type": "choix", "texte": "Quel type d'événement ?", "options": [ { "id": "conf", "label": "Conférence" } ] },
    { "id": "jauge", "label": "Jauge", "type": "nombre", "texte": "Combien de personnes ?", "unite": "personnes", "min": 2, "max": 2000, "defaut": 100, "si": "type == \"conf\"" }
  ],
  "parametres": { "micro_zone_m2": { "label": "…", "valeur": 36, "unite": "m²", "source": "Guide de l'audio 2025, p. 178", "status": "draft" } },
  "calculs": [ { "id": "surface_salle", "label": "Surface de la salle", "formule": "longueur * largeur", "unite": "m²" } ],
  "modules": [ { "id": "micros_hf", "titre": "Micros sans fil", "regles": [
    { "si": "type == \"conf\" et nb_hf > 0", "niveaux": ["essentiel"], "items": [ { "produit": "shure-slxd", "qte": "nb_hf", "pourquoi": "…" } ], "note": "…" } ] } ],
  "controles": [ { "type": "poe" }, { "type": "regle", "si": "nb_hf > p.hf_par_bande", "niveau": "erreur", "message": "{nb_hf} micros HF : …" } ]
}
```

- **Formules** (`si`, `formule`, `qte`) : nombres (`2.5`), textes entre guillemets, réponses (`jauge`), calculs déjà définis, repères (`p.micro_zone_m2`), `+ - * /`, comparaisons, `et`, `ou`, `non`, `dans ["a", "b"]`, `arrondi_sup()`, `arrondi_inf()`, `arrondi()`, `min()`, `max()`. Le mot `niveau` vaut l'identifiant du niveau calculé. Aucun code n'est exécuté : `reco-engine.js` lit les formules avec son propre analyseur.
- Dans un bloc, la **première règle vraie** s'applique (`"mode": "toutes"` : toutes les règles vraies). Une règle sans `niveaux` vaut pour tous.
- Messages et justifications acceptent des valeurs entre accolades : `{nb_enceintes} enceintes pour {surface_salle} m²`.
- **Lignes hors catalogue** : une ligne peut porter un `libelle` au lieu d'un `produit` (accessoire, élément d'un pack), avec `inclus` (le produit qui la contient, sans quantité au devis), `source` (lien vers la fiche constructeur) et `status: "draft"`.
- **Synoptique** : `zones` (colonnes, dans l'ordre), `types_liaison` (`label`, `liaison` = identifiant de la table des longueurs de `outils.json`, `couleur` 0 à 7), et sur chaque ligne `repere` + `zone`. `liaisons` : `{ "de": "s1_ecran", "port_de": "HDMI", "vers": "s1_tx", "port_vers": "HDMI", "type": "hdmi", "longueur": "distance_baie", "si": "distance_baie > 5" }`. Une liaison n'apparaît que si ses deux repères sont dans la configuration.
- `meta.question_marque` désigne la question dont les réponses portent une `marque`.
- **Plusieurs salles** : `meta.salles = { "nombre": "nb_salles", "max": 4, "si": "type == \"salles\"" }`. Une question, un calcul, un bloc, une zone ou une liaison marqués `"par_salle": true` sont répétés : la question `superficie` devient `superficie_1`, `superficie_2`… et, dans un bloc par salle, `superficie` désigne la salle en cours ; `{salle}` et `{maitre}` sont remplacés dans les repères, zones et libellés.
- Lignes : `role` (ex. `tablette_maitre`) pour le contrôle `unicite`. Types de liaison : `port` (type de port compté) et `poe: true`. Contrôles : `ports`, `unicite`, `poe` (exact avec la connectique).
- Types de contrôles : `poe`, `reseau` (`question`, `sans`, `motif` cherché dans les caractéristiques du catalogue), `longueur` (`question`, `liaison` de `outils.json`), `regle`.
- `node tools/validate.mjs` vérifie les références (questions, calculs, repères, produits, niveaux) et simule toutes les combinaisons de réponses.
- **Contenu livré : brouillon à valider.** Les repères sans notice constructeur (surface par enceinte, ratio d'écran) sont provisoires.

---

## Veille technologique

L'onglet **Veille** (`#/veille`) présente les actualités utiles au SAV en cartes, filtrables par catégorie (**Nouveautés / Firmware / Fin de vie / Bulletins sécurité**), de la plus récente à la plus ancienne. Chaque carte indique la date, l'**impact SAV** (faible, moyen, élevé), la source, l'action à mener et le matériel concerné (lien vers sa fiche). Le filtre est dans l'adresse (`#/veille?f=firmware`).

**La veille est saisie à la main** : le site ne va chercher aucune information sur Internet (aucun appel externe). Le lien de la source s'ouvre dans un nouvel onglet.

### Format de `data/news.json`

```json
{
  "meta": { "version": "0.1.0", "updated": "2026-11-22", "title": "Veille technologique" },
  "categories": [ { "id": "firmware", "label": "Firmware" } ],
  "impacts": { "moyen": { "label": "Moyen", "description": "À planifier…" } },
  "items": [
    { "id": "mctrl4k-firmware-x", "category": "firmware", "title": "…", "date": "2026-11-15",
      "impact": "moyen", "summary": "…", "action": "…", "products": ["novastar-mctrl4k"],
      "source": { "name": "Notes de version du constructeur", "url": "https://…" } }
  ]
}
```

- `category` : `nouveaute`, `firmware`, `fin-de-vie` ou `securite`. `impact` : `faible`, `moyen` ou `eleve`.
- `date` au format AAAA-MM-JJ ; `source.url` doit commencer par `https://`.
- `products` : identifiants de produits de `decisions.json` (facultatif).
- **Le fichier livré contient une seule entrée fictive marquée [EXEMPLE]** : remplacez-la.

---

## Assistant produit

L'onglet **Assistant produit** (`#/produits`) répond aux questions sur le matériel du catalogue Focus été 2025, **sans IA ni connexion** : c'est un moteur de recherche local sur les caractéristiques.

- On tape une question en langage courant : « switch PoE 48 ports », « vidéoprojecteur 8000 lumens », « caméra PTZ SDI », « MCTRL4K ».
- Chaque réponse cite le **produit**, les **caractéristiques qui correspondent** (surlignées) et la **page du catalogue**.
- Les nombres suivis d'une unité sont compris comme un minimum : `48 ports` → 48 ports ou plus ; `8000 lumens` → 8000 lm ou plus ; `70 m`. Les tailles d'écran (`98 pouces`, `98"`) sont comparées à l'identique.
- Tous les mots doivent être trouvés. Sinon l'assistant le dit : « Aucun produit ne remplit tous les critères » (correspondance partielle, au moins 2 critères), ou « Aucun produit du catalogue ne correspond ». **Il n'invente jamais de réponse.**
- La fiche d'un produit (`#/produits/<id>`) propose **Diagnostiquer ce produit** (symptômes de sa famille, diagnostic ouvert avec le produit présélectionné) et un accès direct aux **étapes spécifiques** à ce produit.
- La requête est dans l'URL (`#/produits?q=…`) : un lien peut être partagé.

### Parcourir le catalogue

Quand la recherche est vide, la page affiche tout le catalogue, regroupé par famille. On filtre par **rayon** (Affichage, Audio…) et par **marque** ; le lien est partageable (`#/produits?rayon=Audio&marque=Shure`). Le rayon d'une famille est le champ `group` de `families` dans `decisions.json`, modifiable dans l'éditeur (Produits › Familles, « Rayon du catalogue »).

### Format de `data/catalogue.json`

```json
{
  "meta": { "version": "1.0.0", "updated": "2026-11-21", "source": "focus-ete-2025" },
  "synonyms": { "lm": "lumens", "projo": "videoprojecteur", "sans fil": "sans-fil" },
  "products": {
    "novastar-mctrl4k": { "facts": ["Contrôleur LED 4K", "HDR10 et HLG", "Latence inférieure à 1 ms"] }
  }
}
```

- Les **identifiants** de `products` sont ceux de `decisions.json`. La marque, le modèle, la page et la famille ne sont pas répétés : on les modifie dans `decisions.json`.
- `facts` : 2 à 6 caractéristiques **courtes et factuelles**, reformulées. Pas de texte commercial ni de prix.
- `synonyms` : mot ou expression → terme utilisé dans les fiches. Ajoutez-y le vocabulaire des techniciens (« projo », « alim »…).
- Un identifiant inconnu est signalé dans la console du navigateur.

Pour **ajouter un produit** : créer sa fiche dans `decisions.json` (`products`), puis ses caractéristiques dans `catalogue.json`.

---

## En cas d'erreur de chargement

Si les procédures ne se chargent pas, l'écran d'erreur indique la cause, l'adresse exacte du fichier et le statut HTTP :

| Message | Cause | Que faire |
|---|---|---|
| « n'a pas pu être chargé (HTTP 404) » | `data/decisions.json` absent à cette adresse | Vérifier que le fichier est bien dans `data/` sur la branche `main`, ou attendre la fin du déploiement Pages (1–2 min) |
| « contient une erreur de syntaxe (ligne X, colonne Y) » | JSON mal formé | Corriger la ligne indiquée (virgule, guillemet) |
| « a bien été chargé, mais son contenu ne peut pas être exploité » | Section `symptoms` ou `nodes` absente ou mal formée | Comparer avec le format ci-dessus |
| « n'a pas pu être téléchargé » + mention `file://` | Page ouverte depuis le disque | Lancer un serveur local (voir plus haut) |
| « L'application n'a pas pu démarrer » | `app.js` introuvable | Vérifier le déploiement |

Le chemin du fichier est calculé à partir de `app.js`, et une adresse sans `/` final est automatiquement complétée.

---

## Mode hors ligne

Au premier chargement, `sw.js` met en cache tous les fichiers. Ensuite :

- **Données** (`decisions.json`, `catalogue.json`) : le réseau est interrogé en premier, le cache sert de secours. Une modification publiée est donc visible dès que l'appareil a du réseau.
- **Code** (HTML, CSS, JS) : servi depuis le cache, mis à jour en arrière-plan.

Après une modification de `index.html`, `styles.css` ou `app.js`, changez `CACHE_VERSION` dans `sw.js` (ex. `diagsav-v1.0.1`) pour forcer la mise à jour chez tous les utilisateurs. Changez aussi, **avec la même valeur**, `APP_VERSION` dans `app.js` et la balise `<meta name="diagsav-version">` de `index.html` : si le serveur sert brièvement des fichiers de versions différentes (cache de GitHub Pages juste après une publication), la page se recharge une fois puis affiche « Mise à jour en cours » au lieu de planter.

Sur tablette, utilisez « Ajouter à l'écran d'accueil » pour lancer l'outil comme une application.

---

## Utilisation

- **Recherche** : tapez un symptôme (« pas de son », « écran noir », « dante »…) ou une marque / référence du catalogue (« MCTRL4K », « SLXD », « Netgear »). La touche Entrée ouvre le premier résultat.
- **Filtres** : par catégorie (alimentation, audio, vidéo, réseau, thermique, stabilité, périphériques, firmware).
- **Fil d'Ariane** : cliquez sur une étape pour y revenir.
- **Journal** : liste des questions et réponses. Cliquez sur une entrée pour revenir à cette question.
- **Résultat** : cochez les actions réalisées, puis **Copier le rapport** (texte à coller dans un ticket), **Télécharger le PDF** (fichier `rapport-diagnostic-AAAA-MM-JJ-HHMM.pdf` généré dans le navigateur, même hors ligne : résultat, actions cochées, étapes selon le matériel, parcours, notes) ou **Imprimer**.
- **Notes du technicien** : champ « Notes » à côté du journal, enregistré automatiquement sur l'appareil (une note par symptôme et par jour, supprimée après 30 jours). Les notes sont reprises dans le rapport copié. Ne pas y saisir de données personnelles.
- **Liens partageables** : l'URL contient tout le parcours (`#/d/pas-de-son/audio-q1/…`). Envoyer le lien permet à un collègue ou au N2 de voir exactement le même diagnostic.
- **Raccourcis clavier** : `/` recherche · `1`–`9` répondre · `Retour arrière` étape précédente · `Échap` accueil.

---

## Confidentialité

- Aucun cookie, aucun outil de statistiques, aucune requête vers un domaine externe (pas de polices ni de CDN).
- Données conservées, uniquement dans le stockage local du navigateur de l'appareil (`localStorage`), jamais envoyées : les 6 derniers diagnostics (bouton **Effacer** de l'accueil), les notes du technicien (bouton **Effacer les notes**, purge automatique après 30 jours) et le brouillon de l'éditeur.

---

## Polices

Le design utilise **Space Grotesk** (titres) et **Rubik** (texte) si elles sont installées sur l'appareil, sinon la police système. Pour les embarquer sans appel externe :

1. Télécharger les fichiers `.woff2` (Google Fonts, licence libre OFL) dans un dossier `fonts/`.
2. Ajouter en haut de `styles.css` :

```css
@font-face { font-family: "Space Grotesk"; src: url("fonts/SpaceGrotesk.woff2") format("woff2"); font-weight: 300 700; font-display: swap; }
@font-face { font-family: "Rubik"; src: url("fonts/Rubik.woff2") format("woff2"); font-weight: 300 700; font-display: swap; }
```

3. Ajouter les deux fichiers à la liste `SHELL` de `sw.js` et incrémenter `CACHE_VERSION`.

---

## Compatibilité

Navigateurs récents : Chrome / Edge 90+, Safari 15+ (iPad, iPhone), Firefox 90+.
