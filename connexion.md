# NovaGuard — Spécification technique de connexion des agents IA par MCP

- Version : 1.0
- Date : 16 octobre 2026
- Statut : proposition d’architecture à valider sur le code de NovaGuard
- Clients : Claude, ChatGPT, Microsoft Copilot Studio, LibreChat, Open WebUI, AnythingLLM, OpenClaw et Hermes Agent de Nous Research.

## 1. Objectif et périmètre

Permettre à un utilisateur ou administrateur de connecter un agent généraliste aux outils de NovaGuard avec un minimum de configuration, puis de réutiliser la connexion après redémarrage et expiration normale des jetons.

La solution couvre l’enregistrement du serveur dans le client, l’authentification, la découverte des outils, leur sélection, le diagnostic, le renouvellement des accès et la révocation. Elle ne crée pas un nouveau moteur d’agent et ne remplace pas les règles d’approbation des clients.

Aucun classement d’usage des huit produits n’est affirmé : cette sélection repose sur leurs capacités MCP documentées. Certaines solutions sont des assistants conversationnels ; d’autres sont des plateformes d’agents ou des interfaces à configurer.

### 1.1 État des connaissances

Le dépôt NovaGuard n’a pas été consulté avec succès durant cette analyse. Aucun transport, endpoint, mécanisme OAuth ou outil ci-dessous ne doit être considéré comme déjà implémenté dans NovaGuard. Les chemins applicatifs, permissions et noms de ressources proposés sont des contrats cibles, à adapter après audit.

Les commandes clientes correspondent à la documentation consultée. Leur disponibilité doit être vérifiée sur les versions réellement déployées. Aucun appel réel à NovaGuard ni test d’intégration n’a été effectué pour produire ce document.

## 2. Principes de connexion

Distinguer quatre opérations :

1. **Provisionner** : enregistrer l’adresse et les paramètres du serveur dans un client.
2. **Authentifier** : obtenir une autorisation utilisateur ou une identité de service.
3. **Connecter** : initialiser une session MCP et découvrir les outils.
4. **Exécuter** : sélectionner les outils et les appeler avec les droits applicables.

Une URL MCP et des métadonnées OAuth ne suffisent pas à installer automatiquement un connecteur dans tous les comptes SaaS. Une connexion technique n’implique pas non plus que le client utilisera spontanément les outils : sélection de l’agent, profil d’outils et règles de conversation restent applicables.

### 2.1 Niveaux d’automatisation cibles

| Niveau | Résultat | Intervention humaine |
| --- | --- | --- |
| A — guidé | URL et instructions adaptées au client | Ajout du connecteur et autorisation initiale |
| B — préconfiguré | Entrée du serveur installée par script ou fichier | Autorisation initiale en OAuth délégué |
| C — réutilisable | Reconnexion et renouvellement des accès | Réauthentification si révocation, politique ou échec de renouvellement |
| D — sans présence | Exécution avec identité de service | Création et attribution initiales de l’identité |

Le niveau D exige la prise en charge effective du mode machine par le serveur, le fournisseur d’identité et le client. Il ne doit pas être déduit du seul support d’OAuth.

## 3. Architecture cible

### 3.1 Composants

| Composant | Responsabilité |
| --- | --- |
| Page NovaGuard « Connecter un agent IA » | Choix du client, génération de configuration et aide au diagnostic |
| Endpoint MCP | Initialisation, catalogue et exécution des outils |
| Serveur d’autorisation | Authentification, consentement, émission et renouvellement des jetons |
| Contrôle d’accès NovaGuard | Vérification de l’utilisateur, de l’environnement, du périmètre et des permissions à chaque appel |
| Gestion des secrets | Stockage des identifiants techniques et certificats selon le déploiement |
| Journal d’audit | Traçabilité des accès, appels et changements de permissions |

Un reverse proxy peut assurer TLS et routage. S’il porte l’authentification, la transmission de l’identité et l’application des droits dans NovaGuard doivent être explicites et vérifiées ; un simple proxy HTTP ne fournit pas automatiquement OAuth MCP.

### 3.2 Transport

Cible principale : **Streamable HTTP** derrière HTTPS pour les accès distants.

