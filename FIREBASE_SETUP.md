# Configuration Firebase — pas à pas

Ce guide détaille toutes les manipulations à faire dans la console Firebase pour que l'app (présentateur + public) fonctionne. Compte environ 10-15 minutes. Tout est gratuit (plan Spark).

## 1. Créer le projet Firebase

1. Va sur https://console.firebase.google.com et connecte-toi avec ton compte Google.
2. Clique sur **Ajouter un projet**.
3. Donne-lui un nom (ex. `quiz-theatre`) → **Continuer**.
4. Désactive Google Analytics si tu n'en as pas l'usage (pas nécessaire ici) → **Créer le projet**.
5. Attends la fin de la création → **Continuer**.

## 2. Activer Firestore Database

1. Dans le menu de gauche : **Build > Firestore Database**.
2. Clique sur **Créer une base de données**.
3. Choisis une région proche de tes utilisateurs (ex. `eur3 (europe-west)`) — **ce choix est définitif, on ne peut pas en changer après**.
4. Mode de démarrage : choisis **Mode production** (on va poser nos propres règles à l'étape 5).
5. Clique sur **Créer**.

## 3. Activer l'authentification anonyme

1. Menu de gauche : **Build > Authentication**.
2. Clique sur **Get started** (si c'est la première fois que tu ouvres Authentication sur ce projet).
3. Onglet **Sign-in method**.
4. Dans la liste des fournisseurs, clique sur **Anonyme** (Anonymous).
5. Active le toggle **Activer/Enable** → **Enregistrer**.

C'est cette authentification (invisible pour l'utilisateur) qui permet à chaque participant d'avoir un identifiant stable, sans compte ni mot de passe.

## 4. Déclarer une application Web et récupérer la config

1. Menu de gauche, en haut : clique sur la **roue crantée ⚙️ > Paramètres du projet**.
2. Descends jusqu'à la section **Vos applications**.
3. Clique sur l'icône **</>** (Web).
4. Donne un surnom à l'app (ex. `quiz-theatre-web`). **Ne coche pas** "Configurer Firebase Hosting" (on déploie sur GitHub Pages, pas sur Firebase Hosting).
5. Clique sur **Enregistrer l'application**.
6. Firebase affiche un bloc de code avec un objet `firebaseConfig = { apiKey: ..., authDomain: ..., ... }`. **Copie cet objet.**
7. Clique sur **Passer à la console** pour terminer.

Si tu dois retrouver cette config plus tard : **Paramètres du projet > Général**, section **Vos applications**, clique sur l'app puis **Configuration du SDK**.

## 5. Coller la config dans le projet

Ouvre le fichier `assets/js/firebase-config.js` et remplace les valeurs `YOUR_...` par celles copiées à l'étape précédente :

```js
export const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "quiz-theatre-xxxxx.firebaseapp.com",
  projectId: "quiz-theatre-xxxxx",
  storageBucket: "quiz-theatre-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

Dans le même fichier, tu peux aussi changer `PRESENTER_PIN` (le code demandé pour ouvrir la page présentateur — ce n'est pas une vraie sécurité, juste un garde-fou contre un accès accidentel) :

```js
export const PRESENTER_PIN = "1234"; // remplace par ce que tu veux
```

## 6. Déployer les règles de sécurité Firestore

Le fichier `firestore.rules` à la racine du projet contient les règles à appliquer. Deux façons de faire, choisis la plus simple pour toi :

### Option A — copier-coller dans la console (le plus rapide, pas d'installation)

1. Menu de gauche : **Build > Firestore Database**.
2. Onglet **Règles** (Rules) en haut.
3. Sélectionne tout le contenu de l'éditeur et supprime-le.
4. Ouvre le fichier `firestore.rules` du projet, copie tout son contenu, colle-le dans l'éditeur de la console.
5. Clique sur **Publier**.

### Option B — via la CLI Firebase (si tu préfères scripter/versionner)

```bash
npm install -g firebase-tools
firebase login
firebase init firestore   # choisis le projet créé à l'étape 1, garde firestore.rules par défaut
firebase deploy --only firestore:rules
```

## 7. Vérifier que ça fonctionne

1. Lance un serveur statique local à la racine du projet (`npx serve .` si tu as Node, sinon `python -m http.server 8080`).
2. Ouvre `http://localhost:8080/presenter/index.html` (adapte le port si besoin), entre le PIN.
3. Clique sur **Créer une session** : un QR code et un code à 4 caractères doivent apparaître.
4. Ouvre `http://localhost:8080/` dans un autre onglet (ou scanne le QR code depuis ton téléphone) — c'est la page publique, à la racine du site. Entre le code + un prénom, clique sur **Rejoindre**.
5. Le prénom doit apparaître dans la liste des participants sur la page présentateur, en quelques secondes.

Si une erreur Firebase s'affiche à l'écran (`auth/api-key-not-valid`, `permission-denied`, etc.), relis l'étape correspondante ci-dessus — le message d'erreur indique précisément quoi vérifier.

## 8. Vérifier les quotas (facultatif, utile le jour J)

Menu de gauche : **Build > Firestore Database > Utilisation** (ou **Usage**). Le plan gratuit (Spark) autorise 50 000 lectures, 20 000 écritures et 20 000 suppressions par jour — largement suffisant pour un évènement de 200 personnes, mais utile à surveiller si tu enchaînes plusieurs sessions le même jour.

## 9. Déployer sur GitHub Pages

Une fois Firebase configuré, voir la section correspondante dans `README.md` (dépôt GitHub + Settings > Pages).
