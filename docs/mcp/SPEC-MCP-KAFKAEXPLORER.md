# `kafkaexplorer-mcp` — spécification

Serveur MCP adossé à [Kafka SQL Explorer](https://github.com/devdownin/Kafkaexplorer).
Complément analytique aux serveurs MCP « admin » existants (cf. [analyse comparative](ANALYSE-COMPARATIVE-MCP-KAFKA.md)).

- **Version de la spec** : 1.0 — 2026-09-07
- **Cible** : Kafka SQL Explorer ≥ 1.x (Spring Boot 4.1, Java 25, Flink 2.3, clients Kafka 4.3)
- **Protocole** : MCP `2025-06-18`, JSON-RPC 2.0

---

## 1. Objectifs

1. Exposer aux agents la **couche analytique** de Kafka SQL Explorer : SQL sur le contenu, inférence
   de schéma, traçage cross-topic, modèle de données déduit, audit qualité, DLQ, lag en temps, KPI.
2. **Ne pas dupliquer** la couche admin (KIP-1318, mcp-confluent…) : elle est commoditisée.
3. Rendre chaque réponse **auto-descriptive quant à sa couverture et à ses incertitudes**, pour
   qu'un LLM ne puisse pas conclure « absent » d'un « pas trouvé dans ce que j'ai lu ».
4. Tenir un **budget de tokens** explicite : profils d'outils, pagination, troncature signalée.

### Non-objectifs (assumés)

| Hors périmètre | Raison |
|---|---|
| `produce`, `create_topic`, `delete_topic`, `alter_config` | L'application est en lecture seule par construction. Un agent qui écrit dans un topic de production est un incident, pas une fonctionnalité. Utiliser le serveur MCP Apache aux côtés de celui-ci. |
| Gestion des ACL / RBAC Kafka | Relève de la plateforme, pas de l'explorateur. |
| Kafka Connect | Non couvert par l'application. |
| Multi-cluster dans une même instance | L'application est mono-cluster par instance (repointage gardé). Un agent multi-cluster déclare N serveurs MCP. |

---

## 2. Architecture

### 2.1 Décision : module in-process, pas process séparé

Le serveur MCP est un **module Maven `mcp-server` packagé dans le même JAR**, exposant un endpoint
`/mcp` à côté de l'API REST, et appelant **directement les beans de service** (`KafkaAdminService`,
`FlinkSqlService`, `AuditService`, `DataModelService`, `StreamFlowService`, `MetricService`,
`SchemaInferenceService`).

```
┌────────────────────────── kafka-sql-explorer.jar ──────────────────────────┐
│  React SPA ──▶ /api/**  (REST)  ┐                                          │
│                                  ├──▶ Services ──▶ Flink 2.3 ──▶ Kafka     │
│  Agent MCP ──▶ /mcp     (MCP)   ┘        │                                 │
│                                          └──▶ AdminClient / Consumers      │
└────────────────────────────────────────────────────────────────────────────┘
```