Exemple d’adresse à remplacer :

```text
https://novaguard.example.com/mcp
```

- Conserver une URL stable par environnement.
- Préserver les en-têtes MCP, les identifiants de session éventuels et les flux requis par le transport.
- Valider les origines acceptées et les hôtes ; configurer CORS seulement pour les usages navigateur qui l’exigent.
- Prévoir des délais de proxy compatibles avec les appels longs et annulations.
- Ne pas ajouter un adaptateur `stdio` sans besoin client identifié. Un processus `stdio` ne doit pas écrire de logs sur sa sortie protocolaire.

Sur un réseau Docker partagé, les clients auto-hébergés peuvent utiliser le DNS du service NovaGuard. Dans un conteneur, `localhost` désigne ce conteneur. Les clients SaaS doivent disposer d’un chemin réseau accessible depuis leur infrastructure ; un VPN installé uniquement sur le poste utilisateur ne suffit pas.

## 4. Authentification et droits

### 4.1 Mode utilisateur recommandé

OAuth avec flux Authorization Code et PKCE, compatible avec les exigences MCP du client et du fournisseur d’identité :

1. Le client connaît déjà l’URL MCP.
2. Il découvre les métadonnées de ressource protégée et le serveur d’autorisation.
3. L’utilisateur s’authentifie et accorde les permissions demandées.
4. Le client obtient ses jetons et appelle NovaGuard.
5. Il renouvelle l’accès si un mécanisme de renouvellement est disponible et autorisé.

Publier les métadonnées de découverte applicables, dont les Protected Resource Metadata, et un challenge `WWW-Authenticate` approprié. Le chemin exact de découverte dépend de l’URL de ressource et de la version de spécification retenue. [S1]

L’enregistrement dynamique du client, les clients préenregistrés et les mécanismes plus récents ne sont pas uniformément disponibles : établir une matrice avec le fournisseur d’identité choisi. Ne pas exiger DCR de tous les clients.

### 4.2 Mode service

Pour les déploiements contrôlés : jeton dédié ou autre authentification machine prise en charge. Un compte technique ne doit pas servir à attribuer fictivement des actions à plusieurs utilisateurs.

Exigences proposées :

- identité distincte par installation et environnement ;
- droits minimaux et durée de vie documentée ;
- stockage hors des configurations exportables et du dépôt ;
- rotation et révocation ;
- aucune transmission de secret dans l’URL ou les logs.

Les permissions cibles, par exemple `novaguard.read` et `novaguard.execute`, restent à définir à partir des outils réels. Le filtrage d’outils côté agent améliore l’ergonomie mais ne remplace jamais l’autorisation côté serveur.

### 4.3 Séparation des plans d’accès

Séparer l’identité employée pour appeler le modèle LLM de celle utilisée pour appeler NovaGuard. Un abonnement à un assistant ne fournit pas automatiquement un accès API au modèle ni une autorisation MCP.

## 5. Matrice des huit clients

| Client | Mécanisme documenté | Automatisation cible | Condition principale |
| --- | --- | --- | --- |
| Claude | Connecteur MCP distant ; intégrations locales selon la surface Desktop | A puis C | Ajout initial et autorisation individuelle |
| ChatGPT | Connexion MCP personnalisée distante | A puis C | Offre, permissions et surface web compatibles |
| Copilot Studio | Serveur MCP ajouté comme outil d’un agent | A/B puis C | Configuration de l’agent, de la connexion et de son authentification |
| LibreChat | `mcpServers` dans `librechat.yaml` | B puis C ou D | Configuration et secrets gérés par l’opérateur |
| Open WebUI | MCP natif Streamable HTTP | A/B puis C | Enregistrement administratif et connexion utilisateur si OAuth |
| AnythingLLM | `anythingllm_mcp_servers.json` | B, puis C/D à qualifier | Transport et authentification à confirmer sur la version retenue |
| OpenClaw | Registre natif `mcp.servers` et CLI | B puis C/D à qualifier | Cycle de vie Gateway et profil d’outils |
| Hermes Agent | `mcp_servers` dans `config.yaml` et CLI | B puis C/D à qualifier | Persistance de la configuration et des accès |

