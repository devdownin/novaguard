# Serveurs MCP pour Apache Kafka — analyse comparative

> Relevé effectué le 2026-09-07. Les inventaires d'outils proviennent des README / documentations
> publiques des projets. Trois sources ont été **inaccessibles depuis l'environnement de rédaction**
> (`cwiki.apache.org`, `docs.confluent.io`, `docs.redpanda.com`, `docs.conduktor.io`, `aiven.io`,
> `docs.cloud.google.com` — bloqués par le proxy de sortie) : les lignes correspondantes sont
> renseignées à partir de résumés de recherche et **marquées `(déclaratif)`**. Elles sont
> exploitables pour du cadrage, pas pour une décision d'intégration ligne à ligne.

---

## 1. Le paysage

Trois familles distinctes, qui ne se concurrencent pas sur le même terrain.

| Famille | Ce qu'elle expose | Ce qu'elle suppose |
|---|---|---|
| **A. Wrappers `AdminClient`** (KIP-1318, tuannvm, Joel-hanson, kanapuli, aswinayyolath) | Les appels Kafka natifs : topics, groupes, produce/consume, configs | Rien — un bootstrap et des credentials |
| **B. Façades de plateforme** (Confluent, Redpanda, Conduktor, Lenses, Aiven, Google MSK) | L'API de la plateforme : SR, Connect, Flink, RBAC, facturation | Être client de la plateforme |
| **C. Spécialistes verticaux** (aywengo/kafka-schema-reg-mcp) | Un seul sous-système, en profondeur (57 outils sur le seul Schema Registry) | Un Schema Registry |

**Aucune des trois n'expose de couche analytique sur le contenu des topics.** C'est le trou dans
lequel un serveur MCP adossé à Kafka SQL Explorer s'insère (§5).

---

## 2. Tableau comparatif — capacités

Légende : ✅ complet · 🟡 partiel · ❌ absent · `?` non documenté publiquement.

| | KIP-1318 (Apache) | mcp-confluent | Confluent managé | Redpanda Cloud | Conduktor | Lenses | Aiven | Google MSK | tuannvm | Joel-hanson | aswinayyolath | kanapuli | aywengo (SR) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Statut** | KIP adopté, impl. en cours (KAFKA-20436) | GA, OSS | GA managé | GA | GA | GA | GA | Preview | Communauté | Communauté | Communauté | Communauté | Communauté |
| **Langage / stack** | Java (module `tools/mcp-server`) | TypeScript | — (SaaS) | Go (`rpk`) | JVM (dans la Console) | Go/JVM `?` | `?` | — (SaaS) | Go (franz-go + mcp-go) | Python | Python (kafka-python) | Go (mcp-golang) | Python (FastMCP) |
| **Licence** | Apache-2.0 | Apache-2.0 (déclaratif) | propriétaire | propriétaire | propriétaire | propriétaire | propriétaire | propriétaire | MIT/Apache `?` | MIT `?` | `?` | MIT | MIT `?` |
| **Nb d'outils annoncé** | ~15 (déclaratif) | **50+** / 13 catégories | ~10 (déclaratif) | 1 à N selon serveur | `?` | `?` | `?` | ~8 (déclaratif) | 9 | 5 | 13 | 6 | **57** |
| Lister / décrire topics | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Créer / supprimer topic | ✅ | ✅ | ❌ (déclaratif) | ✅ | 🟡 | ✅ | 🟡 (approbation) | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Produire un message | ✅ | ✅ | ❌ | ✅ | `?` | ✅ | 🟡 | ❌ | ✅ | 🟡 | ✅ | ✅ | ❌ |
| Consommer (échantillon) | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | ❌ |
| Groupes de conso + lag | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ❌ | ✅ | ❌ | ❌ |
| Configs (broker/topic) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 | ✅ | ❌ | ❌ | ❌ | ❌ |
| ACL / RBAC | 🟡 | 🟡 | ✅ | ✅ | ✅ | ✅ | `?` | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ |
| Schema Registry | ❌ (*future work*) | ✅ (3 outils) | ✅ | 🟡 | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅✅ (57) |
| Kafka Connect | ❌ | ✅ (13 outils) | ✅ + diagnostic IA | 🟡 | 🟡 | ✅ | ✅ (CDC) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Flink / stream processing | ❌ | ✅ (14 outils : SQL, catalogue, diagnostic) | ✅ | 🟡 (Connect) | ❌ | ✅ (SQL Processors) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **SQL analytique sur le contenu** | ❌ | 🟡 (Flink SQL managé) | 🟡 | ❌ | ❌ | 🟡 (SQL Lenses) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Inférence de schéma sans registre** | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Traçage cross-topic d'un message** | ❌ | ❌ | ❌ | ❌ | 🟡 (investigation) | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Modèle de données déduit** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Audit qualité (poison, doublons)** | ❌ | ❌ | ❌ | ❌ | 🟡 | 🟡 | ❌ | ❌ | 🟡 (health-check) | ❌ | 🟡 | ❌ | ❌ |
| **DLQ / retry en tant que domaine** | ❌ | ❌ | ❌ | ❌ | 🟡 | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Lag en temps (pas en offsets)** | ❌ | ❌ | ❌ | ❌ | `?` | `?` | ❌ | ❌ | 🟡 | ❌ | ❌ | ❌ | ❌ |
| Métriques / KPI | ❌ | ✅ (2 outils) | ✅ | ✅ | ✅ | ✅ | ❌ | 🟡 | 🟡 (ressources) | ❌ | 🟡 | ❌ | ❌ |
| Lineage | ❌ | 🟡 (Catalog/Tags) | 🟡 | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Documentation produit interrogeable | ❌ | ✅ (2 outils) | ✅ | ✅ | ✅ | `?` | `?` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