**Alternative rejetée** — process Node/Python séparé consommant l'API REST : double authentification,
un aller-retour HTTP de plus par appel, et surtout un contrat REST qui n'a jamais été conçu comme une
API publique (il dérive à chaque release de l'UI). Le module in-process partage les budgets, les
caches Caffeine, le cycle de vie de l'`AdminClient` et le garde de repointage.

**Alternative rejetée** — exposer l'API REST telle quelle via un proxy OpenAPI→MCP : produirait
~40 outils calqués sur les besoins de l'UI (`/api/dashboard/activity`, `/api/config/llm-models`),
avec des payloads dimensionnés pour un navigateur et non pour une fenêtre de contexte.

### 2.2 Stack

| Élément | Choix |
|---|---|
| SDK MCP | `spring-ai-starter-mcp-server-webmvc` (transport HTTP streamable, servlet) |
| Transport principal | HTTP streamable sur `POST /mcp` (même port que l'app, 8080) |
| Transport local | `stdio` via `java -jar … --mcp.stdio` (profil `mcp-stdio`, SPA et REST désactivés) |
| Déclaration des outils | `@Tool` sur des méthodes de classes `*McpTools`, `record` en entrée/sortie |
| Sérialisation | Jackson, `structuredContent` MCP + résumé texte |

Aucun nouveau conteneur, aucune image supplémentaire : `docker run -p 8080:8080 …` suffit, et
l'endpoint MCP est activable par une variable d'environnement.

---

## 3. Contrat transversal des réponses

**C'est le cœur de la spécification.** Toute réponse d'outil retournant des données mesurées est
enveloppée dans le record suivant. Un outil qui ne peut pas remplir `coverage` n'a pas le droit de
renvoyer une liste.

```java
/**
 * Enveloppe commune. Sérialisée en structuredContent MCP.
 * Le résumé texte rendu à l'agent restitue TOUJOURS coverage.stoppedReason et le nombre
 * d'éléments non atteints — un agent qui ne lit que le texte ne doit pas pouvoir rater la limite.
 */
public record McpResult<T>(
        T data,
        Coverage coverage,
        List<Note> notes,
        Page page) {

    /** Ce qui a été réellement lu, et pourquoi la lecture s'est arrêtée. */
    public record Coverage(
            int topicsScanned,
            int topicsRequested,
            long recordsScanned,
            long elapsedMs,
            StopReason stoppedReason,      // COMPLETED | TIME_BUDGET | RECORD_BUDGET | CANCELLED | PARTIAL_FAILURE
            List<String> topicsNotReached, // nommés, jamais résumés en un compte
            String resumeToken) {          // null si COMPLETED
    }

    /** Une incertitude nommée. `evidence` est en clair : elle est destinée à être citée par l'agent. */
    public record Note(Severity severity, String code, String message, String evidence) { }

    public record Page(Integer returnedCount, Boolean truncated, String nextCursor) { }
}
```

### 3.1 Règles opposables

| # | Règle | Contre-exemple qu'elle interdit |
|---|---|---|
| R1 | Un résultat vide s'accompagne toujours d'un `coverage` non nul. | `[]` seul, que l'agent lit comme « n'existe pas ». |
| R2 | Une mesure impossible est `null` + une `Note` portant sa raison. **Jamais `0`.** | Un lag à `0` parce que la partition n'a pas pu être lue → alerte éteinte. |
| R3 | Toute inférence (relation, appairage DLQ, source d'un topic) porte `confidence` ∈ {`HIGH`,`MEDIUM`,`LOW`} et une `evidence` textuelle. | Une relation servie comme un fait. |
| R4 | Tout DDL, config ou chaîne de connexion renvoyé est passé par le rédacteur de secrets existant. | `sasl.jaas.config` avec le mot de passe envoyé à un LLM hébergé. |
| R5 | Toute réponse tronquée porte `page.truncated=true` et un `nextCursor` utilisable. | Une troncature silencieuse qui fait conclure sur un échantillon. |
| R6 | Un outil qui dépasse son budget renvoie ce qu'il a **avec** `resumeToken`, il n'échoue pas. | Un timeout qui jette 40 s de scan. |
| R7 | Aucun outil ne modifie l'état sans être dans le profil `write`, désactivé par défaut. | Une « suggestion » de KPI qui crée la métrique. |

---

## 4. Catalogue d'outils

`slim` = présent dans le profil réduit (12 outils, ~4 k tokens de catalogue).
`W` = profil `write` (désactivé par défaut). Les autres sont en lecture seule.

### 4.1 Cluster & topologie

| Outil | Profil | Paramètres | Renvoie |
|---|---|---|---|
| `cluster_describe` | slim | — | brokers, contrôleur, **quorum KRaft** (leader, epoch, high watermark, lag par réplique), **feature versions** finalisées vs supportées + badge de retard, groupes clients par type (`CLASSIC`/`CONSUMER`/`SHARE`/`STREAMS`) |
| `cluster_configs` | | `resourceType`, `resourceName?` | configs, secrets rédigés (R4) |
| `topic_list` | slim | `prefix?`, `regex?`, `includeDlt=true`, `cursor?`, `limit=100` | nom, partitions, comptes, dernier message, verdict d'activité |
| `topic_describe` | slim | `name` | partitions, offsets min/max, taille estimée, type détecté (JSON/XML/AVRO/BINARY), badge DLT |
| `topic_ddl` | | `name` | DDL Flink prêt à exécuter, **secrets rédigés** |
| `topic_activity` | | `topics[]` (≤ `explorer.activity-max-topics`), `windowMs?`, `buckets?` | séries par bucket, verdicts *quiet/receiving/surging/not measured* |

### 4.2 Contenu & schéma

| Outil | Profil | Paramètres | Renvoie |
|---|---|---|---|
| `topic_sample` | slim | `name`, `limit≤50`, `from=LATEST\|EARLIEST`, `partition?` | enregistrements (clé, headers, payload tronqué à `record-max-value-chars`), formatage JSON/XML |
| `topic_get_record` | | `name`, `partition`, `offset` | un enregistrement complet |
| `topic_search` | slim | `name`, `query`, `mode=TEXT\|REGEX\|JSONPATH\|XPATH\|HEADER`, `from?`, `to?`, `limit≤search-max-hits` | occurrences **+ `coverage` : enregistrements scannés et raison d'arrêt** (R1) |
| `topic_infer_schema` | slim | `name`, `sampleSize≤inference-sample-size` | colonnes inférées, type de source, DDL généré, **`confidence` par colonne** ; Avro résolu via Schema Registry quand présent |

### 4.3 SQL analytique — le différenciateur

| Outil | Profil | Paramètres | Renvoie |
|---|---|---|---|
| `sql_validate` | | `sql` | verdict de la whitelist (`SELECT`/`EXPLAIN`/`CREATE TABLE`), erreur de parse Flink, tables référencées |
| `sql_run` | slim | `sql`, `maxRows≤default-max-rows`, `timeoutMs≤default-query-timeout-ms`, `readMode=EARLIEST\|LATEST` | lignes, colonnes, moteur ayant répondu, **`coverage.stoppedReason`** si borné par `maxRows` ou par le budget |
| `sql_explain` | | `sql` | plan Flink |
| `sql_register_table` | slim | `topic`, `ddl?` (sinon dérivé de `topic_infer_schema`) | nom de la table enregistrée |
| `sql_list_tables` | slim | — | tables et vues dynamiques du catalogue Flink |
| `sql_drop_table` | | `name` | — (le catalogue Flink local n'est pas le cluster : cette suppression ne touche aucun topic, d'où le maintien hors profil `write`) |
| `sql_cancel` | | `queryId` | — |

`readMode` injecte le hint `/*+ OPTIONS('scan.startup.mode'='…') */`, comme l'UI : l'agent n'a pas à
réécrire le DDL pour relire depuis le début.

### 4.4 Traçabilité — `stream_flow`

| Outil | Profil | Paramètres | Renvoie |
|---|---|---|---|
| `trace_message` | slim | `criterion`, `matchMode=EXACT_KEY\|TEXT\|REGEX\|JSONPATH\|XPATH\|HEADER\|ANY`, `topics[]?`, `from?`, `to?`, `budgetMs?`, `maxTopics≤explorer.stream-flow-max-topics` | hops ordonnés (topic, partition, offset, timestamp, latence depuis le hop précédent), hop le plus lent marqué, dérive d'horloge signalée, **`coverage` complet avec `topicsNotReached` nommés et `resumeToken`** |
| `trace_continue` | | `resumeToken` | les hops des topics non lus, **fusionnés dans la même chaîne** |
| `trace_compare` | | `criterionA`, `criterionB`, mêmes options | topics communs, topics atteints par un seul, **écart de latence par hop** (jamais des timestamps absolus comparés) |
| `lineage_graph` | | `includeJobs=true` | nœuds topics/tables/vues/jobs, arêtes ; **`resolvedBy=FLINK_PARSER\|LEXICAL_FALLBACK`** avec la raison du repli (R3) |

`matchMode=EXACT_KEY` restreint le scan à la partition que le partitionneur par défaut (murmur2)
aurait choisie — c'est la sémantique réelle de « retrouver l'enregistrement X », et c'est une
fraction du travail. `ANY` couvre clé + payload + headers, parce qu'un identifiant de corrélation
voyage très souvent dans un header seul.

### 4.5 Modèle de données

| Outil | Profil | Paramètres | Renvoie |
|---|---|---|---|
| `data_model_build` | | `topics[]` (≤ `explorer.data-model-max-topics`, 100), `perTopicTimeoutMs?` | entités (colonnes inférées, clé détectée **ou absente**), relations avec `confidence` + `evidence` en clair, colonnes ressemblant à une clé étrangère mais sans relation **signalées** (R3), topics coûtés sans schéma nommés avec leur raison |
| `data_model_join_sql` | | `entities[]` | une requête joignant l'ensemble, chaque prédicat citant une table déjà introduite — **ou un refus nommant l'entité non atteignable** |
| `data_model_export` | | `topics[]`, `format=MERMAID\|JSON` | `erDiagram` Mermaid ou JSON, portant la ligne de couverture |

`data_model_join_sql` **refuse plutôt que d'inventer un prédicat**. C'est le comportement le plus
important de la section pour un agent : un `JOIN` plausible mais faux est indétectable en aval.

### 4.6 Santé & audit

| Outil | Profil | Paramètres | Renvoie |
|---|---|---|---|
| `audit_start` | | `topics[]?`, `exactCounts=false`, `budgetMs?` | `auditId` (asynchrone) |
| `audit_status` | slim | `auditId` | avancement, findings partiels |
| `audit_cancel` | | `auditId` | rapport partiel, **conservé** (R6) |
| `audit_last` | slim | — | dernier rapport : poison, doublons par clé, drop-off entre étapes, latence inter-topics, findings consommateurs, **upgrade `metadata.version` non finalisé** |
| `audit_history` | | `limit≤audit-history-max-records` | runs passés depuis `internal.audit.history` |
| `audit_compare` | | `idA`, `idB` | évolution des findings entre deux runs |
| `consumer_group_list` | | `topic?`, `limit≤consumer-group-max-groups` | groupes, type, état, membres |
| `consumer_group_lag` | slim | `groupId`, `topics[]?` | lag en enregistrements **et** en temps ; une partition non lue est `null` + `Note` (R2), jamais `0` |

### 4.7 Dead Letter & Retry

| Outil | Profil | Paramètres | Renvoie |
|---|---|---|---|
| `dlq_overview` | slim | `windowMs?`, `kind=DEAD_LETTER\|RETRY\|ALL` | par file : arrivées par bucket, **part de la source** (taux d'échec), topic source avec `pairing=EXACT\|INFERRED\|AMBIGUOUS` + les candidats nommés si ambigu, verdict *quiet/retrying/receiving/surging/not measured*, buckets sans trafic amont rendus comme **trous** et non comme zéro |
| `dlq_inspect` | | `topic`, `sampleSize≤20`, `groupBy?` | regroupement des rejets par `failure_reason`/`exception`/`original-topic`, **avec la taille de l'échantillon** ; les enregistrements sans le champ sont comptés comme tels, pas exclus du dénominateur ; consommateurs assignés à la file |

### 4.8 Métriques & KPI

| Outil | Profil | Paramètres | Renvoie |
|---|---|---|---|
| `metric_list` | | — | métriques configurées, type Prometheus, seuils, état (et *pourquoi* une métrique est en attente : le plus souvent l'alias `AS metric_value` manquant) |
| `metric_suggest` | | — | KPI proposés depuis l'audit, les traces, les jobs Flink et le mapping validé — **chaque carte nommant la mesure sur laquelle elle repose** ; ne crée rien |
| `metric_preview` | | `definition` | résultat d'un tour d'exécution, sans persistance |
| `metric_create` | **W** | `definition` | métrique persistée dans `internal.metrics` |
| `metric_delete` | **W** | `id` | — |

### 4.9 Process Mining (LLM) — module optionnel

Désactivé par défaut (`explorer.mcp.llm-tools-enabled=false`). Ces outils **appellent un fournisseur
LLM externe** : un agent qui les invoque déclenche un coût et, selon le fournisseur, une sortie de
données. Les exposer sans le dire serait la fuite que §5 interdit.

| Outil | Profil | Renvoie |
|---|---|---|
| `process_profile` | | champs `CORRELATION_ID`/`TIMESTAMP`/`STATUS` détectés par topic ; un run impossible (pas de clé API, endpoint muet, réponse non parsable) est rapporté **comme tel avec sa cause**, jamais comme « rien trouvé » |
| `process_snapshot` | | flowchart Mermaid du processus reconstruit + anomalies (ruptures de séquence, délais, incohérences), **avec les tokens et le coût réel rapporté par le fournisseur**, et la politique de rétention effective (`LOCAL_ONLY`/`NO_RETENTION`/`RETENTION_ALLOWED`/`ENDPOINT_TERMS`) |
| `process_audit_templates` | | bibliothèque de checks prêts (ordonnancement, doublons, flux orphelins, SLA, dérive de schéma, transitions invalides, PII, intégrité de corrélation), ceux dont le champ requis n'a pas été profilé étant marqués indisponibles |

---

## 5. Ressources MCP

Contenu stable, lisible sans appel d'outil — l'agent peut les attacher au contexte en début de session.

| URI | Contenu | Cache |
|---|---|---|
| `kafkaexplorer://cluster/overview` | Résumé cluster : brokers, version, quorum, nombre de topics, groupes | `explorer.cache-expire-seconds` (30 s) |
| `kafkaexplorer://topics` | Catalogue des topics avec type détecté et badge DLT | 30 s |
| `kafkaexplorer://topic/{name}/schema` | Schéma inféré + DDL rédigé | à la demande |
| `kafkaexplorer://audit/last` | Dernier rapport d'audit, résumé | à la publication |
| `kafkaexplorer://dlq/overview` | État des files d'échec | 60 s |
| `kafkaexplorer://metrics/catalog` | Métriques configurées et leurs seuils | à la modification |
| `kafkaexplorer://capabilities` | **Ce que cette instance peut réellement faire** : Flink actif ?, Schema Registry joignable ?, LLM configuré ?, profil d'outils, budgets effectifs | au démarrage |

`kafkaexplorer://capabilities` évite le pire échec agentique : appeler `topic_infer_schema` sur un
topic Avro alors qu'aucun Schema Registry n'est joignable, et interpréter le résultat dégradé comme
la structure réelle.

## 6. Prompts MCP

| Prompt | Arguments | Enchaînement guidé |
|---|---|---|
| `incident_trace` | `correlationId`, `since?` | `trace_message(ANY)` → si `topicsNotReached` non vide, `trace_continue` → `dlq_overview` → conclusion **citant la couverture** |
| `dlq_triage` | `windowMs?` | `dlq_overview` → `dlq_inspect` sur les files *surging* → `consumer_group_lag` sur leurs consommateurs |
| `cluster_health_review` | — | `audit_last` (ou `audit_start`) → `cluster_describe` → `consumer_group_lag` → rapport gradué |
| `model_a_domain` | `topicPrefix` | `topic_list(prefix)` → `data_model_build` → `data_model_join_sql` → `sql_run` |
| `kpi_from_audit` | — | `audit_last` → `metric_suggest` → `metric_preview` ; s'arrête là (R7) |

Chaque prompt se termine par la consigne : *« énonce ce qui n'a pas été lu avant de conclure »*.

---

## 7. Sécurité

| Sujet | Décision |
|---|---|
| **Écriture Kafka** | Impossible. Aucun producteur n'est exposé. Le seul chemin d'écriture de l'application (ses topics `internal.*`) est derrière le profil `write`. |
| **Whitelist SQL** | Héritée telle quelle : `SELECT`, `EXPLAIN`, `CREATE TABLE`. Validation côté serveur avant soumission à Flink, pas côté prompt. |
| **Auth du transport HTTP** | `explorer.mcp.auth.mode` : `NONE` (stdio / loopback), `API_KEY` (bearer statique, comparaison à temps constant), `OAUTH2` (resource server Spring Security, scopes `explorer.read` / `explorer.write` / `explorer.llm`). Par défaut : `API_KEY` si l'endpoint n'écoute pas sur loopback, refus de démarrer si aucune clé n'est posée. |
| **Rédaction des secrets** | R4, appliquée dans le sérialiseur MCP et pas seulement dans les services — un nouvel outil ne doit pas pouvoir fuiter par oubli. Test de non-régression : aucune réponse d'outil ne contient `sasl.jaas.config`, `password`, `confluent-secret`. |
| **Repointage de cluster** | Non exposé en MCP. Un agent ne repointe pas un cluster. |
| **Concurrence** | Les outils longs (`sql_run`, `trace_message`, `audit_start`, `data_model_build`) partagent le sémaphore `explorer.max-concurrent-jobs` de l'application. Au-delà : refus explicite nommant ce qui tourne, pas une mise en file silencieuse. |
| **Traçabilité** | Chaque appel d'outil journalisé : nom, arguments tronqués, durée, `stoppedReason`, principal appelant. Compteurs Micrometer `explorer_mcp_tool_calls_total{tool,outcome}` sur `/actuator/prometheus`. |
| **Fuite via LLM** | Les outils `process_*` sont le seul chemin où des données quittent l'hôte. Désactivés par défaut, et leur réponse porte la politique de rétention effective **lue sur l'adresse résolue**, pas sur le nom du fournisseur. |

---

## 8. Configuration

```yaml
explorer:
  mcp:
    enabled: ${EXPLORER_MCP_ENABLED:false}      # opt-in : une app existante ne s'ouvre pas toute seule
    path: /mcp
    transport: HTTP                              # HTTP | STDIO
    tool-profile: ${EXPLORER_MCP_TOOL_PROFILE:slim}   # slim (12 outils) | full (~35)
    write-enabled: false                         # débloque metric_create / metric_delete
    llm-tools-enabled: false                     # débloque process_* (coût + sortie de données)
    allow-tools: []                              # liste blanche, prioritaire sur le profil
    block-tools: []
    max-response-bytes: 262144                   # au-delà : troncature + nextCursor (R5)
    max-concurrent-calls: 4
    auth:
      mode: ${EXPLORER_MCP_AUTH_MODE:API_KEY}    # NONE | API_KEY | OAUTH2
      api-key: ${EXPLORER_MCP_API_KEY:}
      issuer-uri: ${EXPLORER_MCP_OAUTH_ISSUER:}
```

Les budgets métier ne sont **pas redéclarés** : `search-max-scan`, `search-max-hits`,
`data-model-max-topics`, `activity-max-topics`, `default-max-rows`, `default-query-timeout-ms`,
`audit-max-duration-ms`, `consumer-group-max-groups` restent les propriétés existantes, et
`kafkaexplorer://capabilities` les publie pour que l'agent dimensionne ses appels au lieu de les
découvrir par troncature.

### Déclaration côté client

```json
{
  "mcpServers": {
    "kafka-explorer": {
      "type": "http",
      "url": "https://kafka-explorer.internal/mcp",
      "headers": { "Authorization": "Bearer ${EXPLORER_MCP_API_KEY}" }
    }
  }
}
```

---

## 9. Implémentation de référence

### 9.1 Dépendance

```xml
<dependency>
  <groupId>org.springframework.ai</groupId>
  <artifactId>spring-ai-starter-mcp-server-webmvc</artifactId>
</dependency>
```

### 9.2 Enveloppe partagée

`src/main/java/com/compagnonsdudev/kafkasqlexplorer/mcp/McpResult.java`

```java
package com.compagnonsdudev.kafkasqlexplorer.mcp;

import java.util.List;

/**
 * Enveloppe de toute réponse d'outil MCP portant une mesure.
 * Le résumé texte rendu à l'agent restitue toujours stoppedReason et topicsNotReached :
 * un agent qui ne lit pas le structuredContent ne doit pas pouvoir rater la limite.
 */
public record McpResult<T>(T data, Coverage coverage, List<Note> notes, Page page) {

    public enum StopReason { COMPLETED, TIME_BUDGET, RECORD_BUDGET, CANCELLED, PARTIAL_FAILURE }

    public enum Severity { INFO, WARNING, CRITICAL }

    public enum Confidence { HIGH, MEDIUM, LOW }

    public record Coverage(int topicsScanned,
                           int topicsRequested,
                           long recordsScanned,
                           long elapsedMs,
                           StopReason stoppedReason,
                           List<String> topicsNotReached,
                           String resumeToken) {

        public Coverage {
            topicsNotReached = topicsNotReached == null ? List.of() : List.copyOf(topicsNotReached);
        }

        public boolean complete() {
            return stoppedReason == StopReason.COMPLETED && topicsNotReached.isEmpty();
        }
    }

    public record Note(Severity severity, String code, String message, String evidence) { }

    public record Page(Integer returnedCount, Boolean truncated, String nextCursor) { }

    public static <T> McpResult<T> complete(T data, int topics, long records, long elapsedMs) {
        return new McpResult<>(data,
                new Coverage(topics, topics, records, elapsedMs, StopReason.COMPLETED, List.of(), null),
                List.of(),
                null);
    }
}
```

### 9.3 Un outil, du début à la fin

`src/main/java/com/compagnonsdudev/kafkasqlexplorer/mcp/tools/StreamFlowMcpTools.java`

```java
package com.compagnonsdudev.kafkasqlexplorer.mcp.tools;

import com.compagnonsdudev.kafkasqlexplorer.mcp.McpResult;
import com.compagnonsdudev.kafkasqlexplorer.service.StreamFlowService;
import com.compagnonsdudev.kafkasqlexplorer.service.dto.TraceRequest;
import com.compagnonsdudev.kafkasqlexplorer.service.dto.TraceResult;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

@Component
public class StreamFlowMcpTools {

    private final StreamFlowService streamFlow;
    private final int maxTopics;

    // Constructor injection : le budget vient de la configuration existante, il n'est pas redéclaré ici.
    public StreamFlowMcpTools(StreamFlowService streamFlow,
                              @org.springframework.beans.factory.annotation.Value("${explorer.stream-flow-max-topics:30}") int maxTopics) {
        this.streamFlow = streamFlow;
        this.maxTopics = maxTopics;
    }

    public enum MatchMode { EXACT_KEY, TEXT, REGEX, JSONPATH, XPATH, HEADER, ANY }

    public record Hop(String topic, int partition, long offset, Instant timestamp, Long latencyFromPreviousMs) { }

    public record Trace(List<Hop> hops, String slowestHopTopic, Long clockSkewMs) { }

    @Tool(description = """
            Trace un message à travers les topics du cluster à partir d'un critère (clé exacte, texte,
            regex, JSONPath, XPath ou header). Renvoie les sauts ordonnés avec la latence entre chacun.
            La réponse porte TOUJOURS sa couverture : nombre de topics et d'enregistrements lus, raison
            de l'arrêt, et la liste nommée des topics jamais atteints. Un résultat vide signifie
            "pas trouvé dans ce qui a été lu", jamais "n'existe pas" : vérifier topicsNotReached et
            rappeler trace_continue avec le resumeToken avant de conclure.
            """)
    public McpResult<Trace> trace_message(
            @ToolParam(description = "Valeur recherchée : identifiant de corrélation, clé d'enregistrement, motif.")
            String criterion,
            @ToolParam(description = "EXACT_KEY restreint le scan à la partition que le partitionneur aurait choisie. ANY couvre clé + payload + headers.", required = false)
            MatchMode matchMode,
            @ToolParam(description = "Topics à scanner. Vide : les topics les plus récemment actifs, dans la limite du budget.", required = false)
            List<String> topics,
            @ToolParam(description = "Début de la fenêtre (ISO-8601). Les topics dont le message le plus récent lui est antérieur sont écartés et nommés.", required = false)
            Instant from,
            @ToolParam(description = "Fin de la fenêtre (ISO-8601).", required = false)
            Instant to,
            @ToolParam(description = "Budget en millisecondes. Au-delà, ce qui a été trouvé est renvoyé avec un resumeToken.", required = false)
            Long budgetMs) {

        TraceRequest request = new TraceRequest(
                criterion,
                matchMode == null ? MatchMode.ANY.name() : matchMode.name(),
                topics == null ? List.of() : topics,
                from, to,
                Math.min(topics == null ? maxTopics : topics.size(), maxTopics),
                budgetMs);

        TraceResult result = streamFlow.trace(request);
        return McpMappers.toMcp(result);
    }

    @Tool(description = """
            Reprend une trace arrêtée par son budget, sur les seuls topics jamais lus, et fusionne
            les nouveaux sauts dans la même chaîne. À appeler tant que coverage.resumeToken est non nul
            et que la conclusion dépend des topics non atteints.
            """)
    public McpResult<Trace> trace_continue(
            @ToolParam(description = "resumeToken renvoyé par un appel précédent.") String resumeToken) {
        return McpMappers.toMcp(streamFlow.resume(resumeToken));
    }
}
```

### 9.4 Le garde-fou qui rend la règle R1 opposable

`src/main/java/com/compagnonsdudev/kafkasqlexplorer/mcp/CoverageEnforcingCallback.java`

```java
package com.compagnonsdudev.kafkasqlexplorer.mcp;

import org.springframework.stereotype.Component;

/**
 * Refuse de sérialiser une réponse d'outil dont la couverture est absente.
 * Sans ce garde, R1 est une convention de revue de code : au premier outil ajouté sans McpResult,
 * l'agent reçoit à nouveau une liste vide indiscernable d'une absence.
 */
@Component
public final class CoverageEnforcingCallback {

    public Object inspect(String toolName, Object payload) {
        if (payload instanceof McpResult<?> result) {
            if (result.coverage() == null) {
                throw new IllegalStateException("Outil MCP '" + toolName + "' : coverage absent (R1)");
            }
            return payload;
        }
        // Les outils sans mesure (sql_validate, capabilities) sont déclarés explicitement.
        if (!McpToolRegistry.COVERAGE_EXEMPT.contains(toolName)) {
            throw new IllegalStateException("Outil MCP '" + toolName + "' : réponse non enveloppée dans McpResult (R1)");
        }
        return payload;
    }
}
```

### 9.5 Tests

`src/test/java/com/compagnonsdudev/kafkasqlexplorer/mcp/StreamFlowMcpToolsTest.java`

```java
package com.compagnonsdudev.kafkasqlexplorer.mcp;

import com.compagnonsdudev.kafkasqlexplorer.mcp.tools.StreamFlowMcpTools;
import com.compagnonsdudev.kafkasqlexplorer.service.StreamFlowService;
import com.compagnonsdudev.kafkasqlexplorer.service.dto.TraceRequest;
import com.compagnonsdudev.kafkasqlexplorer.service.dto.TraceResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class StreamFlowMcpToolsTest {

    @Mock
    StreamFlowService streamFlow;

    @Test
    void une_trace_vide_porte_sa_couverture_et_nomme_les_topics_non_atteints() {
        when(streamFlow.trace(any())).thenReturn(TraceResult.stoppedByBudget(
                List.of(), 12, 41_000L, List.of("demo.orders.5.shipped", "demo.orders.6.delivered"), "rt-42"));

        var tools = new StreamFlowMcpTools(streamFlow, 30);
        var result = tools.trace_message("ORD-101", StreamFlowMcpTools.MatchMode.ANY, null, null, null, 20_000L);

        assertThat(result.data().hops()).isEmpty();
        assertThat(result.coverage().complete()).isFalse();
        assertThat(result.coverage().stoppedReason()).isEqualTo(McpResult.StopReason.TIME_BUDGET);
        assertThat(result.coverage().topicsNotReached())
                .containsExactly("demo.orders.5.shipped", "demo.orders.6.delivered");
        assertThat(result.coverage().resumeToken()).isEqualTo("rt-42");
    }

    @Test
    void le_nombre_de_topics_demandes_est_borne_par_la_configuration() {
        when(streamFlow.trace(any())).thenReturn(TraceResult.empty());
        var tools = new StreamFlowMcpTools(streamFlow, 30);

        tools.trace_message("ORD-101", null, List.of("t1", "t2"), null, null, null);

        var captor = ArgumentCaptor.forClass(TraceRequest.class);
        org.mockito.Mockito.verify(streamFlow).trace(captor.capture());
        assertThat(captor.getValue().maxTopics()).isEqualTo(2);
        assertThat(captor.getValue().matchMode()).isEqualTo("ANY");
    }
}
```

`src/test/java/com/compagnonsdudev/kafkasqlexplorer/mcp/SecretRedactionContractTest.java` — test de
contrat sur **tous** les outils, pour que R4 ne dépende pas de la vigilance de l'auteur du prochain outil :

```java
@SpringBootTest
class SecretRedactionContractTest {

    @Autowired
    List<Object> mcpToolBeans; // toutes les classes *McpTools

    @ParameterizedTest
    @MethodSource("everyToolInvocationAgainstEmbeddedCluster")
    void aucune_reponse_ne_contient_de_secret(String toolName, String serializedResponse) {
        assertThat(serializedResponse)
                .as("outil %s", toolName)
                .doesNotContainIgnoringCase("sasl.jaas.config")
                .doesNotContainIgnoringCase("ssl.key.password")
                .doesNotContainIgnoringCase("confluent-secret");
    }
}
```

---

## 10. Lots de livraison

| Lot | Contenu | Pourquoi cet ordre |
|---|---|---|
| **L1 — Socle** (≈ 12 outils, profil `slim`) | `McpResult` + `CoverageEnforcingCallback`, transport HTTP + auth, `cluster_describe`, `topic_list`, `topic_describe`, `topic_sample`, `topic_search`, `topic_infer_schema`, `sql_validate`, `sql_run`, `sql_register_table`, `sql_list_tables`, ressource `capabilities` | Le contrat de couverture doit exister avant le premier outil, sinon il ne sera jamais rétro-appliqué. Le SQL est le différenciateur : il est dans le premier lot. |
| **L2 — Traçabilité & modèle** | `trace_message`, `trace_continue`, `trace_compare`, `lineage_graph`, `data_model_build`, `data_model_join_sql`, `data_model_export`, prompts `incident_trace` et `model_a_domain` | La valeur d'usage la plus forte (incident), mais elle repose sur les budgets et la couverture de L1. |
| **L3 — Exploitation** | `audit_*`, `consumer_group_*`, `dlq_overview`, `dlq_inspect`, `metric_list/suggest/preview`, prompts `dlq_triage`, `cluster_health_review`, `kpi_from_audit`, métriques Micrometer des appels d'outils | Dépend de l'audit asynchrone, dont l'exposition MCP suppose une gestion d'`auditId` et d'annulation déjà rodée. |
| **L4 — Optionnels** | Profil `write` (`metric_create/delete`), outils `process_*` (LLM), transport `stdio`, OAuth2 | Tout ce qui a un coût, une sortie de données ou un effet de bord, isolé et désactivé par défaut. |

## 11. Points ouverts

1. **`explorer.stream-flow-max-topics`** est cité par `docs/FEATURES.md` mais absent de
   `application.yml` du dépôt : vérifier sa source réelle avant de la publier dans `capabilities`.
2. **Pagination du `topic_list`** : l'API REST actuelle ne pagine pas. Un curseur MCP suppose soit un
   tri stable côté serveur, soit une pagination réelle à ajouter dans `KafkaAdminService`.
3. **`resumeToken` de Stream Flow** : l'UI garde l'état de reprise côté navigateur. Pour MCP, il faut
   un état côté serveur, borné en TTL et en nombre — ou un token auto-porteur signé, ce qui évite
   tout stockage mais expose la liste des topics restants dans le token.
4. **Multi-tenant** : `explorer.internal-topic-prefix` isole déjà les topics internes ; reste à décider
   si un même serveur MCP peut servir plusieurs principals avec des vues différentes, ou si l'isolation
   passe par une instance par équipe (recommandé pour L1–L3).
5. **Alignement KIP-1318** : quand le module Apache sera livré, aligner le schéma des ressources
   (`kafka://` vs `kafkaexplorer://`) et documenter la cohabitation des deux serveurs dans un même
   client, pour que l'agent sache lequel interroger.
