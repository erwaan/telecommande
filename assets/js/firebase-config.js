// Config de ton projet Firebase (Console Firebase > Paramètres du projet > Vos applications > config SDK).
// Pas d'import ni d'initializeApp ici : c'est assets/js/firebase-init.js qui s'en charge
// via le SDK modulaire chargé depuis le CDN gstatic (pas de bundler npm dans ce projet).
export const firebaseConfig = {
  apiKey: "AIzaSyBqRzkI3M2YSeNI9ogqaGQJ_x14EhBvOTc",
  authDomain: "telecommande-37238.firebaseapp.com",
  projectId: "telecommande-37238",
  storageBucket: "telecommande-37238.firebasestorage.app",
  messagingSenderId: "644223055920",
  appId: "1:644223055920:web:b7820eb452744ad11315f5"
};

// Code demandé à l'ouverture de la page présentateur.
// Ce n'est PAS une vraie sécurité (vérifié côté client) : juste un garde-fou
// contre un accès accidentel à l'écran de contrôle. Change-le librement.
export const PRESENTER_PIN = "2955";