## 3. Tableau comparatif — surface protocolaire et sécurité

| | KIP-1318 | mcp-confluent | Conduktor | Lenses | tuannvm | aywengo (SR) | Autres communautaires |
|---|---|---|---|---|---|---|---|
| **Tools** | ✅ | ✅ | ✅ | ✅ | ✅ (9) | ✅ (57) | ✅ |
| **Resources** (`scheme://`) | ✅ `kafka://` | ❌ | `?` | `?` | ✅ (4, `kafka-mcp://`) | ✅ (19) | 🟡 (`kafka://` chez aswinayyolath) |
| **Prompts** | ❌ | ❌ | `?` | ✅ | ✅ (4) | 🟡 (*interactive tools*) | ❌ |
| **stdio** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **HTTP (streamable)** | 🟡 | ✅ (clé API) | ✅ | ✅ (`/mcp`, port 8000) | ✅ | ✅ | ❌ |
| **SSE** | ❌ | ✅ | `?` | ✅ (`/sse`) | ❌ | 🟡 | ❌ |
| **Auth MCP** | déléguée | clé API / OAuth 2.0 PKCE | PAT Console | **OAuth 2.1** (RFC 7662) + clé API | **OAuth 2.1** (Okta, Google, Azure AD, HMAC) | **OAuth 2.1** (Azure AD, Google, Keycloak, Okta, GitHub) | aucune |
| **Auth Kafka** | passthrough `security.protocol`, `sasl.*`, `ssl.*` | SASL/TLS + API keys Cloud | héritée de la Console | héritée de l'IAM Lenses | SASL PLAIN/SCRAM-256/512, TLS | n/a (HTTP SR) | variable — kanapuli **ne supporte pas SASL_SSL** |
| **Héritage des permissions utilisateur** | ❌ | 🟡 | ✅ (l'agent voit ce que voit l'utilisateur) | ✅ (IAM multi-Kafka) | ❌ | 🟡 (scopes read/write/admin) | ❌ |
| **Mode lecture seule** | 🟡 (déclaratif) | ✅ via allow/block-list | ✅ | ✅ (scope `read`) | ❌ | ✅ (`VIEWONLY` par registre) | ❌ |
| **Filtrage d'outils** | ❌ | ✅ `--allow-tools` / `--block-tools` | `?` | `?` | ❌ | ✅ `SLIM_MODE` (57 → ~9) | ❌ |
| **Masquage PII** | ❌ | ❌ | 🟡 | ✅ | ❌ | ❌ | ❌ |
| **Multi-cluster dans une config** | ❌ | ✅ (YAML multi-connexions) | ✅ | ✅ | ❌ | ✅ (8 registres) | ❌ |
| **Télémétrie / opt-out** | ❌ | ✅ (`DO_NOT_TRACK`, Sentry) | `?` | `?` | ❌ | ❌ | ❌ |

---

## 4. Ce que l'analyse fait ressortir

### 4.1 La couche « admin » est saturée et interchangeable
Neuf projets sur treize exposent le même noyau : `list_topics`, `describe_topic`, `create_topic`,
`produce`, `consume`, `list_consumer_groups`. La différenciation par cette couche est terminée —
et KIP-1318, en la livrant dans la distribution Apache et alignée sur le cycle de release des
clients Java, la rendra commoditisée pour de bon. **Un nouveau serveur qui redéfinit ces outils
n'apporte rien et se périmera.**

### 4.2 Les outils s'arrêtent à la métadonnée, pas au contenu
Sur les treize, aucun ne répond à la question qu'un ingénieur pose réellement en incident :
*« où est passée la commande ORD-101, et pourquoi elle n'est jamais arrivée à l'étape 6 ? »*.
`consume_messages` sur un topic donné n'y répond pas : il faut connaître le topic, la partition,
l'ordre des étapes, et savoir que la corrélation voyage parfois dans un header et pas dans le
payload. Ce raisonnement est aujourd'hui laissé à l'agent, qui l'improvise en enchaînant des
dizaines de `consume` — coûteux en tokens, non borné, et faux dès que la clé n'est pas dans la valeur.

