# NovaGuard — Connexion des agents IA par MCP

- Version : 2.0 (audit de la proposition 1.0 contre le code)
- Date : 16 octobre 2026
- Statut : parcours de connexion fondés sur le serveur tel qu’implémenté ; parcours clients **non qualifiés sur appareil**
- Référence du serveur : [`mcp.md`](../mcp.md) (contrat des outils) et `android/app/src/main/java/com/novaguard/surveillance/McpServerModule.kt`
- Clients étudiés : Claude (Claude Code, Claude Desktop, claude.ai), ChatGPT, Microsoft Copilot Studio, LibreChat, Open WebUI, AnythingLLM, OpenClaw, Hermes Agent (Nous Research)

## 0. Résultat de l’audit

La version 1.0 décrivait un serveur web d’entreprise — HTTPS public, fournisseur d’identité, OAuth, API d’administration — et avertissait elle-même ne pas avoir consulté le dépôt. Le dépôt dit autre chose : le serveur MCP de NovaGuard est **un socket HTTP dans le processus de l’application Android**, sur le téléphone qui filme, sans compte ni connexion sortante. Ce qui change :

| Hypothèse de la v1.0 | Réalité du code | Conséquence |
| --- | --- | --- |
| Serveur distant `https://novaguard.example.com/mcp` | Socket sur le téléphone, port `8081` par défaut (1024–65535), `127.0.0.1` sans jeton, toutes interfaces avec jeton | Le client doit être sur le même téléphone ou le même réseau local |
| OAuth 2.1 + PKCE, Protected Resource Metadata, DCR | Deux jetons porteurs statiques générés sur l’appareil ; aucun serveur d’autorisation, aucun `/.well-known/*` | Tout client se configure avec un en-tête `Authorization: Bearer …`. Les niveaux « OAuth » de la v1.0 sont sans objet |
| Clients SaaS au lot 4 | L’exposition Internet et la redirection de port ne sont pas prises en charge (`mcp.md` §5) ; `INTERNET` n’est déclarée que pour écouter | Claude.ai, ChatGPT et Copilot Studio se connectent depuis leur cloud : **non pris en charge** (§5) |
| Reverse proxy, DNS de service Docker | Contrôle `Host` strict : `127.0.0.1`, `localhost`, `[::1]` et la seule IPv4 LAN détectée, avec le port | Un nom d’hôte (`novaguard.local`, `host.docker.internal`, nom de service Compose) reçoit `421` |
| Routes `/api/agent-connections/*` | Le serveur ne sert que `POST` (JSON-RPC) et `GET /health` | Les routes proposées sont abandonnées ; l’assistant de connexion est l’écran Réglages existant (§7) |
| Identités de service, révocation fournisseur | Jeton de lecture permanent, jeton de pilotage expirant (1 h / 24 h / jamais), coupure depuis la notification | La révocation est un geste sur l’appareil, effective à la requête suivante |

Le reste de la v1.0 — séparation provisionner / authentifier / connecter / exécuter, idempotence, preuve par un appel de lecture, prudence sur les mutations rejouées, prudence sur les capacités des clients — est conservé.

## 1. Objectif et périmètre

Permettre au propriétaire du téléphone de connecter un agent généraliste aux outils de NovaGuard avec un minimum de configuration, et de la réutiliser après redémarrage du client, changement d’adresse du téléphone ou expiration du jeton de pilotage.

Le document couvre l’enregistrement du serveur dans le client, l’authentification, la découverte des outils, le diagnostic, le renouvellement et la révocation. Il ne change ni le contrat des outils (`mcp.md`) ni les règles d’approbation des clients.

Aucun classement d’usage des huit produits n’est affirmé. Les syntaxes de configuration clientes viennent de leur documentation (§13) et n’ont pas été rejouées contre un téléphone : chacune est à qualifier (§10) avant d’être présentée comme fonctionnelle.

## 2. Principes de connexion

Quatre opérations distinctes :

1. **Provisionner** : écrire l’URL et l’en-tête d’autorisation dans le client.
2. **Authentifier** : présenter le jeton de lecture ou de pilotage ; aucun flux interactif.
3. **Connecter** : `initialize`, `notifications/initialized`, `tools/list`.
4. **Exécuter** : appeler un outil ; le serveur décide des droits à chaque requête.

Une connexion technique n’implique pas que l’agent utilisera les outils : sélection d’agent, profil d’outils et approbation restent du ressort du client.

