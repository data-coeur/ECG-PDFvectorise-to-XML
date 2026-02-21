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
| phpMyAdmin | https://ecg-dev.data-coeur.com/phpmyadmin/ *(IP whitelist)* |

## État d'avancement

- [x] Extracteur ECG (PDF vectorisé → signal JS côté client)
- [x] Récepteur signal PHP (sauvegarde EDF+, WFDB, DICOM, HDF5, WebP)
- [x] DeepECG backend opérationnel (FastAPI)
- [x] DeepECG frontend React déployé
- [x] Infrastructure Docker complète + reverse proxy nginx + SSL
- [x] MCP servers pour développement via Claude.ai et VS Code
- [ ] Moteur IA DeepECG — adaptation CPU (actuellement profil GPU uniquement)
- [ ] Intégration complète : extracteur → analyse DeepECG → résultats
- [ ] Stockage des résultats en MySQL
- [ ] Accès SFTP pour édition directe des fichiers source

## Développement (Vibe Coding)

Deux méthodes pour travailler sur le code :

### 1. Claude.ai (compte `data-coeur@proton.me`)

Le projet est connecté à Claude.ai via un serveur MCP. Dans une conversation, Claude peut directement lire/écrire les fichiers, gérer Docker, et pousser sur Git.

**Connecteurs disponibles** (Settings → Integrations) :
- **ECG Pipeline (DEV)** — accès complet au projet (fichiers, Docker, Git)
- **Playwright Browser** — navigation web automatisée pour tester les pages

Pour utiliser : se connecter sur [claude.ai](https://claude.ai) avec le compte `data-coeur@proton.me`, vérifier que les connecteurs sont actifs dans les paramètres.

### 2. VS Code Remote Tunnel (compte GitHub `data-coeur`)

Un tunnel VS Code tourne sur le serveur, relié au compte GitHub `data-coeur@proton.me`.

**Première connexion :**
1. Installer VS Code
2. Créer un profil dédié (pour ne pas mélanger avec son profil personnel) :
   ```
   # Windows
   "C:\Program Files\Microsoft VS Code\Code.exe" --user-data-dir="%USERPROFILE%\VSCode-ECG"
   ```
3. Se connecter avec le compte GitHub `data-coeur@proton.me`
4. Remote Explorer → `Serveur-ECG-Pipeline` → Connect

Le workspace s'ouvre sur `/home/workspace` qui contient le projet.

**Si le tunnel demande une ré-authentification :**
```bash
docker logs vscode-tunnel-ecg | grep "use code"
```
→ utiliser le dernier code affiché sur https://github.com/login/device

### Playwright (navigateur automatisé)

[Playwright](https://playwright.dev/) est disponible de deux façons :

- **MCP (claude.ai)** : le connecteur « Playwright Browser » permet à Claude de naviguer sur le web, cliquer, remplir des formulaires, prendre des screenshots. Utile pour tester les pages du projet ou récupérer du contenu web.

- **CLI (VS Code / terminal)** : Playwright est installé dans le conteneur `ecg-dev-playwright` (image officielle Microsoft). Peut servir pour des tests end-to-end automatisés.

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
