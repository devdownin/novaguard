# NovaGuard — Connexion des agents IA par MCP

- Version : 2.2
- Date : 16 octobre 2026
- Statut : décisions prises (§12) ; lots 0 et 3 implémentés, relais et OAuth (R1 à R3) aussi ; parcours clients **non qualifiés sur appareil** (§10). **Accès depuis le cloud : décidé le 16 octobre 2026, par relais intégré à l’application (§14) ; le service `relay/`, le client de l’application et le serveur d’autorisation OAuth existent ; aucune instance du relais n’est déployée et rien n’a été essayé avec un vrai client cloud.**
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

Aucun classement d’usage des huit produits n’est affirmé. Les syntaxes de configuration clientes viennent de leur documentation (§15) et n’ont pas été rejouées contre un téléphone : chacune est à qualifier (§10) avant d’être présentée comme fonctionnelle.

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
- Versions négociées : `2024-11-05`, `2025-03-26`, `2025-06-18`, `2026-07-28` ; une version inconnue reçoit `2026-07-28`. Chaque réponse porte `MCP-Protocol-Version` : la version négociée sur `initialize`, celle du client ensuite ; un en-tête de version inconnue est refusé en `400`, son absence (client antérieur à 2025-06-18) est acceptée.
- Pas de `stdio`. Un client qui ne parle que `stdio` passe par un pont (§6.1, Claude Desktop) ; ce pont ne doit rien écrire sur sa sortie standard en dehors du protocole.

### 3.3 Adressage et réseau

| Mode | Écoute | Accès |
| --- | --- | --- |
| Sans jeton | `127.0.0.1:port` | Applications du téléphone seulement ; lecture sans jeton, jamais de pilotage |
| Jeton de lecture et/ou de pilotage | Toutes les interfaces | Toute requête hors boucle locale présente un jeton |
| HTTPS (option, éteint par défaut) | Idem, en TLS, boucle locale comprise | Le client fait confiance à la CA du téléphone |

Contrôles qui décident si un client se connecte :

- **`Host`** doit valoir exactement `127.0.0.1:port`, `localhost:port`, `[::1]:port` ou `<IPv4 LAN>:port`, sinon `421`. L’IPv4 LAN est celle du Wi-Fi, du point d’accès ou de l’Ethernet, jamais celle d’un VPN ou des données mobiles (`McpRules.lanAddress`). Le LAN est servi en IPv4 seulement. Conséquences : adresser le téléphone **par son IP**, port explicite ; un reverse proxy doit transmettre ce `Host` inchangé ; un nom mDNS, un nom de service Docker ou un port implicite (443 derrière un proxy) est refusé.
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
- Sur le réseau local, un `401` porte `WWW-Authenticate: Bearer realm="NovaGuard MCP"`, sans `resource_metadata`. Un client qui tente une découverte OAuth sur ce `401` échoue (`GET` → `405`) : **désactiver explicitement OAuth** dans tout client qui le propose. Par le relais, le `401` porte `resource_metadata` et le client suit la découverte (§14.3).

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
| claude.ai (connecteurs distants) | Seulement via le relais (§14) : appel depuis l’infrastructure d’Anthropic | OAuth | A puis C | **Implémenté, non qualifié** |
| ChatGPT | Seulement via le relais (§14) : appel depuis l’infrastructure d’OpenAI | OAuth (ou sans authentification, exclu) | A puis C | **Implémenté, non qualifié** |
| Copilot Studio | Seulement via le relais (§14) : appel depuis l’infrastructure Microsoft | Clé d’API ou OAuth | A/B puis C | **Implémenté, non qualifié** |
| LibreChat | Oui, auto-hébergé sur le LAN | `mcpServers` dans `librechat.yaml` | B/C/D | À qualifier |
| Open WebUI | Oui, auto-hébergé sur le LAN | MCP natif Streamable HTTP, clé/en-tête | A/B/C | À qualifier |
| AnythingLLM | Oui, Desktop ou Docker sur le LAN | `anythingllm_mcp_servers.json` | B, C à qualifier | À qualifier (transport HTTP et en-têtes) |
| OpenClaw | Oui, Gateway sur le LAN | Registre `mcp.servers` + CLI | B/C/D | À qualifier |
| Hermes Agent | Oui, sur le LAN | `mcp_servers` dans `config.yaml` | B/C/D | À qualifier |

