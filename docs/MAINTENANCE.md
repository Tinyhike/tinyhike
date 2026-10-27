# Procédure : fenêtre de maintenance (apt, PostgreSQL, PostGIS, Node, reboot)

**Exécutée le 27 octobre 2026 au matin par Jérôme** (préparée le 26/10). Le résultat est dans la section suivante. Les étapes intègrent ce qui a coincé ce jour-là et servent de base à la prochaine fenêtre.

> **À lancer par Jérôme depuis sa propre session SSH**, pas depuis Claude. Claude tourne dans la session tmux `tinyhike` de ce serveur, et le reboot la tue. Claude peut faire les vérifications des étapes 5 et 7 dans une nouvelle session, après le redémarrage.

---

## Exécution du 27 octobre 2026

| | Avant | Après |
|---|---|---|
| Paquets | | **69 mis à jour**, 0 supprimé, 0 nouveau (la simulation du 26/10 en annonçait 66). Les 4 paquets différés par le phasing d'Ubuntu (`qemu-guest-agent`, `ubuntu-virt`, `software-properties-common`, `python3-software-properties`) le sont toujours |
| Noyau | 7.0.0-15 | **7.0.0-38**, plus de reboot requis |
| PostgreSQL | 16.14 | **16.15** (pgdg) |
| PostGIS | 3.6.3 | **3.6.4** : le paquet, puis `ALTER EXTENSION postgis UPDATE` et `postgis_topology UPDATE` sur `tinyhike` **et** `tinyhike_dev` |
| Node | 22.22.2 | **22.23.4** (nodesource) |
| Autres | | systemd 259.9, nginx 1.28.3-2ubuntu1.12, apparmor 5.0.2, cloud-init 26.2, open-vm-tools 2:13.0.10-1ubuntu1.1 ; côté pgdg, GDAL 3.13, PROJ 9.8 et libpq 18.6 |

**Déroulé** : sauvegardes à 09:01 (`STAMP=20261027-0901`), reboot à 09:13:19, `sshd` à l'écoute à 09:13:35, PostgreSQL et `tinyhike-api` actifs à 09:13:38. Le site a été coupé une vingtaine de secondes.

**Vérifications, toutes bonnes** :
- `postgresql`, `nginx`, `tinyhike-api`, `fail2ban`, `ufw` et `ssh.socket` actifs ;
- comptages identiques avant et après (`1379|1|1|3923` : lieux, avis, comptes, traductions) ;
- `trg_place_geom` et `Review_one_written_per_user_per_place` présents, 0 `geom` nul ;
- `prisma migrate status` à jour, sharp 0.35.5 se charge sous le nouveau Node ;
- `X-Total-Count` 1037 avant et après ;
- 665 tests verts, lancés dans `/srv/tinyhike-dev` ;
- carte et fiche d'un lieu OK dans le navigateur, `/api/health` OK à travers Cloudflare.

