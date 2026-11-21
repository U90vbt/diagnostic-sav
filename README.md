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

### Contrôler ses modifications

1. Vérifier que le JSON est valide (VS Code le signale, ou https://jsonlint.com en local).
2. Ouvrir le site : en cas d'incohérence (nœud introuvable, gravité invalide, nœud jamais atteint…), un message **« ⚠ N anomalie(s) dans les données »** apparaît en pied de page. Le détail s'affiche dans la console du navigateur (F12).
3. Si le JSON est mal formé, l'application affiche l'erreur de syntaxe au lieu de la page.
4. Incrémenter `meta.version` : elle s'affiche en haut à droite (`DATA v…`), ce qui permet de vérifier que les techniciens ont la bonne version.

Convention d'identifiants conseillée : `<préfixe>-q<n>` pour les questions et `<préfixe>-r-<nom>` pour les résultats (ex. `video-q3`, `video-r-edid`).

---

## Mode hors ligne

Au premier chargement, `sw.js` met en cache tous les fichiers. Ensuite :

- **Procédures** (`decisions.json`) : le réseau est interrogé en premier, le cache sert de secours. Une modification publiée est donc visible dès que l'appareil a du réseau.
- **Code** (HTML, CSS, JS) : servi depuis le cache, mis à jour en arrière-plan.

Après une modification de `index.html`, `styles.css` ou `app.js`, changez `CACHE_VERSION` dans `sw.js` (ex. `diagsav-v1.0.1`) pour forcer la mise à jour chez tous les utilisateurs.

Sur tablette, utilisez « Ajouter à l'écran d'accueil » pour lancer l'outil comme une application.

---

## Utilisation

- **Recherche** : tapez un symptôme (« pas de son », « écran noir », « dante »…). La touche Entrée ouvre le premier résultat.
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

## Compatibilité

Navigateurs récents : Chrome / Edge 90+, Safari 15+ (iPad, iPhone), Firefox 90+.
