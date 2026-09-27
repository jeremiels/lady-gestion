# Suivi de la revue de code — septembre 2026

La revue [`code-review-2026-09.md`](code-review-2026-09.md) (26 septembre 2026,
`7ad2425`) relevait 1 constat critique, 2 élevés, 12 moyens et 12 groupes de
constats faibles, avec un plan d'action en dix chantiers. Ces chantiers ont été
traités les 26 et 27 septembre 2026, de `08d9cf2` à `7fb102c` sur `main`.

Ce document dit ce qui est fait, ce qui reste, et ce qu'il faut garder en tête
pour ne pas refaire ces bugs. **État au 27 septembre 2026, `7fb102c`.**

**Légende**

|     |                                                                             |
| --- | --------------------------------------------------------------------------- |
| ✅  | fait, avec un test de régression qui échouait sur l'ancien code             |
| 🟡  | fait en partie ; le reste est dit dans la colonne « Reste »                 |
| ⏸️  | reporté volontairement ; son déclencheur est indiqué                        |
| ❓  | décision à prendre (produit, design ou propriétaire du dépôt)               |
| 📱  | à vérifier sur l'iPhone : rien de propre à iOS ni à VoiceOver n'a pu l'être |

---

## 1. Ce qui a été fait

| #   | Chantier                                                                                                      | Constats                              | Commits                         |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------- |
| 1   | Feuille d'édition recréée à chaque ouverture, champs indexés par `field.id`                                   | C1, M6, F9 (repli)                    | `08d9cf2`                       |
| 2   | Confirmation avant de supprimer une séance qui porte une note ; suppression via `postsService.deletePost`     | E1                                    | `08d9cf2`                       |
| 3   | Données personnelles retirées du bundle et des fixtures                                                       | E2                                    | `7496b9c`, `b27b41c`            |
| 4   | Navigation sous `/lady-gestion/`, fin de la boucle Profil ↔ Personnaliser                                     | M8, F3                                | `c51cebb`                       |
| 5   | « À venir » selon la date et l'heure, puce fantôme « Balade à pied », `.today` du calendrier                  | M7, M9, F2                            | `71e38b3`, `8f5210f`, `16d21c5` |
| 6   | Sauvegarde honnête : partage confirmé, export sans Dexie, purge du seed sur base vierge, validation complétée | M1, M2, M3, F6                        | `38ff478`                       |
| 7   | Échecs visibles : bandeau de lecture, messages français, drapeau `saving`                                     | M4, M5, F4                            | `4d98231`                       |
| 8   | iPhone et VoiceOver : `maximum-scale=1`, noms et états accessibles                                            | M11, F1                               | `b1c049c`                       |
| 9   | Filets : suite e2e (hors ligne, mise à jour du service worker), job WebKit, tests `app-checkbox`              | M12                                   | `39f2379`                       |
| 10  | Dette : règles métier sorties des vues, CSP, routeur, nombres, commentaires faux…                             | F2, F3, F5, F7, F8, F9, F10, F11, F12 | `eeb6e8b`, `7fb102c`            |

Hors revue, dans la même période : le nom du cheval séparé en prénom et nom
(schéma v14, `596e588`) et le durcissement des migrations qui a suivi
(`da9f1a1`, `d61e925`).

---

## 2. Ce qui reste

### 2.1 Décisions à prendre ❓

- **M10 — montant des rendez-vous de suivi.** Une copie de suivi recopie
  `amountCents` et compte dans « Dépenses » avant d'avoir eu lieu, puis une
  seconde fois si la vraie visite est saisie à part. Deux options :
  - une copie sans montant (`followUpOf`, `posts.service.ts`, et le test qui
    fige le comportement actuel dans `posts.service.test.ts`) ;
  - ou séparer « prévu » et « dépensé » dans les totaux.
- **M6 — valeur par défaut d'un type contre une saisie.** À la création, si
  l'on change de type et que l'ancien et le nouveau ont un champ de même `id`
  avec des `defaultValue` différentes, la valeur par défaut du nouveau type
  écrase ce qui a été tapé. A priori elle ne devrait pas.
- **E2 — historique Git.** Les valeurs réelles retirées du code (identité,
  cheval, montants de la fixture) restent dans l'historique. Il faut vérifier
  si le dépôt est public, puis décider de le réécrire ou non.
- **E2 — valeurs par défaut des praticiens.** Les quatre `defaultValue` réelles
  (coach et trois praticiens, `categories.ts`) sont **gardées exprès** jusqu'à
  ce que le form builder permette à l'utilisatrice de les saisir elle-même.
  Elles sont donc toujours dans le bundle public.
