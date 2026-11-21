# DIAG·SAV — Assistant de diagnostic de premier niveau

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
├── styles.css             Thème sombre « control room »
├── app.js                 Navigation, recherche, historique, rendu
├── sw.js                  Service worker (mode hors ligne)
├── manifest.webmanifest   Installation sur l'écran d'accueil (tablette)
├── icon.svg               Icône de l'application
├── .nojekyll              Désactive Jekyll sur GitHub Pages
└── data/
    └── decisions.json     Arbre de décision (symptômes, questions, résultats)
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

## Modifier les procédures (équipes SAV)

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

### Migration du schéma

`meta.schemaVersion` indique la version du format (actuellement `2`). Un fichier sans ce champ est lu comme v1 et complété automatiquement au chargement (sections `sources`, `families`, `products` vides) : un ancien `decisions.json` fonctionne sans modification.

### Contrôler ses modifications

1. Vérifier que le JSON est valide (VS Code le signale, ou https://jsonlint.com en local).
2. Ouvrir le site : en cas d'incohérence (nœud introuvable, gravité invalide, nœud jamais atteint…), un message **« ⚠ N anomalie(s) dans les données »** apparaît en pied de page. Le détail s'affiche dans la console du navigateur (F12).
3. Si le JSON est mal formé, l'application affiche l'erreur de syntaxe au lieu de la page.
4. Incrémenter `meta.version` : elle s'affiche en haut à droite (`DATA v…`), ce qui permet de vérifier que les techniciens ont la bonne version.

Convention d'identifiants conseillée : `<préfixe>-q<n>` pour les questions et `<préfixe>-r-<nom>` pour les résultats (ex. `video-q3`, `video-r-edid`).

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

- **Procédures** (`decisions.json`) : le réseau est interrogé en premier, le cache sert de secours. Une modification publiée est donc visible dès que l'appareil a du réseau.
- **Code** (HTML, CSS, JS) : servi depuis le cache, mis à jour en arrière-plan.

Après une modification de `index.html`, `styles.css` ou `app.js`, changez `CACHE_VERSION` dans `sw.js` (ex. `diagsav-v1.0.1`) pour forcer la mise à jour chez tous les utilisateurs.

Sur tablette, utilisez « Ajouter à l'écran d'accueil » pour lancer l'outil comme une application.

---

## Utilisation

- **Recherche** : tapez un symptôme (« pas de son », « écran noir », « dante »…) ou une marque / référence du catalogue (« MCTRL4K », « SLXD », « Netgear »). La touche Entrée ouvre le premier résultat.
- **Filtres** : par catégorie (alimentation, audio, vidéo, réseau, thermique, stabilité, périphériques, firmware).
- **Fil d'Ariane** : cliquez sur une étape pour y revenir.
- **Journal** : liste des questions et réponses. Cliquez sur une entrée pour revenir à cette question.
- **Résultat** : cochez les actions réalisées, puis **Copier le rapport** pour coller un résumé dans un ticket, ou **Imprimer**.
- **Liens partageables** : l'URL contient tout le parcours (`#/d/pas-de-son/audio-q1/…`). Envoyer le lien permet à un collègue ou au N2 de voir exactement le même diagnostic.
- **Raccourcis clavier** : `/` recherche · `1`–`9` répondre · `Retour arrière` étape précédente · `Échap` accueil.

---

## Confidentialité

- Aucun cookie, aucun outil de statistiques, aucune requête vers un domaine externe (pas de polices ni de CDN).
- Seule donnée conservée : la liste des 6 derniers diagnostics, dans le stockage local du navigateur de l'appareil (`localStorage`). Elle ne quitte jamais l'appareil et peut être effacée avec le bouton **Effacer** de l'accueil.

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
