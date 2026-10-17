/* eslint-env browser */
// Served to the owner's browser by McpOAuthServer.kt while an assistant waits for their answer on the phone.
(function () {
  var status = document.getElementById('s');
  function go() {
    fetch('authorize/status?id=__ID__', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.status === 'waiting') {
          setTimeout(go, 1500);
        } else if (j.redirect) {
          status.textContent = 'OK…';
          location.replace(j.redirect);
        } else {
          status.textContent = 'Demande expirée : relancez la connexion depuis l’assistant. · Request expired: start again from the assistant.';
        }
      })
      .catch(function () { setTimeout(go, 3000); });
  }
  go();
})();
