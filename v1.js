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
  // Поле from строки in (хаб с API 1.26): кто прислал, {kind, name?}. Канал говорит лишь, каким путём пришло —
  // hub send из задания расписания идёт каналом cli, хотя это не владелец. Автор строки — по виду и имени.
  const FROM = {
    core: () => "ядро", hub: () => "hub", schedule: () => "Расписание",
    session: (n) => n || "сессия", module: (n) => (n ? "mod:" + n : "модуль"), plugin: (n) => (n ? "ext:" + n : "плагин"),
  };
  const fromKind = (it) => (it.from && typeof it.from === "object" ? it.from.kind : null);

  // Только известная транспортная шапка отчёта. Не угадываем автора из её from и не меняем журнал/маршрутизацию.
  // Незнакомое поле, неоднозначная шапка или пустой результат — показываем исходный текст целиком.
  function reportBody(text) {
    if (!/^request_id=/.test(text)) return null;
    const lines = text.split(/\r?\n/), header = {};
    let i = 0;
    for (; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      if (/^result:[ \t]*\S/.test(lines[i])) break;
      for (const part of lines[i].split(";")) {
        const m = /^(request_id|from|to|status|in_reply_to)=[ \t]*([A-Za-z0-9_.:/-]*)$/.exec(part.trim());
        if (!m || Object.prototype.hasOwnProperty.call(header, m[1])) return null;
        header[m[1]] = m[2];
      }
    }
    if (!header.request_id || !header.from || !header.to || i === lines.length) return null;
    const statuses = { open: "Open", pending: "Pending", in_progress: "In progress", completed: "Completed",
      done: "Done", blocked: "Blocked", failed: "Failed", ok: "OK" };
    if (header.status && !Object.prototype.hasOwnProperty.call(statuses, header.status)) return null;
    // Markdown/code in the body stays exact; only top-level report labels become reading anchors.
    let fence = null;
    const body = lines.slice(i).map((line, n) => {
      const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (mark) {
        if (!fence) fence = mark[1];
        else if (mark[1][0] === fence[0] && mark[1].length >= fence.length
                 && line.slice(mark[0].length).trim() === "") fence = null;
        return line;
      }
      if (fence) return line;
      if (n === 0) return line.replace(/^result:[ \t]*/, "");
      const section = line.replace(/^evidence:[ \t]*/, "**Evidence:** ")
        .replace(/^follow-up:[ \t]*/, "**Next:** ");
      return section !== line && lines[i + n - 1].trim() ? "\n" + section : section;
    }).join("\n");
    return header.status ? `**${statuses[header.status]}.**\n\n${body}` : body;
  }

  function paragraphs(text) {
    // Уже оформленное, код, JSON и короткие реплики не трогаем. Длинная однострочная проза — только пробелы
    // между предложениями в пустую строку; ни одного слова не переписываем, не сокращаем и не переставляем.
    if (text.length < 400 || /[\r\n`]|\*\*|\]\(|^\s*(?:[\[{<#$>]|[-*+]\s|\d+[.)]\s)/.test(text.trim())) return text;
    let start = 0;
    return text.replace(/[.!?]([ \t]+)(?=[A-ZА-ЯЁ])/g, (match, space, at) => {
      if (at - start < 160) return match;
      start = at + match.length;
      return match[0] + "\n\n";
    });
  }

  function replyText(it) {
    if (!it || typeof it.text !== "string") return it;
    const reply = it.kind === "out" || it.kind === "reply"
      || (it.kind === "in" && it.sender && ["session", "agent"].includes(it.channel));
    if (!reply) return it;
    const body = reportBody(it.text);
    if (body === null && it.text.startsWith("request_id=")) return it;
    const text = body === null ? paragraphs(it.text) : body;
    return text === it.text ? it : { ...it, text, source_text: it.source_text || it.text };
  }

  const rules = {
    // Хаб до модуля «Реакции» не слал reactions вовсе, ранние его выпуски — значки без свёртки; нынешний отдаёт
    // taken (до какого события у сессии отвечено) всегда, даже с выключенным модулем. Клиенты считают по нему
    // свёртку отвеченного — старым хабам подкладываем пустую: отвеченного нет, сворачивать нечего.
    snapshot(s) {
      if (!s || typeof s !== "object") return s;
      const r = s.reactions;
      if (r && r.taken != null) return s;
      return { ...s, reactions: { taken: {}, ...(r || {}) } };
    },

    // Клиент версии 1 считает словами владельца входящую строку без sender. Хаб же оставляет sender пустым и у
    // сообщений плагинов и ядра сессии, и у копии поручения другому треду (поле to), и у сообщений расписания,
    // сессий и модулей, пришедших каналом владельца (автор — в поле from). У таких строк называем автора: слова
    // владельца — строки с from.kind owner, а без поля from (прежние хабы, автор неизвестен) — из его каналов.
    timeline(t) {
      if (!t || !Array.isArray(t.items)) return t;
      const items = t.items.map(replyText).map((it) => {
        if (!it || it.kind !== "in" || it.sender) return it;
        if (it.to) return { ...it, sender: "hub" };
        const kind = fromKind(it);
        if (kind === "owner") return it;
        if (Object.prototype.hasOwnProperty.call(FROM, kind)) return { ...it, sender: FROM[kind](it.from.name) };
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

  root.HubClientAPI = { api: 1, rev: 5, ...rules };
})(globalThis);