**Sauvegardes** : `~/backups/tinyhike-pre-maint-20261027-0901.dump`, copié sur le portable de Jérôme, et le snapshot Hetzner `pre-maint-27oct`. **Le snapshot est à supprimer vers le 3 novembre** (« Plus tard », à la fin de l'étape 7).

**Incidents** :
1. **`cloud-init-main.service` en échec au boot** (stage `init-local`, fichier introuvable : `/sys/class/net/enp1s0/operstate`). C'est un bug connu, sans effet sur le réseau. Le contournement a été appliqué le 27/10 à 09:23 : voir la section « cloud-init ».
2. **SSH a refusé `tinyhike` (`Permission denied`) après le reboot**, puis a accepté la connexion quelques minutes plus tard. Voir l'étape 4.

**Ce qui a coincé, corrigé dans les étapes ci-dessous** :
- `apt-get -s full-upgrade | tail -1` n'affiche pas la ligne de résumé (étape 2) ;
- l'étape 3 doit tourner dans un tmux à part ;
- le noyau, les services et PostgreSQL se vérifient **avant** de toucher à l'extension PostGIS (étape 5) ;
- la mise à jour de l'extension concerne aussi `tinyhike_dev` (étape 6) ;
- les tests se lancent dans `/srv/tinyhike-dev`, pas en prod. En prod, `prisma migrate status` passe par `./node_modules/.bin/prisma`, pas par pnpm (étape 7) ;
- le copier-coller entre Windows Terminal et tmux (« Bon à savoir »).

## Bon à savoir avant une fenêtre

- **pgdg (PostgreSQL, PostGIS) et nodesource (Node) ne sont jamais mis à jour automatiquement.** unattended-upgrades n'applique chaque matin que les correctifs de sécurité Ubuntu.
- **Questions interactives d'apt : risque faible.** Aucun fichier de configuration des paquets n'était modifié localement le 26/10 (`dpkg -V` pour le revérifier). Le serveur démarre en EFI (`grub-efi-amd64`) et `grub-pc` n'est pas installé, donc pas de question sur le disque GRUB.
- **SSH revient seul après le reboot** : `ssh.socket` est activé.
- **Windows Terminal et tmux** : la souris est activée dans tmux (`set -g mouse on`). Pour coller, `Ctrl+Maj+V`. Pour copier, sélectionner en maintenant `Maj`, sinon tmux capture la sélection.

## Durée

| Étape | Durée | Coupure du service |
|---|---|---|
| 1. Sauvegardes + snapshot Hetzner | 10 à 15 min | non |
| 2. Pré-vol | 2 min | non |
| 3. `apt full-upgrade` | 5 à 10 min | quelques secondes au redémarrage de PostgreSQL |
| 4. Reboot | 1 à 2 min | **oui** (~20 s le 27/10, de l'arrêt au retour de l'API) |
| 5. Vérifications système et PostgreSQL | 3 min | non |
| 6. Mise à jour de l'extension PostGIS | 1 min | non |
| 7. Vérifications complètes | 5 à 10 min | non |
| **Total** | **~30 à 40 min** | **~2 à 5 min** au total |

Le 27/10, il a fallu 12 minutes entre le dump et le reboot. Un retour arrière complet par snapshot ajoute 15 à 30 minutes.

**Créneau** : en dehors de 06:00-06:45 (apt-daily-upgrade, qui prendrait le verrou dpkg) et de 00:00-01:00 (apt-daily, logrotate). Le 27/10, 09:00 s'est bien passé. Pendant la coupure, Cloudflare affiche une page d'erreur 52x. La PWA garde son shell en cache, mais la carte ne charge plus. Un seul compte existe aujourd'hui, l'impact est donc minime.

---

## 1. Sauvegardes (sans coupure)

```bash
# 1a. Dump de la base (18 Mo en base, ~300 Ko compressé)
cd /tmp && mkdir -p ~/backups   # /tmp : évite l'avertissement « could not change directory » de sudo -u postgres
STAMP=$(date +%Y%m%d-%H%M); echo $STAMP > ~/backups/.maint-stamp   # relu à l'étape 3 et après le reboot
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
cd /tmp; STAMP=$(cat ~/backups/.maint-stamp)
# Tester le verrou plutôt que les processus : unattended-upgrade-shutdown tourne en permanence
sudo fuser /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock 2>/dev/null && echo "VERROU PRIS, attendre" || echo "aucun verrou apt/dpkg"
sudo apt-get update
apt-get -s full-upgrade > ~/backups/apt-sim-$STAMP.txt
grep 'upgraded,' ~/backups/apt-sim-$STAMP.txt              # le résumé. Le 27/10 : "69 upgraded, 0 newly installed, 0 to remove and 4 not upgraded."
grep '^Remv' ~/backups/apt-sim-$STAMP.txt                  # paquets supprimés : rien attendu
grep -E '^Inst [^ ]+ \(' ~/backups/apt-sim-$STAMP.txt      # paquets nouveaux : rien attendu, sauf un nouveau noyau
df -h /                                                    # 53 Go libres le 26/10
```

`tail -1` ne donne pas le résumé : il précède les lignes `Inst` et `Conf`. Une mise à jour s'écrit `Inst paquet [ancienne version] (nouvelle …)`. Un paquet nouveau n'a pas de crochets entre son nom et la parenthèse, d'où le dernier `grep`.

**Arrêt si** la simulation annonce des suppressions (`to remove` > 0, une ligne `Remv`) ou un paquet nouveau inattendu. Un nouveau noyau arrive en paquets nouveaux (`linux-image-…`, `linux-modules-…`), c'est normal. Dans tous les autres cas, relire avant d'aller plus loin.

## 3. Mise à jour, dans un tmux à part

```bash
tmux new -s maint                       # une session à part, pas `tinyhike` (celle de Claude)
STAMP=$(cat ~/backups/.maint-stamp)     # le nouveau shell ne connaît pas $STAMP
sudo NEEDRESTART_SUSPEND=1 DEBIAN_FRONTEND=noninteractive apt-get -y \
  -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold \
  full-upgrade 2>&1 | tee ~/backups/apt-$STAMP.log
```

- **Pourquoi tmux** : si la connexion SSH tombe pendant `apt-get`, le shell meurt avec elle et dpkg peut s'arrêter au milieu d'une installation. Dans tmux, apt continue : se reconnecter, puis `tmux attach -t maint`. Si dpkg a quand même été interrompu : `sudo dpkg --configure -a`.
- `NEEDRESTART_SUSPEND=1` évite que needrestart relance les services un par un, puisque le reboot suit. Le paquet PostgreSQL redémarre quand même son cluster pendant l'installation, ce qui coupe quelques secondes. L'API continue de tourner sur l'ancien Node en mémoire jusqu'au reboot.
- `--force-confold` garde les fichiers de configuration locaux si un paquet en propose une nouvelle version. C'est un filet de sécurité.

```bash
apt list --upgradable 2>/dev/null      # seulement les paquets différés par le phasing
cat /var/run/reboot-required.pkgs      # noyau, libc6, systemd…
grep -iE 'error|failed' ~/backups/apt-$STAMP.log | head
```

## 4. Reboot

```bash
sudo systemctl reboot
```

**Attendre une à deux minutes avant de se reconnecter (`ssh tinyhike`), et ne pas insister en cas de refus.** fail2ban (jail `sshd`) bannit une IP pendant 1 h après 5 échecs en 10 min, y compris celle de Jérôme. Si SSH répond `Permission denied`, attendre une minute, puis réessayer une seule fois avec `ssh -v tinyhike` : la sortie montre quelle clé le client propose (`Offering public key`). **Si SSH ne répond pas après 5 minutes** : Console Hetzner → *Console* (VNC) pour voir où bloque le démarrage, puis la section « Retour arrière ».

**Le 27/10**, le journal montre deux refus, à 09:15:35 et 09:15:53 (`Connection reset by authenticating user tinyhike … [preauth]`), puis une connexion acceptée à 09:20:00 avec la clé ED25519. Le boot était pourtant fini depuis deux minutes : `sshd` écoutait depuis 09:13:35, et `systemd-user-sessions`, qui lève l'interdiction de connexion du démarrage, avait fini à la même seconde. `authorized_keys` n'a pas bougé depuis mai. Le serveur était donc dans le même état pour les refus et pour la connexion réussie. La cause n'est pas identifiée : le plus probable est que le client n'a pas proposé la bonne clé, mais le journal (niveau INFO) ne dit pas laquelle il a proposée.

## 5. Premières vérifications : noyau, services, PostgreSQL

À faire **avant** l'étape 6. Si PostgreSQL se comporte mal, revenir aux paquets 16.14 / 3.6.3 par apt (« Retour arrière ») n'est simple que tant que l'extension n'est pas passée en 3.6.4.

```bash
STAMP=$(cat ~/backups/.maint-stamp); cd /tmp   # la variable est perdue au reboot

# Système
uname -r                                          # 7.0.0-38-generic le 27/10
test -f /var/run/reboot-required && echo "REBOOT ENCORE REQUIS" || echo "ok, plus de reboot requis"
systemctl --failed --no-pager                     # 0 unité en échec (cloud-init : voir sa section)
for s in postgresql nginx tinyhike-api fail2ban ufw ssh.socket; do printf '%-14s %s\n' $s "$(systemctl is-active $s)"; done
sudo ufw status | head -3                         # active, 22/80/443
sudo fail2ban-client status sshd | tail -3
ss -ltnp                                          # 22, 80, 443, 127.0.0.1:5432, 127.0.0.1:3000 (jamais 0.0.0.0:3000). Rien sur 5173
node -v                                           # v22.23.4 le 27/10
sudo journalctl -b -p err --no-pager | tail -20   # erreurs du boot

# PostgreSQL
sudo -u postgres psql -d tinyhike -XAt -c 'SELECT version();'   # 16.15 le 27/10
diff <(sudo -u postgres psql -d tinyhike -XAt -c 'SELECT (SELECT count(*) FROM "Place"), (SELECT count(*) FROM "Review"), (SELECT count(*) FROM "User"), (SELECT count(*) FROM "PlaceTranslation")') ~/backups/counts-before-$STAMP.txt && echo "comptages identiques"
sudo tail -20 /var/log/postgresql/postgresql-16-main.log
```

**Arrêt si** le noyau, un service ou PostgreSQL ne va pas : voir « Retour arrière », avant l'étape 6.

## 6. Mise à jour de l'extension PostGIS, dans les deux bases

Le paquet a remplacé la bibliothèque, mais les objets SQL de l'extension restent dans l'ancienne version tant qu'on ne les met pas à jour, **dans chaque base** : `tinyhike` (prod) et `tinyhike_dev` (dev, depuis le 26/10). `dev-db-refresh.sh` recrée l'extension à la version courante, mais rien ne dit qu'il tournera avant la prochaine session de dev. On le fait après le reboot, quand toutes les connexions utilisent la nouvelle bibliothèque, et en dernier, car cette étape rend un retour à l'ancien PostGIS plus difficile.

```bash
for db in tinyhike tinyhike_dev; do
  echo "== $db"
  sudo -u postgres psql -d $db -XAt -c "SELECT postgis_full_version();"   # signale "procs need upgrade" si nécessaire
  sudo -u postgres psql -d $db -X -c "ALTER EXTENSION postgis UPDATE; ALTER EXTENSION postgis_topology UPDATE;"
  sudo -u postgres psql -d $db -XAt -c "SELECT extname || ' ' || extversion FROM pg_extension ORDER BY 1;"   # postgis 3.6.4, postgis_topology 3.6.4 le 27/10
done
```

`ALTER EXTENSION … UPDATE` ne met à jour que les fonctions de l'extension. Il ne touche ni à la colonne `Place.geom`, ni au trigger `trg_place_geom`, ni à l'index partiel des avis. L'étape 7 le vérifie.

## 7. Vérifications complètes

```bash
# Base de prod
sudo -u postgres psql -d tinyhike -XAt <<'SQL'
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_place_geom';                           -- 1 ligne
SELECT indexname FROM pg_indexes WHERE indexname = 'Review_one_written_per_user_per_place';  -- 1 ligne
SELECT count(*) FROM "Place" WHERE geom IS NULL;                                         -- 0
SQL
cd /srv/tinyhike/api && ./node_modules/.bin/prisma migrate status   # "Database schema is up to date". En prod, le binaire, pas pnpm

# Application de prod
cd /srv/tinyhike/api && node -e "import('sharp').then(s => console.log('sharp ok', s.default.versions.sharp))"   # le sharp de la prod sous le nouveau Node
curl -s http://127.0.0.1:3000/api/health
curl -sk --resolve app.tinyhike.com:443:127.0.0.1 https://app.tinyhike.com/api/health
curl -sk --resolve app.tinyhike.com:443:127.0.0.1 -o /dev/null -D - \
  'https://app.tinyhike.com/api/places?bbox=4.4,51.8,4.6,51.95&locale=nl&limit=500' | grep -i x-total-count   # = cat ~/backups/total-before-$STAMP.txt (1037 le 27/10)
curl -s -A 'Mozilla/5.0' https://app.tinyhike.com/api/health   # à travers Cloudflare
sudo journalctl -u tinyhike-api -b --no-pager | tail -5

# Tests : dans le checkout de dev, jamais en prod (CLAUDE.md, « Dev and production »)
cd /srv/tinyhike-dev/api && pnpm test       # tout vert sous le nouveau Node (665 tests le 27/10)
```

Enfin, dans un navigateur : ouvrir `https://app.tinyhike.com`, vérifier que la carte charge, puis ouvrir un lieu.

**Plus tard (pas pendant la fenêtre)** :
- **Vers le 3 novembre**, après une semaine sans problème : supprimer le snapshot Hetzner `pre-maint-27oct` (Console Hetzner → *Snapshots*). Le dump reste, sur le serveur et sur le portable.
- **Ensuite, les anciens noyaux.** `apt autoremove --purge` ne retire rien : sa simulation du 27/10 annonce 0 suppression. 7.0.0-22 à 7.0.0-34 sont déjà désinstallés. Il ne reste d'eux que leur configuration : 21 paquets en état `rc` (`linux-image`, `linux-modules`, `linux-main-modules-zfs`), plus les fichiers `modules.*` de `/lib/modules/<version>`, 7,4 Mo par version. Pour les purger :
  ```bash
  apt list '?and(?config-files,?name(^linux-))'          # les 21 paquets, 7.0.0-22 à -34
  sudo apt purge '?and(?config-files,?name(^linux-))'
  ls /lib/modules                                         # attendu : 7.0.0-15-generic et 7.0.0-38-generic
  ```
  Le filtre `^linux-` laisse de côté `grub-pc`, lui aussi en état `rc` : on le garde tel quel. **7.0.0-15 reste installé** : `apt autoremove` le garde comme noyau précédent, et c'est lui que la ligne « noyau » du retour arrière utilise. Ne le retirer que quand 7.0.0-38 aura fait ses preuves.

---

## cloud-init : échec au boot (bug connu, contourné le 27/10)

**Symptôme**, au reboot du 27/10 : `cloud-init-main.service` en échec. `cloud-init status --long` affiche `status: error`, stage `init-local`, `[Errno 2] No such file or directory: '/sys/class/net/enp1s0/operstate'` (datasource Hetzner). Le réseau fonctionne.

**Cause** : [canonical/cloud-init#7142](https://github.com/canonical/cloud-init/issues/7142), fermé « not planned », sans version corrigée. Pendant le boot, la carte réseau change deux fois de nom : udev la renomme de `eth0` en `enp1s0`, puis le netplan de Hetzner la remet en `eth0`. Si le DHCP éphémère d'`init-local` démarre sur `enp1s0` pendant ce second renommage, il échoue. La mise à jour d'`open-vm-tools` (2:13.0.10-1ubuntu1.1, installée le 27/10) a déplacé son `After=apparmor.service` dans un générateur réservé à VMware. Sur une VM KVM comme celle-ci, `cloud-init-local` n'attend donc plus AppArmor, et c'est ce délai qui masquait la course.

**Contournement**, appliqué par Jérôme le 27/10 à 09:23 : un drop-in qui rétablit l'attente, versionné dans `ops/systemd/cloud-init-local.service.d/10-after-apparmor.conf` (identique au fichier installé).

```bash
sudo install -D -m 644 /srv/tinyhike/ops/systemd/cloud-init-local.service.d/10-after-apparmor.conf \
  /etc/systemd/system/cloud-init-local.service.d/10-after-apparmor.conf
sudo systemctl daemon-reload
sudo systemctl reset-failed     # efface de systemd l'échec du boot en cours
```

Le drop-in redonne seulement le délai, il ne corrige pas la course. Le ticket ne s'appuie d'ailleurs que sur un boot en échec et un boot propre.

**À vérifier au prochain reboot** (étape 5) :

```bash
systemctl --failed --no-pager                           # 0 unité
cloud-init status --long                                # status: done, aucune erreur
systemctl show cloud-init-local.service -p DropInPaths  # le drop-in est chargé
```

Jusqu'au prochain reboot, `cloud-init status` affiche encore l'erreur du 27/10 : c'est l'état enregistré pendant ce boot-là, et `reset-failed` ne l'efface que dans systemd. Si l'échec revient malgré le drop-in, le réseau marche quand même : relire le ticket avant de toucher à quoi que ce soit. Retirer le drop-in quand une version de cloud-init aura corrigé la course.

---

## Retour arrière, selon le symptôme

| Symptôme | Action |
|---|---|
| **L'API ne démarre plus**, le reste va bien | `sudo journalctl -u tinyhike-api -b`. Si Node est en cause : `sudo apt-get install nodejs=22.22.2-1nodesource1 && sudo apt-mark hold nodejs && sudo systemctl restart tinyhike-api`. Cette version est toujours sur nodesource au 26/10. Retirer le `hold` une fois le problème compris. |
| **PostgreSQL ne démarre plus**, ou se comporte mal | Lire `/var/log/postgresql/postgresql-16-main.log`. Revenir aux versions précédentes, toujours sur apt.postgresql.org au 26/10 : `sudo apt-get install postgresql-16=16.14-1.pgdg26.04+1 postgresql-client-16=16.14-1.pgdg26.04+1 postgresql-16-postgis-3=3.6.3+dfsg-1.pgdg26.04+1 postgresql-16-postgis-3-scripts=3.6.3+dfsg-1.pgdg26.04+1`. Une version mineure garde le même format sur disque : pas de restauration nécessaire. **À faire avant l'étape 6** (c'est l'étape 5 qui permet d'en décider). Si l'extension est déjà passée en 3.6.4, préférer le snapshot. |
| **Le nouveau noyau démarre mal**, mais le serveur répond en SSH | `grep -E "menuentry '" /boot/grub/grub.cfg` pour trouver l'entrée 7.0.0-15, puis `sudo grub-reboot '<titre exact>' && sudo reboot` (démarrage unique sur l'ancien noyau). Le menu GRUB est caché (`GRUB_TIMEOUT=0`), il n'est pas accessible facilement depuis la console. |
| **Le serveur ne démarre pas, plus de réseau, ou plusieurs problèmes à la fois** | **Snapshot** : Console Hetzner → *Snapshots* → *Rebuild from snapshot*. Le disque revient exactement à son état d'avant la maintenance (15 à 30 min). L'IP ne change pas et le DNS n'est pas touché. Ce qui a été écrit après le snapshot est perdu, ce qui est négligeable aujourd'hui. |
| **Données perdues ou corrompues** (très improbable : une mise à jour mineure ne réécrit pas les données) | Dernier recours, **destructif, uniquement sur décision explicite de Jérôme** : `sudo systemctl stop tinyhike-api`, puis `sudo -u postgres dropdb tinyhike`, `sudo -u postgres createdb -O tinyhike tinyhike`, `sudo -u postgres pg_restore -d tinyhike ~/backups/tinyhike-pre-maint-<STAMP>.dump`. Refaire ensuite les vérifications « Base de prod » de l'étape 7, puis `sudo systemctl start tinyhike-api`. Le dump contient l'extension, la colonne `geom`, le trigger et l'index partiel. |

## Ce que cette procédure ne touche pas

- **Inchangés** : `.env`, la configuration nginx, le code de l'API et du web, les données.
- **Colonnes `geom` et triggers PostGIS** : non modifiés. Seule l'extension est mise à jour, et l'étape 7 vérifie qu'ils sont intacts.
- **Seul fichier système ajouté le 27/10** : le drop-in cloud-init, après la fenêtre (section « cloud-init »).
- **Hors périmètre** :
  - Ubuntu Pro / ESM : 3 correctifs GDAL ne sont disponibles qu'avec un abonnement ;
  - le passage à PostgreSQL 17 ou 18, qui est une montée de version majeure avec `pg_upgradecluster`, à part ;
  - le nettoyage des anciens noyaux (« Plus tard », fin de l'étape 7).