### 2.1 Niveaux d’automatisation

| Niveau | Résultat | Intervention humaine |
| --- | --- | --- |
| A — guidé | URL, jeton et fragment copiés depuis Réglages ou le QR code | Saisie dans le client |
| B — préconfiguré | Entrée posée par script ou fichier, jeton injecté par variable d’environnement | Génération du jeton sur le téléphone |
| C — réutilisable | Reconnexion après redémarrage ou changement d’IP (DNS-SD) | Nouveau jeton de pilotage à expiration ; certificat à faire confiance une fois en HTTPS |
| D — sans présence | Lecture permanente avec le jeton de lecture | Aucune au-delà de B ; le pilotage reste borné par son expiration |

Le niveau D ne s’applique qu’à la lecture. Le pilotage sans présence se règle avec la durée « sans expiration », que le propriétaire choisit explicitement.

## 3. Le serveur tel qu’il est

### 3.1 Composants

| Composant | Où | Rôle |
| --- | --- | --- |
| Écran Réglages → Serveur MCP | `src/screens/SetupScreen.tsx` | Activation, port, HTTPS, jetons, durée du pilotage, URL, config JSON, QR code, dernière activité |
| Feuille « Services MCP » | `src/components/McpServicesSheet.tsx` | Ce qu’un agent peut lire et faire, selon les interrupteurs actuels |
| Serveur HTTP(S) + JSON-RPC | `McpServerModule.kt` | Transport, authentification, outils, ressources, prompts, DNS-SD |
| Décisions pures | `McpRules.java` | Principal, expiration, quotas de connexion, échéance par requête |
| Autorité TLS | `McpTls.kt`, `McpCertificates.java` | CA propre au téléphone (Android Keystore), certificat serveur par adresse |
| Journal de pilotage | `src/surveillance/agentLog.ts` | Chaque appel de pilotage, refus compris, visible dans Réglages |

Il n’y a ni fournisseur d’identité, ni gestion de secrets externe, ni journal d’audit des lectures : seul le pilotage est journalisé, avec un compteur de requêtes et l’heure de la dernière activité pour le reste.

### 3.2 Transport

- **Streamable HTTP sans état** : une requête JSON-RPC par `POST`, réponse `application/json` (jamais de flux SSE), `202` sans corps pour une notification, `Connection: close` à chaque réponse. Aucun `Mcp-Session-Id`.
- `GET` sur `/mcp` rend `405` — comportement prévu par le transport pour un serveur sans flux. `GET /health` rend `{"status":"ok"}` et sert de sonde réseau.
- Le chemin n’est pas contrôlé : l’URL publiée est `…/mcp`, c’est celle à configurer.
- `Content-Type: application/json` exigé (`415` sinon), corps ≤ 256 Kio (`413`), 64 en-têtes au plus (`431`).
- Versions négociées : `2024-11-05`, `2025-03-26`, `2025-06-18`, `2026-07-28` ; une version inconnue reçoit `2025-06-18`.
- Pas de `stdio`. Un client qui ne parle que `stdio` passe par un pont (§6.1, Claude Desktop) ; ce pont ne doit rien écrire sur sa sortie standard en dehors du protocole.

### 3.3 Adressage et réseau

| Mode | Écoute | Accès |
| --- | --- | --- |
| Sans jeton | `127.0.0.1:port` | Applications du téléphone seulement ; lecture sans jeton, jamais de pilotage |
| Jeton de lecture et/ou de pilotage | Toutes les interfaces | Toute requête hors boucle locale présente un jeton |
| HTTPS (option, éteint par défaut) | Idem, en TLS, boucle locale comprise | Le client fait confiance à la CA du téléphone |

Contrôles qui décident si un client se connecte :

