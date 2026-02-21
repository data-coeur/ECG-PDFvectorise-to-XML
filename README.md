# ECG Pipeline

Pipeline complet d'analyse ECG : upload de PDF ECG vectorisé → extraction du signal → diagnostic automatisé par IA.

Le projet est en **développement actif** (phase proof-of-concept). L'extracteur de signal fonctionne, le backend DeepECG répond mais le moteur IA n'est pas encore actif (nécessite adaptation CPU ou GPU).

## Architecture

```
PDF ECG (vectorisé)
    │
    ▼
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Web UI      │────▶│  ecg_receive.php  │────▶│  DeepECG (API)  │
│  index.html  │     │  EDF+/WFDB/DICOM │     │  FastAPI + AI    │
└──────────────┘     └──────────────────┘     └─────────────────┘
    extraction           sauvegarde              diagnostic
    JS côté client       5 formats               77 classes
```

### Services Docker

| Service | Conteneur | Description |
|---------|-----------|-------------|
| **web** | `ecg-dev-web` | PHP 8.3 Apache — UI d'extraction + réception signal |
| **database** | `ecg-dev-database` | MySQL 8.0 |
| **phpmyadmin** | `ecg-dev-phpmyadmin` | Admin base de données |
| **deepecg-backend** | `ecg-dev-deepecg` | FastAPI Python — API d'analyse ECG |
| **deepecg-frontend** | `ecg-dev-deepecg-frontend` | React (Vite) — interface DeepECG |
| **ai-engine** | *non actif* | Profil GPU — modèles HeartWise (à adapter en CPU) |

## URLs

| Service | URL |
|---------|-----|
| ECG Extractor (app principale) | https://ecg-dev.data-coeur.com/ |
| DeepECG Frontend | https://ecg-dev.data-coeur.com/deepecg/ |
| DeepECG API (Swagger) | https://ecg-dev.data-coeur.com/api/deepecg/docs |
| phpMyAdmin | https://ecg-dev.data-coeur.com/phpmyadmin/ |

## État d'avancement

- [x] Extracteur ECG (PDF vectorisé → signal JS côté client)
- [x] Récepteur signal PHP (sauvegarde EDF+, WFDB, DICOM, HDF5, WebP)
- [x] DeepECG backend opérationnel (FastAPI)
- [x] DeepECG frontend React déployé
- [x] Infrastructure Docker complète (DinD isolé) + reverse proxy nginx + SSL
- [x] MCP servers pour développement via Claude.ai
- [x] Navigation automatisée Playwright pour tests
- [x] Accès SFTP pour édition directe des fichiers source
- [ ] Moteur IA DeepECG — adaptation CPU (actuellement profil GPU uniquement)
- [ ] Intégration complète : extracteur → analyse DeepECG → résultats
- [ ] Stockage des résultats en MySQL

## Développement (Vibe Coding)

Trois méthodes pour travailler sur le projet, de la plus assistée à la plus manuelle :

### 1. Claude.ai (recommandé pour le vibe coding)

