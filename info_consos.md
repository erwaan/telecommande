❯ Quelles sont les limites avec firebase ? J'aimerais m'assurer que mon appli ne bloque pas avec les quotas pendant ma présentation

  Read 1 file, ran 1 shell command

Firebase Firestore (plan gratuit Spark, celui que le README mentionne) a ces quotas par jour :

┌────────────────────────┬───────────────────────────────────────────────────────────────────────┐
│       Ressource        │                             Quota gratuit                             │
├────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ Lectures               │ 50 000 / jour                                                         │
├────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ Écritures              │ 20 000 / jour                                                         │
├────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ Suppressions           │ 20 000 / jour                            │
├────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ Stockage               │ 1 GiB                                    │
├────────────────────────┼───────────────────────────────────────────────────────────────────────┤
│ Réseau sortant         │ 10 GB / mois                             │
├────────────────────────┼───────────────────────────────────────────────────────────────────────┤                                            │ Connexions simultanées │ pas de limite (contrairement à la à 100) │
└────────────────────────┴───────────────────────────────────────────────────────────────────────┘                                            
⚠️ Le reset quotidien se fait à minuit heure du Pacifique (US), pas heure française — donc si ton événement a lieu en soirée en France, tu es potentiellement déjà dans le "jour" de quota suivant.

Estimation pour ton appli, avec ~200 participants et tes 3 qu

J'ai regardé session-service.js pour voir ce qui consomme rée

- Écritures : ~1 par vote (castVote, ligne 121) + joins. Avechs manche 2 (tous quiz confondus) × 200 votants ≈ 7 500-8 000écritures. Large marge sous 20 000.
- Lectures : c'est le point sensible, à cause des onSnapshot
  - listenSession (ligne 60) : chaque participant garde un listener ouvert sur le doc de session. Chaque changement de phase (nouveau pitch, résultats,
    etc.) déclenche 1 lecture par participant connecté. Avec les 3 quiz × 200 personnes ≈ 12 000-13 000 lectures.
  - listenVotesForPitch (ligne 141, côté présentateur) : chaque vote qui arrive en direct compte comme une lecture ≈ 7 000-8 000 lectures.
  - getVotesForQuizRound (ligne 153) : relit tous les votes pnal de chaque manche → re-consomme à peu près le même volumeune seconde fois ≈ 7 000-8 000 lectures.
  - Total estimé : ≈ 28 000-30 000 lectures pour un passage c

Donc pour un seul passage live avec 200 personnes, tu restes e marge d'environ 40% seulement sur les lectures — pas énorme.

Ce qui pourrait te faire dépasser

- Une répétition générale complète avec un vrai groupe le mêms'additionnent).
- Redémarrer un quiz plusieurs fois après une erreur de manip (chaque relance rejoue les mêmes lectures/écritures).
- Plus de participants que prévu.

Ce qui se passe si tu dépasses le quota

Ce n'est pas gracieux : Firestore renvoie une erreur (RESOURCnt d'être enregistrés et les écrans (présentateur + public)arrêtent de se mettre à jour en direct — en plein événement, c'est le pire moment pour ça.                                                               
Recommandation                                                                                                                                           
Le plus simple et quasi gratuit : passer le projet Firebase en plan Blaze (pay-as-you-go). Les 50k lectures/20k écritures gratuites sont incluses telles quelles, et au-delà c'est facturé au-delà (~0,036 $/100k lect) — pour un dépassement éventuel de quelques milliersd'opérations, ça coûterait des centimes. Ça élimine complètement le risque de blocage en dur pendant la présentation, sans changer une ligne de code.    
Sinon, sans changer de plan : fais tes répétitions un autre jour que le live, et jette un œil à l'onglet Utilisation de Firestore la veille pour voir où tu en es sur le quota du jour.