Tant que le relais du §14 n’existe pas, ces trois clients restent **non pris en charge** : le téléphone n’est pas joignable depuis leur cloud, et le sélecteur de Réglages ne leur propose rien. Le §14 décrit ce que la décision du 16 octobre 2026 change.

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
3. « Client de l’agent » et « Jeton de la configuration » (§7.2), puis « Copier l’URL », « Copier le jeton », « Copier la configuration », QR code de la config JSON (jeton compris, avec l’avertissement correspondant).
4. Certificat de la CA et son empreinte, en HTTPS.
5. « Voir les services MCP » : ce qu’un agent peut lire et faire avec les réglages actuels.
6. Dernière activité IA et journal des appels de pilotage.

### 7.2 Ajouts de la version 2.1

| Manque relevé | Réponse | Où |
| --- | --- | --- |
| Une seule config JSON, sans `type`, valide pour aucun client | « Client de l’agent » : sept fragments, chacun dans la forme du §6 ; la config JSON et le QR code déclarent `type: http` | `src/surveillance/mcpClients.ts` |
| La config portait le jeton de pilotage dès que le pilotage était actif | « Jeton de la configuration » : lecture par défaut, pilotage seulement si choisi et encore valide | `fragmentToken` |
| Clients cloud présentés comme les autres | Absents de la liste ; une ligne dit pourquoi ils ne peuvent pas joindre le téléphone | `setup.mcpClient.unsupported` |
| Aucun avertissement sur `Host` | « Adressez le téléphone par cette IP… » et la réservation DHCP | `setup.mcpHost.hint` |

Reste à faire : activité par IP de pair (nombre de requêtes, dernière activité), sans plus — un nom de client est autodéclaré et ne prouve rien.

Les fragments embarquent le jeton en clair pour être collés tels quels (niveau A) ; le provisionnement scripté (niveau B, §9.1) remplace la valeur par une variable d’environnement quand le client la substitue. Le choix du client et du jeton n’est pas un réglage : il n’est ni persisté ni lu ailleurs que sur cet écran.

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

| Écart | Où | Effet | Statut |
| --- | --- | --- | --- |
| L’en-tête `MCP-Protocol-Version` valait toujours `2025-06-18`, même quand `2026-07-28` était négocié | `McpServerModule.kt` | Un client strict pouvait rejeter la réponse | Corrigé : `McpRules.responseProtocol`, testé sur JVM |
| Une version inconnue recevait `2025-06-18` alors que l’interface et `mcp.md` annoncent `2026-07-28` | `LATEST_PROTOCOL` | Contrat et affichage divergents | Corrigé : `McpRules.LATEST_PROTOCOL = 2026-07-28` |
| L’IP LAN était la première IPv4 non locale de n’importe quelle interface | `localIpAddress()` | Avec VPN ou données mobiles : `Host` refusé, certificat sans la bonne IP, URL fausse | Corrigé : `McpRules.lanAddress` ; à vérifier sur appareil |
| IPv6 LAN absente du contrôle `Host` et du certificat | `expectedAuthorities()`, `certificateAddresses()` | Un client en IPv6 seul reçoit `421` | Décidé : IPv4 exigée et documentée (§12) |
| La config et le QR portaient le jeton de pilotage dès que le pilotage était actif | `SetupScreen.tsx` | Contraire au moindre privilège (§4.2) | Corrigé (§7.2) |
| Le fragment JSON n’avait pas de `type` | `SetupScreen.tsx` | Rejeté par les clients qui l’exigent | Corrigé (§7.2) |

Le Kotlin modifié n’est compilé par aucune vérification locale : le build APK de la PR (job `changes` de `ci.yml`) le valide.

### Lot 1 — Guides des clients scriptables

OpenClaw, Hermes et Claude Code : fragments, script de provisionnement idempotent, AC-01 à AC-14. Priorité fondée sur la configuration scriptable, pas sur la popularité.

### Lot 2 — Clients auto-hébergés

LibreChat, Open WebUI, puis AnythingLLM après qualification de son transport HTTP. Exemples Compose seulement à partir d’images officielles, avec la CA montée en HTTPS.

### Lot 3 — Interface

Fait, sauf l’activité par pair (§7.2). Tests : `__tests__/mcpClients.test.ts` (un fragment par client, jeton de lecture par défaut, aucun jeton de pilotage expiré), `__tests__/setupUx.test.tsx` (choix du jeton dans le QR code, liste des clients).