Cette matrice ne garantit pas une compatibilité de bout en bout avec NovaGuard. Les guides suivants définissent les parcours à qualifier.

## 6. Parcours par client

### 6.1 Claude et Claude Desktop

Parcours distant : présenter le nom, l’URL MCP et les instructions d’ajout d’un connecteur personnalisé. L’utilisateur autorise ensuite la connexion. En organisation, l’ajout administratif et la connexion individuelle sont distincts. La connexion distante part de l’infrastructure d’Anthropic. [S2]

NovaGuard doit proposer : bouton de copie de l’URL, guide de connexion et aide OAuth. Un lien prérempli peut être ajouté seulement après validation officielle et test sur les surfaces ciblées ; aucun lien universel d’installation silencieuse n’est supposé.

Le parcours local Desktop est distinct : ne pas appliquer au connecteur distant un fichier de configuration prévu pour un processus local.

### 6.2 ChatGPT

Fournir l’URL HTTPS, les paramètres d’authentification et le guide d’ajout d’un serveur MCP personnalisé. Respecter les droits d’administration et de publication du workspace. La documentation consultée distingue notamment le support complet Business/Enterprise/Edu de capacités plus limitées selon les autres offres ; vérifier l’éligibilité avant de générer des instructions. [S3]

Ne pas promettre la création d’un connecteur personnalisé depuis l’application mobile. Aucun endpoint public universel de provisionnement des comptes ChatGPT n’est présumé. Après modification du catalogue, prévoir la revue et l’actualisation des outils approuvés dans le workspace.

### 6.3 Microsoft Copilot Studio

Ajouter le serveur MCP à l’agent, sélectionner son authentification et créer la connexion. La documentation prévoit une clé API ou OAuth, avec plusieurs variantes de découverte et d’enregistrement. [S4]

Automatisation proposée : préparer un paquet de déploiement et les références de connexion seulement si les outils ALM de la version retenue le permettent. Qualifier les capacités d’export/import avant de promettre un déploiement sans interface. Séparer la publication de l’agent de l’authentification personnelle des utilisateurs.

### 6.4 LibreChat

Exemple pour une installation contrôlée utilisant un jeton statique accepté par NovaGuard :

```yaml
mcpServers:
  novaguard:
    type: streamable-http
    url: "${NOVAGUARD_MCP_URL}"
    requiresOAuth: false
    headers:
      Authorization: "Bearer ${NOVAGUARD_MCP_TOKEN}"
```

LibreChat documente la substitution de variables d’environnement et la configuration OAuth. [S5] Ce bloc ne constitue pas une authentification OAuth : `requiresOAuth: false` correspond ici au choix explicite d’un en-tête statique.

Le déploiement doit monter le fichier, injecter le secret via le mécanisme retenu et affecter les outils au bon agent. Ne pas supposer qu’un secret Docker est automatiquement converti en variable d’environnement. Fusionner la seule entrée `novaguard` sans écraser les autres serveurs.

### 6.5 Open WebUI

Enregistrer NovaGuard comme serveur MCP Streamable HTTP. L’administrateur configure le serveur ; en OAuth, chaque utilisateur connecte son propre compte. Le support MCP natif documenté ne couvre pas directement `stdio` et l’ancien transport SSE. [S6]

Pour une automatisation du provisionnement, utiliser uniquement une API administrative ou une configuration officiellement prise en charge par la version installée. À défaut, conserver l’enregistrement initial guidé ; ne pas écrire directement dans la base de données.

La vérification OAuth de l’interface ne prouve pas qu’un outil peut être appelé : effectuer aussi un appel métier de lecture.

### 6.6 AnythingLLM

Préinstaller l’entrée NovaGuard dans `anythingllm_mcp_servers.json`, dans le répertoire `plugins` du stockage AnythingLLM, et persister ce stockage. La documentation décrit le démarrage de serveurs lors de l’accès aux compétences d’agent ou de l’invocation de l’agent. [S7]