- **`Host`** doit valoir exactement `127.0.0.1:port`, `localhost:port`, `[::1]:port` ou `<IPv4 LAN>:port`, sinon `421`. Conséquences : adresser le téléphone **par son IP**, port explicite ; un reverse proxy doit transmettre ce `Host` inchangé ; un nom mDNS, un nom de service Docker ou un port implicite (443 derrière un proxy) est refusé.
- **`Origin`**, s’il est présent, doit être l’origine du serveur (`403` sinon). Les clients serveur n’en envoient pas ; un client exécuté dans un navigateur et parlant directement au téléphone est refusé, et c’est voulu (*DNS rebinding*).
- **Débit et connexions** : 120 requêtes par minute et par IP, 8 connexions simultanées dont 4 par IP, échéance de 15 s pour lire une requête. Un client multi-utilisateur (LibreChat, Open WebUI, AnythingLLM) et tout conteneur derrière une NAT présentent **une seule IP** : tous leurs utilisateurs partagent ce budget, et chaque `wait_for_event` en cours (≤ 25 s) y occupe une place.
- **Découverte** : le serveur s’annonce en DNS-SD (`_novaguard-mcp._tcp`, TXT `path=/mcp`, `auth=bearer`) dès qu’il écoute hors boucle locale. L’IP du téléphone est un bail DHCP ; réserver son adresse sur le routeur est le moyen le plus simple de garder une configuration valide. mDNS ne traverse ni les réseaux Docker en pont ni la plupart des VLAN invités.
- Dans un conteneur, `localhost` désigne le conteneur, pas le téléphone. Un téléphone et un client sur deux réseaux Wi-Fi isolés l’un de l’autre (« isolation des clients ») ne se voient pas.

### 3.4 Clients sur le téléphone lui-même

Un client qui tourne sur le même appareil (Termux, par exemple) atteint `http://127.0.0.1:8081/mcp` sans jeton en lecture. Le pilotage exige toujours le jeton de pilotage, y compris en boucle locale : une autre application du téléphone ne doit pas pouvoir éteindre la caméra.

## 4. Authentification et droits

### 4.1 Jetons

| Jeton | Obtenu | Ouvre | Fin de validité |
| --- | --- | --- | --- |
| Lecture | « Générer un jeton » (32 caractères, `SecureRandom`) | Outils de lecture, ressources, prompts | « Effacer le jeton » ou régénération |
| Pilotage | « Générer un jeton de pilotage », avec l’interrupteur « Autoriser le pilotage par un agent » | Lecture + 7 outils de pilotage | Durée choisie (1 h, 24 h par défaut, sans expiration), « Couper le pilotage » sur la notification, interrupteur éteint |

- En-tête : `Authorization: Bearer <jeton>` (le préfixe `Bearer` est toléré absent). Jamais dans l’URL.
- Comparaison par empreinte SHA-256 à temps constant ; un jeton de moins de 16 caractères est ignoré.
- Un jeton de pilotage expiré n’ouvre plus rien, pas même la lecture : `401` `NOVAGUARD_AUTH_REQUIRED` hors boucle locale.
- Un outil de pilotage appelé avec le jeton de lecture : erreur JSON-RPC `NOVAGUARD_AUTH_FORBIDDEN`, HTTP `403`.
- Un `401` porte `WWW-Authenticate: Bearer realm="NovaGuard MCP"`, sans `resource_metadata`. Un client qui tente une découverte OAuth sur ce `401` échoue (`GET` → `405`) : **désactiver explicitement OAuth** dans tout client qui le propose.

### 4.2 Choix du jeton par client

Donner au client le jeton de **lecture** par défaut. Le jeton de pilotage ne va qu’au client qui doit piloter : il ouvre aussi la lecture, donc un client configuré pour piloter n’a besoin que de lui. Un client partagé entre plusieurs personnes (LibreChat, Open WebUI) ne reçoit jamais le jeton de pilotage sans que chacun de ses utilisateurs soit en droit d’arrêter la surveillance.

### 4.3 Catalogue variable

Les outils de pilotage n’apparaissent dans `tools/list` que tant que l’interrupteur est allumé et le jeton non expiré ; `get_live_frame` que tant que « Vue en direct pour l’agent » est allumée. Le serveur annonce `listChanged: false` et ne pousse rien : **après un changement d’interrupteur ou une expiration, le client doit recharger le catalogue** (reconnexion, redémarrage ou commande de rechargement du client).

Noms annoncés : `novaguard_*` (la forme pointée de `mcp.md` reste acceptée à l’appel). Certains clients préfixent par le nom du serveur (`novaguard`), ce qui donne des noms redondants mais valides.

### 4.4 Données qui quittent le téléphone

NovaGuard n’envoie rien de lui-même. Mais ce que l’agent lit — métadonnées, images de `get_event_frames`, image en direct — part vers le modèle qu’utilise le client. Avec un modèle hébergé, des images de la pièce surveillée quittent donc le réseau local. Le guide de chaque client le dit avant la configuration (`mcp.md` §14). Un client relié à un modèle local (Ollama, llama.cpp…) garde tout sur le réseau.