- **Design, à trancher avec la designer :**
  - **Contrastes (F1)** sous 4,5:1 : méta des cartes `#929292` sur blanc à
    10 px (3,11:1), libellés inactifs de la barre (2,26:1), carte Dépenses
    (2,34:1 et 1,92:1). Repère : `#767676` sur blanc donne 4,54:1.
  - **Champs (F10)** : `flat` et `hide-label` ne retirent plus la carte ;
    `--app-input-background` et `--app-select-border-color` ne sont lus nulle
    part ; libellés en 12 ou 14 px et rayons de 12 ou 8 selon le champ.
  - **Rappel de sauvegarde (M1)** sur l'Accueil au-delà de N jours.
  - **Taille des champs (M11)** : `maximum-scale=1` a été choisi, sans
    changement visuel. Des champs à 16 px supprimeraient la cause ; sur Android,
    `maximum-scale` bloque aussi le pincement.
  - **Textes écrits pendant les chantiers, à valider :**
    - la modale « Supprimer la séance ? » (E1) ;
    - les trois messages d'export (M1) ;
    - le stockage plein, et la phrase sous « Restaurer un fichier » désactivé
      (M2) ;
    - le bandeau « Certaines données n'ont pas pu être lues. » et « Lecture
      impossible » (M4) ;
    - « Modification impossible. » et « Ajout impossible. » (M5) ;
    - « Navigation principale » et les libellés des jours (« …, aujourd'hui :
      Trotting », « : aucune ») (F1) ;
    - « Prénom » et « Nom » dans Personnaliser › Cheval.

### 2.2 À vérifier sur l'iPhone 📱

- **Export (M1)** : dans l'app installée, la feuille de partage confirme un
  enregistrement dans Fichiers, et sa fermeture n'horodate rien.
- **Zoom (M11)** : toucher un champ ne zoome plus, et le pincement fonctionne
  toujours.
- **VoiceOver (F1)** :
  - le jour sélectionné du calendrier est annoncé « sélectionné »
    (`aria-selected` est sur la cellule, pas sur le bouton ; non modifié) ;
  - les nouveaux noms sont lus comme prévu : jours de la semaine, total du
    budget, barre de navigation.
- **Lectures en échec (M4)** : fréquence réelle des pertes de connexion
  IndexedDB après une longue mise en arrière-plan.
- **Garde double-tap (F4)** : pas de tap perdu entre deux contrôles d'un même
  composant.
- **Souscriptions push (F7)** : expirent-elles sur iOS, et Safari envoie-t-il
  `pushsubscriptionchange` ?
- **Les trois points de fin de revue :**
  - la poignée de la feuille, saisie pendant sa fermeture ;
  - « Ouvrir dans un nouvel onglet » d'un PDF depuis l'app installée ;
  - la touche Retour du clavier dans « Autre activité… ».

### 2.3 Reporté, avec son déclencheur ⏸️

**Avec le chantier Drive**

- **F6 — octets des documents.** Ils ne sont dans aucune sauvegarde : un
  document restauré a une fiche et pas de fichier. C'est **bloquant avant tout
  upload.** Le Drive est le bon endroit pour les porter à côté du snapshot.
- **F7 — Worker de rappels.** `PUT /reminders` n'a ni authentification ni
  limite de débit. À faire en même temps que l'endpoint du Drive (« token
  broker ») sur le même Worker :
  - un plafond total d'abonnements ;
  - un budget par exécution du cron ;
  - une limite de débit Cloudflare.
- **F8 — upload.** N'accepter que les PDF et les images matricielles.
- **M1 — « Dernière sauvegarde ».** Un envoi au Drive confirmé par le serveur
  deviendra la vraie preuve ; l'export manuel mérite peut-être son propre
  horodatage.
- **Sauvegarde automatique sur iOS.** Safari n'a ni Background Sync ni Periodic
  Background Sync : « automatique » voudra dire à l'ouverture, au passage en
  arrière-plan ou après des écritures, jamais app fermée. L'export se prête à
  un envoi sans geste : `exportBackup` lit IndexedDB directement, et
  `backup/file.ts` sépare la lecture de la livraison, où un `drive.ts` pourra
  se brancher.

**À la prochaine montée de schéma**

- **F11 — index morts** : `posts.horseId`, `categoryKey`, `status`,
  `[horseId+categoryKey]`, `documents.category`, `[horseId+category]`,
  `rationItems.horseId`, `categories.key` et `order`.
- **M7 — lignes fantômes.** Les trois lignes `baladeApied` de la base réelle
  sont invisibles (`activityChoices` les écarte) mais toujours stockées. Une
  étape `ROW_STEPS` peut les supprimer logiquement.
