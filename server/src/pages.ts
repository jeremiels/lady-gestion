/**
 * The two public pages Google asks of an app before it can be published: a
 * home page and a privacy policy. Served by this Worker because its domain is
 * the one already authorised on the consent screen.
 *
 * The policy says what the code does — `drive-auth.ts` and `index.ts` — and
 * has to be kept in step with it.
 */

const APP_URL = "https://jeremiels.github.io/lady-gestion/";
const CONTACT = "jeremie.ls@gmail.com";

const layout = (title: string, body: string): Response =>
  new Response(
    `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body { font: 17px/1.5 system-ui, sans-serif; max-width: 42rem; margin: 0 auto; padding: 24px; color: #2c211b; background: #f5f1ec; }
  h1 { font-size: 26px; }
  h2 { font-size: 19px; margin-top: 28px; }
  a { color: #4a2c17; }
</style>
</head>
<body>
${body}
</body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );

export const homePage = (): Response =>
  layout(
    "ladympala",
    `<h1>ladympala</h1>
<p>Application personnelle de suivi d’un cheval : soins, activités, dépenses,
rations et documents.</p>
<p><a href="${APP_URL}">Ouvrir l’application</a></p>
<p><a href="/confidentialite">Règles de confidentialité</a></p>`,
  );

export const privacyPage = (): Response =>
  layout(
    "Règles de confidentialité — ladympala",
    `<h1>Règles de confidentialité</h1>
<p>Dernière mise à jour : 28 septembre 2026.</p>

<h2>Où sont vos données</h2>
<p>Les informations saisies dans ladympala (cheval, soins, activités, dépenses,
rations) restent sur votre appareil. Elles ne sont envoyées à aucun serveur,
sauf dans les deux cas décrits ci-dessous.</p>

<h2>Google Drive</h2>
<p>Si vous connectez Google Drive, l’application accède aux fichiers du dossier
que vous choisissez : elle les liste, les affiche, et y range les fichiers que
vous ajoutez depuis l’application. Les fichiers passent directement entre votre
appareil et Google ; ils ne transitent pas par nos serveurs.</p>
<p>Pour que la connexion dure, notre serveur conserve, chiffrés, le jeton
d’accès délivré par Google et l’adresse e-mail du compte connecté. Il ne
conserve ni vos fichiers, ni leurs noms, ni leur contenu.</p>
<p>L’utilisation des informations reçues des API Google respecte les
<a href="https://developers.google.com/terms/api-services-user-data-policy">règles
d’utilisation des données utilisateur des services d’API Google</a>, y compris
les exigences d’utilisation limitée.</p>

<h2>Rappels</h2>
<p>Si vous activez les notifications, notre serveur conserve la liste de vos
rappels à venir (date, titre, courte description) jusqu’à leur envoi, pour
pouvoir vous les envoyer à l’heure.</p>

<h2>Partage</h2>
<p>Aucune donnée n’est vendue, partagée ou utilisée à des fins publicitaires.</p>

<h2>Supprimer l’accès</h2>
<p>Vous pouvez déconnecter Google Drive depuis la page Profil de l’application,
ou retirer l’accès à tout moment depuis
<a href="https://myaccount.google.com/permissions">votre compte Google</a>.
Le jeton conservé devient alors inutilisable.</p>

<h2>Contact</h2>
<p><a href="mailto:${CONTACT}">${CONTACT}</a></p>`,
  );