Les outils d’images rendent des blocs `image` dans le résultat d’outil : un client ou un modèle qui ne les transmet pas ne voit que le bloc texte, sans erreur.

## 5. Matrice des clients

| Client | Atteint le téléphone ? | Mécanisme | Automatisation | Statut |
| --- | --- | --- | --- | --- |
| Claude Code | Oui, depuis le poste | `claude mcp add --transport http` + `--header` | B/C/D | À qualifier |
| Claude Desktop | Oui, via un pont `stdio` local | `mcpServers` → pont HTTP | B/C/D | À qualifier ; dépend d’un pont tiers |
| claude.ai (connecteurs distants) | Non : appel depuis l’infrastructure d’Anthropic | — | — | **Non pris en charge** |
| ChatGPT | Non : appel depuis l’infrastructure d’OpenAI | — | — | **Non pris en charge** |
| Copilot Studio | Non : appel depuis l’infrastructure Microsoft (une passerelle de données locale n’a pas été qualifiée pour MCP) | — | — | **Non pris en charge** |
| LibreChat | Oui, auto-hébergé sur le LAN | `mcpServers` dans `librechat.yaml` | B/C/D | À qualifier |
| Open WebUI | Oui, auto-hébergé sur le LAN | MCP natif Streamable HTTP, clé/en-tête | A/B/C | À qualifier |
| AnythingLLM | Oui, Desktop ou Docker sur le LAN | `anythingllm_mcp_servers.json` | B, C à qualifier | À qualifier (transport HTTP et en-têtes) |
| OpenClaw | Oui, Gateway sur le LAN | Registre `mcp.servers` + CLI | B/C/D | À qualifier |
| Hermes Agent | Oui, sur le LAN | `mcp_servers` dans `config.yaml` | B/C/D | À qualifier |

« Non pris en charge » n’est pas un manque de configuration : rendre le téléphone joignable depuis un cloud tiers demande un tunnel ou une redirection de port, que NovaGuard exclut (`mcp.md` §5) — c’est une caméra, et le jeton serait la seule barrière face à Internet. Le contrôle `Host` refuse de toute façon un nom de tunnel. Rouvrir ce point est une décision de produit (§12), pas une étape d’intégration.

## 6. Parcours par client

Valeurs communes, lues dans Réglages → Serveur MCP :

```text
NOVAGUARD_MCP_URL=http://192.168.1.42:8081/mcp     # « Copier l’URL » ; https:// si HTTPS est activé
NOVAGUARD_MCP_TOKEN=<jeton de lecture>             # « Copier le jeton »
```

Vérification réseau préalable, depuis l’hôte qui exécutera le client (et non depuis un autre poste) :

```bash
curl -sS "http://192.168.1.42:8081/health"
curl -sS "$NOVAGUARD_MCP_URL" \
  -H "Authorization: Bearer $NOVAGUARD_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"novaguard_get_status","arguments":{}}}'
```

`421` : le client n’adresse pas le téléphone par son IP. `401` : jeton absent, faux ou de pilotage expiré. Pas de réponse : réseau isolé, téléphone hors Wi-Fi ou serveur éteint.

### 6.1 Claude

**Claude Code** (poste du propriétaire, même réseau) :

```bash
claude mcp add --transport http novaguard "$NOVAGUARD_MCP_URL" \
  --header "Authorization: Bearer $NOVAGUARD_MCP_TOKEN"
claude mcp list
```

L’option `--scope` décide où l’entrée est écrite ; préférer la portée utilisateur ou locale à `.mcp.json` versionné, qui ferait entrer le jeton dans un dépôt.

**Claude Desktop** : son fichier `claude_desktop_config.json` lance des processus `stdio` ; une entrée `url` n’y est pas un connecteur. Il faut un pont HTTP → `stdio` exécuté sur le poste (par exemple `mcp-remote`, qui exige une option explicite pour une URL `http://` hors `localhost`). Ce pont est une dépendance tierce : nom, version, et absence de journalisation du jeton à vérifier avant de le recommander.

**claude.ai** (connecteurs personnalisés) : non pris en charge (§5). Ne pas proposer l’URL du téléphone dans ce parcours.

### 6.2 ChatGPT

Non pris en charge (§5) : un serveur MCP personnalisé est appelé depuis l’infrastructure d’OpenAI et doit être joignable en HTTPS public.

### 6.3 Microsoft Copilot Studio

