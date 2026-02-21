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
| phpMyAdmin | https://ecg-dev.data-coeur.com/phpmyadmin/ *(identifiants envoyés par email)* |

## État d'avancement

- [x] Extracteur ECG (PDF vectorisé → signal JS côté client)
- [x] Récepteur signal PHP (sauvegarde EDF+, WFDB, DICOM, HDF5, WebP)
- [x] DeepECG backend opérationnel (FastAPI)
- [x] DeepECG frontend React déployé
- [x] Infrastructure Docker complète + reverse proxy nginx + SSL
- [x] MCP servers pour développement via Claude.ai
- [x] Navigation automatisée Playwright pour tests
- [ ] Moteur IA DeepECG — adaptation CPU (actuellement profil GPU uniquement)
- [ ] Intégration complète : extracteur → analyse DeepECG → résultats
- [ ] Stockage des résultats en MySQL
- [ ] Accès SFTP pour édition directe des fichiers source

## Développement (Vibe Coding)

### 1. Claude.ai (recommandé)

Se connecter sur [claude.ai](https://claude.ai) avec le compte `data-coeur@proton.me`, puis ouvrir le projet **« Pipeline ECG (image/pdf/raw) to Diagnosis »**.

Dans ce projet, Claude a accès à deux connecteurs MCP :
- **ECG Pipeline (DEV)** — lire/écrire les fichiers du projet, gérer Docker, pousser sur Git
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

## Structure du projet

```
ecg-dev/
├── src/                          # Code source PHP (document root Apache)
│   ├── index.html                # UI principale — upload PDF + extraction signal
│   ├── ecg_receive.php           # Réception signal → sauvegarde multi-format
│   └── data/                     # ECGs extraits
├── deepecg/                      # Clone de DeepECGAnalyser
│   ├── backend/                  # FastAPI
│   └── frontend/                 # React (Vite)
├── docker-compose.yml
├── mcp-server-ecg.js             # Serveur MCP pour Claude.ai
├── playwright-oauth-proxy.js     # Proxy OAuth pour Playwright MCP
├── CLAUDE.md                     # Instructions pour l'IA (contexte projet)
└── .env                          # Variables d'environnement
```

## Licence

Projet privé — Data-Cœur.