Se connecter sur [claude.ai](https://claude.ai) avec le compte `data-coeur@proton.me`, puis ouvrir le projet **« Pipeline ECG (image/pdf/raw) to Diagnosis »**.

Dans ce projet, Claude a accès à deux connecteurs MCP :
- **ECG Pipeline (DEV)** — lire/écrire les fichiers du projet, gérer Docker, exécuter des commandes, pousser sur Git. Claude a un accès root complet dans l'environnement isolé du projet.
- **Playwright Browser** — naviguer sur les pages web, remplir des formulaires, prendre des captures d'écran, tester l'interface. Pour l'utiliser, préciser dans le prompt « utilise Playwright pour... » ou « va sur telle page et dis-moi ce que tu vois ».

### 2. VS Code Remote Tunnel

Un tunnel VS Code tourne sur le serveur, relié au compte GitHub `data-coeur@proton.me`.

**Connexion :**
1. Installer [VS Code](https://code.visualstudio.com/)
2. Installer l'extension **Remote - Tunnels** (`ms-vscode.remote-server`)
3. Dans la palette de commandes : **Remote-Tunnels: Connect to Tunnel...** → se connecter avec le compte GitHub `data-coeur@proton.me`
4. Sélectionner le tunnel `Serveur-ECG-Pipeline`
5. **Fichier → Ouvrir un dossier...** → `/home/workspace`

> **Note :** Un tunnel VS Code est lié à un seul compte GitHub. Si le tunnel demande une ré-authentification (après un redémarrage serveur par exemple), demandez à Claude.ai dans le projet Pipeline ECG de récupérer le code via la commande `vscode_tunnel_code`, puis entrez-le sur https://github.com/login/device.

### 3. Antigravity + SFTP

[Antigravity](https://antigravity.dev) est un outil de vibe coding qui fonctionne avec n'importe quel éditeur de texte ou IDE. Il s'appuie sur un accès SFTP pour synchroniser les fichiers modifiés par l'IA.

**Connexion SFTP :**
- **Hôte :** `ecg-dev.data-coeur.com` (port 22)
- **Utilisateur :** `data-coeur`
- **Mot de passe :** *(envoyé par email)*
- **Dossier distant :** vous arrivez directement dans `/workspace/ecg-pipeline/`

Le SFTP est aussi utilisable seul depuis n'importe quel client (FileZilla, WinSCP, Cyberduck, `sftp` en ligne de commande) pour éditer les fichiers du projet directement sur le serveur.

## Développement local

Pour travailler sur le projet en local sans accès au serveur :

### Prérequis

- Docker et Docker Compose
- Git

### Installation

```bash
# Cloner le repository
git clone git@github.com:data-coeur/ecg-pipeline.git
cd ecg-pipeline

# Créer le fichier d'environnement
cp .env.example .env
# Adapter les variables si nécessaire (ports, mots de passe MySQL...)

# Créer le réseau Docker
docker network create dev-network

# Lancer les services
docker compose up -d --build
```

### Variables d'environnement (.env.example)

```
DOMAIN=localhost
WEB_PORT=8300
PHPMYADMIN_PORT=8301
DEEPECG_BACKEND_PORT=8302
DEEPECG_FRONTEND_PORT=8303
MYSQL_DATABASE=ecgpipeline
MYSQL_USER=ecguser
MYSQL_PASSWORD=changeme
MYSQL_ROOT_PASSWORD=changeme
```

### Accès local

| Service | URL |
|---------|-----|
| ECG Extractor | http://localhost:8300/ |
| phpMyAdmin | http://localhost:8301/ |
| DeepECG API | http://localhost:8302/docs |
| DeepECG Frontend | http://localhost:8303/ |

### Notes

- Le **DeepECG frontend** a un `base path` configuré à `/deepecg/` pour le déploiement serveur. En local, il est accessible directement sur son port.
- Le moteur **AI Engine** nécessite un GPU NVIDIA. Si vous n'en avez pas, les endpoints d'analyse retourneront une erreur — le reste du système fonctionne normalement.
- Les données MySQL sont persistées dans `./data/mysql/`.

## Structure du projet

```
ecg-pipeline/
├── src/                          # Code source PHP (document root Apache)
│   ├── index.html                # UI principale — upload PDF + extraction signal
│   ├── ecg_receive.php           # Réception signal → sauvegarde multi-format
│   ├── data/                     # ECGs extraits (gitignored)
│   └── ecg_data/                 # Données ECG structurées
├── deepecg/                      # Clone de DeepECGAnalyser
│   ├── backend/                  # FastAPI
│   └── frontend/                 # React (Vite)
├── docker-compose.yml            # Services du projet
├── Dockerfile                    # Image web (PHP 8.3 Apache)
├── CLAUDE.md                     # Instructions pour l'IA (contexte projet)
├── .env                          # Variables d'environnement (gitignored)
└── data/                         # Données persistantes (gitignored)
    ├── mysql/                    # Base MySQL
    └── deepecg-*/                # Données DeepECG
```

## Licence

Projet privé — Data-Cœur.