Non pris en charge (§5), pour la même raison. Une qualification de la passerelle de données locale serait une étude à part, avec la même question de produit.

### 6.4 LibreChat

```yaml
mcpServers:
  novaguard:
    type: streamable-http
    url: "${NOVAGUARD_MCP_URL}"
    requiresOAuth: false
    headers:
      Authorization: "Bearer ${NOVAGUARD_MCP_TOKEN}"
```

- `requiresOAuth: false` est indispensable : le serveur n’a pas d’OAuth (§4.1).
- `NOVAGUARD_MCP_URL` contient l’IP du téléphone, jamais un nom ; le conteneur doit pouvoir la router (réseau Docker en pont ou `host`).
- Les versions récentes de LibreChat filtrent les adresses de serveurs MCP ; vérifier que les adresses privées du LAN sont autorisées sur la version retenue.
- Tous les utilisateurs de l’instance partagent le budget d’une IP (§3.3) et le même jeton : jeton de lecture uniquement.
- Fusionner la seule entrée `novaguard` sans écraser les autres serveurs ; ne pas supposer qu’un secret Docker devient une variable d’environnement.

### 6.5 Open WebUI

Ajouter un serveur MCP Streamable HTTP avec l’URL du téléphone et une authentification par clé/en-tête porteur, **pas** OAuth. L’enregistrement est administratif et vaut pour l’instance : jeton de lecture uniquement.

Le support MCP natif d’Open WebUI ne couvre ni `stdio` ni l’ancien SSE ; il est sans objet ici puisque le serveur est Streamable HTTP. Les mêmes réserves que LibreChat s’appliquent (IP routable depuis le conteneur, budget partagé, filtrage d’adresses privées éventuel). Valider par un appel métier, pas seulement par le test de connexion de l’interface.

### 6.6 AnythingLLM

Entrée à poser dans `plugins/anythingllm_mcp_servers.json` du stockage persistant :

```json
{
  "mcpServers": {
    "novaguard": {
      "type": "streamable",
      "url": "http://192.168.1.42:8081/mcp",
      "headers": { "Authorization": "Bearer <jeton de lecture>" }
    }
  }
}
```

Le nom exact du type de transport HTTP et la prise en charge des en-têtes sont à confirmer sur la version Desktop/Docker retenue avant de livrer ce fragment. Le fichier contient le jeton en clair : restreindre ses permissions et l’exclure des sauvegardes partagées.

### 6.7 OpenClaw

Registre natif, sans OAuth :

```bash
openclaw mcp add novaguard \
  --url "$NOVAGUARD_MCP_URL" \
  --transport streamable-http \
  --header "Authorization: Bearer $NOVAGUARD_MCP_TOKEN"

openclaw mcp doctor novaguard --probe
```

Le nom de l’option d’en-tête est à confirmer dans la référence du registre (S8). Les mutations CLI et la sonde exigent que le Gateway propriétaire du stockage soit arrêté ; sur une instance en fonctionnement, passer par la Control UI. Vérifier le profil d’outils de l’agent : une entrée enregistrée n’est pas une entrée exposée.

Le script de provisionnement détecte l’entrée avant de l’ajouter et la met à jour sans perdre ses filtres. MCPorter a un registre distinct ; `openclaw mcp serve` expose OpenClaw et ne le connecte pas à NovaGuard.

### 6.8 Hermes Agent

Bloc à fusionner dans `~/.hermes/config.yaml` :

```yaml
mcp_servers:
  novaguard:
    url: "http://192.168.1.42:8081/mcp"
    headers:
      Authorization: "Bearer ${NOVAGUARD_MCP_TOKEN}"
```

```bash
hermes mcp test novaguard
```

Pas de `auth: oauth` ni de `hermes mcp login` : il n’y a rien à quoi se connecter. La substitution `${…}` dans les en-têtes est à confirmer dans S9b ; à défaut, le jeton est écrit en clair et le fichier protégé. Hermes découvre les outils au démarrage ; `/reload-mcp` est la réponse au catalogue variable (§4.3). `hermes mcp serve` expose Hermes et ne le connecte pas à NovaGuard.

### 6.9 HTTPS

Avec « Chiffrer les connexions », l’URL passe en `https://`, et le client doit faire confiance à la CA du téléphone (« Copier le certificat (PEM) », empreinte SHA-256 à comparer). Le certificat serveur couvre `127.0.0.1`, `::1` et l’IP LAN détectée, et il est réémis à la poignée de main suivante si l’IP change : la CA, elle, ne change pas.