- **S4 / M9 — statut.** Proposition : réduire le statut stocké à « annulé ou
  non » et déduire `planned` / `done` de la date là où l'iCalendar en a besoin.
  Cela supprime `statusForDate` et la re-dérivation de `posts.service.ts`.

**Quand on voudra**

- **Suppression du repli sans Navigation API (F11)** : `history-fallback.ts`,
  les branches du routeur, `view-state.ts` et `navigation.ts`. C'est du code
  mort sous le plancher navigateur. Ensuite seulement : rendre `toAppPath`
  strict (M8) et ramener le « Retour » à un seul idiome. Effort M.
- **Job WebKit (M12)** : il n'a jamais tourné (pas de WebKit pour Ubuntu 20.04,
  ni Docker, en local). Au premier push, lire ses échecs : vrais bugs iOS ou
  tests qui supposent Chromium. Une fois vert, l'ajouter aux `needs` du
  déploiement.
- **Tests de `pwa/push.ts` (M12)** : l'état est au niveau du module et dépend
  d'un vrai enregistrement de service worker. Il faut injecter l'enregistrement
  et `fetch`, ce qui demande un petit remaniement.

### 2.4 Dette latente connue, sans action prévue

- **F10 — `<fieldset>` désactivé.** `formDisabledCallback` pose un attribut
  `disabled` réfléchi : un champ désactivé par un `<fieldset>` le resterait
  après sa réactivation. Aucun `<fieldset>` n'est désactivé dans l'app.
- **F10 — `app-unit-select` sans options** n'est jamais `valueMissing`. L'app
  lui passe toujours des unités.
- **F10 — `app-select`, valeur posée avant ses options** : non reproduit sur
  trois scénarios.
- **Accueil** : un rendez-vous du jour dont l'heure est passée sort de « À
  venir » à la prochaine exécution de la requête (ouverture, écriture, minuit),
  pas à la minute près.
- **`activity-sheet`** : l'ajout au catalogue et l'écriture de la séance sont
  deux écritures, pas une transaction (documenté sur place).
- **CSP** : `frame-ancestors` ne peut pas être posé par une balise `<meta>`, et
  GitHub Pages ne permet pas d'en-têtes.
- **Recouvrement possible** : le bandeau de lecture et le toast de mise à jour
  sont au même endroit, et peuvent se superposer s'ils apparaissent ensemble.

---

## 3. À l'avenir — ce que ces chantiers ont appris

Chaque ligne correspond à un bug réellement trouvé ici.

- **Un formulaire d'édition se reconstruit à chaque ouverture** (clé
  `` `${id}-${openCount}` ``, patron `ration-sheet` / `post-sheet`). On ne
  revient jamais au record par `form.reset()`, et une liste de champs se rend
  avec `repeat(…, field.id, …)`. Cause de C1 et M6.
- **Tout chemin passé à `navigateTo` / `goBack` est un chemin d'app**
  (`/posts`). Tout code qui écrit une URL a son test sous base déployée
  (`*.deployed-base.test.ts`). Cause de M8.
- **Une lecture qui échoue se voit.** `onReadError` alimente le bandeau, et une
  vue dont l'état vide aurait un autre sens (« introuvable ») lit
  `LiveQuery.error`.
- **Une écriture qui échoue se dit en français.** Utiliser
  `errorMessage(error, repli)`, et `UserFacingError` pour un message écrit pour
  l'utilisatrice ; jamais `error.message` brut. Le drapeau `saving` est levé
  avant le premier `await` et baissé à la fermeture.
- **Un nombre à éditer passe par `editableDecimal`**, jamais par
  `toLocaleString`, qui groupe les milliers et arrondit. Deux textes se
  comparent avec `foldText`.
- **« Aujourd'hui » vient du contrôleur `Today`** (`.today=${…}`), pas d'un
  `todayISO()` figé au montage.
- **Toute écriture sur plusieurs tables se fait en transaction**, le seed
  compris. La purge du seed ne touche qu'une base vierge.
- **Avant une montée de schéma ou un déploiement qui touche les données** :
  - faire un export frais sur l'iPhone et le déposer dans `backup/` : le test
    `snapshot.real-backup.test.ts` le lit ;
  - écrire la montée dans `ROW_STEPS`, pour l'appareil et le fichier à la fois ;
  - la tester contre une base de la version précédente.
- **Rien de réel dans le code ni dans les fixtures.** Une fixture tirée d'un
  export se brouille : noms remplacés, dates décalées, montants modifiés.
- **Chaque correctif a son test de régression, vérifié en échec sur l'ancien
  code.** `npm run test:e2e` pour tout changement du service worker ou de
  `pwa/`. Le job WebKit doit devenir bloquant dès qu'il est vert.