### 4.3 Aucun serveur ne rend compte de sa propre couverture
C'est le défaut structurel le plus grave pour un usage agentique. `consume_messages(topic, limit=100)`
qui ne trouve rien renvoie une liste vide. Le LLM en conclut « le message n'existe pas ». La vérité
est « il n'est pas dans les 100 derniers enregistrements de la partition que j'ai lue ». Les deux
sont indiscernables dans la réponse, et mènent à des conclusions opposées. Même problème sur le lag :
une mesure impossible renvoyée comme `0` signifie *« rattrapé »* et éteint l'alerte qu'elle devait lever.

### 4.4 Le budget de tokens n'est traité que par un seul projet
`SLIM_MODE` chez aywengo (57 → ~9 outils) est la seule réponse explicite au coût du catalogue
d'outils dans le contexte. mcp-confluent y répond partiellement par des allow/block-lists, à la
charge de l'opérateur. Ailleurs, ni pagination normalisée, ni troncature signalée, ni curseur.

### 4.5 Le clivage OSS / plateforme est net
Les serveurs riches (Confluent, Lenses, Conduktor) sont des façades sur une plateforme payante,
avec leur IAM et leur gouvernance. Les serveurs OSS riches en fonctionnalités **n'existent pas** :
l'OSS s'arrête au wrapper `AdminClient`. Un serveur OSS qui apporte de l'analytique de contenu
n'a pas de concurrent direct dans sa catégorie de licence.

---

## 5. Ce que Kafka SQL Explorer apporte et qu'aucun serveur MCP n'expose