### Lot 4 — Maintien

Associer chaque fragment à une version testée et à une date. Requalifier après changement significatif du client ou du protocole.

Le lot « clients SaaS » de la v1.0 est retiré (§12).

## 12. Décisions

| Question | Décision | Conséquence |
| --- | --- | --- |
| Accès depuis un cloud tiers (claude.ai, ChatGPT, Copilot Studio) | **Oui, par un relais intégré à l’application** (décision du 16 octobre 2026, qui remplace le « non » de la v2.1). L’application ouvre une connexion sortante vers un relais ; option éteinte par défaut | Fin de « aucune connexion sortante » : `PRIVACY.md`, `PRIVACY.en.md`, `docs/PLAY_STORE.md` (*Data safety*), `CLAUDE.md`, `mcp.md` §5 et `playRelease.test.ts` sont à réécrire dans la même PR que le code (§14.6) |
| Version de protocole de référence | **`2026-07-28`**, une seule pour le code (`McpRules.LATEST_PROTOCOL`), `mcp.md` et l’interface | Les versions antérieures restent négociables |
| Clients multi-utilisateurs | **Un jeton de lecture par téléphone**, partagé par l’instance ; jamais le jeton de pilotage | Révoquer un client, c’est régénérer le jeton et reconfigurer les autres ; des jetons multiples seraient une évolution du serveur |
| IPv6 sur le LAN | **IPv4 exigée**, documentée | Un client en IPv6 seul n’est pas pris en charge |

Ces décisions se rouvrent par une révision de ce document, pas au fil d’une intégration.

**Tranchées le 16 octobre 2026 :** le projet exploite le relais (§14.2), et le modèle de confiance où le relais voit le trafic en clair, images comprises, est accepté (§14.4). Il reste à déployer l’instance du projet : l’adresse n’existe pas encore, et l’application ne contient aucune valeur par défaut tant qu’elle n’existe pas.

## 14. Accès depuis le cloud : relais intégré

Conception. Le service `relay/` (R1) et le client de l’application (R2) existent. Cette section est la seule de ce document à décrire un changement du contrat de confidentialité, réécrit avec le code (§14.6).

### 14.1 Principe

claude.ai, ChatGPT et Copilot Studio appellent le serveur MCP depuis leur infrastructure : il leur faut une URL HTTPS publique, avec un certificat qu’ils acceptent. Un téléphone derrière une box n’en a pas. L’application ouvre donc **elle-même** une connexion sortante vers un relais, qui expose l’URL publique et lui transmet les requêtes :

```text
claude.ai ──HTTPS──► relais (https://<id>.relais.exemple/mcp) ◄──WSS sortant── téléphone
                      transmet la requête ─────────────────────►  serveur MCP du téléphone
                      ◄───────────────────────────────────────   la réponse
```

Le téléphone n’écoute rien de plus : il initie la connexion, aucune redirection de port n’est nécessaire.

### 14.2 Le relais

- Service minimal, sans stockage : il associe un identifiant d’appareil à une connexion WebSocket et transmet des trames. Il ne garde ni corps de requête, ni images, ni jetons ; ses journaux ne contiennent que l’heure, l’identifiant, le statut et la taille.
- Code dans ce dépôt (`relay/`), **auto-hébergeable** : l’adresse du relais est un réglage de l’application. Aucune valeur par défaut n’est livrée tant que la question d’hébergement ci-dessous n’est pas tranchée.
- **Exploitation : le projet.** Une instance du projet est la valeur par défaut, ce qui engage son mainteneur (disponibilité, coût, abus, responsabilité sur ce qui y transite). Le code reste auto-hébergeable et l’adresse reste un réglage, pour qui préfère ne rien confier à l’instance du projet. Le déploiement et son adresse sont à fournir par le mainteneur ; `relay/Dockerfile` en est la base.
- Appairage : l’application génère une paire de clés Ed25519 (Android Keystore). L’identifiant public est un **condensé de la clé**, donc personne ne peut prendre l’adresse d’un autre téléphone sans sa clé privée : le relais n’a ni registre ni code d’appairage. À chaque connexion il envoie un défi aléatoire que le téléphone signe ; une signature invalide ferme la connexion (code 4003).
- Quotas par appareil, taille maximale de trame, une seule connexion par appareil (la nouvelle remplace l’ancienne), expiration des requêtes à 15 s comme en local.

