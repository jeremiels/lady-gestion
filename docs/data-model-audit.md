# Audit du modèle de données — septembre 2026

Revue du schéma IndexedDB/Dexie, des patterns d'accès, de la cohérence des noms
et de ce qui bloquerait l'ouverture à plusieurs chevaux / plusieurs
utilisatrices / une synchronisation.

**À prioriser.** Rien dans ce document n'est appliqué, sauf ce qui est marqué
« ✅ fait ». Chaque constat porte une estimation d'effort, de risque et
d'ampleur, pour être trié sans avoir à rouvrir le code.

**Méthode.** Reconstruit depuis `src/data/` et croisé avec les deux exports
réels de `./backup/` (schéma v13, 18 sept. 2026, 125 posts dont 113 vivants).
Les chiffres cités sont mesurés, pas estimés. Les comportements décrits sont
tracés dans le code contre ces données — **l'application n'a pas été lancée**,
donc ce sont des déductions vérifiables, pas des observations d'écran.

**Données personnelles.** Les noms de praticiens, boutiques et coachs présents
dans la base réelle sont remplacés ici par leur rôle : `/backup/` est gitignoré
parce que ce dépôt est publié sur GitHub Pages, et ce fichier ne l'est pas.

---

## 0. Décisions déjà prises

| | Décision | Raison |
|---|---|---|
| ✅ | **Plancher navigateur remonté** à Safari 26.2 / Chrome 143 / Firefox 147, et rendu effectif via `build.target` | voir §1 |
| ❌ | **Garde de version au démarrage** (refuser d'ouvrir une base < v13) — *rejeté* | Une seule installation, confirmée en v13, migrations précédentes supprimées volontairement. Conservé ici pour que la question ne soit pas reposée, pas pour être refaite. |
| ⏸️ | **Suppression des gardes devenues mortes** (API Navigation, ancrage CSS) — *reporté* | Le plancher a bougé en premier exprès ; la suppression sera un changement à part. `AGENTS.md` dit que c'est en attente, donc la doc ne ment pas entre-temps. |

---

## 1. Plancher navigateur ✅ fait

**Safari 26.2 / Chrome 143 / Firefox 147** — trois fichiers modifiés
(`CLAUDE.md`, `AGENTS.md`, `vite.config.ts`), `vite build` vérifié (exit 0).

**Choix des numéros.** Règle retenue : « latest − 10 au maximum ».
Chrome 153 − 10 = **143** (4 déc. 2025). Firefox : **147** (13 janv. 2026,
latest − 9) plutôt que 146, parce que 147 livre *à la fois* l'API Navigation et
l'ancrage CSS — un cran de plus achète les deux seams. Safari : l'utilisatrice
est sur iOS dernière version (Safari 27, 14 sept. 2026) ; **26.2** (12 déc.
2025) est une marge délibérée en dessous, choisie parce que c'est là que l'API
Navigation atterrit. Les trois tombent entre le 4 décembre 2025 et le
13 janvier 2026.

**Ce que l'audit a trouvé au passage, et qui vaut plus que les numéros :**

1. **Les numéros n'avaient pas été « modifiés sans raison ».** Ils datent du
   commit initial (`fe295a5`) et n'ont jamais été remontés. Le seul commit qui a
   touché la section, `e79937e`, n'a pas bougé les versions : il a corrigé le
   raisonnement, en découvrant que l'API Navigation est à Safari 26.2 et non
   18.2. Le problème était de la péremption, pas une mauvaise édition.

2. **Le plancher n'était appliqué nulle part.** `vite.config.ts` n'avait pas de
   `build.target`, donc Vite 8 retombait sur `baseline-widely-available` =
   `chrome111 / firefox114 / safari16.4` (`node_modules/vite/dist/node/chunks/node.js:612`).
   Le bundle était transpilé pour des navigateurs dix-huit mois plus anciens que
   ce que la documentation prétendait supporter. **La prose et `build.target`
   doivent bouger ensemble.**

3. **« latest − n » perd son sens.** Chrome est passé à un cycle de deux
   semaines à la 153 (8 sept. 2026), Firefox à la 155 (1er sept. 2026, annoncé
   comme une expérimentation). 143/146 ont été livrés sous l'ancien rythme de
   4 semaines, donc « −10 » vaut encore ~9 mois aujourd'hui, mais vaudra
   **~4,5 mois** désormais, en se resserrant à chaque livraison sans que rien ne
   le signale. → Le plancher est écrit comme une **date** que les numéros
   traduisent, avec les versions courantes notées pour la prochaine
   re-dérivation.

**Conséquences à traiter plus tard (⏸️ reporté, voir §0) :**

- 9 `'navigation' in window` (`commons/navigation.ts`,
  `commons/controllers/router.ts`, `commons/controllers/view-state.ts`) et tout
  `commons/history-fallback.ts` — l'API Navigation est Baseline Newly Available
  depuis janvier 2026 (Chrome, Edge, Firefox 147, Safari 26.2).
- 4 blocs `@supports (anchor-name: --sliding-selection)`
  (`commons/sliding-selection.styles.ts`, `commons/segmented.styles.ts`,
  `app-unit-select`, `app-calendar`) — ancrage CSS par défaut depuis
  Firefox 147 / Safari 26.
- `URLPattern` passe **sous** le plancher (Safari 26) : option réelle pour la
  table de routes, là où c'était « un écran blanc » auparavant.
- `Temporal` et `<dialog closedby>` : apparus en Safari Technology Preview 249
  (juil. 2026), donc au plus tôt en Safari 27 stable — **au-dessus** du plancher,
  et non vérifié en stable. `data/dates.ts` reste le seam.

---

## 2. Stockage — l'existant

### 2.1 Le schéma réel

`db.ts:63-74`, une seule version déclarée (v13). Aucun `autoIncrement` : toutes
les clés sont des UUID v4 clients (`ids.ts`), sauf `categories` (dont l'`id`
*est* le `key`, voir §5.2) et `meta`.

| Store | keyPath | Index déclarés | Index **réellement** interrogés |
|---|---|---|---|
| `horses` | `id` | `name`, `updatedAt` | `name` (`orderBy`) |
| `posts` | `id` | `horseId`, `date`, `categoryKey`, `status`, `[horseId+date]`, `[horseId+categoryKey]`, `updatedAt` | **`[horseId+date]` seul** |
| `documents` | `id` | `horseId`, `postId`, `category`, `[horseId+category]`, `updatedAt` | `horseId`, `postId` |
| `documentBlobs` | `documentId` | — | accès par clé |
| `rationItems` | `id` | `horseId`, `[horseId+sortOrder]`, `updatedAt` | `[horseId+sortOrder]` |
| `activities` | `id` | `horseId`, `updatedAt` | `horseId` |
| `categories` | `id` | `key`, `order`, `updatedAt` | **aucun** (`toArray()`) |
| `profiles` | `id` | `updatedAt` | **aucun** (`toArray()`) |
| `meta` | `key` | — | accès par clé |

`BaseRecord` = `{ id, ownerId, createdAt, updatedAt, deletedAt }` sur les
7 tables d'enregistrements. `documentBlobs` et `meta` en sont exemptées,
volontairement.

### 2.2 Relations implicites

```
horses.id ─┬─< posts.horseId              (UUID)
           ├─< documents.horseId          (UUID)
           ├─< rationItems.horseId        (UUID)
           ├─< activities.horseId         (UUID)
           └─< meta.activeHorseId         (état d'appareil, non exporté)

posts.id ──< documents.postId             (UUID, nullable — AUCUNE cascade)
documents.id ─1:1─ documentBlobs.documentId  (cascade dure à la suppression)

categories.key ──< posts.categoryKey      (SLUG, durable par conception)
categories.id  ──< categories.parentId    (adjacence, profondeur max 2)

activities.label ⇠ posts.customFields.activity   (par LIBELLÉ, non relationnel)
posts.customFields.counterparty ⇠ (rien)          (texte libre)
BaseRecord.ownerId ⇠ (rien)                       (écrit partout, lu par aucune requête)
```

Deux stratégies de référencement opposées, toutes deux documentées et
défendables : `categoryKey` pointe sur un **slug** pour qu'un post survive à la
suppression de sa catégorie ; `parentId` pointe sur un **id** parce qu'un lien
structurel cassé doit être réparé, pas préservé (`categories.repo.ts:112` fait
cette réparation).

### 2.3 Patterns d'accès réels

| Vue | Requête | Volume lu (données réelles) |
|---|---|---|
| `PostsView` (liste + calendrier) | `listByHorse` → scan `[horseId+date]`, filtré en mémoire (recherche, chip, annulés) | **113 lignes à chaque fois** |
| `BudgetView` | `listBudget` = même scan + `amountCents != null` ; période filtrée en mémoire | 95 |
| `HomeView` | `listUpcoming` (range `today..∞`), `listByCategory(['cures','traitement'])`, `totalSpent(mois)` | 3 requêtes |
| `week-strip` | `listInRange(lundi..dimanche)` | 0–7 |
| `HorseView` | `listByCategory` + `rationItems[horseId+sortOrder]` | 4 + 5 |
| `DocumentsView` | `documents.where(horseId)` puis comptage en mémoire | 1 |
| Toutes | `categories.toArray()` puis résolution + tri en mémoire | 14 |

Le filtrage en mémoire est **correct et documenté** (`BudgetView.ts:82`) : une
`liveQuery` ne se relance que sur écriture, donc une requête bornée par une
période choisie à l'écran serait périmée dès le premier clic. Le seam pour plus
tard est `listInRange` + ré-abonnement explicite, déjà nommé dans le code.

### 2.4 Hypothèses restées ouvertes

1. `profiles: []` dans les deux sauvegardes. Probablement parce que
   `seedProfileIfEmpty` est postérieur au dernier export (`seed.ts` modifié le
   18/09 à 10h36, export à 08h56). **À confirmer avec un export frais** avant de
   vider `ACCOUNT` (voir §3.3 M6).
2. Aucun chemin d'upload de document n'existe : pas de `<input type="file">` ni
   de `showOpenFilePicker` dans `DocumentsView`, `document-viewer`,
   `PostDetailView`. L'unique document vient de `seed.ts`.

---

## 3. Stockage — constats

Effort : **S** < 1 h · **M** quelques heures · **L** une journée ou plus.
Risque : perte de données potentielle, ou non.

### 3.1 🔴 Critique

#### S1 — `amountCents` et `endDate` sont structurels mais rangés dans un sac non typé

**Effort M · Risque données (migration) · 106 lignes à réécrire · 95 + 4 occurrences**

```ts
// types.ts:134
customFields: Record<string, string | number | boolean | null>;

// posts.repo.ts:108-112 — décide de l'appartenance au budget
posts.filter((post) => typeof post.customFields.amountCents === "number" && …)

// posts.ts:343-346 — décide des jours occupés au calendrier
export const courseEndDate = (post: Post): IsoDate | null => {
  const end = post.customFields.endDate;
  return isIsoDate(end) ? end : null;
};
```

**Mesuré.** 102 posts portent `amountCents`, 4 portent `endDate`. Mais **2 posts
`cures` portent `duration` et pas `endDate`** — reliquat d'une définition de
champ disparue avant `courseFields()` :

```
cures  2026-10-06  planned  customFields={'duration': None,         'followUp': None}
cures  2027-03-01  planned  customFields={'duration': '3 semaines', 'followUp': None}
```

En traçant le code contre ces lignes : `courseEndDate` → `null`, donc
`isCourseOngoing` → `true`, donc **les deux apparaissent dans « cures et
traitements en cours » du tableau de bord** alors que l'une commence dans
17 jours et l'autre dans 18 mois ; `activeDays` renvoie `0`. Le symptôme n'est
pas une erreur visible : l'UI ne peut pas distinguer « cure en cours sans date
de fin » de « on a perdu la date de fin ».

**Pourquoi c'est de la conception et pas un bug ponctuel.** Le sac est le bon
endroit pour ce qui est *propre à une catégorie et purement affiché*. Mais
`amountCents` décide de l'appartenance au budget et des totaux ; `endDate`
décide **quels jours du calendrier une ligne occupe**. Tout le reste du schéma
en dépend, et rien ne les garantit : `assertRows` (`snapshot.ts:318`) ne valide
que « scalaire » (et c'est le bon choix pour le sac) ; `reconcileCategories`
peut retirer un champ d'une catégorie intégrée à chaque lancement, laissant les
anciennes lignes orphelines — c'est exactement ce qui est arrivé à `duration` ;
et aucun index ne peut être posé dessus.

Corollaire du même défaut : `currency` est une *colonne* réelle alors que le
montant qu'elle qualifie est dans le sac. Le couple est réparti sur deux
mécanismes de stockage.

**La règle à retenir :** *un champ sort du sac le jour où autre chose que son
propre affichage en dépend.* Aujourd'hui elle vise exactement deux champs.
`dosage`, `counterparty`, `quantity`, `competition`, `result` restent dans le
sac. `followUp` aussi, et devra en sortir le jour où les rappels le liront pour
calculer une date.

**Correction.** Promouvoir en colonnes **sans toucher au formulaire** : la
catégorie continue de les déclarer dans `fields`, et c'est `postFields`
(`posts.service.ts:253-257`) qui les route vers la colonne au lieu du sac —
mécanisme qui existe déjà pour `title`/`date`/`notes` via `BASE_FIELD_IDS`
(`categories.ts:47`). Il s'agit d'ajouter deux ids à un `Set`. Voir §6 pour le
code, et §4.1 pour le renommage simultané en `cost`.

#### S2 — Une sauvegarde ne contient aucun octet de fichier

**Effort M · Risque données (dormant) · à trancher AVANT de livrer l'upload**

`db.ts:117-125` : `RECORD_TABLES` exclut `documentBlobs`. `snapshot.ts:24-27` :
« Document *bytes* are not included — only metadata. »

**Vérifié** sur les deux fichiers réels : `tables` =
`[horses, posts, documents, rationItems, activities, categories, profiles]`.
Pas de `documentBlobs`, pas de `meta`.

La *métadonnée* du document est restaurée, le fichier non. `getBlob()` renvoie
`undefined`, le visualiseur n'a rien à afficher, et la ligne survit pour faire
croire que le document est là. Aujourd'hui sans conséquence : un seul PDF de
697 octets généré par `seed.ts`, et aucun chemin d'upload. C'est une mine
dormante, qui explosera au moment où il y aura des radios et des comptes rendus
qu'on ne peut pas retélécharger.

Le raisonnement du commentaire est correct mais incomplet : « base64 would
bloat the file by a third » est vrai, mais la conclusion (« files travel
separately, once Drive backup lands ») fait dépendre l'intégrité de la
sauvegarde d'une intégration qui n'existe pas et n'a pas de date. Entre-temps,
le seul mécanisme anti-perte de données perd des données.

**Options, par ordre de préférence :**
1. Inclure les blobs en base64 dans le snapshot avec un **plafond par fichier**
   (2 Mo p. ex.) et un compteur des fichiers exclus affiché à l'export.
   Attention : `JSON.stringify` sur 50 Mo de base64 fait sauter la mémoire d'un
   téléphone — le plafond n'est pas une optimisation.
2. Un second fichier `.zip` exporté à côté, corrélé par `documentId`.
3. Au minimum, si rien n'est fait : faire dire à un document restauré sans blob
   qu'il est vide, au lieu de le laisser ressembler à un document intact.

### 3.2 🟠 Important

#### S3 — Aucun historique des rations et des posologies

**Effort S · Risque nul · aucune migration · 3 lignes**

`rations.service.ts:153` : `rationsRepo.update(ration.id, { label, quantity, unit, season })`.

`rationItems` est une table d'*état courant*. Le jour où la véto demande « elle
était à combien de vitamine E en mars ? », la réponse n'existe nulle part. Idem
pour la posologie d'une cure (`customFields.dosage`) modifiée en cours de route.

**C'est le seul constat de ce document où attendre coûte des données.** Un index
manquant se rajoute quand on veut ; un historique non écrit ne se reconstruit
jamais.

**Correction minimale — zéro colonne, zéro migration.** Le soft-delete conserve
déjà la ligne complète avec son `deletedAt`. Sur un changement **matériel**
(`label`/`quantity`/`unit`/`season`), remplacer au lieu de modifier :

```ts
// rations.service.ts, à la place du update()
// Remplacer plutôt que modifier : `softDelete` garde l'ancienne ligne intacte,
// donc « 40 mL d'octobre à mars, 50 mL depuis » se relit de
// `createdAt`/`deletedAt` sans nouvelle colonne. Un changement matériel est un
// changement de plan ; `sortOrder` n'en est pas un et reste un update.
await rationsRepo.remove(ration.id);
await rationsRepo.add({
  horseId: ration.horseId, sortOrder: ration.sortOrder,
  label, quantity, unit, season,
});
```

Non-régressions vérifiées : `reorder`/`updateMany` continuent d'écrire
`sortOrder` en place ; `clearUntouchedSeedData` reconnaît une ligne semée par
`createdAt === updatedAt` et `softDelete` déplace `updatedAt`, donc une ligne
semée puis éditée reste protégée ; la fusion de sauvegarde est par `id`, et les
deux lignes ont des `id` distincts, donc une restauration ramène le tombstone
*et* la ligne courante.

Si tu veux plus tard afficher la frise, tu passeras à `validFrom`/`validTo`
explicites — mais les données seront là, ce qui est tout l'enjeu.

#### S4 — `status` est calculé à l'écriture et jamais réévalué

**Effort M · Risque données (migration) · 7 lignes concernées aujourd'hui**

`posts.ts:21-24` et `posts.service.ts:271-276`.

**Mesuré, au 19/09/2026** — 7 lignes vivantes, datées dans le passé, toujours
`planned` : 6 `travail` (08, 11, 12, 13, 15, 17 sept.) et 1 `cours` (09 sept.,
20,00 €).

`status` mélange deux questions : *l'intention* (c'était prévu) et *le résultat*
(ça a eu lieu). Dérivé de la date à l'écriture, il ne répond correctement ni à
l'une ni à l'autre et dérive sans correction. Ces 7 lignes comptent dans les
séances de la semaine et dans le budget (`listBudget` n'exclut que `cancelled`)
mais pas dans « Rendez-vous à venir » (qui filtre sur `date >= today`) — trois
lectures, trois réponses différentes à « est-ce que ça a eu lieu ».

C'est aussi la réponse à « planifié vs réellement donné » : le schéma **n'a pas
de place** pour la distinction. Une cure planifiée du 15/09 au 06/10 à 2 mL/j
n'enregistre nulle part qu'elle a effectivement été donnée.

**Correction — ne pas construire de journal d'administration** (une seule
utilisatrice, qui ne cochera pas 21 cases par cure). Séparer les deux notions
dans le type, ce qui est gratuit :

```ts
// types.ts — remplace `status: PostStatus`
/**
 * Le statut posé explicitement, ou `null` quand la date le dit déjà.
 *
 * `cancelled` est le seul état qu'aucune date ne redérive : une séance annulée
 * reste annulée. « À venir » et « fait » sont une lecture de la date, pas un
 * fait à stocker — les stocker, c'est les laisser se périmer.
 */
statusOverride: PostStatus | null;

// posts.ts
export const statusOf = (post: Post, on: IsoDate = todayISO()): PostStatus =>
  post.statusOverride ?? statusForDate(post.date, on);
```

Bonus sans migration supplémentaire : une case « ça n'a pas eu lieu » écrit
`statusOverride: "planned"` sur une ligne passée, et la distinction
prévu/réalisé existe pour le prix d'un booléen.

#### S5 — Le contact est du texte libre, la dérive a commencé, et `cours` casse sa propre règle

**Effort S (a+b) · Risque nul · 74 occurrences pour le renommage**

**Mesuré** : 27 orthographes distinctes de `counterparty`, 26 après
normalisation casse/accents/ponctuation. Une collision exacte (une boutique
écrite avec et sans majuscule) et au moins une paire qu'aucune normalisation
n'attrapera : le même ostéopathe saisi sous deux formes (« X de Y » et
« X - Y »), sous deux catégories différentes.

