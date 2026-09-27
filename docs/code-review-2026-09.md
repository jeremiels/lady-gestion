# Revue de code — lady-gestion

> **Document figé.** Revue du 26 septembre 2026 sur `7ad2425`, conservée telle
> quelle : les numéros de ligne renvoient à cette révision. Ce qui a été fait
> depuis, ce qui reste et ce qu'il faut surveiller : voir
> [`code-review-2026-09-suivi.md`](code-review-2026-09-suivi.md).

Revue en lecture seule, 26 septembre 2026, branche `feat/rappels-push` (`7ad2425`).
Aucun fichier de code n'a été modifié. Méthode et périmètre exact : annexe B.

---

## 1. Résumé de l'architecture

- **Produit** : PWA mobile de suivi d'un cheval (rendez-vous et soins, cures, travail, ration, documents, budget), installée sur l'écran d'accueil d'un iPhone. Une seule utilisatrice réelle, dont les données n'existent que dans IndexedDB et dans ses exports JSON.
- **Shell** : `index.html` → `app-root` (light DOM) = barre de navigation + `<main>`. Routeur maison sur la Navigation API (`Router`), table `ROUTES`, vues chargées à la demande (sauf l'accueil), View Transitions. L'état d'interface d'une vue vit sur l'entrée d'historique (`ViewState`).
- **Vues → composants** : les vues (`views/*View.ts`, light DOM) tiennent des `LiveQuery` sur les repositories et passent les données en propriétés à des composants Lit en shadow DOM (`BaseElement`).
- **Saisie** : les formulaires (`post-sheet`, `activity-sheet`, `ration-form`, `customize-*`) sont faits de champs form-associated (`FormFieldElement`). Ils sont lus par `readForm()` / `readCategoryForm()` et écrits par des services.
- **Persistance** : Dexie 4 / IndexedDB, une seule version déclarée (13), 9 stores. `record.ts` estampille `id` (UUID), `ownerId`, `createdAt` / `updatedAt` et la suppression logique `deletedAt`.
- **Accès aux données** : un repository par table ; les services portent les écritures multi-tables, en transaction (post + rendez-vous de suivi, suppression + détachement des documents, restauration).
- **Réactivité** : `LiveQuery` (ReactiveController sur `liveQuery`), ouvert seulement après `initData()` : ouverture, `ownerId`, réconciliation des catégories intégrées, seed de démo sur base vide. Pas de store.
- **Sauvegarde** : export/import JSON manuel (`backup/snapshot.ts`), fusion last-write-wins en une transaction, purge des données de démo « intactes ». Les octets des documents n'y figurent pas.
- **PWA** : service worker écrit à la main. Il précache tout le build, sert en cache-first, et renvoie la coquille pour toute navigation. Une nouvelle version attend le « Actualiser » du toast. L'app demande `navigator.storage.persist()`.
- **Réseau** : aucune synchronisation. Seul appel sortant : les rappels push. `watchReminders` recalcule la liste depuis IndexedDB et la `PUT` en entier à un Worker Cloudflare (D1 + cron à la minute + Web Push RFC 8291/VAPID). L'app fonctionne sans ce serveur.
- **Parcours critiques retenus pour prioriser** :
  1. saisir ou modifier un évènement ;
  2. ouvrir l'app hors ligne et y retrouver ses données ;
  3. exporter et restaurer (seule protection contre la perte) ;
  4. le tableau de bord et le budget ;
  5. recevoir un rappel.

---

## 2. Synthèse

### État général

**Bonnes fondations.** Le socle est nettement au-dessus de la moyenne :

- TypeScript strict, zéro `any`, zéro `@ts-ignore` ; `typecheck` (app, outillage, serveur) et `oxlint` passent sans erreur.
- Frontière Dexie réellement tenue ; transactions bien placées.
- Service worker soigné.
- Serveur push minimal et prudent.
- Tests abondants sur la couche données.

**Les problèmes sont ailleurs** :

- **La couche formulaire** repose sur des champs non contrôlés et `form.reset()`. Elle désynchronise ce qui est affiché de ce qui est en base. Un cas est **reproduit** : il réécrit silencieusement d'anciennes valeurs.
- **Les échecs sont presque toujours invisibles**, en lecture comme en écriture.
- **Le filet de sécurité** (export, restauration, écran d'erreur) promet plus qu'il ne garantit.
- **Des données personnelles réelles** sont publiées avec l'app.

**Bilan chiffré** : 1 constat critique, 2 élevés, 12 moyens, 12 groupes de constats faibles.

### Les trois risques principaux

1. **Corruption silencieuse à la saisie (C1, M6, E1).**
   - Modifier trois fois de suite un évènement sans quitter sa fiche suffit pour qu'un simple « Enregistrer » remette en base une valeur corrigée plus tôt (reproduit).
   - Changer de type en cours de saisie déplace ce qui a été tapé dans un autre champ.
   - Un tap sur l'activité déjà choisie supprime la séance et sa note, sans confirmation ni retour possible.
2. **Un filet de sauvegarde troué (M1, M2, M3, F6).**
   - « Dernière sauvegarde : aujourd'hui » est affiché même si le fichier n'a pas été enregistré.
   - L'écran « Données inaccessibles » propose un export qui ne peut pas marcher dans les cas qu'il décrit.
   - Restaurer le mauvais fichier peut supprimer en dur la fiche du vrai cheval.
   - Les octets des documents ne sont jamais sauvegardés (latent tant qu'il n'y a pas d'upload).
3. **Données personnelles publiées (E2).**
   - Nom et e-mail réels, noms de praticiens et identité du cheval sont dans le bundle servi publiquement, et dans chaque nouvelle installation.
   - L'historique financier réel (pseudonymisé) est dans le dépôt.

### Ce qui est bien fait — à ne pas casser en nettoyant

- **Données**
  - `dexie` n'est importé que par `src/data/db.ts`, et aucun `db.*` n'apparaît hors de `src/data/` dans le code applicatif.
  - IDs UUID, suppression logique, tombstones exportés.
  - Fusion LWW qui laisse les lignes de seed intactes céder face au fichier.
- **Transactions** : là où il faut (`savePost` + suivi, `deletePost`, `documentsRepo.create/remove`, `categoriesRepo.remove/setParent/setEnabled`, `rationsRepo.updateMany`, `importBackup`), sans aucun `await` non-Dexie à l'intérieur. La restauration est tout-ou-rien, et c'est testé (`snapshot.test.ts:567`).
- **`LiveQuery`** :
  - porte d'attente sur `initData()` (corrige un vrai bug de premier lancement) ;
  - désabonnement au démontage, garde `#connected`, `loading` distinct de `value`.
  - Le contrôleur `Today` (minuit local + `visibilitychange`) est propre.
- **`watchDatabase`** gère `versionchange` et `blocked` avant l'ouverture, avec un écran dédié.
- **Service worker**
  - manifeste de révisions par fichier et réutilisation des entrées inchangées ;
  - installation atomique, pas de `skipWaiting` automatique ;
  - `cacheName` borné au build courant, `ignoreVary`, repli 503 lisible ;
  - build qui échoue si les jetons du gabarit disparaissent.
- **Serveur push**
  - la liste entière est remplacée à chaque `PUT` (idempotent) ;
  - les rappels déjà échus sont ignorés, ce qui évite les doublons ;
  - `UPDATE` conditionnel face à un `PUT` concurrent ;
  - liste blanche des hôtes push (anti-SSRF), plafond de 100 rappels ;
  - chiffrement tenu au vecteur de test de la RFC 8291.
- **Aucune injection HTML** : pas de `unsafeHTML`, `innerHTML` ni `eval`. Tous les liens internes passent par `appHref`.
- **Dialogues** : `<dialog>` natif, verrou de défilement par détenteurs, régions live montées en permanence, focus sur le premier champ fautif.
- **Pour corriger C1** : le patron « formulaire recréé à chaque ouverture » de `ration-sheet` est le modèle à suivre.
- **CI** : lint, typecheck, tests (dont un vrai Chromium), build. C'est **l'artefact testé** qui est déployé.

---

## 3. Constats détaillés

**Sévérité**

| Niveau       | Définition                                                                               |
| ------------ | ---------------------------------------------------------------------------------------- |
| **Critique** | corruption ou perte de données reproductible sur un parcours courant                     |
| **Élevée**   | perte irréversible possible en un geste, ou exposition de données personnelles           |
| **Moyenne**  | bug réel à impact limité ou contournable, ou risque de données dans des conditions rares |
| **Faible**   | mineur, latent, cosmétique technique ou dette                                            |

**Effort** : S = moins d'une demi-journée, M = une à deux journées, L = davantage.

**Certitude** :

- « confirmé » : le chemin est tracé dans le code ; « reproduit » quand il a été observé dans l'app ;
- « à vérifier » : plausible, non prouvé. La manière de le prouver est indiquée.

### Critique

#### C1 — Modifier plusieurs fois un évènement réécrit en silence d'anciennes valeurs

**Localisation**

- `src/components/post-sheet/post-sheet.ts:386-389` (`#reset`) ;
- `post-sheet.ts:483` (appelé après chaque enregistrement) ;
- liaisons sans `live()` : `post-sheet.ts:684`, `:735`, `:817` ;
- `src/commons/form-field-element.ts:121-122` (défaut capturé une seule fois) et `:149-153` ;
- `src/views/PostDetailView.ts:370-376` (la feuille reste montée pendant toute la visite de la fiche) ;
- même mécanisme dans `app-input.ts:70-76`, `app-select.ts:64-78`, `app-combobox.ts:58-74`, `app-unit-select.ts:52-58`, `app-checkbox.ts:35-41`.

**Problème**

- Chaque champ mémorise sa valeur « par défaut » **une seule fois**, à son premier rendu.
- Après chaque enregistrement, `#reset()` appelle `form.reset()`, qui ramène chaque champ à cette valeur du premier rendu. Ce n'est pas le record courant, contrairement à ce qu'affirme le commentaire de `#reset`.
- Le post à jour revient ensuite par `LiveQuery`. Mais Lit ne ré-applique `.value=${…}` que si la valeur liée diffère de la dernière qu'il a posée.
- Un champ que cet enregistrement n'a pas modifié garde donc l'ancienne valeur affichée. Elle part avec l'enregistrement suivant.

**Reproduit** dans l'app : `npm run dev`, Chromium headless, pilote `.claude/skills/run-lady-gestion/driver.mjs`, post de démo « Rappel vaccins » du 15/10/2026.

1. Modifier → Date 01/12/2026 → Enregistrer. La base contient 01/12.
2. Modifier (le champ affiche bien 01/12) → Note → Enregistrer. La base contient 01/12 + la note.
3. Modifier : le champ Date affiche **15/10/2026**. Enregistrer **sans rien toucher** : la base repasse au **15/10/2026**.

**Variantes**, confirmées dans le code mais non reproduites :

- **Cases à cocher.** « Planifier un rendez-vous » ou « Créer une notification » peut s'afficher décochée alors que son champ révélé est visible. L'enregistrement suivant efface le suivi ou le rappel (`post-form.ts:119-120`).
- **Sélecteur Type.** Après un changement de catégorie, il revient à l'ancienne, et c'est elle qui est enregistrée.
- **Fermer sans enregistrer** (fond, glisser, ✕) ne réinitialise rien. La modification abandonnée réapparaît et part avec la sauvegarde suivante.

**Impact** : le parcours n° 1 corrompt des données sans aucun signal. L'utilisatrice regarde le champ qu'elle modifie, pas celui qui vient de revenir en arrière.

```ts
// form-field-element.ts:121
protected firstUpdated() {
  this.captureDefault();
// post-sheet.ts:386
#reset() {
  this.formEl?.reset();
  this.#seedFromPost();
}
```

**Recommandation**

- Reprendre le patron de `ration-sheet.ts:42`, `:60`, `:87-88` : reconstruire le formulaire à chaque ouverture (``keyed(`${post.id}-${openCount}`, …)``).
- Ne plus appeler `form.reset()` en mode édition.
- Ne **pas** « corriger » avec `live()` dans le parent : chaque rendu de la feuille écraserait la frappe en cours.
- Ajouter un test composant : éditer A → enregistrer → `.post = v2` → éditer B → enregistrer → `.post = v3` → A doit afficher la valeur de v3.

**Effort** : S. **Certitude** : confirmé, **reproduit**.

### Élevée

#### E1 — Un tap sur l'activité déjà choisie supprime toute la séance, sans confirmation ni retour possible

**Localisation** : `src/components/activity-sheet/activity-sheet.ts:263-275` (`#remove` → `postsRepo.remove`), `:283-286` (`#onChipClick`), commentaire `:257-261`.

**Problème**

- Dans la feuille du jour, toucher la puce déjà sélectionnée supprime (suppression logique) le **post entier** : titre personnalisé, note, champs, puis ferme la feuille.
- Il n'y a ni confirmation, ni « Annuler ».
- Le tombstone est plus récent que toute copie d'une sauvegarde, donc aucune restauration ne ramène la séance (fusion LWW, `record.ts:58-61`, `snapshot.ts:170-180`).
- Contrairement au commentaire, ce n'est pas la suppression de `PostDetailView`, qui passe par `postsService.deletePost` : transaction, et détachement des documents.

**Impact**

- Exposition mesurée sur la sauvegarde réelle du 18/09 : 5 des 19 séances de travail enregistrées portent une note.
- Un tap raté efface ce texte définitivement.

**Recommandation**

- Décision de design, car l'affordance appartient à la designer. Au minimum, quand la séance porte autre chose que l'activité (note, heure, titre renommé) :
  - demander confirmation via `app-modal`,
  - ou proposer « Annuler » quelques secondes.
- Dans tous les cas, passer par `postsService.deletePost`.

**Effort** : S (technique), M avec la décision de design. **Certitude** : confirmé.

#### E2 — Données personnelles réelles publiées avec l'application et le dépôt

**Localisation**

- `src/data/account.ts:19-23` : prénom, nom et adresse e-mail réels de l'utilisatrice.
- `src/data/seed.ts:158-164` : cette identité est écrite dans `profiles` à chaque nouvelle installation.
- `src/data/categories.ts:342`, `:362`, `:382`, `:402` : noms réels d'un coach et de praticiens en `defaultValue`.
- `src/data/seed.ts:184-193` : identité réelle du cheval (nom, numéro SIRE, père, mère), semée dans toute nouvelle installation.
- `src/data/__tests__/fixtures/real-v13-export.json` : pseudonymisé, mais montants, dates et libellés réels, dont le prix d'achat du cheval.

**Impact**

- Le bundle est servi publiquement (GitHub Pages) à tout visiteur. Il expose l'utilisatrice et des tiers qui n'ont rien demandé.
- Toute nouvelle installation reçoit comme profil l'identité d'une autre personne, et son cheval comme « démo ».
- L'historique financier est dans le dépôt, public si le dépôt l'est (à vérifier), et dans l'historique Git.
- Déjà relevé (M6 de l'audit de septembre, commentaire d'`account.ts`), toujours présent.

**Recommandation**

1. Faire un export frais pour confirmer que la ligne `profiles` existe sur l'appareil. C'est la précondition documentée : sans elle, vider `ACCOUNT` change le nom affiché.
2. Vider `ACCOUNT` et retirer les quatre `defaultValue` ; le combobox de suggestions proposé en S5b de l'audit peut prendre le relais.
3. Mettre un cheval de démo générique pour les nouvelles installations.
4. Brouiller montants et dates de la fixture. Les tests qui s'y appuient (« does not lose a cent ») suivront.
5. Décider de réécrire, ou non, l'historique Git : c'est au propriétaire de trancher.

**Effort** : S pour 1 à 4, M s'il faut réécrire l'historique. **Certitude** : confirmé ; la visibilité du dépôt est à vérifier.

### Moyenne

#### M1 — Sauvegarde : l'app affirme « sauvegardé » sans le savoir

**Localisation** : `src/data/backup/snapshot.ts:262-266` (`markBackedUp()` juste après `link.click()`) ; `src/commons/backup-actions.ts:40-44` (« Sauvegarde téléchargée. ») ; `src/views/ProfileView.ts:211-219`, seul endroit où l'âge de la sauvegarde est visible.

**Problème**

- En PWA iOS, l'export ouvre une feuille système ou un aperçu, que l'on peut annuler.
- L'app enregistre quand même « Dernière sauvegarde : aujourd'hui ». Or c'est l'indicateur censé dire la vérité sur le seul filet de sécurité.

**Recommandation**

- Quand `navigator.canShare({ files })` le permet, utiliser `navigator.share({ files: [file] })`. La promesse ne résout qu'après un partage effectif et rejette `AbortError` sur annulation : n'horodater qu'à ce moment-là.
- Sinon, garder l'ancre avec un message neutre, sans horodatage.
- Afficher un rappel sur l'Accueil au-delà de N jours (décision de design).

**Effort** : S–M. **Certitude** : confirmé dans le code ; le comportement exact d'iOS en mode standalone est à vérifier sur l'appareil.

#### M2 — L'écran « Données inaccessibles » propose un export qui échoue dans les cas qu'il décrit

**Localisation**

- `src/app-root.ts:565-619` : l'écran cite stockage plein, navigation privée et base endommagée.
- `src/data/index.ts:79-91` : `initData` = `db.open()` → `initOwnerId()` → `seedIfEmpty()`.
- `src/data/backup/snapshot.ts:57` : `getOwnerId()`.
- `src/data/owner.ts:42-49` : lève « Owner id not initialised — call initData() before writing records. ».
- `src/commons/backup-actions.ts:109-113` : affiche `error.message` tel quel.

**Problème**

- Quand `db.open()` échoue, ce qui correspond à la plupart des causes affichées, l'export échoue forcément. L'owner n'a pas été résolu et Dexie ne s'ouvre pas davantage. Le message affiché est une phrase de développeur en anglais. La restauration échoue de même.
- Le bouton ne tient sa promesse que si l'échec est survenu après `initOwnerId()`.
- À la prochaine montée de schéma, une migration ratée sera le cas le plus probable.

**Recommandation**

- Rendre `exportBackup` indépendant du cache mémoire : lire `meta.ownerId`, ou exporter sans.
- Ajouter un export de secours en IndexedDB brut (`indexedDB.open("lady-gestion")` sans version, `getAll()` sur chaque store) quand Dexie ne s'ouvre pas.
- Messages en français ; désactiver les actions impossibles dans le cas détecté.

**Effort** : M. **Certitude** : confirmé.

#### M3 — Restaurer le mauvais fichier peut supprimer en dur la fiche du vrai cheval

**Localisation**

- `src/data/seed.ts:211-253` : `seedRecordIds` = cheval, rations, posts, document de démo.
- `src/data/seed.ts:267-296` : suppression **dure** des lignes de ce seed dont `createdAt === updatedAt`.
- `src/data/backup/snapshot.ts:160` : purge appelée par chaque restauration.
- `seedRecordIds` n'est effacé que par cette purge (`seed.ts:295`).

**Problème**

- Sur l'appareil réel, le « cheval de démo » **est** le vrai cheval, jamais modifié depuis. Dans les deux sauvegardes réelles, sa fiche a `createdAt === updatedAt`, et 2 rations sur 5 aussi.
- Restaurer un fichier venu d'une autre installation (fichier de test, autre appareil) supprime définitivement ces lignes :
  - la centaine de posts reste en base mais orpheline, donc invisible ;
  - `getActive()` bascule sur le cheval du fichier.
- On ne s'en sort qu'en restaurant l'un de ses propres fichiers.
- Restaurer son propre fichier est sans danger : les lignes sont supprimées puis réécrites. Seuls les octets du PDF de démo sont perdus.

**Recommandation**

- Ne purger que si la base est « vierge » (aucune ligne hors seed), ou effacer `seedRecordIds` dès la première écriture de l'utilisatrice.
- Ajouter le test « restaurer un fichier étranger sur un appareil utilisé ».

**Effort** : S. **Certitude** : confirmé (code et données réelles). La présence de `meta.seedRecordIds` sur l'appareil est à vérifier : `meta` n'est pas exporté.

#### M4 — Une lecture en échec s'affiche comme « aucune donnée » ou « Évènement introuvable »

**Localisation**

- `src/data/live.ts:152-157` : l'erreur est stockée, puis `.error` n'est lu nulle part dans `src/`.
- `.loading` n'est lu que par `PostDetailView.ts:67`.
- `PostDetailView.ts:74` rend alors `#renderNotFound` (« Il a peut-être été supprimé »).
- Dexie 4.4.5 avale en plus `DatabaseClosedError` et `AbortError` dans `liveQuery` (`node_modules/dexie/dist/dexie.mjs:6352`).
- Le commentaire de `src/data/ready.ts:36-37` affirme le contraire.

**Impact**

- Une perte de connexion IndexedDB après une longue mise en arrière-plan (cas connu de WebKit) s'afficherait comme « 0,00 € », « Aucun rendez-vous à venir » ou « introuvable ».
- C'est le pire message possible quand IndexedDB est la seule copie : il pousse à ressaisir (doublons) ou à restaurer.

**Recommandation**

- Un canal central : `LiveQuery` signale l'erreur, `app-root` affiche un bandeau `role="alert"` « Lecture impossible — Recharger ».
- Au minimum, `PostDetailView` doit distinguer une erreur d'un post introuvable.
- Corriger `ready.ts` et `AGENTS.md:586-591`.

**Effort** : M. **Certitude** : confirmé pour le chemin ; la fréquence réelle sur iPhone est à vérifier.

#### M5 — Une écriture en échec donne un message technique en anglais, ou rien

**Localisation**

- `post-sheet.ts:477-480`, `activity-sheet.ts:247-250` et `:268-271` : `error.message` brut.
- `activity-sheet.ts:224` : lecture du cheval hors `try`.
- `views/CustomizeView.ts:108`, `:120`, `:129`, `:147`, `:178`, `:200` : aucun `try`, donc rejet non géré et aucun message.
- `ProfileView.ts:48` : `void metaRepo.setNotificationsEnabled(…)`.

**Impact**

- Quota plein ou connexion perdue donnent un texte de `DOMException` en anglais, ou rien.
- L'interrupteur de catégorie reste basculé alors que la base n'a pas changé : l'écran ment jusqu'au prochain rendu complet.

**Recommandation**

- Un helper commun qui traduit une erreur en message français, avec un cas « stockage plein » distinct (textes à valider par la designer).
- Un `try/catch` par gestionnaire de `CustomizeView`, et une resynchronisation de l'interrupteur en cas d'échec.

**Effort** : S–M. **Certitude** : confirmé.

#### M6 — Changer de type en cours de saisie déplace ou écrase ce qui a été tapé

**Localisation** : `post-sheet.ts:601-603` (`type.fields.map(…)` sans clé) et `:747` (champs révélés).

**Problème**

- Lit réutilise l'élément d'indice _i_ pour le champ qui occupe l'indice _i_ du nouveau type : même gabarit `app-input`, nouveau `name`.
- La valeur n'est ré-appliquée que si la valeur liée change. Exemples réels :
  - **Pension → Achat** : la Note tapée devient « Site » (`counterparty`), et la Note repart vide.
  - **Achat → Alimentation** : le Site est perdu.
  - **Soins → Vétérinaire** : le praticien tapé est remplacé par la valeur par défaut du type.

**Recommandation**

- `repeat(type.fields, (field) => field.id, …)`, idem pour `reveals`.
- Décider si la valeur par défaut d'un type doit écraser une saisie (a priori non).

**Effort** : S. **Certitude** : confirmé (sémantique de Lit + ordre des champs dans `categories.ts`) ; non reproduit.

#### M7 — « Balade à pied » ajoute une activité fantôme au catalogue à chaque enregistrement

**Localisation**

- `post-sheet.ts:470-476` : si `!matchActivity(…)`, alors `activitiesRepo.add`.
- `src/data/posts.ts:176-188` : `matchActivity` compare des **libellés** normalisés.
- `app-combobox.ts:54-56` et `:184-201` : le combobox soumet la **clé** de l'option.

**Problème**

- La clé `baladeApied` se normalise en « baladeapied », qui ne vaut pas « balade a pied ».
- Elle est donc prise pour une activité nouvelle, et ajoutée au catalogue avec le libellé `baladeApied`.
- Comme ce libellé est aussi une clé intégrée, `formatWorkActivity` l'affiche « Balade à pied » et la comparaison échoue encore au prochain enregistrement : une ligne de plus à chaque fois.
- **Preuve** : cette ligne est apparue dans la base réelle entre les exports du 17/09 et du 18/09. C'est la cause du doublon de puce M3 de l'audit de septembre.
- Même racine dans le combobox (`app-combobox.ts:97-120`) : après un choix, le filtre et la ligne « Ajouter » travaillent sur la clé. « Carrière » et « Liberté » affichent « Aucun résultat » ; « Ajouter « baladeApied » » est proposé.

**Recommandation**

- Dans `matchActivity`, reconnaître d'abord une clé intégrée (`choice === label`).
- Dans le combobox, séparer le texte tapé de la valeur soumise, et filtrer avec la normalisation de `activityKey`.
- Nettoyer une fois les lignes dont le libellé est une clé intégrée (suppression logique).

**Effort** : S (correctif) + S (nettoyage). **Certitude** : confirmé (code et données réelles).

#### M8 — Après une suppression, l'adresse sort de `/lady-gestion/` (reproduit)

**Localisation**

- `src/commons/navigation.ts:22-25` : `navigation.navigate(path)` sans `appHref`.
- `PostDetailView.ts:38` et `:483` (`"/posts"`), et les replis de `goBack` / `goBackOutOf` (`navigation.ts:65`, `:110`) avec `"/posts"` et `"/"` (`ProfileView.ts:23`, `HorseView.ts:34`).
- `src/commons/base-path.ts:36-38` : un chemin hors préfixe est rendu tel quel, donc la route correspond et l'écran paraît juste.

**Reproduit** en dev (servi sous `/lady-gestion/`) : après « Supprimer », l'URL vaut `http://localhost:5173/posts`.

**Impact**

- Le rechargement suivant vise une URL hors du scope du service worker. Il peut venir du toast « Actualiser » (`controllerchange` → `reload`) ou des boutons « Recharger ».
- Résultat : une 404 GitHub Pages, ou une erreur hors ligne, dans une app standalone sans barre d'adresse : il faut tuer l'app.
- Même chose sur « Retour » depuis une fiche ouverte à froid par une notification.

**Recommandation**

- `navigateTo` applique `appHref` dans ses deux branches, et `CustomizeView` passe `PROFILE` nu.
- Ajouter un test sous base déployée, sur le modèle de `sections.deployed-base.test.ts`.
- Seulement après ce correctif, rendre `toAppPath` strict.
- Corriger `base-path.ts:13`, qui affirme que la base vaut `/` sous `npm run dev` : c'est faux.

**Effort** : S. **Certitude** : confirmé, **reproduit** (URL). L'affichage exact dans la PWA iOS est à vérifier.

#### M9 — Accueil : un rendez-vous du jour saisi le jour même n'apparaît pas dans « Rendez-vous à venir »

**Localisation** : `src/data/posts.ts:29-32` (`statusForDate` : aujourd'hui ⇒ `done`, calculé à l'écriture) ; `src/data/repositories/posts.repo.ts:95-98` (`listUpcoming` : date ≥ aujourd'hui **et** `planned`) ; `HomeView.ts:69`.

**Problème**

- Un rendez-vous saisi la veille pour aujourd'hui s'affiche.
- Le même, saisi ce matin pour cet après-midi, ne s'affiche pas.
- C'est un nouveau symptôme de S4 de l'audit (statut figé à l'écriture).

**Recommandation** : dans `listUpcoming`, filtrer `date >= today && status !== "cancelled"` (dériver à la lecture). À terme, le `statusOverride` proposé en S4.

**Effort** : S. **Certitude** : confirmé.

#### M10 — Un rendez-vous de suivi recopie le montant et compte dans « Dépenses » avant d'avoir eu lieu

**Localisation**

- `src/data/services/posts.service.ts:140-171` : `followUpOf` recopie `...saved.customFields`, `amountCents` compris ; figé par `posts.service.test.ts:237-255`.
- `posts.repo.ts:109-120` : `listBudget` n'exclut que `cancelled`.
- `HomeView.ts:88-99` : « Dépenses » du mois courant, dates futures incluses.

**Exemple** : maréchal à 90 € le 5, suivi à 3 semaines.

- La copie à 90 € tombe le 26 ; le mois affiche 180 € dès le 5.
- Si la vraie visite est saisie comme un nouvel évènement plutôt qu'en modifiant la copie, elle est comptée deux fois.

**Recommandation** (décision produit) :

- soit une copie sans montant ;
- soit distinguer « prévu » et « dépensé » (date ≤ aujourd'hui) dans les totaux.

**Effort** : S, plus la décision. **Certitude** : confirmé (code + test qui le fige) ; l'intention est à confirmer.

#### M11 — Sur iPhone, toucher un champ texte fait zoomer toute l'application

**Localisation**

- `src/components/app-input/app-input.ts:188` : `font-size: 0.813rem`, soit 13 px, depuis `f757f93` (03/09).
- `index.html:5-8` : viewport sans `maximum-scale`.
- Le code documente lui-même le problème : `app-select.ts:269-275`, et `app-combobox.ts:430-433` cite `app-input` comme contre-exemple.

**Impact**

- Safari iOS zoome sur tout contrôle de moins de 16 px qui prend le focus. En standalone, l'app reste zoomée jusqu'à un pincement.
- Sont concernés tous les champs texte, date, heure et nombre des feuilles, ainsi que la recherche.

**Recommandation** : contrôle à 16 px (décision de la designer), ou `maximum-scale=1` dans le viewport (sur iOS, cela supprime le zoom au focus sans bloquer le pincement).

**Effort** : S. **Certitude** : confirmé dans le code ; le zoom est à confirmer sur l'iPhone.

#### M12 — Tests : les bugs reproduits passent au travers, et le moteur réel n'est jamais testé

**Localisation** : `vitest.config.ts:107` (Chromium seulement, alors que le runtime réel est WebKit iOS).

**Ce qui manque**

- Aucun test pour `pwa/push.ts`, `pwa/index.ts` et `service-worker.js`.
- Aucun test pour les scénarios de C1, M3, M6 et M8.
- `app-combobox` et `app-checkbox` n'ont pas de fichier de test.

**Recommandation**

- Ajouter une instance `{ browser: "webkit" }` au projet `components` en CI (runner Ubuntu, `npx playwright install --with-deps webkit`).
- Ajouter les tests de régression cités dans chaque constat.
- Ajouter un test Playwright contre `vite preview` : hors ligne, puis mise à jour du service worker.

**Effort** : M. **Certitude** : confirmé.

### Faible

Constats regroupés par thème. Chaque ligne donne sa localisation, sa correction, son effort et sa certitude.

#### F1 — Accessibilité (VoiceOver) et contraste

| Constat                                                                                                                                                                              | Où                                                                                      | Correction                                                                          | Effort     | Certitude              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------- | ---------------------- |
| L'`aria-label` du jour remplace tout son contenu : l'activité et « aujourd'hui » ne sont jamais annoncés, et l'`aria-current` de `day-card` est perdu dans le bouton                 | `week-strip.ts:172`, `day-card.ts:130-134`                                              | Composer le nom complet dans `week-strip` et poser `aria-current` sur le bouton     | S          | confirmé               |
| Le total du budget est `aria-hidden` et absent de la description                                                                                                                     | `app-donut-chart.ts:507`, `:555-575`                                                    | Ajouter le total à `#description()`                                                 | S          | confirmé               |
| `aria-selected` sur la cellule plutôt que sur le bouton focusable                                                                                                                    | `app-calendar.ts:708-727`                                                               | État sélectionné sur le bouton                                                      | S          | à vérifier (VoiceOver) |
| h1 sans `tabindex="-1"` : le focus de fin de navigation échoue                                                                                                                       | `CustomizeView.ts:215`                                                                  | Ajouter `tabindex="-1"`                                                             | S          | confirmé               |
| Deux « page actuelle » sur les sous-pages ; `<nav>` sans nom ; nom du cheval annoncé deux fois                                                                                       | `nav-item.ts:81`, `nav-bar.ts:39`, `horse-card.ts:139-146`                              | `aria-current="true"` hors page d'atterrissage, `aria-label` sur la barre, `alt=""` | S          | confirmé               |
| Messages « Modifications enregistrées. » insérés déjà remplis (non annoncés) ; bouton ✓ nommé via son icône                                                                          | `customize-horse.ts:132-136`, `customize-profile.ts:78-82`, `activity-sheet.ts:352`     | Région `role="status"` permanente ; `aria-label` sur le `<button>`                  | S          | à vérifier (VoiceOver) |
| Contrastes de 1,9:1 à 3,1:1 pour les petits textes : méta des cartes `#929292` sur blanc à 10 px (3,11:1), libellés inactifs de la barre (2,26:1), carte Dépenses (2,34:1 et 1,92:1) | `post-card.ts:131-140`, `nav-item.ts:32-53`, `budget-card.ts:55-77`, tokens `color.css` | Décision de tokens avec la designer (repère : `#767676` sur blanc donne 4,54:1)     | S + design | confirmé (calcul WCAG) |

#### F2 — « Aujourd'hui » figé et états périmés

| Constat                                                                                                                                          | Où                                                                              | Correction                                                 | Effort | Certitude |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ | --------- |
| Le calendrier et les `course-card` de la liste gardent le jour de leur création : app reprise le lendemain = pastille et « jours actifs » d'hier | `PostsView.ts:236-241`, `:394-397` ; `app-calendar.ts:118`, `course-card.ts:47` | Passer `.today=${this.#today.value}`                       | S      | confirmé  |
| « Modifications enregistrées. » et les erreurs de validation réapparaissent au retour sur un onglet                                              | `CustomizeView.ts:77-92`                                                        | Remettre à zéro dans `willUpdate` sur `changed.has("tab")` | S      | confirmé  |

#### F3 — Navigation

| Constat                                                                                                                                   | Où                                                     | Correction                                                                    | Effort | Certitude |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- | ------ | --------- |
| Boucle « Retour » : Personnaliser empile `/profile`, et Profil fait `back()` vers Personnaliser, sans fin (seule la barre du bas en sort) | `CustomizeView.ts:105`, `ProfileView.ts:43`            | `goBackOutOf(…, PROFILE)` comme `HorseView`, après M8                         | S      | confirmé  |
| Une navigation abandonnée (chunk lent) s'applique quand même sous l'URL suivante                                                          | `router.ts:177-178`, `:322-341`, `app-root.ts:399-403` | Passer `event.signal` à `#commit` et sortir si `aborted` après chaque `await` | S      | confirmé  |
| Un `%` mal formé dans l'URL fait planter le constructeur d'`app-root` : écran blanc au lieu de la 404                                     | `router.ts:122`, `:129`, `:158`                        | `safeDecode()` qui retombe sur le chemin brut                                 | S      | confirmé  |

#### F4 — Double soumission et garde double-tap

| Constat                                                                                                                                                                                          | Où                                                                                             | Correction                                                                                                 | Effort | Certitude                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------- |
| Aucun état « enregistrement en cours » : un second tap pendant l'écriture crée un doublon (post, séance du jour, ligne de ration). Amorti par IndexedDB rapide et le garde double-tap (< 300 ms) | `post-sheet.ts:410-485`, `:611-619` ; `activity-sheet.ts:223-254` ; `CustomizeView.ts:142-155` | `@state() saving` levé avant le premier `await`, baissé en `finally`, reflété en `?disabled` / `aria-busy` | S      | confirmé (absence de garde) ; fréquence à vérifier |
| Si la ligne de catalogue échoue après le post, « Enregistrer » recrée le post                                                                                                                    | `post-sheet.ts:458-480`                                                                        | Écrire l'activité d'abord, ou ne pas échouer pour une suggestion                                           | S      | confirmé                                           |
| Le garde compare `event.target` au niveau `document`, qui est l'hôte re-ciblé. Deux contrôles différents d'un même composant touchés en moins de 300 ms : le second clic est perdu               | `double-tap-guard.ts:36-41`                                                                    | Comparer `event.composedPath()[0]`                                                                         | S      | confirmé (spec) ; perte à observer sur l'iPhone    |

#### F5 — Saisie de nombres

| Constat                                                                                                                                                                                                                                                          | Où                                                                                            | Correction                                                                                               | Effort | Certitude                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ | ------------------------------- |
| `toLocaleString("fr-FR")` insère U+202F au-delà de 999 (`Number("1 500")` = NaN) et arrondit à 3 décimales : une ration ≥ 1000 ou une quantité « 1 200 kg » ne se réédite plus, et un arrondi est réécrit en silence. Aucune donnée réelle concernée aujourd'hui | `ration-form.ts:180` via `horse.types.ts:28-29` ; `post-form.ts:131`, `:178` ; `forms.ts:107` | Formateur d'édition `{ useGrouping: false, maximumFractionDigits: 20 }` ; `decimal()` ignore les espaces | S      | confirmé (évalué sous Node/ICU) |

#### F6 — Sauvegarde et restauration : fragilités secondaires

| Constat                                                                                                                                                                                                                                                                                                                       | Où                                                                                                             | Correction                                                                                      | Effort | Certitude |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ | --------- |
| **Octets des documents absents des sauvegardes** : aucun impact aujourd'hui (seul le PDF de démo existe), mais **bloquant avant tout upload**. Les commentaires « Blobs travel separately » ne correspondent à aucun code                                                                                                     | `db.ts:112-115`, `snapshot.ts:24-28` ; S2 de l'audit                                                           | Blobs base64 plafonnés, ou `.zip` à côté ; au minimum, marquer un document restauré sans octets | M      | confirmé  |
| Validation incomplète : `createdAt`, `deletedAt`, `ownerId`, `sortOrder`, `season`, format de date et de devise ne sont pas vérifiés. Un fichier retouché peut écrire des lignes invisibles (`deletedAt` absent) ou qui font planter une vue (`localeCompare` sur `undefined`, `RangeError` d'`Intl` sur une devise invalide) | `snapshot.ts:339-381` ; `activities.repo.ts:24`, `documents.repo.ts:101-104`, `money.ts:29`, `record.ts:48-49` | Compléter `ROW_RULES`                                                                           | S      | confirmé  |
| Export non cohérent : sept `toArray()` en parallèle, hors transaction de lecture                                                                                                                                                                                                                                              | `snapshot.ts:48-51`                                                                                            | `db.transaction("r", …)`                                                                        | S      | confirmé  |
| `seedIfEmpty` n'est pas transactionnel : un premier lancement interrompu laisse une base à moitié semée, sans `seedRecordIds` (S7 de l'audit)                                                                                                                                                                                 | `seed.ts:176-254`                                                                                              | Envelopper dans une transaction                                                                 | S      | confirmé  |

#### F7 — Rappels push

| Constat                                                                                                                                                                                                                                               | Où                                                                       | Correction                                                                          | Effort | Certitude                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------ | ------------------------------ |
| `PUT /reminders` sans authentification ni limite de débit : l'hôte est vérifié mais pas le chemin, donc des lignes factices en masse sont possibles, et le cron les traite toutes en série (sans risque pour les données, qui restent sur l'appareil) | `server/src/index.ts:55-81`, `:90-152` ; `server/src/reminders.ts:21-26` | Rate limiting Cloudflare, plafond du nombre de lignes, budget par exécution du cron | S      | confirmé                       |
| Souscription morte (404/410) supprimée côté serveur, mais le client ne le sait pas : il ne renvoie qu'au prochain changement, puis re-perd la ligne, et les rappels disparaissent en silence                                                          | `server/src/index.ts:118-135` ; `src/pwa/push.ts:112-141`                | Gérer `pushsubscriptionchange` dans le SW ; revérifier la souscription au démarrage | S      | à vérifier (fréquence sur iOS) |
| Toucher une notification recharge toute l'app (`client.navigate`), ce qui efface un brouillon en cours dans une feuille                                                                                                                               | `service-worker.js:285-296`                                              | `postMessage` au client, qui navigue via la Navigation API                          | S      | confirmé                       |

#### F8 — Service worker et sécurité

| Constat                                                                                                                                                                                                 | Où                                                            | Correction                                                                                                                                 | Effort | Certitude         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ----------------- |
| `cache.put` du cache d'exécution hors `waitUntil`                                                                                                                                                       | `service-worker.js:227-230`                                   | L'attendre dans `event.waitUntil`                                                                                                          | S      | confirmé          |
| Pas de CSP (possible en `<meta>` sur GitHub Pages). « Ouvrir dans un nouvel onglet » ouvre un `blob:` de même origine : un SVG ou un HTML uploadé demain y exécuterait du script avec accès à IndexedDB | `index.html` ; `document-viewer.ts:151-163`, `files.ts:43-44` | CSP `script-src 'self'`, `connect-src 'self'` + URL du Worker, `object-src 'none'` ; n'autoriser que PDF et images matricielles à l'upload | S      | confirmé (latent) |

#### F9 — Dialogues : défauts mineurs

| Constat                                                                                                                                                  | Où                              | Correction                                                              | Effort | Certitude                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------- | ------ | ------------------------------ |
| `post-sheet` émet 2 à 3 `sheet-close` par fermeture                                                                                                      | `post-sheet.ts:374-379`, `:577` | `stopPropagation()` + garde `if (!this.open)`, comme `activity-sheet`   | S      | confirmé                       |
| `.dialog__footer:not(:has(*))` ne masque jamais un pied vide (le `<slot>` compte comme enfant) : bande de 32 px sur la feuille du jour et le visualiseur | `dialog-element.ts:244`         | `slotchange` + état personnalisé                                        | S      | confirmé                       |
| Après une création, les champs disparaissent avant la sortie : la feuille se replie puis glisse                                                          | `post-sheet.ts:483-484`         | Réinitialiser après la sortie, ou à l'ouverture suivante (réglé par C1) | S      | confirmé (effet visuel à voir) |

#### F10 — Champs de formulaire

| Constat                                                                                                                                                                                            | Où                                                                                            | Correction                                                                                | Effort | Certitude                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ | --------------------------- |
| `formDisabledCallback` écrit `disabled`, qui est reflété : un champ désactivé par un `<fieldset>` le reste après réactivation (latent, aucun fieldset désactivé aujourd'hui)                       | `form-field-element.ts:69-70`, `:145-147` ; `app-switch.ts:44`, `:70-72`                      | État du fieldset stocké à part                                                            | S      | confirmé (spec HTML)        |
| `name` non reflété (une liaison `.name=` sortirait le champ du formulaire) ; `app-unit-select` sans options n'est jamais `valueMissing`                                                            | `form-field-element.ts:68` ; `app-unit-select.ts:40-44`                                       | `reflect: true` ; validité explicite                                                      | S      | confirmé                    |
| `app-select` applique la valeur avant ses options : la pilule de période peut afficher une option et envoyer une autre valeur                                                                      | `app-select.ts:346-377`                                                                       | Resynchroniser dans `updated()`                                                           | S      | à vérifier                  |
| `flat` et `hide-label` ne retirent plus la carte ; `--app-input-background` et `--app-select-border-color` ne sont lus nulle part ; libellés en 12 px ou 14 px et rayons de 12 ou 8 selon le champ | `app-input.ts:91-132`, `:141-146` ; `app-select.ts:197`, `:212-216` ; `post-sheet.ts:179-188` | Faire trancher la designer, puis supprimer ou restaurer ; base commune dans `fieldStyles` | M      | confirmé (rendu à capturer) |

#### F11 — Maintenabilité et dette connue

| Constat                                                                                                                                                                                                                              | Où                                                                                                     | Correction                                                        | Effort | Certitude |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------ | --------- |
| Règles métier dans les vues : lignes d'information, partage qui lit `customFields` en dur, recherche, séparation cures/évènements, règle « en cours »                                                                                | `PostDetailView.ts:173-258`, `:435-442` ; `PostsView.ts:134-163`, `:195-233` ; `HomeView.ts:104-118`   | Fonctions pures dans `src/data/posts.ts`, testées sans navigateur | M      | confirmé  |
| Quatre idiomes de « Retour » (`goBack`, `goBackOutOf`, `navigateTo(appHref(…))`, `navigateTo(chemin nu)`) : c'est la racine de M8 et de F3                                                                                           | `navigation.ts`, vues                                                                                  | Un seul idiome                                                    | S      | confirmé  |
| Repli sans Navigation API : code mort sous le plancher navigateur (suppression déjà prévue)                                                                                                                                          | `history-fallback.ts` ; `router.ts:50-58`, `:205-320` ; `navigation.ts:23-24` ; `view-state.ts:56-115` | Supprimer avec M8                                                 | M      | confirmé  |
| Index jamais interrogés : `posts.horseId`, `categoryKey`, `status`, `[horseId+categoryKey]`, `documents.category`, `[horseId+category]`, `rationItems.horseId`, `categories.key` et `order`. `posts.date` sert désormais aux rappels | `db.ts:63-74` ; S9 de l'audit                                                                          | À la prochaine montée de schéma, pas avant                        | S      | confirmé  |

#### F12 — Commentaires et documentation qui affirment des choses fausses

Ce projet s'appuie beaucoup sur ses commentaires, donc un commentaire faux y coûte cher. À corriger au passage, en premier ceux qui orientent une décision :

- **`post-sheet.ts:382-384`** : « restores … the value rendered from `event` » (cause de C1).
- **`activity-sheet.ts:257-261`** : « the same one PostDetailView's own delete does » (E1).
- **`base-path.ts:13`** : la base vaudrait `/` sous `npm run dev` (M8).
- **`ready.ts:36-37`** et **`AGENTS.md:586-591`** : `LiveQuery.error` serait exposé, et `HorseView` lirait `.loading` (M4).
- **`db.ts:55-57`** : `key` et `order` indexés « parce que » jointure et tri (aucun index n'y participe).
- **`db.ts:112-113`**, **`snapshot.ts:24-28`**, **`AGENTS.md:229-230`** : « blobs travel separately », alors qu'aucun code ne le fait.
- **`types.ts:417`** : `notificationsEnabled` « nothing consumes it », alors que `reminders.ts:72` le lit.
- **`view-state.ts:46-50`**, **`router.ts:99-107`** : le repli historique serait « le chemin vivant sur la plupart des iPhone ».
- **`app-combobox.ts:24-25`**, **`:140-142`** : `input` serait `composed: false`, et `combobox-change` n'est pas émis au commit.
- **`app-unit-select.ts:27-29`** : « visually-hidden legend », alors qu'elle est visible.
- **`forms.ts:28-30`** : la validation native « couvrirait » tous les chemins, alors que tous les formulaires sont `novalidate`.
- **`double-tap-guard.ts:21-23`** : « le même élément », faux à travers le shadow DOM (F4).
- **`customize-categories.ts:8`**, **`:14-15`** : icône annoncée mais non rendue, import inutilisé.

**Effort** : S. **Certitude** : confirmé.

### Points à vérifier sur l'iPhone (plausibles, non prouvés)

- **Saisir la poignée de la feuille pendant sa fermeture** (`app-bottom-sheet.ts:156-170`, `:385-392`). `pointerdown` ignore `open`, et `lostpointercapture` n'est pas géré. La classe `sheet--dragging` et un `transform` inline pourraient rester : ouvertures suivantes sans animation, ou décalées. Test : glisser vers le bas, rattraper aussitôt, rouvrir.
- **« Ouvrir dans un nouvel onglet »** d'un PDF depuis l'app installée (`document-viewer.ts:155-163`). L'onglet ouvert pourrait ne pas lire l'URL `blob:`. C'est pourtant le seul accès aux pages 2 et suivantes selon le commentaire.
- **Touche Retour du clavier dans « Autre activité… »** (`activity-sheet.ts:339-347`). Elle ne soumet probablement pas : l'`<input>` natif vit dans un shadow root, sans formulaire propriétaire.

---

## 4. Plan d'action

Ordonné par rapport impact / effort, gains rapides d'abord.

| #   | Chantier                                                                                                                                                                                                                                          | Constats                          | Effort                  | Pourquoi à ce rang                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| 1   | **Réparer la feuille d'édition** : formulaire recréé à chaque ouverture (patron `ration-sheet`), plus de `form.reset()` en édition, champs en `repeat` indexé par `field.id`, deux tests de régression (éditions successives, changement de type) | C1, M6, F9 (repli)                | S                       | Seule corruption reproduite, sur le parcours n° 1 ; le patron existe déjà dans le dépôt |
| 2   | **Sécuriser la puce du jour** : confirmation ou « Annuler » quand la séance porte une note, suppression via `postsService.deletePost`                                                                                                             | E1                                | S + design              | Perte irréversible en un tap                                                            |
| 3   | **Retirer les données personnelles** : export frais pour vérifier `profiles`, vider `ACCOUNT` et les `defaultValue`, démo générique, fixture brouillée ; décider pour l'historique Git                                                            | E2                                | S (M avec l'historique) | Exposition publique en cours, correctif simple                                          |
| 4   | **Navigation sous `/lady-gestion/`** : `navigateTo` passe par `appHref`, `goBackOutOf` pour Personnaliser, test sous base déployée                                                                                                                | M8, F3                            | S                       | Deux bugs de parcours pour quelques lignes                                              |
| 5   | **Règles de lecture et catalogue** : `listUpcoming` dérivé de la date, `matchActivity` qui reconnaît les clés + nettoyage des lignes fantômes, décision sur le montant des suivis, `.today` dans `PostsView`                                      | M9, M7, M10, F2                   | S (+ décision produit)  | Écrans principaux faux ou pollués, correctifs très locaux                               |
| 6   | **Rendre la sauvegarde honnête** : Web Share + horodatage sur succès, export de secours en IndexedDB brut, purge du seed limitée à une base vierge, `ROW_RULES` complétées, export en transaction, messages en français                           | M1, M2, M3, F6                    | M                       | Le seul filet de sécurité doit dire vrai                                                |
| 7   | **Rendre les échecs visibles** : canal d'erreur `LiveQuery` → bandeau dans `app-root`, `try/catch` et messages dans `CustomizeView` et les feuilles, drapeau `saving`                                                                             | M4, M5, F4                        | M                       | Évite les ressaisies et les restaurations faites « à l'aveugle »                        |
| 8   | **iPhone et accessibilité** : champs à 16 px (ou viewport), corrections VoiceOver, arbitrage des contrastes avec la designer                                                                                                                      | M11, F1                           | S + design              | Gêne quotidienne sur l'appareil réel                                                    |
| 9   | **Filets de tests** : WebKit en CI, tests de régression de chaque chantier, test Playwright hors ligne et mise à jour du SW contre `vite preview`                                                                                                 | M12                               | M                       | Empêche le retour de ces bugs ; le moteur réel est WebKit                               |
| 10  | **Dette, au fil de l'eau** : commentaires faux, repli Navigation API, champs de formulaire, index morts (avec la prochaine montée de schéma), blobs **avant** tout upload, CSP, durcissement du Worker                                            | F7, F8, F10, F11, F12, F6 (blobs) | M                       | Pas urgent, mais à ne pas laisser dériver                                               |

---

## Annexe A — Suivi de l'audit de septembre (`docs/data-model-audit.md`)

| Réf.           | Sujet                                                                          | État au 26/09                                                        |
| -------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| S6             | Supprimer un post rend ses documents orphelins                                 | ✅ corrigé : `postsService.deletePost`, transactionnel               |
| M1             | `blocked` / `versionchange` non gérés                                          | ✅ corrigé : `watchDatabase` + écran dédié                           |
| M3             | Doublon de puce « Balade à pied »                                              | Cause trouvée et toujours active → **M7**                            |
| M6             | Données personnelles dans le bundle                                            | Toujours présent → **E2**                                            |
| S2             | Octets des documents hors sauvegarde                                           | Toujours présent, latent → **F6**                                    |
| S4             | `status` calculé à l'écriture                                                  | Toujours présent ; nouveau symptôme → **M9**                         |
| S7             | `seedIfEmpty` non transactionnel                                               | Toujours présent → **F6**                                            |
| S9             | Index morts, docblock faux                                                     | Toujours présent (`posts.date` désormais utilisé) → **F11**, **F12** |
| S1, S3, S5, S8 | Promotions de colonnes, historique des rations, contacts, catégories intégrées | Décisions de schéma ou de produit, non réévaluées ici                |

## Annexe B — Méthode et couverture

**Lu en détail par l'auteur de la revue**

- tout `src/data/` hors tests : `db`, `live`, `ready`, `record`, `owner`, repositories, services, `backup/`, `seed`, `categories`, `posts`, `forms`, `post-form`, `reminders`, `dates`, `money` ;
- `src/pwa/` (`index`, `push`, `service-worker.js`) ;
- `server/src/` et la migration D1 ;
- `vite.config.ts`, `vite/icon-sprite.ts`, `index.html`, le manifeste, la CI ;
- dans `app-root.ts` : l'initialisation et les écrans d'erreur ;
- `backup-actions.ts` ;
- les chemins de soumission de `post-sheet` et `activity-sheet`.

**Délégué à trois sous-agents, puis revérifié constat par constat dans le code** avant d'être retenu, les pistes non confirmées étant écartées ou marquées « à vérifier » :

- les champs de formulaire (`commons/` + 12 composants) ;
- les dialogues, feuilles et formulaires (12 composants + services) ;
- le shell, le routeur et les vues (`app-root`, contrôleurs, 8 vues, 16 composants).

**Exécuté**

- `npm run typecheck` (app + outillage) et `tsc` du serveur : 0 erreur. `oxlint` : 0 alerte.
- Reproduction de **C1** et **M8** avec le pilote du projet, sur `npm run dev` : Chromium headless, base de démo, aucune donnée réelle.
- Aucun test ni build lancé.

**Données réelles** : les sauvegardes locales de `./backup/` ont été lues en local pour mesurer l'exposition (M3, M7, E1, F5). Aucune donnée personnelle n'est reprise dans ce document.

**Survolé**

- les CSS globales de `src/styles/` : seulement les tokens de couleur et de focus, et `reduced-motion` ;
- le contenu des tests : intitulés et mise en place seulement ;
- `.claude/`, `scripts/`.

**Non vérifié** : tout comportement propre à iOS et à VoiceOver. Ces points sont marqués « à vérifier » et la manière de les confirmer est indiquée.
