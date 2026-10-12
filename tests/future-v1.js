// Правила для подставного «хаба будущего» (tests/future_hub.py): он переименовал поля и пути, клиент версии 1 этого
// не должен заметить. Образец того, как дописывать настоящий v1.js.
(function (root) {
  "use strict";
  const renamed = (o, from, to) => {
    if (!o || !(from in o)) return o;
    const { [from]: value, ...rest } = o;
    return { ...rest, [to]: value };
  };
  const paths = { "/api/timeline": "/api/lines", "/api/send": "/api/say" };

  root.HubClientAPI = {
    api: 1,
    rev: 99,
    snapshot(s) {
      const out = renamed(s, "fleet", "sessions");
      return { ...out, sessions: (out.sessions || []).map((x) => renamed(x, "status", "state")) };
    },
    timeline(t) {
      const out = renamed(t, "rows", "items");
      return { ...out, items: (out.items || []).map((x) => renamed(x, "type", "kind")) };
    },
    request(req) {
      const out = { ...req, path: paths[req.path] || req.path };
      if (req.path === "/api/timeline") out.query = renamed(req.query, "session", "name");
      return out;
    },
  };
})(globalThis);
