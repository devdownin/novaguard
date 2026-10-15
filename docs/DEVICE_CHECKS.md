# Vérifications sur appareil

Ce que ni Jest ni la CI ne peuvent prouver : un vrai capteur, un vrai encodeur,
un vrai réseau, Android qui tue ou bride l'application. À dérouler sur un
téléphone avant une release qui touche ces parties ; cocher dans la PR de
release, pas ici.

Prérequis : un APK de la branche (`Build Android APK` en CI ou
`npm run android`), un ordinateur sur le même Wi-Fi, `curl` et `jq`.

```bash
PHONE=192.168.1.42            # l'adresse affichée dans Réglages → Serveur MCP
TOKEN=mcp_…                   # jeton d'accès (lecture)
CONTROL=mcp_…                 # jeton de pilotage
mcp() {  # mcp <jeton> <méthode> [params JSON]
  local params="${3:-}"; [ -n "$params" ] || params='{}'
  curl -s "http://$PHONE:8081/mcp" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$2\",\"params\":$params}"
}
tool() {  # tool <jeton> <outil sans préfixe> [arguments JSON]
  local args="${3:-}"; [ -n "$args" ] || args='{}'
  mcp "$1" tools/call "{\"name\":\"novaguard_$2\",\"arguments\":$args}"
}
```

## Surveillance

- [ ] **Image noire** : masquer l'objectif 5 s → statut « Image noire » au viseur
      et sur la notification, avec l'heure ; le retirer → retour à la normale.
- [ ] **Champ de vue modifié** : tourner le téléphone, pièce vide, 8 s → alerte ;
      « C'est voulu » la lève et la nouvelle vue devient la référence.
- [ ] Une personne qui traverse le champ pendant ce temps ne déclenche **pas** l'alerte.
- [ ] Mode calibrage (Réglages → Avancé) : pistes en attente et détections sous
      le seuil dessinées en pointillés, avec leur confiance.

## Serveur MCP : lecture

- [ ] `tool $TOKEN get_event '{"eventId":<id réel à 13 chiffres>}'` rend l'évènement.
- [ ] `tool $TOKEN search_events '{"minConfidence":0.9}'` filtre réellement.
- [ ] Objectif masqué : `get_status` dit `camera-obstructed`, `healthy: false`, `statusSince`.
- [ ] `mcp $TOKEN resources/read '{"uri":"novaguard://event/1"}'` → erreur `-32002`.
- [ ] `get_event_frames` sur un clip 4K : 4 blocs `image`, l'application ne
      ralentit pas (cadence du viseur), pas de redémarrage.
- [ ] Clip supprimé à la main : repli sur la vignette (`"source":"thumbnail"`).
- [ ] 9 connexions ouvertes en parallèle (`nc $PHONE 8081` ×9) → la 9ᵉ reçoit `503` ;
      une connexion qui envoie un octet par seconde est coupée après 15 s.
- [ ] `get_event_frames` avec `"framing":"subject"` sur une personne au fond de la pièce :
      les images sont centrées sur elle, mains et objets dans le cadre, `cropped: true`.
      Même chose caméra **avant** (miroir) et téléphone en paysage.
- [ ] `get_diagnostics` après un passage plus long que la durée maximale :
      `clipGap.samples ≥ 1`, `device.thermalStatus` renseigné.

## Serveur MCP : pilotage

- [ ] Interrupteur « Autoriser le pilotage » éteint : aucun outil de pilotage
      dans `tools/list`, même avec `$CONTROL`.
- [ ] Allumé : `tool $TOKEN stop_surveillance` → `403` `NOVAGUARD_AUTH_FORBIDDEN`.
- [ ] `tool $CONTROL stop_surveillance` arrête la surveillance comme le bouton
      (son, vibration), et l'action apparaît dans « Actions de l'agent ».
- [ ] `tool $CONTROL annotate_event '{"eventId":<id>,"verdict":"attention","note":"…"}'` :
      « Agent : À regarder » sur la carte, la note dans la fiche, « Effacer la note » la retire.
- [ ] Application en arrière-plan : `start_surveillance` refusé avec la raison ;
      au premier plan, accepté.
- [ ] `tool $TOKEN wait_for_event '{"timeoutSeconds":25}'` rend la main dès
      qu'une personne passe, pas à l'échéance.
- [ ] Jeton de pilotage à « 1 h » : après l'heure, `$CONTROL` est refusé
      (« expired ») et les outils de pilotage disparaissent de `tools/list`.
- [ ] Écran verrouillé, surveillance en cours : « Couper le pilotage » sur la
      notification → l'appel suivant est refusé, l'interrupteur est éteint
      dans Réglages, l'action a disparu de la notification.

## Serveur MCP : découverte et clients

- [ ] `dns-sd -B _novaguard-mcp._tcp` (macOS) ou `avahi-browse -r _novaguard-mcp._tcp`
      (Linux) trouve « NovaGuard » avec `path=/mcp`.
- [ ] Le QR code de Réglages se lit avec l'appareil photo d'un autre téléphone
      et donne la configuration complète, jeton compris.
- [ ] Claude Desktop (ou un autre client) avec cette configuration : les
      outils se chargent, les trois prompts sont proposés, `night_report`
      cherche bien de 20 h à 8 h heure du téléphone.
- [ ] Page « Services MCP » (Réglages → Confidentialité) lisible en grande
      taille de texte et en paysage.
