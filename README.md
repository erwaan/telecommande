# Quiz Théâtre — App présentateur / public

Application de quiz/sondage en direct pour présenter des pitchs de pièces de théâtre et laisser le public voter depuis son téléphone.

- **Page publique** (`/` — racine du site) : rejoindre avec un code de session + prénom, puis voter en direct. C'est la page destinée au grand public (lien/QR code partagé).
- **Page présentateur** (`/presenter/`) : QR code + code de session, liste des inscrits, contrôle des 3 quiz. URL à garder privée.

100% statique (déployable sur GitHub Pages), synchronisé en temps réel via **Firebase Firestore**.

## 1. Créer le projet Firebase

Toutes les manipulations détaillées (création du projet, Firestore, authentification anonyme, récupération de la config, déploiement des règles) sont dans **[FIREBASE_SETUP.md](FIREBASE_SETUP.md)**.

### Capacité pour ~200 participants simultanés

Firestore (plan gratuit Spark) n'a **pas** de limite de connexions simultanées (contrairement à la Realtime Database, plafonnée à 100 en gratuit). La seule limite est un quota quotidien (50 000 lectures / 20 000 écritures / jour), largement suffisant pour un évènement live avec 200 personnes. Si tu enchaînes beaucoup de sessions le même jour, surveille l'onglet "Utilisation" de Firestore.

## 2. Configurer les quiz

Les quiz sont définis dans `config/quiz-1.json`, `config/quiz-2.json`, `config/quiz-3.json`, etc. Ils sont détectés automatiquement : ajoute simplement un nouveau fichier `config/quiz-N.json` en suivant la numérotation (sans trou) pour qu'un quiz supplémentaire apparaisse, et son nom affiché est celui du champ `name`. Structure :

```jsonc
{
  "id": "quiz-1",
  "name": "Quiz 1",
  "round1": {
    "voteOptions": [
      { "label": "J'adore", "points": 3 },
      { "label": "J'aime bien", "points": 2 },
      { "label": "Sans plus", "points": 1 },
      { "label": "Ça ne m'intéresse pas", "points": 0 }
    ],
    "selectCount": 3, // Y : nombre de pièces retenues pour la manche 2
    "pitches": [
      {
        "id": "p1",
        "title": "Titre de la pièce",
        "pitch": "Résumé du pitch...",
        "presentationOptions": ["Teaser vidéo", "Jim et Julien jouent un extrait", "Pourquoi ce choix Christian ?"]
      }
    ]
  }
}
```

`presentationOptions` est propre à chaque pièce (manche 2) : mets uniquement les options réellement disponibles pour cette pièce (par exemple, pas de "Teaser vidéo" si elle n'existe pas pour cette pièce-là). Modifie librement le nombre de pitchs, les libellés, les points, `selectCount` (Y) et les options de présentation de chaque pièce.

## 3. Lancer en local

Un simple serveur statique suffit (les imports ES module ne fonctionnent pas en `file://`) :

```bash
npx serve .
# ou
python -m http.server 8080
```

Puis ouvre `http://localhost:8080/` (page public) et `http://localhost:8080/presenter/` (page présentateur).

## 4. Déployer sur GitHub Pages

1. Pousse ce dossier sur un dépôt GitHub.
2. Repo **Settings > Pages** → Source: `Deploy from a branch`, branche `main`, dossier `/ (root)`.
3. L'app sera disponible sur `https://<user>.github.io/<repo>/` (page public, à partager) et `.../presenter/` (à garder pour toi).

## Sécurité — à savoir

Il n'y a pas de compte "présentateur" séparé : n'importe qui possédant l'URL `/presenter/` peut piloter la session (un simple code PIN client-side est demandé à l'ouverture, voir `PRESENTER_PIN` dans `firebase-config.js` — **ce n'est pas une vraie sécurité**, juste un garde-fou contre un accès accidentel). Les règles Firestore (`firestore.rules`) empêchent en revanche un participant de voter au nom d'un autre ou de modifier le vote de quelqu'un d'autre. Pour un usage plus sensible, il faudrait ajouter une vraie authentification présentateur (ex. Firebase custom claims via une Cloud Function).

## Personnalisation du style

Tout le style est dans `assets/css/style.css` (variables CSS en haut du fichier). Dis-moi les couleurs/logo/police que tu veux et j'adapterai.