| Pile du client | Faire confiance à la CA |
| --- | --- |
| Node (Claude Code, LibreChat, AnythingLLM, ponts `npx`) | `NODE_EXTRA_CA_CERTS=/chemin/novaguard-ca.pem` |
| Python (Open WebUI, Hermes) | Magasin système de l’hôte ou du conteneur, ou variable propre à la bibliothèque HTTP (`SSL_CERT_FILE` selon la version) — à qualifier |
| Conteneur | Monter le PEM et l’ajouter au magasin de l’image ; la variable seule ne suffit pas si la bibliothèque ne la lit pas |

Ne jamais désactiver la vérification TLS dans un client pour « faire marcher » la connexion : le jeton redeviendrait lisible par quiconque se place sur le chemin.

## 7. Interface NovaGuard

Elle existe : **Réglages → Serveur MCP** (en tête de l’écran Réglages, carte « ASSISTANT IA (MCP) »).

### 7.1 Ce qu’elle fournit

1. Activation, port, mode (« Lecture seule strict » / « Lecture et pilotage »), HTTPS, vue en direct.
2. Jeton de lecture et jeton de pilotage, avec durée et date d’expiration.
3. « Copier l’URL », « Copier le jeton », « Copier la config JSON », QR code de la configuration (jeton compris, avec l’avertissement correspondant).
4. Certificat de la CA et son empreinte, en HTTPS.
5. « Voir les services MCP » : ce qu’un agent peut lire et faire avec les réglages actuels.
6. Dernière activité IA et journal des appels de pilotage.

### 7.2 Ce qui reste à ajouter

| Manque | Proposition |
| --- | --- |
| La config JSON n’a qu’une forme, sans champ `type`, et n’est directement valide pour aucun des clients du §6 | Un fragment par client (§6), choisi dans une liste ; les clients non pris en charge y figurent avec la raison |
| La config copiée porte le jeton de **pilotage** dès que le pilotage est actif (`SetupScreen.tsx`, `clientToken`) | Choisir explicitement le jeton du fragment, lecture par défaut (§4.2) |
| Aucun avertissement sur `Host` | Afficher « adressez le téléphone par son IP » sous l’URL, et une suggestion de réservation DHCP |
| Aucune preuve par client | Afficher le nombre de requêtes et la dernière activité **par IP de pair**, sans plus : un nom de client est autodéclaré et ne prouve rien |

### 7.3 États affichables

NovaGuard ne voit que ce qui arrive sur son socket. Ces états se déduisent de ses propres compteurs, jamais de l’état interne d’un client :

| État | Preuve | Action proposée |
| --- | --- | --- |
| Serveur éteint | `running = false` | Activer |
| Boucle locale seulement | `loopbackOnly = true` | Générer un jeton pour le LAN |
| En attente | Serveur actif, aucune requête | Ouvrir le guide du client |
| Requêtes reçues | `lastActivityAt` récent | — |
| Pilotage expiré | Jeton de pilotage échu | Régénérer |
| Pilotage coupé | « Couper le pilotage » utilisé | Réactiver si voulu |

« Configuration copiée » n’est pas « connecté ».

## 8. Contrats applicatifs

Les routes `/api/agent-connections/*` de la v1.0 sont **abandonnées** : elles supposaient un serveur d’administration distant, ajouteraient une surface HTTP à un socket qui tourne dans le processus de la caméra, et rien ne les consommerait. La configuration se produit dans l’application, à partir de l’état local.

Chaque fragment client du §7.2 porte : identifiant du client, version testée et date de qualification, transport, forme d’authentification, étapes humaines, rechargement du catalogue. Un client sans qualification est présenté comme « non qualifié ».

L’application ne sonde jamais une adresse fournie par l’utilisateur : NovaGuard n’ouvre aucune connexion sortante, et `playRelease.test.ts` le vérifie. Le diagnostic de connectivité se fait **depuis l’hôte du client** (§6, `curl`).

## 9. Provisionnement et exploitation

### 9.1 Procédure idempotente (niveau B)

1. Vérifier depuis l’hôte du client : `GET /health`, puis `novaguard_get_status` avec le jeton.
2. Sauvegarder la configuration du client.
3. Fusionner la seule entrée `novaguard` ; refuser un conflit non résolu.
4. Écrire de façon atomique, permissions restreintes, jeton par variable d’environnement quand le client la substitue.
5. Recharger ou redémarrer le client.
6. Vérifier `tools/list` puis un appel de lecture.
7. Conserver une trace du résultat sans jeton ni image.