**Incohérence structurelle.** `counterpartyField` (`categories.ts:157`) affirme
« One `id` for both, so the detail view and the search box find it whatever a
type calls it. » Mais `cours` déclare un id distinct `coach`
(`categories.ts:290`). `PostsView.#visiblePosts` (`PostsView.ts:148-155`) ne
cherche que dans `customFields.counterparty` : **chercher le nom du coach ne
remonte aucun cours.** Une seule ligne concernée, mais c'est l'exception qui
invalide la règle que le commentaire pose.

**Trois temps :**
- **(a) maintenant, gratuit** — `cours` passe sur
  `counterpartyField("Coach", …)`. Une ligne à migrer (`coach` → `counterparty`).
- **(b) maintenant, peu cher, le point important** — passer `counterpartyField`
  de `inputTextField` à `comboBoxField` avec `suggestions: "counterparties"`,
  alimenté par les valeurs distinctes déjà stockées. C'est **le motif que
  `activity` utilise déjà** (`suggestions: "activities"`, `types.ts:175`). Ça
  arrête la dérive sans toucher au schéma.
- **(c) pas maintenant** — une table `contacts`. Elle ne devient rentable que
  quand deux utilisatrices distinctes ont le même maréchal *et* qu'on veut leur
  montrer quelque chose de commun. Et elle sera propre à faire plus tard **à
  condition d'avoir fait (b)** — sinon il faudra dédoublonner à la main sans
  savoir qui est qui.