Avant de produire un modèle JSON exécutable, confirmer sur la version Desktop/Docker retenue le schéma, les transports distants et le traitement de l’authentification. Si un adaptateur est nécessaire, documenter son nom, sa version, son stockage des secrets et son cycle de vie. Aucun adaptateur ni support OAuth distant n’est présumé ici.

### 6.7 OpenClaw

Utiliser en priorité le registre natif. Exemple si OAuth et Streamable HTTP sont disponibles côté NovaGuard :

```bash
openclaw mcp add novaguard \
  --url https://novaguard.example.com/mcp \
  --transport streamable-http \
  --auth oauth

openclaw mcp login novaguard
openclaw mcp doctor novaguard --probe
```

Les opérations CLI de mutation, de connexion OAuth et de sonde documentées exigent que le Gateway propriétaire du stockage soit arrêté. Pour une instance en fonctionnement, utiliser les fonctions prises en charge dans la Control UI. Le rechargement CLI ne recharge pas tous les processus distants. [S8]

Le script cible doit détecter l’existence de l’entrée avant de l’ajouter. Une mise à jour doit préserver ses accès et filtres, sauf demande explicite. Vérifier le profil d’outils de l’agent : une entrée enregistrée ne garantit pas son exposition à l’agent.

MCPorter possède un registre distinct de `mcp.servers`. Ne pas configurer les deux simultanément sans besoin identifié. `openclaw mcp serve` expose OpenClaw comme serveur ; cette commande ne connecte pas OpenClaw à NovaGuard.

### 6.8 Hermes Agent de Nous Research

Bloc à fusionner dans `~/.hermes/config.yaml` :

```yaml
mcp_servers:
  novaguard:
    url: "https://novaguard.example.com/mcp"
    auth: oauth
```

Puis :

```bash
hermes mcp login novaguard
hermes mcp test novaguard
```

Hermes découvre les outils au démarrage. Une session existante peut les recharger avec `/reload-mcp`. Les jetons sont conservés séparément dans `~/.hermes/mcp-tokens/` ; persister et protéger cet emplacement pour éviter une reconnexion après recréation du conteneur. [S9]

Sur une machine distante, le flux device code peut être utilisé si le serveur d’autorisation le prend en charge :

```bash
hermes mcp login novaguard --flow device
```

Prévoir un client OAuth préenregistré lorsque l’enregistrement dynamique n’est pas disponible. Le mode entièrement automatique doit être qualifié séparément. Ne pas confondre le client MCP avec `hermes mcp serve`, qui expose Hermes à un autre client. [S9]

## 7. Interface NovaGuard proposée

Point d’entrée : **Paramètres → Intégrations → Agents IA**.

### 7.1 Assistant de connexion

1. Choisir l’un des huit clients et sa version.
2. Choisir l’environnement NovaGuard et l’adresse accessible depuis ce client.
3. Choisir l’accès utilisateur OAuth ou l’identité de service, si compatible.
4. Définir les droits à partir du catalogue réel ; proposer la lecture seule au départ.
5. Copier les commandes, télécharger un fragment de configuration ou suivre le guide SaaS.
6. Effectuer la connexion puis afficher les résultats du diagnostic.

Ne pas télécharger de secret dans les fragments de configuration par défaut. Lorsqu’un secret est créé, fournir son accès par le canal approprié et masquer sa valeur après l’affichage autorisé.

### 7.2 États affichés

| État | Signification | Action |
| --- | --- | --- |
| À configurer | Aucune preuve d’enregistrement | Ouvrir le guide |
| En attente d’autorisation | OAuth non terminé | Autoriser |
| Authentifié | Identité validée, outils non encore vérifiés | Tester |
| Outils accessibles | Initialisation et catalogue réussis | Tester un appel de lecture |
| Opérationnel | Appel réel de lecture réussi et daté | Utiliser |
| Accès refusé | Identité reconnue, droits insuffisants | Vérifier les droits |
| Indisponible | Échec réseau ou protocolaire | Diagnostiquer |
| Révoqué | Accès explicitement retiré | Reconnecter si autorisé |

NovaGuard ne peut pas connaître l’état interne d’un client SaaS sans canal de retour. Afficher « configuration téléchargée » plutôt que « connecté » tant qu’aucun événement ou appel corrélé ne prouve la connexion.