Recensé depuis [`docs/FEATURES.md`](https://github.com/devdownin/Kafkaexplorer/blob/main/docs/FEATURES.md)
et [`docs/architecture.md`](https://github.com/devdownin/Kafkaexplorer/blob/main/docs/architecture.md)
du dépôt `devdownin/Kafkaexplorer`.

| Apport Kafka SQL Explorer | Pourquoi c'est un outil MCP et pas une fonction d'UI |
|---|---|
| **Flink SQL embarqué + whitelist `SELECT`/`EXPLAIN`/`CREATE TABLE`** | Donne à l'agent un langage de requête borné sur le *contenu*, au lieu de l'obliger à consommer et raisonner en mémoire. La whitelist est une garantie de non-destruction vérifiable côté serveur, pas une consigne de prompt. |
| **Inférence de schéma zéro-config** (JSON, XML, Avro via SR) | L'agent n'a pas à deviner la structure : un outil la lui rend, avec les colonnes et le DDL prêt. |
| **Stream Flow** : traçage d'une clé à travers le cluster (clé exacte, JSONPath, XPath, header), scan parallèle borné, résultats streamés, **reprise** là où le budget s'est arrêté, comparaison de deux traces | C'est exactement le raisonnement multi-tours que l'agent ferait mal et cher. Un seul appel, un budget, une couverture. |
| **Couverture honnête** : chaque trace dit combien de topics et de messages ont été lus, pourquoi elle s'est arrêtée, et **quels topics n'ont jamais été atteints** | Corrige directement le défaut §4.3. Un résultat vide devient « pas dans la fenêtre scannée », jamais « inexistant ». |
| **Modèle de données déduit** : entités = topics, relations déduites des noms de colonnes clés, **graduées `HIGH`/`MEDIUM`/`LOW` avec l'évidence en clair**, ouvrables en `JOIN` | Une relation graduée avec son évidence est une donnée qu'un LLM peut pondérer. Une relation non graduée est une hallucination servie par l'API. Le refus de générer un `JOIN` pour un ensemble non connecté est la même discipline. |
| **Audit fonctionnel** : messages poison, doublons par clé, drop-off entre étapes, latence inter-topics, historique persisté dans un topic Kafka | Un « health check » qui porte sur les *données* et pas sur les brokers. Aucun autre serveur ne l'a. |
| **Dead Letter & Retry** : arrivées + **part de la source** (le taux d'échec), appairage source exact/inféré, verdicts *quiet/retrying/receiving/surging/not measured*, trous dessinés comme trous et non comme zéro | Le domaine que tous les autres traitent comme « un topic parmi d'autres ». |
| **Lag en temps** (`CONSUMER_TIME_LAG`) : l'âge du plus vieux message non lu — et **`null` avec sa raison** quand la mesure échoue | 4 000 messages, c'est 4 secondes ici et 4 jours là. Seule la seconde forme réveille quelqu'un. |
| **KPI Prometheus suggérés depuis ce qui a été observé** (audit, traces, jobs Flink, mapping validé), **qui ne créent rien** | Un outil MCP qui *propose* et laisse la création à un appel explicite : le bon découpage lecture/écriture pour un agent. |
| **Lineage résolu par le parseur Flink**, avec repli lexical **annoncé** quand la résolution échoue | Une arête manquante et une dépendance absente sont indiscernables : le dire est la fonctionnalité. |
| **Kafka 4 natif** : quorum KRaft, groupes KIP-848, share groups KIP-932, feature versions, détection d'upgrade non finalisé | Aucun serveur communautaire n'expose le quorum ni les feature versions. |
| **Rédaction des secrets** dans tout DDL/config rendu | Un DDL Kafka porte `sasl.jaas.config`. Le renvoyer à un LLM hébergé est une fuite. |
| **Repointage de cluster gardé (HTTP 409)** pendant un audit / un job / une session live | Un agent qui repointe le cluster au milieu d'un audit produit un rapport décrivant deux clusters. |

---

## 6. Positionnement recommandé pour `kafkaexplorer-mcp`

**Ne pas réimplémenter la famille A.** KIP-1318 la livrera dans Apache Kafka. Le serveur MCP de
Kafka SQL Explorer doit se poser en **couche analytique complémentaire**, composable avec un serveur
admin dans le même client MCP.

Trois principes de cadrage, qui découlent directement des §4 et §5 :

1. **Lecture seule par construction**, pas par configuration. Pas de `produce`, pas de
   `create_topic`, pas de `delete_topic`. La whitelist SQL existante (`SELECT`/`EXPLAIN`/`CREATE TABLE`)
   est déjà cette frontière côté application ; le serveur MCP l'hérite au lieu de la contourner.
   Les rares écritures (créer une métrique) sont dans un profil séparé, désactivé par défaut.
2. **Chaque réponse porte sa couverture et ses incertitudes.** C'est le seul apport de cette liste
   qu'aucun concurrent ne peut copier sans réécrire son modèle de données.
3. **Budget de tokens traité comme une contrainte de conception**, pas comme un réglage : profils
   `slim` / `full`, pagination normalisée, troncature signalée avec curseur.

La spécification complète est dans [`SPEC-MCP-KAFKAEXPLORER.md`](SPEC-MCP-KAFKAEXPLORER.md).

---

## 7. Sources

- [KIP-1318: Model Context Protocol (MCP) Server for Apache Kafka](https://cwiki.apache.org/confluence/display/KAFKA/KIP-1318:+Model+Context+Protocol+(MCP)+Server+for+Apache+Kafka) · [KAFKA-20436](https://issues.apache.org/jira/browse/KAFKA-20436)
- [confluentinc/mcp-confluent](https://github.com/confluentinc/mcp-confluent) · [Confluent managed MCP servers](https://docs.confluent.io/cloud/current/ai/ai-tools/managed-mcp-server.html) · [MCP for Confluent Manager for Apache Flink](https://docs.confluent.io/cp-flink/current/clients-api/mcp.html)
- [Redpanda Cloud Management MCP Server](https://docs.redpanda.com/cloud-data-platform/develop/cloud-mcp/) · [Kafka Managed MCP Server (Agentic Data Plane)](https://docs.redpanda.com/agentic-data-plane/connect/managed/kafka/)
- [Conduktor — Kafka MCP server for AI assistants](https://docs.conduktor.io/guide/conduktor-in-production/automate/mcp) · [AI for Kafka Operations](https://www.conduktor.io/blog/ai-kafka-operations)
- [Lenses MCP for Kafka](https://lenses.io/blog/2025/10/lenses-mcp-new-era-in-ai-enablement-for-streaming-app-dev/) · [lensesio/lenses-mcp](https://github.com/lensesio/lenses-mcp)
- [Aiven — Kafka MCP Server](https://aiven.io/blog/kafka-mcp)
- [Google Cloud — Managed Service for Apache Kafka remote MCP server](https://docs.cloud.google.com/managed-service-for-apache-kafka/docs/use-managed-service-for-apache-kafka-mcp)
- [tuannvm/kafka-mcp-server](https://github.com/tuannvm/kafka-mcp-server) · [Joel-hanson/kafka-mcp-server](https://github.com/Joel-hanson/kafka-mcp-server) · [aswinayyolath/kafka-mcp-server](https://github.com/aswinayyolath/kafka-mcp-server) · [kanapuli/mcp-kafka](https://github.com/kanapuli/mcp-kafka) · [jonyx225/MCP_Kafka](https://github.com/jonyx225/MCP_Kafka)
- [aywengo/kafka-schema-reg-mcp](https://github.com/aywengo/kafka-schema-reg-mcp)
- [devdownin/Kafkaexplorer](https://github.com/devdownin/Kafkaexplorer) — `README.md`, `docs/FEATURES.md`, `docs/architecture.md`