#### S6 — Supprimer un post orpheline ses documents (déjà arrivé)

**Effort S · Risque nul · 1 ligne à réparer**

`record.ts:120-125` : `remove` écrit le tombstone et s'arrête.
`PostDetailView.ts:464` l'appelle. `documents.postId` n'est jamais réparé.

**Vérifié — l'orphelin existe déjà :** l'unique document vivant pointe vers un
post supprimé le 2026-08-25. Il reste visible dans son dossier (donc pas perdu),
mais son rattachement est mort : plus aucune vue ne relie ce compte rendu à la
visite qu'il documente.

IndexedDB n'a pas de clé étrangère : la cascade est une décision explicite ou
elle n'existe pas. `categoriesRepo.remove` (`categories.repo.ts:112`) l'a
comprise — elle promeut les enfants en racines dans la même transaction.
`postsRepo.remove` non.

```ts
/**
 * Supprime le post et détache ses documents, dans la même transaction.
 *
 * Le document n'est pas supprimé : on supprime un rendez-vous, pas une facture.
 * Il reste dans le dossier du cheval, sans lien mort vers une ligne qu'aucune
 * vue ne sait plus afficher.
 */
export const deletePost = (id: string): Promise<void> =>
  db.transaction("rw", [db.posts, db.documents], async () => {
    await postsRepo.remove(id);
    for (const doc of await documentsRepo.listByPost(id)) {
      await documentsRepo.update(doc.id, { postId: null });
    }
  });
```

Et réparer la ligne existante (`postId: null`), ou décider de la garder en
documentant que `postId` peut désigner un post supprimé — auquel cas la lire via
`db.posts.get()` et non `postsRepo.getVisible()`.

#### S7 — `seedIfEmpty` n'est pas transactionnel, et `seedRecordIds` est écrit en dernier

**Effort S · Risque nul · 1 wrapper**

`seed.ts:156-234` : une douzaine d'`await` successifs (cheval, 5 rations,
6 posts, 1 document + blob, 2 écritures `meta`) sans transaction.

Une interruption au milieu laisse un cheval et quelques rations, et **pas**
`seedRecordIds`. Au lancement suivant, `db.horses.count() > 0` (`seed.ts:161`)
fait sauter tout le bloc : l'installation reste à moitié semée pour toujours, et
`clearUntouchedSeedData` ne peut plus rien nettoyer (elle lit `seedRecordIds`) —
donc une restauration laissera un deuxième cheval démo à côté du vrai, ce que le
commentaire de cette fonction identifie précisément comme le scénario à éviter.

```ts
await db.transaction(
  "rw",
  [...Object.values(RECORD_TABLES), db.documentBlobs, db.meta],
  async () => { /* le corps actuel */ },
);
```

Les repositories appelés à l'intérieur rejoignent la transaction ambiante —
Dexie le fait déjà pour `importBackup` (`snapshot.ts:147`), avec le même
raisonnement écrit. Gain secondaire : `seedRecordIds` commit avec les lignes
qu'il décrit.

#### S8 — `reconcileCategories` réécrit le contenu sans bouger `updatedAt`

**Effort L · Risque nul aujourd'hui · à décider AVANT la sync**

