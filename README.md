# Elegance Barber Shop

Application de réservation du salon Elegance Barber Shop : les clients voient les créneaux libres de chaque barbier et réservent ; l'admin gère tout.

## Lancer l'application

La base de données est **PostgreSQL** sur **Neon** (gratuit).

1. https://neon.tech → créer un projet.
2. **Connect** : copier la chaîne de connexion (`postgresql://…?sslmode=require`).
3. Copier `.env.example` en `.env` et y coller la chaîne dans `DATABASE_URL`.

```bash
npm install
npm start
```

Puis ouvrir http://localhost:3000.

Comptes créés au premier démarrage (changez les mots de passe dans 👤 Compte / ✂️ Équipe) :

| Compte            | Téléphone | Mot de passe |
|-------------------|-----------|--------------|
| Salim — admin     | 20000000  | admin123     |
| Mahmoud — barbier | 20000001  | barber123    |
| Houssem — barbier | 20000002  | barber123    |

## Fonctionnalités

**Client** : compte par numéro de téléphone · créneaux libres par barbier, jour et service · choix d'un style depuis la galerie · annulation / modification jusqu'à 2 h avant · liste d'attente quand c'est complet (notification dès qu'une place se libère) · rappel 1 h avant le RDV · carte fidélité : après 4 coupes, la 5e coupe à -50 % (seuls les services marqués 🎁 comptent : Coupe cheveux, Coupe enfants) · plusieurs services dans un même RDV (ex. Coupe + Barbe).

**Barbier** : planning du jour (Terminé / Absent / Annuler) · ses horaires et sa pause pour chaque jour (🕘 Horaires) · absences · photos dans la galerie.

**Admin** : tout ce que fait un barbier, pour toute l'équipe · offres envoyées en notification à tous les clients · ajout / désactivation de barbiers et horaires de chacun · services, prix, durées et services « fidélité » · liste des clients · statistiques du mois · réglages (nom du salon, jours de fermeture — lundi par défaut, délai d'annulation, rappel, règles de fidélité).

## Données

Tout est dans PostgreSQL : comptes, réservations, services, réglages, **photos** (table `files`) et clés des notifications push. Le serveur ne garde aucun fichier : rien à sauvegarder à part la base (Neon fait des sauvegardes automatiques).

### Reprendre l'ancienne base SQLite

Les données de l'ancienne version (`data/barber.db`, `data/uploads`, `data/vapid.json`) se copient une fois dans PostgreSQL :

```bash
npm run migrate              # refuse si la base contient déjà des comptes
npm run migrate -- --force   # vide la base puis recopie tout
```

## Mise en ligne sur Render

1. Mettre le code sur un nouveau dépôt GitHub.
2. https://dashboard.render.com → **New › Blueprint** → choisir le dépôt : Render lit `render.yaml`.
3. Render demande `DATABASE_URL` : coller la chaîne de connexion Neon.
4. Après le déploiement, l'adresse est `https://elegance-barbershop.onrender.com` (ou proche). Chaque `git push` redéploie.

⚠️ Offre gratuite de Render : le serveur s'endort après 15 min sans visite (premier chargement lent, ~1 min) et, pendant qu'il dort, **les rappels avant RDV ne partent pas**. Pour un vrai salon : offre payante « Starter », ou un service de ping (ex. UptimeRobot toutes les 10 min sur `/api/me`).

Variables d'environnement (ou fichier `.env`) : `DATABASE_URL` (obligatoire), `PORT` (défaut 3000), `VAPID_SUBJECT` (ex. `mailto:vous@exemple.com`), `TZ` (défaut `Africa/Tunis`), `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (facultatif : sinon créées et gardées dans la base).

### Autre possibilité : un VPS (Ubuntu / Debian)

Avec le fichier `.env` sur le PC (il est envoyé avec l'application) :

```powershell
.\deploy\deploy.ps1 -Server root@IP_DU_VPS
```

Le script installe Node.js, un service qui redémarre tout seul et le HTTPS (Caddy). Sans nom de domaine, l'adresse est `https://IP-DU-VPS.sslip.io` ; avec un domaine pointé vers le VPS : `-Domain elegancebarbershop.tn`.

## Application Android (APK)

```powershell
.\android\build-apk.ps1 -Url https://ADRESSE-DU-SITE
```

Crée `public/download/elegance-barbershop.apk` (téléchargeable depuis le site, bouton « Télécharger l'application Android » sur les téléphones Android) et `public/.well-known/assetlinks.json`. Relancez ensuite `deploy.ps1` pour les mettre en ligne.
L'APK ouvre le site en plein écran avec le moteur de Chrome (notifications comprises) : les mises à jour du site arrivent dans l'application sans réinstaller. Il ne faut reconstruire l'APK que si l'adresse du site change.

Nécessite JDK 17 et le SDK Android (Android Studio). **Sauvegardez `android/elegance-barbershop.keystore` et `android/keystore-password.txt`** : sans eux, impossible de publier une mise à jour de l'application.

Sur iPhone, une application native demande un Mac et un compte Apple Developer : en attendant, Safari → Partager → « Sur l'écran d'accueil ».