- **Un commentaire dit ce que fait le code et pourquoi, pas son histoire**
  (CLAUDE.md). Un commentaire faux a coûté cher ici : celui de `#reset`
  affirmait l'inverse du bug C1.

---

## Annexe — état de chaque constat

| Réf. | Sujet                                                     | État | Commits                           | Reste                                                    |
| ---- | --------------------------------------------------------- | ---- | --------------------------------- | -------------------------------------------------------- |
| C1   | Éditions successives qui réécrivent d'anciennes valeurs   | ✅   | `08d9cf2`                         | —                                                        |
| E1   | Tap sur la puce du jour qui supprime la séance            | ✅   | `08d9cf2`                         | textes ❓                                                |
| E2   | Données personnelles publiées                             | 🟡   | `7496b9c`, `b27b41c`              | `defaultValue` des praticiens (voulu), historique Git ❓ |
| M1   | « Sauvegardé » sans le savoir                             | ✅   | `38ff478`                         | 📱 partage ; rappel sur l'Accueil ❓                     |
| M2   | Export impossible depuis « Données inaccessibles »        | ✅   | `38ff478`                         | —                                                        |
| M3   | Restauration étrangère qui supprime le vrai cheval        | ✅   | `38ff478`                         | —                                                        |
| M4   | Lecture en échec affichée comme vide                      | ✅   | `4d98231`                         | 📱 fréquence                                             |
| M5   | Écriture en échec muette ou en anglais                    | ✅   | `4d98231`, `38ff478`              | —                                                        |
| M6   | Changement de type qui déplace la saisie                  | ✅   | `08d9cf2`                         | valeur par défaut contre saisie ❓                       |
| M7   | Activité fantôme « Balade à pied »                        | ✅   | `71e38b3`                         | 3 lignes en base ⏸️ schéma                               |
| M8   | Adresse hors de `/lady-gestion/`                          | ✅   | `c51cebb`                         | `toAppPath` strict ⏸️                                    |
| M9   | Rendez-vous du jour absent d'« À venir »                  | ✅   | `8f5210f`                         | modèle de statut ⏸️ schéma                               |
| M10  | Montant recopié dans les suivis                           | ❓   | —                                 | décision produit                                         |
| M11  | Zoom au focus sur iPhone                                  | ✅   | `b1c049c`                         | 📱                                                       |
| M12  | Filets de tests                                           | 🟡   | `39f2379`                         | WebKit jamais exécuté, `push.ts` sans test               |
| F1   | VoiceOver et contrastes                                   | 🟡   | `b1c049c`                         | calendrier 📱, contrastes ❓                             |
| F2   | « Aujourd'hui » figé, messages périmés                    | ✅   | `16d21c5`, `7fb102c`              | —                                                        |
| F3   | Navigation : boucle, navigation abandonnée, `%` mal formé | ✅   | `c51cebb`, `7fb102c`              | —                                                        |
| F4   | Double soumission, garde double-tap                       | ✅   | `4d98231`                         | 📱                                                       |
| F5   | Saisie des nombres                                        | ✅   | `7fb102c`                         | —                                                        |
| F6   | Sauvegarde : fragilités secondaires                       | 🟡   | `38ff478`                         | octets des documents ⏸️ Drive                            |
| F7   | Rappels push                                              | 🟡   | `7fb102c`                         | Worker ⏸️ Drive ; expiration 📱                          |
| F8   | Service worker et CSP                                     | ✅   | `7fb102c`                         | liste blanche d'upload ⏸️                                |
| F9   | Dialogues                                                 | ✅   | `08d9cf2`, `7fb102c`              | —                                                        |
| F10  | Champs de formulaire                                      | 🟡   | `7fb102c`                         | deux cas latents, un non reproduit, design ❓            |
| F11  | Maintenabilité                                            | 🟡   | `eeb6e8b`                         | index ⏸️ schéma, repli Navigation API ⏸️                 |
| F12  | Commentaires faux                                         | ✅   | `7fb102c` et au fil des chantiers | —                                                        |

**Audit de septembre** (`data-model-audit.md`). Depuis cette revue :

- M3 (doublon de puce) est corrigé par `71e38b3` ;
- S7 (`seedIfEmpty` non transactionnel) est corrigé par `38ff478` ;
- M6 (données personnelles) est traité en partie, comme E2 ;
- S2 (octets des documents) et S9 (index) sont reportés comme ci-dessus ;
- S6 : le code était corrigé avant la revue, mais **le document orphelin déjà
  présent sur l'appareil ne l'est pas** — la sauvegarde du 27/09 contient
  toujours un document vivant rattaché à un post supprimé.

L'audit porte ces états, et note que sa montée de schéma « v13 → v14 » est
devenue v14 → v15, v14 ayant servi au prénom et au nom du cheval.