Une seconde exécution sans changement ne duplique rien et ne régénère aucun jeton : régénérer un jeton sur le téléphone casse tous les clients qui utilisent l’ancien.

### 9.2 Connexions durables

- **IP** : réservation DHCP, ou résolution DNS-SD par le script de provisionnement (`dns-sd -B _novaguard-mcp._tcp`, `avahi-browse -r _novaguard-mcp._tcp`) qui réécrit l’URL avec l’IP trouvée — jamais le nom `.local`, refusé par le contrôle `Host`.
- **Redémarrage du téléphone ou de l’application** : le serveur repart avec les mêmes jetons ; le client se reconnecte sans session à restaurer (serveur sans état).
- **Expiration du pilotage** : le client reçoit `401` sur tout appel ; ne pas réessayer en boucle, signaler qu’un nouveau jeton est à générer sur le téléphone.
- **`429`** : respecter `Retry-After: 60`.
- Après une réponse incertaine à un outil de pilotage, relire l’état (`novaguard_get_status`, `novaguard_get_event`) : tous les outils de pilotage sont idempotents et rendent `changed`, donc le rejeu est sûr, mais il ne doit pas être aveugle.

### 9.3 Observabilité

Sur le téléphone : compteur de requêtes, dernière activité, journal de pilotage (heure, commande, appliqué / inchangé / refusé). Jetons et médias ne sont jamais journalisés. Côté client : les journaux du client lui-même, qui ne doivent pas contenir l’en-tête `Authorization`. Aucun SLA n’est défini ; les cibles de latence sont celles de `mcp.md` §15.

## 10. Validation et critères d’acceptation

| ID | Scénario | Résultat attendu |
| --- | --- | --- |
| AC-01 | Installation neuve | Entrée enregistrée sans altérer les autres serveurs |
| AC-02 | Deuxième provisionnement | Aucun doublon, aucun jeton régénéré |
| AC-03 | Jeton de lecture valide | `tools/list` sans outils de pilotage ; `novaguard_get_status` réussit |
| AC-04 | Jeton absent ou faux depuis le LAN | `401` avec `WWW-Authenticate` ; le client n’entame pas de découverte OAuth |
| AC-05 | Jeton de pilotage expiré | `401`, même en lecture ; message clair dans le client |
| AC-06 | Outil de pilotage avec le jeton de lecture | `403` `NOVAGUARD_AUTH_FORBIDDEN` |
| AC-07 | « Couper le pilotage » pendant un appel | Appel en cours refusé, suivants refusés |
| AC-08 | Interrupteur de pilotage ou de vue en direct basculé | Catalogue mis à jour après rechargement du client |
| AC-09 | Client adressant le téléphone par un nom | `421`, diagnostic qui dit d’utiliser l’IP |
| AC-10 | Changement d’IP du téléphone | Reprise par réservation DHCP ou réécriture DNS-SD ; en HTTPS, aucune nouvelle confiance à accorder |
| AC-11 | Redémarrage du client ou recréation du conteneur | Configuration et confiance TLS conservées |
| AC-12 | Client multi-utilisateur, `wait_for_event` simultanés | Quatre au plus par IP ; le cinquième est refusé sans bloquer le serveur |
| AC-13 | `novaguard_get_event_frames` | Images visibles par le modèle du client, ou limite documentée |
| AC-14 | Exports et journaux du client | Aucun jeton |
| AC-15 | Client non pris en charge (claude.ai, ChatGPT, Copilot Studio) | Raison affichée ; aucune URL proposée |
| AC-16 | OpenClaw avec Gateway actif | Pas de mutation CLI forcée ; parcours Control UI indiqué |

Exécuter AC-01 à AC-14 sur les sept parcours pris en charge, en HTTP puis en HTTPS. Ce que seul un téléphone prouve (IP qui change, téléphone en arrière-plan, 9ᵉ connexion refusée) rejoint `docs/DEVICE_CHECKS.md`.

## 11. Découpage de réalisation

### Lot 0 — Audit préalable

Fait (§0). Écarts relevés dans le code, à traiter dans leur propre PR :