## 8. Contrats applicatifs proposés

Ces routes sont des propositions pour NovaGuard, distinctes des méthodes JSON-RPC MCP et des API des clients tiers.

| Route cible | Fonction | Exigence |
| --- | --- | --- |
| `GET /api/agent-connections/templates` | Lister clients et versions qualifiées | Références documentaires et limites |
| `POST /api/agent-connections` | Créer un profil de connexion | Authentification et droits de gestion |
| `GET /api/agent-connections/{id}/configuration` | Générer un fragment spécifique | Valeurs publiques, placeholders de secrets |
| `GET /api/agent-connections/{id}/status` | Restituer les preuves observées | Horodatage, provenance et périmètre |
| `POST /api/agent-connections/{id}/revoke` | Révoquer l’accès dédié | Ne pas affecter les autres connexions |

Ne pas proposer une sonde serveur vers une URL arbitraire fournie par l’utilisateur sans protection SSRF. Un test exécuté depuis NovaGuard ne prouve pas la connectivité depuis l’hôte agent : identifier l’origine de chaque diagnostic.

Chaque modèle client doit contenir un identifiant de version, la plage cliente testée, les transports, les modes d’authentification, les étapes humaines et les instructions de rechargement. Une version inconnue reçoit le statut « non qualifiée ».

## 9. Provisionnement et exploitation

### 9.1 Procédure idempotente cible

1. Valider la version du client et le profil choisi.
2. Résoudre l’URL et vérifier son accessibilité depuis le contexte du client.
3. Sauvegarder la configuration existante sans dupliquer les secrets.
4. Fusionner uniquement l’entrée NovaGuard ; refuser un conflit non résolu.
5. Écrire de façon atomique et restreindre les permissions locales.
6. Authentifier si nécessaire ; un processus sans terminal doit signaler qu’une autorisation est requise plutôt qu’attendre indéfiniment.
7. Recharger ou redémarrer selon le client.
8. Vérifier la session, le catalogue et un appel de lecture.
9. Conserver une preuve de résultat sans jeton ni données métier sensibles.

Une nouvelle exécution sans changement ne doit ni dupliquer l’entrée, ni révoquer les jetons, ni modifier les autres serveurs. En cas d’échec de fusion, conserver la version précédente.

### 9.2 Connexions durables

Persister les configurations et magasins d’accès propres à chaque client. Réinitialiser les sessions MCP devenues invalides selon le protocole. Appliquer un backoff borné aux reconnexions réseau et ne pas répéter indéfiniment une autorisation refusée.

Après une réponse incertaine à un outil modifiant des données, ne pas rejouer automatiquement l’action : vérifier son résultat ou utiliser un mécanisme d’idempotence métier supporté par NovaGuard.

### 9.3 Observabilité

Journaliser : identifiant de connexion, client/version lorsque connus, identité, environnement, outil, résultat, durée, horodatage UTC et identifiant de corrélation. Identifier explicitement les champs autodéclarés ; un nom de client ne constitue pas une preuve d’identité.

Mesures proposées : taux d’initialisation réussie, erreurs OAuth, renouvellements échoués, latence des outils, refus d’accès et compatibilité par version. Définir les seuils d’exploitation après mesure ; ne pas inventer de SLA.

## 10. Validation et critères d’acceptation

| ID | Scénario | Résultat attendu |
| --- | --- | --- |
| AC-01 | Installation neuve | Connexion enregistrée sans altérer les paramètres existants |
| AC-02 | Deuxième exécution du provisionnement | Aucun doublon ni nouvelle autorisation injustifiée |
| AC-03 | OAuth initial | Autorisation explicite et identité correcte |
| AC-04 | Expiration normale | Renouvellement si supporté, sinon action de reconnexion claire |
| AC-05 | Redémarrage/recréation du conteneur | Configuration et accès autorisés conservés |
| AC-06 | Initialisation et `tools/list` | Catalogue conforme aux droits et filtres |
| AC-07 | Appel de lecture | Résultat réel reçu et preuve datée |
| AC-08 | Appel hors périmètre | Refus serveur, même si l’outil est visible côté agent |
| AC-09 | Révocation | Accès retiré dans le délai défini pour le mécanisme d’authentification |
| AC-10 | Panne réseau / session expirée | Reconnexion bornée, diagnostic précis, pas de double mutation |
| AC-11 | Mise à jour du catalogue | Parcours de rafraîchissement adapté à chaque client |
| AC-12 | Export et logs | Aucun secret ni donnée non autorisée |
| AC-13 | OpenClaw avec Gateway actif | Pas de mutation CLI forcée ; indication du parcours supporté |
| AC-14 | Hermes distant | Callback joignable ou device flow réellement supporté |
| AC-15 | Client non qualifié | Limite explicite ; aucune affirmation de compatibilité garantie |