### 14.3 Ce que le serveur du téléphone change

1. **Une requête venue du relais n’est jamais une requête de boucle locale.** Aujourd’hui `McpRules.principal` donne la lecture sans jeton à la boucle locale ; une trame du relais arriverait de l’intérieur du processus. Elle porte une origine `relay` qui exige toujours un jeton ou une autorisation OAuth, et le test JVM le vérifie.
2. **Contrôles `Host` et `Origin`** : le nom d’hôte public du relais devient une autorité attendue, uniquement tant que le relais est actif.
3. **Authentification.** claude.ai et ChatGPT n’envoient pas de jeton statique choisi par l’utilisateur : ils attendent OAuth 2.1 (code d’autorisation + PKCE, métadonnées de ressource protégée, `WWW-Authenticate` avec `resource_metadata`). Copilot Studio accepte une clé d’API. Le serveur d’autorisation tourne **sur le téléphone**, derrière le relais : l’autorisation se termine par un geste du propriétaire sur l’écran de l’appareil (« Autoriser Claude ? »), et les jetons émis sont gardés par empreinte, révocables un par un dans Réglages.

   Décisions de mise en œuvre (R3) :
   - **Le consentement est sur le téléphone, pas sur la page web.** `GET /authorize` ouvre une demande et affiche un code à quatre chiffres ; le téléphone affiche le même, avec le nom du client et l'hôte de retour. La page web attend (elle interroge `authorize/status`) et ne reçoit le code d'autorisation qu'une fois la demande acceptée, une seule fois. Le code à comparer est ce qui permet au propriétaire de reconnaître la connexion qu'il vient de lancer.
   - **Plafonds** : 3 demandes en attente, 120 s de validité, code d'autorisation 60 s à usage unique, 20 clients enregistrés, 10 autorisations ; au-delà, refus (`429` pour les demandes). Un client sans autorisation est évincé le premier.
   - **Redirections** : liste d'hôtes (`claude.ai`, `claude.com`, `chatgpt.com`, `chat.openai.com`, sous-domaines de `azure-apim.net`) et boucle locale en `http` pour les clients natifs. Un hôte inconnu est refusé à l'enregistrement. Ajouter un client cloud, c'est ajouter son hôte dans `McpOAuth.java` et son test.
   - **Jetons** : accès 1 h, rafraîchissement 30 jours avec rotation ; un jeton de rafraîchissement rejoué, ou un code d'autorisation rejoué, révoque l'autorisation qu'il avait ouverte.
   - **Un jeton OAuth n'ouvre que le relais.** `principalFor` ne l'accepte pas sur la socket du réseau local.
   - **Notification** : une demande qui attend fait sonner « Autoriser un assistant à lire ? » (sans le nom du client à l'écran verrouillé), et l'invite s'affiche dans l'application dès qu'elle passe au premier plan.
4. **Périmètre cloud réduit par défaut** : lecture seule. Le pilotage et la vue en direct via le relais ont chacun leur interrupteur, éteints par défaut, en plus de ceux qui existent. Le jeton de pilotage actuel n’est jamais accepté par le relais.
5. L’en-tête `Authorization` n’est plus la seule forme d’identité : `principalFor` sait distinguer jeton de lecture, jeton de pilotage, jeton OAuth et origine.

### 14.4 Ce que le relais voit

Le certificat public est celui du relais : il **termine TLS et voit en clair** les requêtes et les réponses, donc les images de `get_event_frames` et de `get_live_frame`. Un chiffrement de bout en bout entre le téléphone et claude.ai n’existe pas, puisque le client cloud ne connaît pas la clé du téléphone. Ce qui reste possible :

- relais auto-hébergé, donc sous le contrôle du propriétaire ;
- aucun stockage ni journal de contenu côté relais ;
- consentement explicite à l’activation, qui nomme le relais utilisé et dit qu’il voit tout ce que l’agent demande ;
- le fournisseur du client cloud reçoit en plus ce que l’agent lit (déjà vrai avec un modèle hébergé, `mcp.md` §14).

**Décision (16 octobre 2026) : ce modèle de confiance est accepté**, images comprises. Le consentement du §14.5 le dit sans l’atténuer.

### 14.5 Interface

Réglages → Serveur MCP, nouvelle ligne « Accès depuis le cloud », éteinte par défaut :

- activation avec écran de consentement (relais utilisé, ce qu’il voit, ce que l’agent pourra lire) ;
- état : connecté, hors ligne (avec raison), dernière activité ;
- appairage et URL publique à copier ;
- liste des autorisations accordées (client, date, dernière utilisation) avec « Révoquer » ;
- bouton « Couper l’accès cloud » aussi dans la notification de surveillance, à côté de « Couper le pilotage ».

La connexion sortante n’est ouverte que tant que l’interrupteur est allumé et le serveur MCP actif.

### 14.6 Contrat de confidentialité

La phrase « NovaGuard n’ouvre aucune connexion sortante » devient fausse dès que le code existe. Elle a été réécrite **dans la même PR** que le client du relais, dans ces fichiers :

| Fichier | Changement |
| --- | --- |
| `PRIVACY.md`, `PRIVACY.en.md` | Décrire la connexion optionnelle au relais, ce qui transite, qui l’exploite, comment la couper |
| `docs/PLAY_STORE.md`, formulaire *Data safety* | Fait dans le dépôt ; reste à revalider dans la Console avant de publier une instance du relais : revoir « aucune connexion sortante » et la définition de « collecte » / « partage » de Google pour des données transmises à un relais que l’utilisateur choisit |
| `CLAUDE.md` | Réécrire le paragraphe « `INTERNET` est déclarée, et seulement pour écouter » |
| `mcp.md` §5, §6, §14 | Retirer « Public Internet exposure … not supported » ; décrire le relais |
| `__tests__/playRelease.test.ts` | Le motif des connexions sortantes admet **un seul fichier** (le client du relais) ; toute autre connexion sortante échoue encore |

### 14.7 Lots

| Lot | Contenu | Prérequis |
| --- | --- | --- |
| R0 | Trancher l’hébergement (§14.2) et le modèle de confiance (§14.4) | **Fait** |
| R1 | Service `relay/` : authentification par défi, transmission, quotas ; tests de protocole | **Fait** : `relay/`, 15 tests `node:test` dans le job `check` de la CI. Reste à le déployer |
| R2 | Client du relais dans l’application (Kotlin) : connexion sortante, origine `relay` dans `McpRules`, tests JVM | **Fait**, sauf l’action « Couper l’accès cloud » de la notification (R4). Le Kotlin est validé par le build APK de la PR ; rien n’a été essayé sur un téléphone |
| R3 | Serveur d’autorisation OAuth sur le téléphone : métadonnées, DCR ou clients préenregistrés, consentement sur l’appareil, révocation | **Fait** : `McpOAuth.java` (flux, PKCE, expiration, rotation, plafonds ; testé sur la JVM), `McpOAuthServer.kt` (HTTP, page de confirmation, fichier d’état), `McpAuthNotifier.kt` (notification), liste et révocation dans Réglages. Le relais route les documents `.well-known` avec leur préfixe. Reste à qualifier avec les trois clients |
| R4 | Interface (§14.5) et réécriture du contrat de confidentialité (§14.6) | Contrat **fait** avec R2 ; interface en partie (interrupteur, consentement, état, adresse). Restent : liste des autorisations, « Couper l’accès cloud » dans la notification, adresse du relais modifiable |
| R5 | Qualification de bout en bout avec chacun des trois clients cloud ; AC-17 à AC-20 ci-dessous | R4 |

Critères d’acceptation à ajouter à §10 :

| ID | Scénario | Résultat attendu |
| --- | --- | --- |
| AC-17 | Requête par le relais sans autorisation | `401` avec `WWW-Authenticate` et `resource_metadata` ; jamais traitée comme boucle locale (`McpRules.relayPrincipal`, test JVM ; `resource_metadata` : `McpRelayRules.challenge`) |
| AC-18 | Autorisation OAuth depuis claude.ai | Consentement sur le téléphone ; un refus ou une absence de réponse sous 2 minutes échoue proprement |
| AC-19 | « Couper l’accès cloud » pendant un appel | Connexion sortante fermée, appel en cours refusé, plus aucune requête transmise |
| AC-20 | Interrupteur éteint | Aucune connexion sortante ouverte (vérifié sur appareil et par `playRelease.test.ts`) |

## 15. Sources

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
