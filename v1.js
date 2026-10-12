// Клиентское API хаба, версия 1 — каким его видит клиент вне страницы (телефон, Mac, скрипт).
//
// Клиент, написанный под версию 1, берёт этот файл с хаба (`/ext/<плагин>/v1.js`), выполняет у себя и пропускает
// через его правила всё, что получает от хаба и шлёт ему. Версия 1 описана в contract/v1.json; правила приводят к ней
// нынешний хаб. Правило — функция над JSON; правила нет — данные идут как есть:
//
//   snapshot(снимок хаба)                → снимок в виде версии 1   (/api/stream: snapshot и собранные patch)
//   timeline(ответ /api/timeline)        → ответ в виде версии 1 (в т. ч. чьё сообщение: владельца или служебное)
//   request({method, path, query, body}) → тот же запрос, каким его ждёт нынешний хаб
//
// Хаб изменил API — допишите правило и поднимите rev. Клиенты подхватят сами, обновлять их не нужно.
// Правила копятся: файл должен работать и с прежними выпусками хаба (проверяйте по полям данных, а не по номеру).
(function (root) {
  "use strict";

  // Каналы, которыми пишет сам владелец: страница (и приложения), CLI вне сессий, его Telegram.
  const OWNER_CHANNELS = ["web", "cli", "telegram"];
  const SERVICE = { core: "ядро", plugin: "плагин", schedule: "Расписание", session: "сессия" };

  const rules = {
    // Клиент версии 1 считает словами владельца входящую строку без sender. Хаб же оставляет sender пустым и у
    // сообщений плагинов и ядра сессии, и у копии поручения другому треду (поле to). У таких строк называем автора:
    // слова владельца — только строки из его каналов, без адресата.
    timeline(t) {
      if (!t || !Array.isArray(t.items)) return t;
      const items = t.items.map((it) => {
        if (!it || it.kind !== "in" || it.sender) return it;
        if (it.to) return { ...it, sender: "hub" };
        if (it.channel && !OWNER_CHANNELS.includes(it.channel)) return { ...it, sender: SERVICE[it.channel] || it.channel };
        return it;
      });
      return { ...t, items };
    },

    // Клиенты версии 1 помечают правку своего сообщения флагом correction; с выпуска 12.10.2026 хаб узнаёт
    // короткую поправку сам, поля в /api/send больше нет.
    request(req) {
      if (req.path === "/api/send" && req.body && "correction" in req.body) {
        const { correction, ...body } = req.body;
        return { ...req, body };
      }
      return req;
    },
  };

  root.HubClientAPI = { api: 1, rev: 2, ...rules };
})(globalThis);
