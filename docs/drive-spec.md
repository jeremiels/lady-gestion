# Spec — Documents sur Google Drive

Statut : **v3, décisions du 27 sept. 2026 intégrées** (voie B : l'app voit son
Drive). Rien n'est implémenté. Rédigé à partir du code sur `main` (98dc4fb),
des deux maquettes (grille « Documents », liste « Factures ») et de ses exports
réels dans `backup/`.

## 1. Objectif

Elle **range ses papiers dans son Google Drive, comme elle le fait déjà, et les
retrouve dans l'app** :

- elle désigne **un dossier général** de son Drive (existant ou créé pour
  l'occasion) ; la page **Documents** affiche **ses sous-dossiers, nommés comme
  elle veut**, et leur contenu ;
- ce qu'elle ajoute, renomme ou supprime **dans Google Drive** apparaît dans
  l'app, et inversement ;
- elle **lit PDF et photos dans l'app**, sans onglet ni app externe ;
- depuis le **formulaire d'un post**, elle joint un fichier (PDF ou photo), qui
  est rattaché au post et rangé dans le sous-dossier choisi.

Critère directeur : pour consulter ou ajouter un document, **elle ne sort
jamais de l'application**. Seule exception : l'écran de consentement Google,
une fois.

## 2. Décisions prises

| #   | Décision                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Plus de catégories fixes : les tuiles sont **les sous-dossiers de son Drive**. `DocumentCategory` / `document.types.ts` disparaissent.                                                                                                              |
| D2  | Taille des fichiers comme la maquette : unité en minuscules, **`1,2 mo`** (virgule comme tous les nombres de l'app). Vaut pour `o`, `ko`, `mo`, `go`.                                                                                               |
| D3  | Le document existant `Controle_oeil.pdf` (PDF d'exemple du seed, 697 octets) **est supprimé**. Le seed ne crée plus de document.                                                                                                                    |
| D4  | **PDF et photos** acceptés à l'ajout ; tout fichier de son Drive est listé.                                                                                                                                                                         |
| D5  | Le lien « Ouvrir dans un nouvel onglet » de la visionneuse disparaît au profit de la lecture dans l'app.                                                                                                                                            |
| D6  | **Voie B** : autorisation large sur son Drive. Remplace la décision du 19 sept. (« `drive.file` seulement, jamais `drive.readonly` »).                                                                                                              |
| D7  | Nouvelle structure en **v15**. La v14 (prénom/nom) est en ligne depuis le 27 sept. au soir : son téléphone peut être en v13 ou en v14, la montée part des deux.                                                                                     |
| D8  | **Seul le dossier général est affiché** : elle le crée (nom proposé « ladympala ») ou en choisit un existant, et l'app n'affiche, ne synchronise et n'écrit que ce qu'il contient. Le reste de son Drive n'est parcouru qu'une fois, pour ce choix. |
| D9  | **Plusieurs niveaux** de sous-dossiers, on descend autant qu'il y en a.                                                                                                                                                                             |
| D10 | Scope **`drive`** (+ `openid email`), retenu après le lot 0 (§9.1) : `drive.readonly` + `drive.file` refuse toute écriture sur ses fichiers existants.                                                                                              |

## 3. Autorisation Google

### 3.1 Scope

**`drive`** (D10). La voie B demande de lire **et** d'écrire dans des
dossiers et fichiers que l'app n'a pas créés : déposer une pièce jointe dans son
sous-dossier « Ostéopathe », renommer, déplacer, mettre à la corbeille, écrire
le lien vers le post dans les `appProperties` de ses fichiers.

Le couple moins puissant `drive.readonly` + `drive.file` a été essayé au lot 0 :
403 « not granted write access » dès qu'il s'agit d'un fichier existant.

Le code n'écrit **que sous le dossier général** et ne fait jamais de
suppression définitive (corbeille uniquement, §6.6).

### 3.2 Conséquences acceptées

- `drive` est un scope _restreint_. Sans audit Google (payant, annuel), l'app
  reste **non validée** :
  - à la connexion, une fois : « Google n'a pas validé cette application » →
    Paramètres avancés → Accéder ;
  - plafond de **100 utilisatrices** au total sur la vie du projet.
- L'écran de consentement doit être en statut **production** : en « Testing »,
  les refresh tokens expirent au bout de 7 jours.
- Le Worker détient un jeton qui peut lire (voire modifier) tout son Drive :
  refresh token chiffré, jamais journalisé, session révocable depuis l'app.
- Ouvrir l'app à d'autres plus tard = audit, ou retour à `drive.file` + Picker
  (voie A : accès fichier par fichier, import par cases à cocher).

## 4. Contraintes qui cadrent tout

| Contrainte                              | Conséquence                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source de vérité                        | **Pour les documents, le Drive devient la référence** (arborescence, noms, présence des fichiers) : elle y travaille aussi. IndexedDB en garde un **miroir** pour le hors-ligne et reste la seule source du **lien document ↔ post** et des ajouts pas encore envoyés. Tout le reste de l'app : inchangé. |
| L'app marche avec le Worker/Drive coupé | Les vues lisent toujours le miroir IndexedDB. Hors ligne : liste des dossiers et fichiers telle qu'à la dernière synchro, lecture des fichiers déjà ouverts, ajout de pièces jointes (envoyées au retour du réseau). Un fichier jamais ouvert affiche « disponible en ligne ».                            |
| Le Worker est un courtier de jetons     | Il garde le refresh token, rend des access tokens d'une heure. Les fichiers vont **navigateur ↔ Drive** directement. Le Worker ne voit ni fichier, ni nom, ni post.                                                                                                                                       |
| Pas de `localStorage`                   | Jeton de session dans `meta.googleAccount` (clé déjà réservée).                                                                                                                                                                                                                                           |
| Plancher Safari 26.2                    | Tout ce qui suit est sous le plancher, pdf.js v5 compris.                                                                                                                                                                                                                                                 |
| Une seule utilisatrice, données uniques | La montée v13/v14 → v15 est vérifiée contre son export réel. Les documents n'ont jamais fonctionné : leur table repart de zéro sans risque (D3).                                                                                                                                                          |

`CLAUDE.md` et `AGENTS.md` sont à mettre à jour avec le premier lot réseau :
IndexedDB n'est plus la source de vérité **des documents**, et il y a deux
appels réseau (push, Drive), avec le même principe « l'app marche serveur
coupé ».

## 5. Parcours utilisatrice

### 5.1 Connexion (une fois)

1. Page Documents, Drive non connecté : encart « Connecter Google Drive ».
2. Tap → feuille Safari : avertissement « application non validée »
   (Paramètres avancés → Accéder), puis consentement Google.
3. Page du Worker « C'est fait, vous pouvez revenir à l'application » → elle
   ferme la feuille.
4. De retour dans l'app : **choix du dossier général**, dans un navigateur de
   dossiers **dessiné par l'app** (le scope large permet de lister son Drive :
   pas besoin du Picker Google ni de sa CSP). Elle descend dans ses dossiers et
   touche « Utiliser ce dossier », ou « Nouveau dossier » (nom proposé
   « ladympala ») pour en créer un. Ce navigateur ne sert qu'ici, et pour
   changer de dossier général depuis Profil ; ensuite l'app ne montre plus
   rien d'autre de son Drive (D8).
5. Première synchro : ses sous-dossiers deviennent des tuiles, leurs fichiers
   sont listés (sans télécharger leur contenu).

### 5.2 Page Documents

- Grille des sous-dossiers directs du dossier général (maquette 2), ordre
  alphabétique, avec le nombre d'éléments.
- Les fichiers posés directement dans le dossier général sont listés sous la
  grille.
- Tuile « Nouveau dossier ».
- Menu d'une tuile : **Renommer**, **Supprimer** (seulement si vide).
- Tirer vers le bas ou revenir au premier plan relance une synchro.
- La carte « Documents » de l'accueil affiche le vrai nombre de sous-dossiers
  (au lieu de la constante `DOCUMENT_FOLDERS` de `HomeView`).

### 5.3 Contenu d'un dossier

Route `/documents/<folderId>`, maquette 1 : retour, nom du dossier, ses
sous-dossiers éventuels (même tuile, on peut descendre), puis une ligne par
fichier : icône du type, nom, `PDF • 1,2 mo`, et l'étiquette de la
**catégorie du post lié** (« Vétérinaire ») quand il y en a un. Menu d'une
ligne : **Lier à un post**, **Renommer**, **Déplacer**, **Supprimer**.

« Lier à un post » compte pour ses fichiers existants : c'est ce qui les fait
apparaître dans le détail du post.

### 5.4 Lecture

Tap sur un fichier → visionneuse plein écran dans l'app :

- **PDF** : pdf.js, toutes les pages, largeur de l'écran, défilement vertical ;
- **photo** : `<img>` existant, avec zoom au pincement ;
- **Google Docs / Sheets** : exporté en PDF par l'API (`files.export`), puis
  comme un PDF ;
- **autre** (Word, etc.) : « Ce type de fichier ne s'affiche pas ici » +
  Partager.

Action « Partager » (feuille iOS, déjà codée dans `PostDetailView`) pour
l'envoyer au véto ou l'enregistrer ailleurs.

### 5.5 Joindre depuis un formulaire

- En bas du formulaire d'un post (création **et** modification) : bloc
  « Pièces jointes », bouton « Ajouter un fichier ».
- Sélecteur iOS : **Prendre une photo**, **Photothèque**, **Choisir un
  fichier**. `accept="application/pdf,image/jpeg,image/png"` : sans
  `image/heic`, iOS convertit les photos HEIC en JPEG au choix (spike).
- Chaque fichier ajouté : nom, taille, **dossier** (pré-rempli avec le dernier
  utilisé, modifiable), bouton retirer.
- Joindre un fichier **déjà dans le dossier général** : « Choisir dans mes
  documents », qui parcourt les dossiers de la page Documents (rien au-dessus
  du dossier général).
- « Enregistrer » écrit le post et ses documents dans une seule transaction
  IndexedDB ; l'envoi au Drive suit en arrière-plan.

## 6. Données — schéma v15

### 6.1 Nouvelle table `documentFolders`

```ts
type DocumentFolder = BaseRecord & {
  /** Nom dans le Drive. */
  name: string;
  /** null = sous-dossier direct du dossier général. */
  parentId: string | null;
  /** null tant qu'un dossier créé dans l'app n'est pas encore dans le Drive. */
  driveFolderId: string | null;
  /** `modifiedTime` du Drive à la dernière synchro. */
  driveModifiedAt: string | null;
  /** Dernière synchro réussie ; comparée à `updatedAt` par le §6.5. */
  driveSyncedAt: string | null;
};
```

Pas de `horseId` : c'est un dossier de son Drive, pas une propriété du cheval.
Index : `"id, driveFolderId, parentId, updatedAt"`. `parentId` est nullable,
donc absent de l'index pour les racines : les requêtes de racines filtrent en
mémoire, comme le reste du schéma (voir le commentaire de `STORES`).

### 6.2 `StoredDocument`

- `category: DocumentCategory` → **`folderId: string | null`** (null = dans le
  dossier général).
- `driveFileId` / `driveSyncedAt` : enfin utilisés ; ajout de
  `driveModifiedAt`.
- `horseId` : celui du cheval actif pour un fichier découvert dans le Drive.
- `postId` : le lien, **seule donnée des documents que le Drive ne sait pas
  reconstruire** sans `appProperties` (§7.3).
- Index `documents` : `"id, horseId, postId, folderId, driveFileId,
updatedAt"` (on retire `category` et `[horseId+category]`).

### 6.3 `meta`

`googleAccount` (`{ email, sessionToken, scope }`), `driveClaim` (connexion
ouverte, pas encore réclamée) et `driveFolder` (`{ id, name }`, dossier
général), typés par `DriveMeta` dans `types.ts` (lot 3). Au lot 4 :
`driveSyncedAt` (dernière synchro réussie, pour « mis à jour il y a … »).

### 6.4 Montée v13 / v14 → v15

Ses trois exports (17, 18 et 27 sept.) sont en v13. La v14 (prénom/nom du
cheval, 596e588) est en ligne depuis le 27 sept. à 21 h 22 : son téléphone est
en v13 ou en v14 selon qu'elle a touché « Actualiser ». Une seule déclaration
v15 dont la montée joue toutes les étapes depuis v13 ; elles sont rejouables,
donc un appareil en v14 passe l'étape v13 sans rien changer.

La seule ligne `documents` (le PDF d'exemple du seed) n'a pas de dossier et
n'a aucune valeur (D3). La montée **vide `documents` et `documentBlobs`**.

- Étapes dans `ROW_STEPS` (`migrations.ts`), jouées par l'appareil (`db.ts`)
  et par un fichier de sauvegarde (`backup/migrate.ts`). Une étape peut
  écarter une ligne (`null`) ; `NEW_TABLES` fournit `documentFolders` vide à
  un fichier v13 ou v14.
- Les sauvegardes n'exportent pas les octets : les lignes `documents` d'un
  ancien fichier étaient déjà des coquilles vides à la restauration.
- `seed.ts` ne crée plus `Controle_oeil.pdf` ni `samplePdf()`.
- `documentFolders` rejoint `RECORD_TABLES` et donc les sauvegardes.

Vérifié contre l'export réel v13, pour un appareil en v13, un appareil en v14
et une restauration : cheval identique (prénom/nom), 138 posts identiques,
0 document.

### 6.5 Synchronisation

Un passage de `src/drive/sync.ts`, déclenché à l'ouverture de l'app, au retour
au premier plan, au retour du réseau, en tirant la page Documents, et après
chaque modification locale :

1. **Envoyer** ce qui est en attente localement : dossiers et fichiers créés
   (`driveFolderId` / `driveFileId` nuls), renommages, déplacements,
   suppressions (`updatedAt > driveSyncedAt`).
2. **Lire** le Drive : premier passage = parcours de l'arborescence sous le
   dossier général (`files.list`, `'<id>' in parents and trashed = false`,
   dossier par dossier) ; ensuite, **`changes.list`** avec un `pageToken`
   rangé dans `meta`, filtré sur ce qui est sous le dossier général.
3. **Appliquer** au miroir, par `driveFileId` / `driveFolderId` :
   - nouveau dans le Drive → nouvelle ligne ;
   - renommé / déplacé / modifié → ligne mise à jour ; si `modifiedTime` a
     changé, les octets en cache sont jetés ;
   - disparu ou à la corbeille → ligne soft-supprimée et octets jetés. Un lien
     vers un post disparaît avec le fichier : c'est elle qui l'a supprimé.
   - conflit (modifié des deux côtés entre deux synchros) : le Drive gagne,
     sauf pour `postId` qui n'existe que localement.

Les octets ne sont **pas** téléchargés à la synchro, seulement à l'ouverture,
puis gardés dans `documentBlobs`. Les fichiers joints depuis l'app y sont dès
l'ajout.

### 6.6 Écritures dans le Drive

- Supprimer depuis l'app → **corbeille** Drive (`trashed: true`, récupérable
  30 jours), jamais de suppression définitive.
- Supprimer un dossier : seulement vide.
- Renommer / déplacer → `PATCH` du nom / des `parents`.
- Aucune écriture hors du dossier général.

### 6.7 États d'un document

| Situation                            | Affichage                                             |
| ------------------------------------ | ----------------------------------------------------- |
| Ajouté dans l'app, pas encore envoyé | normal ; envoi en attente (discret)                   |
| Dans le Drive, déjà ouvert ici       | normal, lisible hors ligne                            |
| Dans le Drive, jamais ouvert ici     | lisible en ligne ; hors ligne « Disponible en ligne » |

## 7. Architecture

```
iPhone (PWA)                                  Cloudflare Worker (existant)
┌──────────────────────────────┐              ┌──────────────────────────┐
│ post-sheet ──┐               │  jeton 1 h   │ /auth/google/start       │
│ DocumentsView│  IndexedDB    │◄────────────►│ /auth/google/callback    │──► Google OAuth
│ doc-viewer ──┤  (miroir)     │              │ /auth/claim              │
│              ▼               │              │ /drive/token             │
│   src/drive/sync.ts ◄────────┼──────────┐   │ /auth/logout             │
└──────────────────────────────┘          │   │ /reminders (inchangé)    │
                                          │   └──────────────────────────┘
                                          ▼
                              Drive API v3 (googleapis.com), CORS
```

### 7.1 Découpage du code

- `src/data/` reste 100 % Dexie : `documentFolders.repo.ts` ; dans
  `documents.repo.ts` `listByFolder`, `listPendingUpload`, `applyRemote`,
  `putBlob`, `dropBlob`, `move`, `link`. Création post + documents dans
  `posts.service.ts`. La logique « appliquer un lot de changements Drive au
  miroir » est une fonction pure de `src/data/`, testée comme le reste. Aucun
  `fetch`.
- **Nouveau `src/drive/`**, frère de `src/pwa/push.ts` : `auth.ts`, `api.ts`
  (appels Drive typés), `sync.ts`, `drive-config.ts` (URL du Worker, client
  ID — publics, commités comme `push-config.ts`).

### 7.2 Authentification via le Worker

Le flux ne suppose **pas** que la redirection OAuth revienne dans la PWA : sur
iOS, une app de l'écran d'accueil ouvre `accounts.google.com` dans une feuille
Safari séparée, dont le stockage n'est pas le sien. Le Worker reçoit la
redirection, et l'app « réclame » la session ensuite.

1. L'app tire un secret `claim` (32 octets), le garde dans `meta`, puis
   `window.open(WORKER/auth/google/start?claim_hash=sha256(claim))`.
2. Le Worker redirige vers Google : scope retenu au §3.1 + `openid email`,
   `access_type=offline`, `prompt=consent`, PKCE, `state` signé (HMAC)
   contenant `claim_hash`.
3. `/auth/google/callback` échange le code, chiffre le refresh token
   (AES-GCM) et le range sous `claim_hash` pour 10 min, puis affiche
   « Revenez dans l'application ». La session n'est créée qu'à la
   réclamation : une connexion jamais réclamée est effacée par le cron, jeton
   compris.
4. Au retour au premier plan, `POST /auth/claim {claim}` →
   `{ sessionToken, email, scope }`, usage unique (404 tant que la connexion
   n'est pas finie), rangé dans `meta.googleAccount`.
5. `POST /drive/token` (`Authorization: Bearer <sessionToken>`) →
   `{ accessToken, expiresAt, scope }`, gardé en mémoire seulement.
6. `POST /auth/logout` révoque chez Google et efface la session. Le miroir
   local reste consultable ; plus de synchro.

Refresh token révoqué (`invalid_grant`) → 401 → l'app efface `googleAccount`
et réaffiche « Connecter Google Drive ». Rien d'autre ne change.

D1, migration `0002_drive.sql` :

`drive_claims` (`claim_hash`, `refresh_token` chiffré, `email`, `scope`,
`expires_at`) et `drive_sessions` (`id` = sha256 du jeton de session, jamais
le jeton brut ; `refresh_token` chiffré, `email`, `scope`, `created_at`,
`last_used_at`).

Secrets Worker : `GOOGLE_CLIENT_SECRET`, `DRIVE_SECRET` (les clés AES et HMAC
en sont dérivées par HKDF). Variable : `GOOGLE_CLIENT_ID`. `corsHeaders` :
`POST` et l'en-tête `Authorization` en plus. Fait au lot 2 :
`server/src/drive-auth.ts`, `drive-crypto.ts`.

### 7.3 Lien document ↔ post dans le Drive

Chaque fichier lié reçoit des `appProperties` `{ ladyPostId }`, y compris
ses fichiers existants (vérifié au lot 0) : le lien survit à la perte de
l'appareil et se relit à la synchro.

Envoi des pièces jointes : `uploadType=multipart` (quelques Mo au plus) dans
le dossier choisi.

### 7.4 Visionneuse

L'`<iframe>` actuel n'affiche qu'une page non défilable sur iOS (D5). Pour les
PDF, **pdf.js** (`pdfjs-dist`), chargé à la demande dans `document-viewer`,
une `<canvas>` par page, pages hors écran rendues paresseusement.

- Octets depuis `documentBlobs` ; sinon téléchargés (`files/{id}?alt=media`,
  ou `files/{id}/export?mimeType=application/pdf` pour un Google Doc) et mis
  en cache.
- `isEvalSupported: false` (CSP). À vérifier : les scans en JPX/JBIG2 passent
  par du WebAssembly dans pdf.js v5, ce qui peut exiger `'wasm-unsafe-eval'`.
- Le chunk (~1 Mo) est précaché par le service worker.
- Cache : pas de limite en V1. Si elle ouvre des centaines de fichiers, on
  ajoutera une éviction des moins récemment ouverts.

## 8. Changements hors `src/`

- `index.html` CSP : `connect-src` + `https://www.googleapis.com`. Pas de
  Picker, donc pas d'`apis.google.com` ni de `frame-src`.
- `CLAUDE.md` / `AGENTS.md` : §4.
- Google Cloud (à faire par toi, une fois) : projet ; API Drive activée ;
  écran de consentement **External**, **publié en production**, scopes du
  §3.1 ; pas de demande de validation ; redirect URI
  `…workers.dev/auth/google/callback`. À documenter dans `server/README.md`.
- Mémoire du projet : la décision « jamais `drive.readonly` » est remplacée
  par D6.

## 9. Lots

0. **Spikes** — fait les 27 et 28 sept., voir §9.1.
1. **Schéma v15** : `documentFolders`, `folderId`, index,
   suppression du document d'exemple, migration des sauvegardes, seed. Vérifié
   contre l'export réel. Taille `1,2 mo` (D2).
2. **Worker** : routes auth, migration D1, tests (comme `reminders.test.ts`).
3. **Connexion + choix du dossier** : `src/drive/auth.ts`, navigateur de
   dossiers, déconnexion dans Profil.
4. **Synchro en lecture** : parcours initial, `changes.list`, miroir, pages
   Documents et dossier, visionneuse pdf.js + photos + export Google Docs.
   **C'est ici qu'elle voit ses fichiers.**
5. **Écritures** : pièces jointes dans `post-sheet`, envoi, nouveau dossier,
   renommer / déplacer / supprimer, « Lier à un post ».

Chaque lot est livrable seul, dans l'ordre. Après le lot 4, elle consulte déjà
tout son Drive dans l'app ; le lot 5 ajoute l'écriture.

### 9.1 Résultats du lot 0

Banc d'essai `server/spike/` (Worker `lady-gestion-drive-spike`), même CSP
que l'app. Android (Chrome 153, onglet, compte du développeur) le 27 sept. ;
**son iPhone, app installée sur l'écran d'accueil, son compte**, le 28 sept.

| Test                                      | Résultat                                                                                                                                                                                                                                    | Conséquence                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| (a) Connexion depuis la PWA iOS installée | ✅ Session réclamée seule au retour au premier plan (26 s), **sans rechargement de la page**. Même chose sur Android pour les deux scopes.                                                                                                  | Le flux du §7.2 est retenu tel quel.                                                                                               |
| (b) `drive` sur son Drive                 | ✅ Lecture de ses dossiers (dont « PONEY 🎠 » → « Ostéopathe », deux niveaux), écriture d'`appProperties` sur une de ses factures existantes. Sur Android : création d'un fichier et d'un sous-dossier dans un dossier existant, corbeille. | Tout le §5 est faisable avec `drive`.                                                                                              |
| (b) `drive.readonly` + `drive.file`       | ❌ 403 « not granted write access » sur un fichier existant (Android). Création dans un dossier existant non testée (seulement à la racine, où c'est toujours permis).                                                                      | Interdit renommer / déplacer / corbeille / lien sur ses fichiers existants.                                                        |
| (c) pdf.js, CSP sans WebAssembly          | ✅ Sa facture de 63 ko : téléchargée en 1,2 s, rendue en 0,3 s sur l'iPhone.                                                                                                                                                                | CSP de l'app inchangée pour les PDF générés. **Non prouvé pour un scan** (images JPX/JBIG2) : à tester avec un vrai scan au lot 4. |
| (d) Photos                                | Deux photos reçues en `image/jpeg` (5,5 et 6,2 mo) avec les deux `accept`. Noms `DSC_…`, donc probablement des JPEG d'origine : **conversion HEIC non prouvée**.                                                                            | À revérifier au lot 5 avec une photo prise par l'appareil de l'iPhone.                                                             |
| Temps de liste                            | 0,3 à 1,4 s par dossier ; 8 éléments à la racine de son Drive.                                                                                                                                                                              | Parcours complet au premier passage acceptable.                                                                                    |
| `changes.list`                            | Non testé.                                                                                                                                                                                                                                  | À valider au lot 4.                                                                                                                |

Dossier général probable : **« PONEY 🎠 »** (12 éléments, sous-dossiers par
praticien), à confirmer avec elle.

## 10. Critères d'acceptation

- L'export réel v13 se restaure en v15 : cheval identique (prénom/nom), 138
  posts identiques, 0 document.
- Connexion faite une fois ; toujours connectée après 8 jours sans ouvrir
  l'app.
- Elle ajoute un PDF dans un de ses sous-dossiers **depuis l'app Google
  Drive** ; il apparaît dans l'app au retour au premier plan.
- Un PDF de 3 pages se lit en entier dans l'app sur iPhone.
- Une photo prise depuis le formulaire d'un post, hors ligne, est visible tout
  de suite ; elle arrive dans le bon dossier du Drive au retour du réseau.
- Un fichier mis à la corbeille dans Google Drive disparaît de l'app à la
  synchro suivante.
- Worker arrêté ou hors ligne : dossiers et fichiers de la dernière synchro
  listés, fichiers déjà ouverts lisibles, aucune erreur bloquante.
- Se déconnecter du Drive ne touche à rien dans son Drive.

## 11. Questions ouvertes

1. **Libellés nouveaux** (designer) : « Connecter Google Drive », « Nouveau
   dossier », « Utiliser ce dossier », « Pièces jointes », « Lier à un post »,
   « Disponible en ligne », l'icône d'une tuile de dossier (la maquette montre
   une loupe, probablement provisoire).
2. **Photos lourdes** : on envoie l'original (3–5 Mo). Recommandation :
   l'original, c'est un document.
3. **Cheval des fichiers découverts** : `horseId` = cheval actif. Tant qu'il
   n'y a qu'un cheval, ça ne se voit pas ; à revoir si un second arrive.