`seed.ts:91-101`. À chaque lancement, `label`, `icon`, `theme`, `order`,
`parentId`, `isAppointment`, `tracksWork` et surtout `fields` sont réécrits
depuis le code, en conservant `updatedAt`. C'est volontaire et la justification
est bonne (livrer une version ne doit pas gagner l'arbitrage LWW d'une
restauration). Mais **deux appareils sur deux versions auront un contenu
différent pour la même ligne au même `updatedAt`**, et aucune règle ne pourra
les départager. Inoffensif avec un appareil ; le jour de la sync, une ligne qui
oscille.

**Le vrai diagnostic.** Les 14 catégories intégrées sont **du code, pas des
données**. Elles sont dans une table synchronisée parce que l'utilisatrice peut
les activer/désactiver — mais `enabled` est le seul bit qui lui appartient, et
c'est précisément le seul que `reconcileCategories` prend soin de ne pas
écraser. Toute la complexité autour en découle : le cas spécial
`YIELDS_TO_FILE` (`snapshot.ts:96-104`), la résolution `idFor` (`seed.ts:75`),
et les versions v7/v9/v10 qui n'ont changé aucune forme de table.

**Correction.** Séparer : `BUILT_IN_CATEGORIES` reste dans le bundle ; la table
ne contient que ce que l'utilisatrice a décidé — `{ key, enabled, sortOrder? }`
pour une intégrée, la ligne complète pour une catégorie créée par elle. Retire
14 lignes de la surface de sync, supprime `reconcileCategories` et son cas
spécial, et résout §5.2 d'un coup.

#### S9 — 14 index morts, et un docblock faux sur deux points

**Effort S · Risque nul · à faire dans la même montée de version**

`db.ts:49-61` affirme : « `key` is what `Post.categoryKey` joins against,
`order` is what the budget donut sorts by. » **Les deux sont faux** : la
jointure est `findCategory` (`categories.ts:747`, un `Array.find` en mémoire) et
le tri est le `.sort((a,b) => a.order - b.order)` de `listAll`
(`categories.repo.ts:24`) sur le tableau complet. Aucun index n'y participe.

Morts : `posts.date`, `posts.categoryKey`, `posts.status`,
`posts.[horseId+categoryKey]`, `documents.category`,
`documents.[horseId+category]`, `rationItems.horseId`, `categories.key`,
`categories.order`, et les 6 `updatedAt`. `posts.horseId` et
`rationItems.horseId` sont en plus redondants avec leur compound (IndexedDB
répond sur préfixe).

À 125 lignes le coût d'écriture est nul. Ce qui coûte, c'est que ce docblock est
la seule documentation du schéma et qu'il orientera mal la prochaine décision.
Et `[horseId+categoryKey]` est **protégé par un test** (`db.test.ts:107-112`)
alors que rien ne l'utilise : le test garantit un index, pas un besoin.

**Une nuance à corriger dans le docblock** : il traite le null-dropping
d'IndexedDB comme un danger uniforme (« Indexing them would silently hide every
live row »). C'est juste pour `deletedAt` (indexer donnerait les lignes
*supprimées*, on veut les vivantes) et **à l'envers** pour `amountCents`
(indexer donnerait les lignes *qui ont un montant*, c'est-à-dire le grand livre
du budget). Même mécanisme, verdict opposé. *(Je ne recommande pas de l'indexer
pour autant : `[horseId+date]` borne déjà bien.)*

**À garder** : les 6 `updatedAt` (futur curseur de sync — et l'écrire dans le
commentaire est la seule raison de les garder) et les 6 index réellement
utilisés.

### 3.3 🟡 Mineur

| | Constat | Effort |
|---|---|---|
| **M1** | **Pas de gestion `blocked` / `versionchange`.** Aucune occurrence dans `src/`. Deux onglets, l'un met à niveau → Dexie ferme la base de l'autre et toutes ses requêtes échouent ; `LiveQuery.error` n'est **jamais lue** après le démarrage (`AGENTS.md` le dit déjà). Si l'ancien onglet garde la base ouverte, le nouveau reste bloqué sans message. → `db.on("blocked")` → « Fermez les autres onglets » ; `db.on("versionchange")` → `db.close()` + « Rechargez ». L'écran `data-error` existe déjà (`app-root.ts:395`). | S |
| **M2** | **`currency` par ligne, sans contrôle de cohérence.** Les 125 lignes sont en `EUR`, `sumCents` additionne sans vérifier. Une utilisatrice belge ou suisse ferait mélanger les devises en silence. La devise appartient plutôt au cheval (ou au compte) : une pension se paie dans une monnaie. La colonne existe déjà, donc peu cher à déplacer. | S |
| **M3** | **Doublon de chip « Balade à pied ».** `activities` contient une ligne dont le `label` est `"baladeApied"` — la *clé* d'une activité intégrée, pas un libellé. `formatWorkActivity` la formate en « Balade à pied », donc deux chips identiques. Cause : `activityChoices` (`posts.ts:144-160`) dédoublonne sur la clé normalisée du libellé **formaté** pour les intégrées (`"balade a pied"`) et du libellé **brut** pour les personnalisées (`"baladeapied"`). `matchActivity` a le même biais, donc retaper la même chose recréerait un doublon. → normaliser les deux côtés via `formatWorkActivity`. Cause racine : §4.2. | S |
| **M4** | **Colonnes inatteignables.** `Post.time` est `null` sur les 113 lignes vivantes (les 4 qui en portaient une sont les posts de démo, tous supprimés) et aucune catégorie ne déclare de contrôle d'heure — `postFields` fait `time: existing?.time ?? null`. `Post.location` : `null` partout. `Post.recurrenceId` : `null` partout. `StoredDocument.driveFileId`/`driveSyncedAt` : écrits `null`, jamais lus. → garder `time`/`location`/`recurrenceId` (un calendrier en aura besoin, et `recurrenceId` est au cœur de §3.4) ; couper les deux colonnes Drive. | S |
| **M5** | **Tombstones jamais purgés.** 12 posts supprimés sur 125, croissance sans borne. Sans conséquence avant des décennies, et la purge ne devient *sûre* qu'après la sync (il faut la dernière synchro du plus ancien appareil). À noter, pas à faire. | — |
| **M6** | **Données personnelles réelles dans le bundle.** `account.ts:19-23` porte un prénom, un nom et une adresse e-mail réels ; `categories.ts` porte deux `defaultValue` qui sont des noms de praticiens. Le commentaire d'`account.ts` prévoit déjà le retrait et `seedProfileIfEmpty` a fait le travail côté profil — mais les deux sauvegardes ont `profiles: []`, donc **vérifier sur l'appareil que la ligne existe avant de vider `ACCOUNT`**. Les deux `defaultValue` n'ont pas d'équivalent : à vider, en laissant le combobox de §3.2 S5(b) faire le travail. Pour une app publiquement déployée qui doit s'ouvrir, ce sont trois personnes identifiables livrées dans le JS de chaque visiteur. | S |

*(Au passage, non corrigé parce que la copie d'interface n'est pas du ressort de
cet audit : `counterpartyField("Practicien", …)` sur `dentiste` — « Praticien ».)*

### 3.4 Récurrence : occurrences matérialisées, et une règle qui les *génère*

**Mesuré** — 12 lignes `pension`, saisies à la main, `recurrenceId = null`
partout :

```
2025-10-31  120,12 €   ← prorata du mois d'arrivée
2025-11-04  182,00 €  …  2026-08-04  182,00 €
2026-09-01  182,00 €   ← pas le 4
```