Exécuter les scénarios applicables sur les huit clients avec les versions retenues. Les modes service, utilisateur, local et distant constituent des variantes distinctes. Une découverte réussie seule n’est pas une preuve de fonctionnement métier.

## 11. Découpage de réalisation

### Lot 0 — Audit préalable

Confirmer le transport, la bibliothèque et la version MCP de NovaGuard ; inventorier ses outils et effets de bord ; relever l’authentification, les permissions et l’infrastructure existantes. Produire une matrice « disponible / à adapter / absent ».

### Lot 1 — Socle d’accès

Implémenter ou adapter Streamable HTTP, HTTPS, contrôle d’accès, métadonnées OAuth et traces. Choisir les versions du protocole prises en charge et les tester avec le SDK retenu.

### Lot 2 — OpenClaw et Hermes en priorité

Livrer les deux modèles et guides, le provisionnement idempotent et les scénarios de redémarrage. Cette priorité est une recommandation d’implémentation fondée sur la configuration scriptable documentée, pas un classement de popularité.

### Lot 3 — Clients auto-hébergés

Ajouter LibreChat et Open WebUI, puis qualifier AnythingLLM avant de fournir ses configurations exécutables. Prévoir des exemples Compose uniquement à partir des images et options officiellement validées.

### Lot 4 — Clients SaaS

Ajouter Claude, ChatGPT et Copilot Studio avec instructions contextualisées, droits requis et parcours d’autorisation. Tester les surfaces web et les limites d’offre.

### Lot 5 — Interface et maintien

Livrer l’assistant, les diagnostics et la révocation. Associer chaque modèle client à une version testée et à une date de qualification. Requalifier après changement significatif du client, du protocole ou du fournisseur d’identité.

## 12. Décisions à prendre avant développement

- Adresse et hébergement réels de NovaGuard ; environnement local, privé ou accessible aux SaaS.
- Transport MCP actuel et éventuel besoin de migration.
- Fournisseur d’identité, clients OAuth, callbacks et mécanisme d’enregistrement acceptés.
- Catalogue d’outils, permissions et actions nécessitant approbation.
- Versions clientes de référence et offres SaaS disponibles.
- Prise en charge ou non des identités de service.
- Mécanisme de révocation et délai effectif, notamment pour les jetons autonomes.

Ces points n’empêchent pas de préparer l’interface et les modèles publics ; ils conditionnent toute promesse de connexion opérationnelle.

## 13. Sources officielles

Documentation consultée le 16 octobre 2026. Les versions déployées priment sur la documentation courante.

- [S1 — Spécification MCP : autorisation](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/authorization.mdx)
- [S2 — Claude : connecteurs MCP distants](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [S3 — ChatGPT : connexion de serveurs MCP personnalisés](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
- [S4 — Copilot Studio : ajout d’un serveur MCP existant](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
- [S5 — LibreChat : configuration des serveurs MCP](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers)
- [S6 — Open WebUI : MCP](https://docs.openwebui.com/features/extensibility/mcp/)
- [S7 — AnythingLLM : MCP sur Docker](https://docs.anythingllm.com/mcp-compatibility/docker)
- [S8 — OpenClaw : registre MCP natif](https://docs.openclaw.ai/cli/mcp/registry)
- [S8b — OpenClaw : connexion des serveurs MCP](https://docs.openclaw.ai/tools/mcp)
- [S9 — Hermes Agent : MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/)
- [S9b — Hermes Agent : référence de configuration](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)
