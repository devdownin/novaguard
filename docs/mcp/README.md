# MCP × Kafka

> Ce dossier ne documente **pas** le serveur MCP de NovaGuard. Sa spécification
> est [`mcp.md`](../../mcp.md) à la racine ; l'implémentation qui tourne sur
> l'appareil est `android/app/src/main/java/com/novaguard/surveillance/McpServerModule.kt`,
> et `novaguard-mcp/` est la passerelle Node. Ce qui suit est une étude
> sans rapport, sur les serveurs MCP pour Kafka.

| Document | Contenu |
|---|---|
| [`ANALYSE-COMPARATIVE-MCP-KAFKA.md`](ANALYSE-COMPARATIVE-MCP-KAFKA.md) | Recensement des 13 serveurs MCP Kafka publics, comparaison des capacités et de la surface protocolaire, et ce que Kafka SQL Explorer apporte qu'aucun n'expose |
| [`SPEC-MCP-KAFKAEXPLORER.md`](SPEC-MCP-KAFKAEXPLORER.md) | Spécification de `kafkaexplorer-mcp` : architecture, contrat de couverture, catalogue de ~35 outils, ressources, prompts, sécurité, configuration, implémentation de référence et lots de livraison |

**En une phrase** : la couche admin Kafka (topics, groupes, produce/consume) est saturée et sera
commoditisée par [KIP-1318](https://cwiki.apache.org/confluence/display/KAFKA/KIP-1318:+Model+Context+Protocol+(MCP)+Server+for+Apache+Kafka) ;
aucun serveur MCP n'expose de couche analytique sur le *contenu* des topics, ni ne rend compte de sa
propre couverture de lecture — c'est là que se place un serveur adossé à
[Kafka SQL Explorer](https://github.com/devdownin/Kafkaexplorer).