**Une `RRULE` expansée à la lecture ne peut pas représenter ces données** : le
premier mois a un montant différent, le dernier une date différente. Il faudrait
des lignes d'exception — et on est reparti sur des occurrences matérialisées, en
plus de la règle. Deux autres raisons : le budget a besoin d'un montant *par
occurrence* (c'est un grand livre, pas une prévision), et une occurrence
expansée n'a pas de ligne à indexer, donc elle sort de `[horseId+date]`.

1. **Maintenant, zéro schéma** — un bouton « Répéter » qui clone la ligne avec
   la date avancée d'un mois (`addMonths` existe, avec le clamp de fin de mois)
   et le curseur dans le champ montant. Le 80/20 exact.
2. **Plus tard, si un cours hebdomadaire arrive** — une table `recurrences`
   (`{ id, horseId, categoryKey, rrule, from, until, template }`) qui **génère**
   des lignes `posts` groupées par `recurrenceId`, et qui n'est jamais la source
   de vérité de ce qui a eu lieu. La colonne `recurrenceId` existe déjà et c'est
   exactement ce à quoi elle sert : **la garder**.
3. **Jamais** — une `RRULE` sur `Post` expansée au rendu. Ça marche pour un
   agenda pur, pas pour un agenda qui est aussi un grand livre.

---

## 4. Cohérence des noms

Objectif : supprimer la dette des premières versions (POC/MVP), où le formulaire
*était* le modèle. Deux catégories qui ne coûtent pas la même chose :

- **Renommages de stockage** → une migration, à regrouper avec §6.
- **Renommages de code** → aucune migration, validés entièrement par le
  typecheck, livrables à tout moment et indépendamment.

### 4.1 `amountCents` — trois problèmes empilés, le suffixe est le moins grave

**Stockage · 95 occurrences / 21 fichiers**

1. **C'est un id de champ de formulaire qui sert de clé de stockage.**
   `amountCents` vit simultanément dans `Category.fields[].id` (un identifiant
   de contrôle), dans `Post.customFields` (le stockage) et dans `budget.ts` (la
   lecture métier). C'est *ça*, la dette MVP : à l'époque, le formulaire **était**
   le modèle. §3.1 S1 dit la même chose par l'autre bout — c'est le même
   changement.
2. **`amount` est le mauvais mot métier.** Ce que ça contient, c'est ce que la
   chose a **coûté** : une pension, un achat, une ferrure, un cours. « Montant »
   est ce qu'on écrit quand on ne sait pas encore ce que c'est. **`cost`** se lit
   juste dans les quatorze catégories.
3. **Le suffixe `Cents` est à défendre — mais pas dans le nom.** Il empêche une
   vraie classe de bug (`cost: 19.00` au lieu de `1900`), et tout `money.ts` est
   en centimes (`toCents`, `fromCents`, `formatCents`, `sumCents`). Le supprimer
   sec rendrait le seul entier de l'app qui ne doit jamais être un flottant
   indiscernable d'un flottant. La sortie propre : mettre l'unité dans le
   **type**, exactement comme `IsoDate`/`IsoTimestamp` le font pour les dates.

```ts
/** Un montant en centimes entiers. Jamais un flottant — voir `money.ts`. */
export type Cents = number;

// sur Post, comme colonne (§3.1 S1) :
cost: Cents | null;
```

Même convention que `IsoDate = string` : documentaire, pas branded. Si tu veux
des dents (`number & { readonly __cents: unique symbol }`), c'est une ligne de
plus, mais ça sortirait du style du fichier.

**→ `customFields.amountCents` devient `Post.cost: Cents | null`.**

### 4.2 Les autres

| Prio | Constat | Type | Ampleur |
|---|---|---|---|
| 🔴 | **`sireNumber` / `sireName` ne parlent pas de la même chose.** `sireName`/`damName` sont une paire correcte (père/mère). `sireNumber` est le **numéro SIRE**, le registre national — **rien à voir avec le père**, homographe pur. Trois champs qui se ressemblent, dont deux forment une paire et le troisième est un faux ami posé entre les deux. C'est le champ que quelqu'un « rangera » un jour en `sire: { number, name }` en corrompant les données. → **`nationalId`**, avec le commentaire « numéro SIRE » conservé. | stockage | 16 occ. / 12 fich. |
| 🟠 | **Trois noms pour une même chose le long du pipeline.** `Category.fields` → `PostInput.values` → `Post.customFields` : la définition, la réponse et le stockage de la même notion sous trois mots. Et « custom » est relatif à quoi ? Ce sont les champs déclarés par la catégorie. → `fields` → `answers` → `answers`. | stockage | 183 occ. / 33 fich. |
| 🟠 | **`order` vs `sortOrder`.** `Category.order` et `RationItem.sortOrder` sont le même concept sous deux noms dans deux tables. `order` est en plus un mot réservé SQL, ce qui piquera au moment du backend. → `Category.order` → `sortOrder`. | stockage | faible |
| 🟠 | **`counterparty`** — vocabulaire de finance pour « le véto / la boutique / le coach ». L'UI dit « Praticien », « Site », « Coach ». Un seul id pour trois libellés est le **bon** design ; c'est le mot qui est emprunté ailleurs. → **`contact`**, qui est ce que ça est et ce que s'appellera la table le jour où elle existera (§3.2 S5c). À faire dans la même migration que la fusion `coach` → `counterparty`, sinon le champ est migré deux fois. | stockage | 74 occ. / 13 fich. |
| 🟡 | **Le même problème résolu deux fois, de deux façons.** `Event` et `Document` sont tous deux des globales DOM. Pour `Document`, le code a préfixé (`StoredDocument`). Pour `Event`, il a renommé le concept (`HorseEvent` → `Post`). Deux stratégies pour un problème identique, et `Post` a dérivé loin du domaine : l'UI dit « évènement » et « activité », le code dit « post », mot de CMS. **Recommandation : ne pas y toucher** — 258 occ. / 43 fichiers, le renommage a été payé il y a trois semaines (`56f2fca`, schéma v13), et le gain est purement lexical. *Ce qui ferait changer d'avis :* si ces 43 fichiers s'ouvrent de toute façon pour autre chose. Dans ce cas `Entry` / `entries` est le mot juste (registre *et* calendrier, pas de collision DOM) et `StoredDocument` devient `StoredEntry`, ou l'inverse — à trancher une fois. | code | 258 occ. / 43 fich. |
| 🟡 | **`add` vs `create`.** Trois repositories créent avec `add` (`activities`, `categories`, `rations`), trois avec `create` (`horses`, `posts`, `documents`). Il y a peut-être une règle cachée (catalogue/enfant → `add`, entité → `create`) et elle n'est écrite nulle part ; sinon c'est de la dérive. → l'écrire dans `AGENTS.md`, ou prendre un mot. Même remarque pour `categoriesRepo.listAll` vs `horsesRepo.list`, qui sont la même chose. | code | faible |
| 🟡 | **Le nœud « activité » — neuf noms pour un concept** : `ActivityItem`, `WorkActivity`, `BuiltInActivity`, `WORK_ACTIVITIES`, `activityChoices`, `matchActivity`, `formatWorkActivity`, `WorkSession`, `workSessionByDate`. Les deux qui font mal sont les premiers : `ActivityItem` est le *catalogue*, `WorkActivity` est la *valeur stockée*, et rien dans les noms ne le dit. → `ActivityItem` → `ActivityTag` (ou `ActivityChoice`). C'est aussi la cause racine de §3.3 M3 : une *clé* rangée comme un *libellé*, parce que `WorkActivity = BuiltInActivity \| (string & {})` fait cohabiter les deux sans moyen de les distinguer. | code | 15 + 47 occ. |
| 🟡 | **Petits.** `BASE_FIELD_IDS = {title, date, notes}` ne veut pas dire « colonnes » (`horseId`, `status`, `currency`, `time`, `location` en sont aussi) mais « colonnes que le formulaire peut écrire » → `FORM_COLUMN_IDS`. Préfixes booléens de `Category` : `isBuiltIn`, `isAppointment`, `tracksWork`, `enabled` — quatre champs, trois conventions. `visible()` (posts.repo) / `enabledOf` / `hiddenKeys` (categories) : trois mots pour un filtre. | code | faible |

---

## 5. Ouverture — multi-chevaux, multi-utilisatrices, sync

### 5.1 Déjà en place, et bien fait

`ownerId` + `createdAt`/`updatedAt`/`deletedAt` sur les 7 tables. `horseId` sur
les 4 tables enfants, avec `getActive()` comme seule source de « quel cheval » —
**aucune vue ne code un id en dur**. UUID clients. Un format de sauvegarde
versionné qui fusionne idempotemment : déjà 80 % d'un protocole de sync *pull*.

### 5.2 À faire maintenant (cher plus tard)

**O1 — Aucune requête ne filtre sur `ownerId`.** *Effort S · à faire tôt.*
`ownerId` est écrit par `createRecord` et lu par exactement deux endroits :
`untouchedSeed` (une comparaison) et `exportBackup` (l'enveloppe). **Zéro
`where("ownerId")` dans tout le dépôt.** Or `horsesRepo.list()` fait
`orderBy("name").toArray()`, `profileRepo.get()` fait `toArray()`,
`categoriesRepo.listAll()` fait `toArray()`. Le jour où une base locale contient
deux propriétaires (restauration partielle, appareil partagé, bug de sync), ces
trois requêtes mélangent tout. Coût maintenant : trois filtres toujours vrais.
Coût plus tard : une fuite entre comptes. **C'est un invariant qu'on ne peut
plus tester une fois qu'il est faux** — poser le filtre et son test pendant
qu'il est trivialement vérifiable.

**O2 — Les catégories intégrées ont un `id` déterministe** (`"achat"`,
`"veto"`, …). *Effort L · à décider avant la sync.* C'est le bon choix pour que
deux appareils convergent sans se parler (`categories.ts:555-563` l'explique
bien) et le mauvais pour une table serveur partagée : deux utilisatrices
écriraient toutes les deux `categories.id = "achat"`. Deux sorties — (a) la clé
primaire serveur devient `(ownerId, id)` ; (b) appliquer §3.2 S8 et sortir les
intégrées de la table synchronisée. **(b) recommandé**, qui résout les deux.

**O3 — `updatedAt` est l'horloge murale de l'appareil.** *Effort S le jour
venu · la décision est à prendre avant d'écrire la sync.* `nowISO()` =
`new Date().toISOString()`. Pour une restauration depuis un fichier avec un
appareil actif, c'est correct et c'est ce que le code prétend. Pour deux
appareils actifs, une horloge décalée de trois minutes fait gagner la mauvaise
écriture, en silence — et le LWW est **par ligne**, donc deux appareils éditant
deux champs différents du même post en perdent un. La migration elle-même est
triviale (`version = 1` partout), donc rien à faire maintenant ; mais trancher
avant : soit le serveur assigne un numéro de version monotone par ligne, soit
une horloge logique (HLC) côté client. **Serveur recommandé** — il n'y en aura
qu'un, il a une horloge fiable, et ça évite de confier au client hors ligne un
concept qu'il gère mal.

**O4 — Multi-chevaux : le schéma est prêt, un chemin d'écriture ne l'est pas.**
`horsesRepo.remove` **n'a aucun appelant**, donc aucune cascade n'existe. Le jour
où l'UI permet de supprimer un cheval, il faut un `horsesService.deleteHorse(id)`
transactionnel sur `posts`/`documents`/`documentBlobs`/`rationItems`/
`activities` — même forme que `categoriesRepo.remove`. Et `profiles` est lue
comme « la ligne vivante la plus récente » plutôt que par id
(`profile.repo.ts:14-21`) : correct pour une utilisatrice, cassé au premier
multi-compte sur un appareil.

**O5 — Entités partageables (véto, maréchal, moniteur, catalogue produits) :
non, pas d'entité dédiée maintenant.** Voir §3.2 S5. Le bon moment, c'est quand
deux utilisatrices distinctes ont le même maréchal *et* qu'on veut leur montrer
quelque chose de commun. Ce qui est urgent, c'est d'arrêter la dérive
orthographique.

### 5.3 Peut attendre

La sync elle-même (le format de sauvegarde en est le brouillon). La purge des
tombstones (M5). La devise (M2). Les chevaux partagés entre comptes (une table
`horse_members`) : ne rien construire, mais **ne pas disperser la règle
d'accès** — aujourd'hui `horsesRepo.list()` est le seul endroit qui décide quels
chevaux sont visibles ; garder ça vrai.

---

## 6. Schéma cible et migration v13 → v14

Le changement le plus important n'est pas dans le tableau : c'est la **règle**.
*Un champ sort de `answers` le jour où autre chose que son propre affichage en
dépend.* Aujourd'hui elle désigne exactement deux champs.

```ts
// db.ts — v14
const STORES = {
  horses:        "id, ownerId, name, updatedAt",
  posts:         "id, [horseId+date], updatedAt",
  documents:     "id, horseId, postId, updatedAt",
  documentBlobs: "documentId",
  rationItems:   "id, [horseId+sortOrder], updatedAt",
  activities:    "id, horseId, updatedAt",
  categories:    "id, ownerId, updatedAt",
  profiles:      "id, ownerId, updatedAt",
  meta:          "key",
} as const;
```

| Store | Index | Changements de champs | Justification |
|---|---|---|---|
| `horses` | `ownerId`, `name`, `updatedAt` | `sireNumber` → `nationalId` | `ownerId` : O1. §4.2 |
| `posts` | `[horseId+date]`, `updatedAt` | **+ `cost: Cents \| null`**, **+ `endDate: IsoDate \| null`**, `status` → `statusOverride`, `customFields` → `answers`, `answers.coach` fusionné dans `answers.contact` | S1, S4, S5a, §4.1, §4.2. `horseId` seul retiré (redondant avec le compound) ; `date`/`categoryKey`/`status`/`[horseId+categoryKey]` retirés (S9) |
| `documents` | `horseId`, `postId`, `updatedAt` | `driveFileId`/`driveSyncedAt` supprimés ; `postId` nullable *par intention* | M4, S6. `category`/`[horseId+category]` retirés : `countByCategory` compte en mémoire |
| `documentBlobs` | — | inchangé | 1:1, accès par clé. Le blob reste hors de la table de métadonnées |
| `rationItems` | `[horseId+sortOrder]`, `updatedAt` | inchangé | **S3 se fait sans changement de schéma.** `horseId` seul retiré |
| `activities` | `horseId`, `updatedAt` | inchangé | Catalogue lu en entier, trié en mémoire |
| `categories` | `ownerId`, `updatedAt` | `order` → `sortOrder` ; `coach` retiré de `cours.fields` ; `cost`/`endDate` ajoutés à `FORM_COLUMN_IDS` | §4.2, S5a. `key`/`order` retirés (S9) ; `ownerId` : O1 |
| `profiles` | `ownerId`, `updatedAt` | inchangé | Une ligne en pratique ; `ownerId` : O1 |
| `meta` | — | inchangé | État local d'appareil, jamais exporté. Bon choix |

**Ce qui n'est délibérément pas fait** : table `contacts` (S5c), table
`recurrences` (§3.4), journal d'administration (S4), `validFrom`/`validTo` sur
`rationItems` (S3 obtient l'historique gratuitement), colonne `version` (O3),
refonte de `categories` (S8), renommage de `Post` (§4.2). Chacun serait de la
machinerie pour un état qui n'existe pas encore, et le schéma actuel les rend
tous possibles sans migration douloureuse.

### 6.1 Règle : chaque changement de schéma est **deux** migrations

L'appareil (`db.ts` + `.upgrade()`) **et** le fichier (`backup/migrate.ts`
`STEPS[13]`), parce qu'une sauvegarde n'est pas un appareil et ne passe jamais
par `onupgradeneeded`. `migrate.ts:39-41` l'exige déjà.

### 6.2 Étape 0 — avant de toucher à quoi que ce soit

Exporter une sauvegarde, la copier **ailleurs que sur le téléphone**, et
vérifier qu'elle se relit (la réimporter : l'import est idempotent,
`snapshot.real-backup.test.ts:130` le teste). Les deux fichiers de `./backup/`
deviennent des fichiers v13 que le nouveau build devra migrer à la lecture — ils
sont donc le jeu de test, et `snapshot.real-backup.test.ts` le harnais.

### 6.3 Côté appareil — `db.ts`

```ts
export const SCHEMA_VERSION = 14;

/**
 * Le schéma tel qu'un appareil v13 le porte. Déclaré non pas pour ressusciter
 * la chaîne supprimée en a58b66d, mais parce qu'un `.upgrade()` a besoin de son
 * unique prédécesseur pour que Dexie diffe les stores.
 */
const STORES_V13 = {
  horses: "id, name, updatedAt",
  posts:
    "id, horseId, date, categoryKey, status, [horseId+date], [horseId+categoryKey], updatedAt",
  documents: "id, horseId, postId, category, [horseId+category], updatedAt",
  documentBlobs: "documentId",
  rationItems: "id, horseId, [horseId+sortOrder], updatedAt",
  activities: "id, horseId, updatedAt",
  categories: "id, key, order, updatedAt",
  profiles: "id, updatedAt",
  meta: "key",
} as const;

constructor() {
  super("lady-gestion");
  this.version(13).stores(STORES_V13);
  this.version(SCHEMA_VERSION).stores(STORES).upgrade(upgradeV13toV14);
}
```

```ts
/**
 * v13 -> v14 : ce qui était structurel quitte le sac pour une colonne, et les
 * noms hérités du formulaire prennent ceux du domaine.
 *
 * `cost` et `endDate` sont structurels — l'un décide de l'appartenance au
 * budget, l'autre des jours qu'une cure occupe au calendrier — et le sac ne
 * peut ni les typer, ni les valider, ni les indexer. Deux lignes `cures` le
 * prouvent déjà : elles portent un `duration` d'une définition disparue, donc
 * aucune date de fin, donc elles se lisent comme des cures en cours sans fin.
 *
 * `duration` est **laissé dans le sac**. C'est la donnée de l'utilisatrice, et
 * « 3 semaines » depuis une date de début n'est pas convertible en date de fin
 * sans inventer la moitié de l'information — `assertRows` garde délibérément
 * les clés que plus aucune catégorie ne déclare, pour cette raison exacte.
 */
const upgradeV13toV14 = async (tx: Transaction): Promise<void> => {
  await tx.table("posts").toCollection().modify((post: Record<string, unknown>) => {
    const bag = (post.customFields ?? {}) as Record<string, unknown>;

    const amount = bag.amountCents;
    post.cost = typeof amount === "number" ? amount : null;
    delete bag.amountCents;

    const end = bag.endDate;
    post.endDate = isIsoDate(end) ? end : null;
    delete bag.endDate;

    // Un seul id pour « avec qui », ce que la recherche de PostsView cherche
    // déjà. Ne recouvre jamais une valeur existante.
    const contact = bag.counterparty ?? bag.coach ?? null;
    bag.contact = typeof contact === "string" ? contact : null;
    delete bag.counterparty;
    delete bag.coach;

    // « À venir » et « fait » sont une lecture de la date. `cancelled` est le
    // seul état qu'aucune date ne redérive.
    post.statusOverride = post.status === "cancelled" ? "cancelled" : null;
    delete post.status;

    post.answers = bag;
    delete post.customFields;
  });

  await tx.table("horses").toCollection().modify((horse: Record<string, unknown>) => {
    // `sireNumber` est le numéro SIRE, pas le nom du père : l'homographe est
    // exactement ce que ce renommage supprime.
    horse.nationalId = horse.sireNumber ?? null;
    delete horse.sireNumber;
  });

  await tx.table("categories").toCollection().modify((type: Record<string, unknown>) => {
    type.sortOrder = typeof type.order === "number" ? type.order : 0;
    delete type.order;
  });

  // M4 : deux colonnes d'une intégration Drive qui n'existe pas.
  await tx.table("documents").toCollection().modify((doc: Record<string, unknown>) => {
    delete doc.driveFileId;
    delete doc.driveSyncedAt;
  });
};
```

Les index morts (S9) n'ont besoin d'aucun code : Dexie applique le diff de
`stores()` avant `upgrade()`, donc ils disparaissent sans que la donnée soit
touchée.

### 6.4 Côté fichier — `backup/migrate.ts`

Même pas, en pur, **et rejouable** (contrat de `migrate.ts:31-34`). Le piège :
la version appareil ne peut pas se rejouer (les versions IDB sont monotones), la
version fichier oui — un fichier à moitié migré par un autre build doit
converger, donc on ne recalcule que ce qui manque.

```ts
const migrateV13toV14: MigrationStep = (tables) => ({
  ...tables,
  posts: (tables.posts ?? []).map((row) => {
    const post = row as Record<string, unknown>;
    const bag = { ...((post.answers ?? post.customFields ?? {}) as Record<string, unknown>) };

    // Rejouable : une ligne déjà migrée porte la colonne et n'a plus la clé
    // dans le sac. Relire le sac recalculerait `null` et effacerait la valeur.
    const cost = "cost" in post ? post.cost
      : typeof bag.amountCents === "number" ? bag.amountCents : null;

    const endDate = "endDate" in post ? post.endDate
      : isIsoDate(bag.endDate) ? bag.endDate : null;

    if (!("contact" in bag)) {
      const contact = bag.counterparty ?? bag.coach ?? null;
      bag.contact = typeof contact === "string" ? contact : null;
    }
    for (const key of ["amountCents", "endDate", "counterparty", "coach"]) delete bag[key];

    const statusOverride = "statusOverride" in post ? post.statusOverride
      : post.status === "cancelled" ? "cancelled" : null;

    const { status: _s, customFields: _c, ...rest } = post;
    return { ...rest, cost, endDate, statusOverride, answers: bag };
  }),
  horses: (tables.horses ?? []).map((row) => {
    const horse = row as Record<string, unknown>;
    const nationalId = "nationalId" in horse ? horse.nationalId : (horse.sireNumber ?? null);
    const { sireNumber: _n, ...rest } = horse;
    return { ...rest, nationalId };
  }),
  categories: (tables.categories ?? []).map((row) => {
    const type = row as Record<string, unknown>;
    const sortOrder = "sortOrder" in type ? type.sortOrder
      : typeof type.order === "number" ? type.order : 0;
    const { order: _o, ...rest } = type;
    return { ...rest, sortOrder };
  }),
  documents: (tables.documents ?? []).map((row) => {
    const { driveFileId: _f, driveSyncedAt: _s, ...rest } = row as Record<string, unknown>;
    return rest;
  }),
});

const STEPS: Partial<Record<number, MigrationStep>> = { 13: migrateV13toV14 };
```

### 6.5 `ROW_RULES` — sinon le validateur exige encore `status`

```ts
// snapshot.ts:347
posts: {
  horseId: isString, categoryKey: isString, title: isString, date: isString,
  currency: isString,
  statusOverride: nullable(isString),   // remplace `status: isString`
  cost: nullable(isNumber),             // nouveau — c'est de l'argent
  endDate: nullable(isString),          // nouveau
  time: nullable(isString), notes: nullable(isString),
  location: nullable(isString),
  answers: isScalarBag,                 // renommé depuis `customFields`
},
horses: { name: isString, sex: isString },
categories: {
  key: isString, label: isString, enabled: isBoolean,
  sortOrder: isNumber,                  // renommé depuis `order`
  fields: isArray, parentId: nullable(isString), isBuiltIn: isBoolean,
},
```

### 6.6 Tests, avant de livrer

Le contrat de `migrate.ts:41` : *« give it a test that runs it twice and asserts
the second run changes nothing »*. Et faire tourner
`snapshot.real-backup.test.ts` contre les deux fichiers réels : 125 posts, dont
les 2 `duration`, le 1 `coach`, les 7 `planned` passés et les 12 tombstones. Si
le round-trip n'est pas exact, s'arrêter là.

### 6.7 Côté code applicatif

Ajouter `"cost"` et `"endDate"` à `FORM_COLUMN_IDS`, faire router `postFields`
vers les colonnes, remplacer les lectures de `customFields.amountCents`
(`posts.repo.ts:110,124`, `budget.ts:88`) et `customFields.endDate`
(`posts.ts:344`) par les colonnes, et introduire `statusOf(post, today)` partout
où `post.status` est lu. **Le typecheck fait la liste** — c'est précisément
pourquoi `PostFields` est dérivé de `Post` par `Omit` (`posts.service.ts:93`) :
une colonne ajoutée est une erreur de compilation dans la fonction qui doit
décider quoi mettre dedans.

---

## 7. Ce qui est bien conçu — à ne pas casser en nettoyant

Ce document est une liste de problèmes ; elle donnerait une fausse impression
sans celle-ci. Le schéma est nettement meilleur que la moyenne d'un premier
modèle de données, et plusieurs décisions sont à protéger explicitement pendant
le nettoyage.

1. **Une seule table `posts`, et tout en est dérivé.** Les événements **ne sont
   pas dupliqués**, ni dérivés des cures/traitements/cours : il n'y a qu'une
   source, et le calendrier, le budget, le tableau de bord et la fiche cheval
   sont quatre lectures de la même ligne. Une visite de maréchal est une ligne
   qui a une date *et* un prix. La version éclatée (table événements + table
   budget) obligerait à saisir la visite deux fois et à la recoller dans chaque
   agrégat. Les cures s'étendent sur plusieurs jours sans aucune ligne
   supplémentaire : `courseLastDay` les transforme en barres au rendu
   (`PostsView.ts:210`).
2. **UUID v4 clients** (`ids.ts`). La décision la plus chère à reprendre —
   renuméroter des clés étrangères après coup, hors ligne, sur des données
   réelles — prise correctement dès le départ.
3. **Centimes entiers** (`money.ts`), `Math.round` à l'entrée, un seul parseur
   (`forms.ts:137` route vers `toCents`). Vérifié sur les 95 montants réels :
   **aucun non-entier**.
4. **Séparation date calendaire / horodatage** (`dates.ts:1-13`). Toute
   l'arithmétique passe par des `Date` à minuit local puis ressort en chaîne,
   donc aucun fuseau ne peut fuir dans une valeur stockée ; `daysBetween` compte
   sur des minuits UTC pour ne pas perdre une heure au changement d'heure. Le
   genre de détail qui produit des bugs une fois par an, impossibles à
   reproduire — réglé.
5. **`RationSeason` = deux numéros de mois, pas deux dates**, avec gestion
   explicite du passage d'année (`seasons.ts:80-84`). Stocker
   `2025-10-01`/`2026-04-30` rendrait la ligne silencieusement fausse le 1er mai.
   Même raisonnement pour `FollowUpInterval` (montant + unité, pas un nombre de
   jours).
6. **La période budgétaire comme préfixe de date** (`budget.ts:18-24`) :
   `'2026-01'`, testé par `startsWith`. Exact, sans `Date`, insensible au fuseau.
7. **`RECORD_TABLES` comme source unique** (`db.ts:117`), d'où dérivent
   l'export, la fusion, le validateur, la purge de seed *et* le type
   `BackupTables`. « La table qu'on oublie, c'est la donnée qui ne survit pas à
   une restauration » est le bon diagnostic.
8. **`importBackup` en une seule transaction** (`snapshot.ts:132-153`), avec les
   compteurs *dans* le callback parce que Dexie peut rejouer, et le cache
   `owner.ts` mis à jour **après** le commit parce que c'est le seul état qu'un
   rollback ne défait pas.
9. **`yieldsToFile`** (`snapshot.ts:88-104`) : « une installation n'est pas un
   choix et ne doit pas outrepasser un choix ». Le bon raisonnement sur le bon
   problème, énoncé par table plutôt qu'en `if (name === "categories")`.
10. **`navigator.storage.persist()` est appelé** (`pwa/index.ts:143-152`), avec
    la bonne justification et le bon silence sur l'échec.
11. **`suggestions: "activities"`** — un catalogue qui n'est *pas* une table
    parent : un post stocke le libellé, pas un id, donc supprimer une ligne du
    catalogue retire un chip et n'orpheline rien. C'est le motif que S5(b)
    recommande d'étendre aux contacts.
12. **Plafond de profondeur à 2 sur `categories`**, avec `canBeParentOf` comme
    unique prédicat et la cyclicité rendue *irreprésentable* plutôt que détectée
    (`categories.ts:727-741`). Et `BudgetSlice.children: BudgetLeaf[]` qui
    exprime ce plafond dans le type.
13. **`backup/migrate.ts` existe, vide, avec son contrat écrit.** Dire *avant*
    d'en avoir besoin qu'un pas doit être pur et rejouable est ce qui fait que
    §6 est un pas + un test plutôt qu'une réécriture sous pression.
14. **`snapshot.real-backup.test.ts`** : un test qui tourne contre les vraies
    données, se `skip` honnêtement quand il n'y en a pas, et dont l'un des cas
    est « garde une clé que plus aucune catégorie ne déclare ». Le seul test du
    dépôt qui peut dire « cette règle rejette une ligne qu'elle a réellement ».

---

## 8. Tableau de priorisation

Tout est à `[ ]` : rien n'est engagé. Les lots sont indépendants sauf indication.

### Lot A — sans schéma, livrable immédiatement, aucun risque de données

| | Réf | Quoi | Effort |
|---|---|---|---|
| `[ ]` | S3 | Historique des rations : remplacer au lieu de modifier | S |
| `[ ]` | S6 | `deletePost` transactionnel + réparer le document orphelin existant | S |
| `[ ]` | S7 | `seedIfEmpty` dans une transaction | S |
| `[ ]` | S5b | `counterparty` en combobox à suggestions (arrête la dérive) | S |
| `[ ]` | M1 | `db.on("blocked")` / `db.on("versionchange")` | S |
| `[ ]` | M3 | Dédoublonnage des chips d'activité | S |
| `[ ]` | M6 | Vider `ACCOUNT` et les deux `defaultValue` — **après** avoir confirmé la ligne `profiles` sur l'appareil | S |
| `[ ]` | O1 | Filtres `ownerId` + leur test | S |

### Lot B — une seule montée v13 → v14 (§6)

Tout ce qui touche le stockage part ensemble : chaque bump est un risque sur une
base irremplaçable, et il ne faut pas en faire trois.

| | Réf | Ancien | Nouveau |
|---|---|---|---|
| `[ ]` | S1 + §4.1 | `customFields.amountCents` | colonne `cost: Cents \| null` |
| `[ ]` | S1 | `customFields.endDate` | colonne `endDate: IsoDate \| null` |
| `[ ]` | S4 | `status` | `statusOverride: PostStatus \| null` |
| `[ ]` | S5a + §4.2 | `customFields.coach`, `customFields.counterparty` | `answers.contact` |
| `[ ]` | §4.2 | `customFields` | `answers` |
| `[ ]` | §4.2 | `Horse.sireNumber` | `Horse.nationalId` |
| `[ ]` | §4.2 | `Category.order` | `Category.sortOrder` |
| `[ ]` | S9 + M4 | 14 index morts, `driveFileId`/`driveSyncedAt`, docblock faux | supprimés / corrigé |
| `[ ]` | O1 | — | index `ownerId` sur `horses`, `categories`, `profiles` |
| `[ ]` | §6.6 | — | test de rejouabilité + `snapshot.real-backup.test.ts` au vert |

### Lot C — renommages code seulement, zéro migration, validés par le typecheck

| | Réf | Quoi | Ampleur |
|---|---|---|---|
| `[ ]` | §4.2 | `ActivityItem` → `ActivityTag` | 15 occ. |
| `[ ]` | §4.2 | `BASE_FIELD_IDS` → `FORM_COLUMN_IDS` | 4 occ. |
| `[ ]` | §4.2 | Unifier `add`/`create` et `list`/`listAll`, ou écrire la règle dans `AGENTS.md` | faible |
| `[ ]` | §4.2 | Unifier `visible`/`enabledOf`/`hiddenKeys` | faible |
| `[ ]` | §4.2 | *(optionnel, non recommandé seul)* `Post` → `Entry` | 258 occ. / 43 fich. |

### Lot D — reporté, mais la décision se prend avant le code

| | Réf | Quoi | Quand |
|---|---|---|---|
| `[ ]` | §1 | Supprimer les gardes API Navigation + ancrage CSS | quand tu veux |
| `[ ]` | S2 | Blobs dans la sauvegarde | **avant** de livrer l'upload de documents |
| `[ ]` | S8 + O2 | Sortir les catégories intégrées de la table synchronisée | **avant** d'écrire la sync |
| `[ ]` | O3 | Choisir l'horloge (version serveur vs HLC) | **avant** d'écrire la sync |
| `[ ]` | O4 | `horsesService.deleteHorse` transactionnel | quand l'UI multi-chevaux arrive |
| `[ ]` | §3.4 | Bouton « Répéter » (zéro schéma) puis table `recurrences` | quand la saisie manuelle pèse |
| `[ ]` | M2 | Devise sur le cheval plutôt que par ligne | avec le multi-utilisateur |
| `[ ]` | S5c | Table `contacts` | quand deux utilisatrices partagent un praticien |
| `[ ]` | M5 | Purge des tombstones | après la sync |

---

## Sources (plancher navigateur)

[Chrome 143](https://developer.chrome.com/release-notes/143) ·
[cycle de deux semaines Chrome](https://developer.chrome.com/blog/chrome-two-week-release) ·
[Safari 26.2](https://developer.apple.com/documentation/safari-release-notes/safari-26_2-release-notes) ·
[Safari 27](https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes) ·
[Firefox 147 (dev)](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/147) ·
[nouvelle cadence Firefox](https://blog.mozilla.org/sumo/2026/08/19/firefox-new-release-cadence-and-what-to-expect/) ·
[API Navigation Baseline](https://www.infoq.com/news/2026/05/navigation-api-browser/)
