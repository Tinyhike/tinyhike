# Procédure : fenêtre de maintenance (apt, PostgreSQL, PostGIS, Node, reboot)

**Préparée le 26 octobre 2026, non exécutée.** Les faits ci-dessous viennent de commandes en lecture seule et d'une simulation `apt-get -s` du 26/10.

> **À lancer par Jérôme depuis sa propre session SSH**, pas depuis Claude. Claude tourne dans la session tmux `tinyhike` de ce serveur, et le reboot la tue. Claude peut faire les vérifications de l'étape 6 dans une nouvelle session, après le redémarrage.

---

## Ce qui va changer

- **66 paquets mis à jour**, 0 nouveau, 0 supprimé. 4 paquets sont différés par le phasing d'Ubuntu (`qemu-guest-agent`, `software-properties-common`, `python3-software-properties`, `ubuntu-virt`) et arriveront seuls plus tard.
- **Noyau** : 7.0.0-38 est déjà installé et deviendra actif au reboot (aujourd'hui 7.0.0-15). `libc6` attend aussi ce reboot.
- **PostgreSQL** 16.14 → 16.15 et **PostGIS** 3.6.3 → 3.6.4, depuis le dépôt pgdg, avec GDAL 3.13, PROJ 9.8, GEOS et libpq 18.6.
- **Node** 22.22.2 → 22.23.4, depuis nodesource.
- **Système** : systemd 259.5 → 259.9, tmux, cloud-init, netplan, apparmor, snapd, ubuntu-pro-client…
- **Aucun de ces paquets n'est un correctif de sécurité Ubuntu** : unattended-upgrades les applique chaque matin. pgdg et nodesource, en revanche, ne sont **jamais** mis à jour automatiquement.
- **Risque de questions interactives : faible.**
  - Aucun fichier de configuration des paquets concernés n'a été modifié localement (`dpkg -V`).
  - Le serveur démarre en EFI (`grub-efi-amd64`), et `grub-pc` n'est pas installé : pas de question sur le disque GRUB.
- **SSH revient seul après le reboot** : `ssh.socket` est activé.

## Durée estimée

| Étape | Durée | Coupure du service |
|---|---|---|
| 1. Sauvegardes + snapshot Hetzner | 10 à 15 min | non |
| 2. Pré-vol | 2 min | non |
| 3. `apt full-upgrade` | 5 à 10 min | quelques secondes au redémarrage de PostgreSQL |
| 4. Reboot | 1 à 2 min | **oui** (le dernier boot a pris 12 s côté OS ; compter la VM et la reconnexion) |
| 5. Mise à jour de l'extension PostGIS | 1 min | non |
| 6. Vérifications | 5 à 10 min | non |
| **Total** | **~30 à 40 min** | **~2 à 5 min** au total |

Un retour arrière complet par snapshot ajoute 15 à 30 minutes.

**Créneau** : un soir (par exemple 21:00). Éviter 06:00-06:45 (apt-daily-upgrade, qui prendrait le verrou dpkg) et 00:00-01:00 (apt-daily, logrotate). Pendant la coupure, Cloudflare affiche une page d'erreur 52x. La PWA garde son shell en cache, mais la carte ne charge plus. Un seul compte existe aujourd'hui, l'impact est donc minime.

---

## 1. Sauvegardes (sans coupure)

```bash
# 1a. Dump de la base (18 Mo en base, ~300 Ko compressé)
cd /tmp && mkdir -p ~/backups   # /tmp : évite l'avertissement « could not change directory » de sudo -u postgres
STAMP=$(date +%Y%m%d-%H%M); echo $STAMP > ~/backups/.maint-stamp   # relu après le reboot
sudo -u postgres pg_dump -Fc -d tinyhike > ~/backups/tinyhike-pre-maint-$STAMP.dump
chmod 600 ~/backups/tinyhike-pre-maint-$STAMP.dump
pg_restore -l ~/backups/tinyhike-pre-maint-$STAMP.dump | grep -cE 'TABLE DATA'   # > 0 : le dump est lisible

# 1b. Photo de l'état actuel, pour comparer après
dpkg -l > ~/backups/dpkg-before-$STAMP.txt
sudo -u postgres psql -d tinyhike -XAt -c 'SELECT (SELECT count(*) FROM "Place"), (SELECT count(*) FROM "Review"), (SELECT count(*) FROM "User"), (SELECT count(*) FROM "PlaceTranslation")' | tee ~/backups/counts-before-$STAMP.txt
# Ce que la carte publique compte (lieux publics sur la bbox par défaut), à comparer après le reboot
curl -sk --resolve app.tinyhike.com:443:127.0.0.1 -o /dev/null -D - \
  'https://app.tinyhike.com/api/places?bbox=4.4,51.8,4.6,51.95&locale=nl&limit=500' | grep -i x-total-count | tee ~/backups/total-before-$STAMP.txt
```

**1c. Copier le dump hors du serveur**, depuis le portable : `scp tinyhike:backups/tinyhike-pre-maint-*.dump .`. Un dump resté sur le même disque ne protège pas d'une perte de la VM. Rappel : aucune sauvegarde automatique de la base n'existe aujourd'hui.

**1d. Snapshot Hetzner** : Console Hetzner → serveur → *Snapshots* → *Create snapshot*. Il peut se prendre serveur allumé, et la base est couverte par le dump. Environ 20 Go utilisés, donc quelques minutes, pour un coût d'environ 0,01 €/Go/mois. **Attendre qu'il soit terminé avant de continuer.** C'est le retour arrière principal. Le supprimer une semaine plus tard.

## 2. Pré-vol

```bash
# Tester le verrou plutôt que les processus : unattended-upgrade-shutdown tourne en permanence
sudo fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock 2>/dev/null && echo "VERROU PRIS, attendre" || echo "aucun verrou apt/dpkg"
sudo apt-get update
apt-get -s full-upgrade | tail -1      # attendu : "66 upgraded, 0 newly installed, 0 to remove, 4 not upgraded" (±)
df -h /                                # 53 Go libres le 26/10
```

**Arrêt si** la simulation annonce des suppressions (`to remove` > 0) ou des paquets inattendus : relire avant d'aller plus loin.

## 3. Mise à jour

```bash
sudo NEEDRESTART_SUSPEND=1 DEBIAN_FRONTEND=noninteractive apt-get -y \
  -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold \
  full-upgrade 2>&1 | tee ~/backups/apt-$STAMP.log
```

- `NEEDRESTART_SUSPEND=1` évite que needrestart relance les services un par un, puisque le reboot suit. Le paquet PostgreSQL redémarre quand même son cluster pendant l'installation, ce qui coupe quelques secondes. L'API continue de tourner sur l'ancien Node en mémoire jusqu'au reboot.
- `--force-confold` garde les fichiers de configuration locaux si un paquet en propose une nouvelle version. Aucun n'est modifié aujourd'hui, c'est un filet de sécurité.

```bash
apt list --upgradable 2>/dev/null      # seulement les 4 paquets différés
cat /var/run/reboot-required.pkgs      # noyau, libc6, systemd…
grep -iE 'error|failed' ~/backups/apt-$STAMP.log | head
```

## 4. Reboot

```bash
sudo systemctl reboot
```

Se reconnecter après environ une minute (`ssh tinyhike`). **Si SSH ne répond pas après 5 minutes** : Console Hetzner → *Console* (VNC) pour voir où bloque le démarrage, puis la section « Retour arrière ».

## 5. Mise à jour de l'extension PostGIS (après le reboot)

Le paquet a remplacé la bibliothèque, mais les objets SQL de l'extension restent en 3.6.3 tant qu'on ne les met pas à jour. On le fait après le reboot, quand toutes les connexions utilisent la nouvelle bibliothèque, et en dernier, car cette étape rend un retour à PostGIS 3.6.3 plus difficile.

```bash
sudo -u postgres psql -d tinyhike -XAt -c "SELECT postgis_full_version();"   # signale "procs need upgrade" si nécessaire
sudo -u postgres psql -d tinyhike -X -c "ALTER EXTENSION postgis UPDATE; ALTER EXTENSION postgis_topology UPDATE;"
sudo -u postgres psql -d tinyhike -XAt -c "SELECT extname || ' ' || extversion FROM pg_extension ORDER BY 1;"   # postgis 3.6.4, postgis_topology 3.6.4
```

`ALTER EXTENSION … UPDATE` ne met à jour que les fonctions de l'extension. Il ne touche ni à la colonne `Place.geom`, ni au trigger `trg_place_geom`, ni à l'index partiel des avis. L'étape 6 le vérifie.

## 6. Vérifications après redémarrage

```bash
STAMP=$(cat ~/backups/.maint-stamp); cd /tmp   # la variable est perdue au reboot

# Système
uname -r                                          # 7.0.0-38-generic
test -f /var/run/reboot-required && echo "REBOOT ENCORE REQUIS" || echo "ok, plus de reboot requis"
systemctl --failed --no-pager                     # 0 unité en échec
for s in postgresql nginx tinyhike-api fail2ban ufw ssh.socket; do printf '%-14s %s\n' $s "$(systemctl is-active $s)"; done
sudo ufw status | head -3                         # active, 22/80/443
sudo fail2ban-client status sshd | tail -3
ss -ltnp                                          # 22, 80, 443, 127.0.0.1:5432, :3000. Rien sur 5173
node -v                                           # v22.23.4
sudo journalctl -b -p err --no-pager | tail -20   # erreurs du boot

# Base
sudo -u postgres psql -d tinyhike -XAt <<'SQL'
SELECT version();                                                                        -- 16.15
SELECT (SELECT count(*) FROM "Place"), (SELECT count(*) FROM "Review"), (SELECT count(*) FROM "User"), (SELECT count(*) FROM "PlaceTranslation");  -- = counts-before
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_place_geom';                           -- 1 ligne
SELECT indexname FROM pg_indexes WHERE indexname = 'Review_one_written_per_user_per_place';  -- 1 ligne
SELECT count(*) FROM "Place" WHERE geom IS NULL;                                         -- 0
SQL
diff <(sudo -u postgres psql -d tinyhike -XAt -c 'SELECT (SELECT count(*) FROM "Place"), (SELECT count(*) FROM "Review"), (SELECT count(*) FROM "User"), (SELECT count(*) FROM "PlaceTranslation")') ~/backups/counts-before-$STAMP.txt && echo "comptages identiques"
cd /srv/tinyhike/api && pnpm exec prisma migrate status    # "Database schema is up to date"

# Application
cd /srv/tinyhike/api && pnpm test                          # tout vert sous le nouveau Node (563 tests au 26/10)
node -e "import('sharp').then(s => console.log('sharp ok', s.default.versions.sharp))"
curl -s http://127.0.0.1:3000/api/health
curl -sk --resolve app.tinyhike.com:443:127.0.0.1 https://app.tinyhike.com/api/health
curl -sk --resolve app.tinyhike.com:443:127.0.0.1 -o /dev/null -D - \
  'https://app.tinyhike.com/api/places?bbox=4.4,51.8,4.6,51.95&locale=nl&limit=500' | grep -i x-total-count   # = cat ~/backups/total-before-$STAMP.txt (1026 le 26/10, depuis le masquage des cafés)
curl -s -A 'Mozilla/5.0' https://app.tinyhike.com/api/health   # à travers Cloudflare
sudo journalctl -u tinyhike-api -b --no-pager | tail -5
```

Enfin, dans un navigateur : ouvrir `https://app.tinyhike.com`, vérifier que la carte charge, puis ouvrir un lieu.

**Plus tard (pas pendant la fenêtre)** :
- supprimer le snapshot Hetzner après une semaine sans problème ;
- `sudo apt autoremove --purge` pour retirer les vieux noyaux (7.0.0-15 et les intermédiaires) une fois le nouveau validé.

---

## Retour arrière, selon le symptôme

| Symptôme | Action |
|---|---|
| **L'API ne démarre plus**, le reste va bien | `sudo journalctl -u tinyhike-api -b`. Si Node est en cause : `sudo apt-get install nodejs=22.22.2-1nodesource1 && sudo apt-mark hold nodejs && sudo systemctl restart tinyhike-api`. Cette version est toujours sur nodesource au 26/10. Retirer le `hold` une fois le problème compris. |
| **PostgreSQL ne démarre plus**, ou se comporte mal | Lire `/var/log/postgresql/postgresql-16-main.log`. Revenir aux versions précédentes, toujours sur apt.postgresql.org au 26/10 : `sudo apt-get install postgresql-16=16.14-1.pgdg26.04+1 postgresql-client-16=16.14-1.pgdg26.04+1 postgresql-16-postgis-3=3.6.3+dfsg-1.pgdg26.04+1 postgresql-16-postgis-3-scripts=3.6.3+dfsg-1.pgdg26.04+1`. Une version mineure garde le même format sur disque : pas de restauration nécessaire. **À faire avant l'étape 5.** Si l'extension est déjà passée en 3.6.4, préférer le snapshot. |
| **Le nouveau noyau démarre mal**, mais le serveur répond en SSH | `grep -E "menuentry '" /boot/grub/grub.cfg` pour trouver l'entrée 7.0.0-15, puis `sudo grub-reboot '<titre exact>' && sudo reboot` (démarrage unique sur l'ancien noyau). Le menu GRUB est caché (`GRUB_TIMEOUT=0`), il n'est pas accessible facilement depuis la console. |
| **Le serveur ne démarre pas, plus de réseau, ou plusieurs problèmes à la fois** | **Snapshot** : Console Hetzner → *Snapshots* → *Rebuild from snapshot*. Le disque revient exactement à son état d'avant la maintenance (15 à 30 min). L'IP ne change pas et le DNS n'est pas touché. Ce qui a été écrit après le snapshot est perdu, ce qui est négligeable aujourd'hui. |
| **Données perdues ou corrompues** (très improbable : une mise à jour mineure ne réécrit pas les données) | Dernier recours, **destructif, uniquement sur décision explicite de Jérôme** : `sudo systemctl stop tinyhike-api`, puis `sudo -u postgres dropdb tinyhike`, `sudo -u postgres createdb -O tinyhike tinyhike`, `sudo -u postgres pg_restore -d tinyhike ~/backups/tinyhike-pre-maint-<STAMP>.dump`. Refaire ensuite les vérifications « Base » de l'étape 6, puis `sudo systemctl start tinyhike-api`. Le dump contient l'extension, la colonne `geom`, le trigger et l'index partiel. |

## Ce que cette procédure ne touche pas

- **Inchangés** : `.env`, la configuration nginx, le code de l'API et du web, les données.
- **Colonnes `geom` et triggers PostGIS** : non modifiés (seule l'extension est mise à jour, et l'étape 6 vérifie qu'ils sont intacts).
- **Hors périmètre** :
  - Ubuntu Pro / ESM : 3 correctifs GDAL ne sont disponibles qu'avec un abonnement ;
  - le passage à PostgreSQL 17 ou 18, qui est une montée de version majeure avec `pg_upgradecluster`, à part ;
  - le nettoyage des anciens noyaux.