| Écart | Où | Effet |
| --- | --- | --- |
| L’en-tête `MCP-Protocol-Version` vaut toujours `2025-06-18`, même quand `2026-07-28` a été négocié | `McpServerModule.kt`, `respond(… LATEST_PROTOCOL)` | Un client strict peut rejeter la réponse ; renvoyer la version négociée |
| Une version inconnue reçoit `2025-06-18` alors que `2026-07-28` est prise en charge, et l’interface comme `mcp.md` annoncent `2026-07-28` | `LATEST_PROTOCOL`, `fr.ts` `setup.mcpEnabled.sub` | Contrat et affichage divergents ; choisir une seule version de référence |
| L’IP LAN est la première IPv4 non locale de n’importe quelle interface active | `localIpAddress()` | Avec un VPN ou des données mobiles actives, l’IP retenue peut ne pas être celle du Wi-Fi : `Host` refusé, certificat sans la bonne IP, URL affichée fausse. Préférer l’interface Wi-Fi ; à vérifier sur appareil |
| IPv6 LAN absente du contrôle `Host` et du certificat | `expectedAuthorities()`, `certificateAddresses()` | Un client en IPv6 seul reçoit `421` ; documenter IPv4 comme exigence ou l’ajouter |
| La config copiée et le QR portent le jeton de pilotage dès que le pilotage est actif | `SetupScreen.tsx` | Contraire au moindre privilège (§4.2) |
| Le fragment JSON n’a pas de `type` | `SetupScreen.tsx` | Rejeté ou mal interprété par les clients qui l’exigent |

### Lot 1 — Guides des clients scriptables

OpenClaw, Hermes et Claude Code : fragments, script de provisionnement idempotent, AC-01 à AC-14. Priorité fondée sur la configuration scriptable, pas sur la popularité.

### Lot 2 — Clients auto-hébergés

LibreChat, Open WebUI, puis AnythingLLM après qualification de son transport HTTP. Exemples Compose seulement à partir d’images officielles, avec la CA montée en HTTPS.

### Lot 3 — Interface

Fragments par client et choix du jeton dans Réglages (§7.2), activité par pair, avertissement `Host`. Tests Jest : un fragment par client, jeton de lecture par défaut, aucun fragment pour un client non pris en charge.

### Lot 4 — Maintien

Associer chaque fragment à une version testée et à une date. Requalifier après changement significatif du client ou du protocole.

Le lot « clients SaaS » de la v1.0 est retiré tant que la décision du §12 n’est pas prise.

## 12. Décisions à prendre

- **Accès depuis un cloud tiers** (claude.ai, ChatGPT, Copilot Studio). Le permettre veut dire un tunnel sortant ou un relais, donc une connexion sortante, une adresse publique pour une caméra et une révision de `PRIVACY.md`, du formulaire *Data safety* et de `playRelease.test.ts`. La position actuelle est non, et ce document en part.
- **Version de protocole de référence** : `2025-06-18` ou `2026-07-28`, une seule pour le code, `mcp.md` et l’interface.
- **Clients multi-utilisateurs** : un jeton par instance suffit-il, ou faut-il des jetons de lecture multiples révocables séparément ?
- **IPv6 LAN** : prise en charge ou exigence IPv4 documentée.

## 13. Sources

Documentation des clients consultée le 16 octobre 2026 ; les versions déployées priment. Le comportement du serveur vient du dépôt (`mcp.md`, `McpServerModule.kt`, `McpRules.java`, `SetupScreen.tsx`), lu à la même date.

- [S1 — Spécification MCP : transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [S1b — Spécification MCP : autorisation](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/authorization.mdx)
- [S2 — Claude : connecteurs MCP distants](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [S2b — Claude Code : MCP](https://code.claude.com/docs/en/mcp)
- [S3 — ChatGPT : serveurs MCP personnalisés](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
- [S4 — Copilot Studio : ajout d’un serveur MCP existant](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- [S5 — LibreChat : serveurs MCP](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers)
- [S6 — Open WebUI : MCP](https://docs.openwebui.com/features/extensibility/mcp/)
- [S7 — AnythingLLM : MCP sur Docker](https://docs.anythingllm.com/mcp-compatibility/docker)
- [S8 — OpenClaw : registre MCP natif](https://docs.openclaw.ai/cli/mcp/registry)
- [S8b — OpenClaw : connexion des serveurs MCP](https://docs.openclaw.ai/tools/mcp)
- [S9 — Hermes Agent : MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/)
- [S9b — Hermes Agent : référence de configuration](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)
