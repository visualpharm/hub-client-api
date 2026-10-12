#!/usr/bin/env python3
"""Подставной «хаб будущего» перед настоящим (или тестовым) хабом: tests/future_hub.py <порт> <адрес хаба> [--no-plugin]

Отдаёт то же, что хаб за ним, но с изменённым API: sessions → fleet, у сессии state → status, в ленте items → rows и
kind → type, /api/timeline → /api/lines (session → name), /api/send → /api/say. И отдаёт плагин client-api с правилами
tests/future-v1.js. Клиент версии 1 через него должен показать то же, что напрямую; с --no-plugin — сломаться."""
import json
import os
import sys
import urllib.request
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
UP = sys.argv[2].rstrip("/")
PLUGIN = "--no-plugin" not in sys.argv
SEEN = []   # что спросил клиент: /seen


def rename(d, a, b):
    if isinstance(d, dict) and a in d:
        d[b] = d.pop(a)
    return d


def future_snapshot(part):
    if "extensions" in part and PLUGIN:
        part["extensions"] = list(part["extensions"] or []) + [{"name": "client-api", "main": "main.js"}]
    for s in part.get("sessions") or []:
        rename(s, "state", "status")
    return rename(part, "sessions", "fleet")


def future_timeline(answer):
    for row in answer.get("items") or []:
        rename(row, "kind", "type")
    return rename(answer, "items", "rows")


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def out(self, code, body, kind="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def up(self, path, body=None):
        req = urllib.request.Request(UP + path, data=body, headers={"X-Hub": "1", "Content-Type": "application/json",
                                                                    "Accept-Encoding": "identity"})
        return urllib.request.urlopen(req, timeout=60)

    def do_GET(self):
        u = urlparse(self.path)
        SEEN.append(f"GET {u.path} api={self.headers.get('X-Hub-Api')}")
        if u.path == "/seen":
            return self.out(200, SEEN)
        if u.path == "/ext/client-api/v1.js":
            if not PLUGIN:
                return self.out(404, {"error": "нет"})
            with open(os.path.join(HERE, "future-v1.js"), "rb") as fh:
                return self.out(200, fh.read(), "text/javascript; charset=utf-8")
        if u.path in ("/api/timeline", "/api/send"):
            return self.out(404, {"error": "такого пути больше нет"})
        try:
            if u.path == "/api/stream":
                return self.stream()
            if u.path == "/api/lines":
                q = {k: v[0] for k, v in parse_qs(u.query, keep_blank_values=True).items()}
                rename(q, "name", "session")
                with self.up("/api/timeline?" + urlencode(q)) as r:
                    return self.out(200, future_timeline(json.load(r)))
            if u.path == "/api/snapshot":
                with self.up(self.path) as r:
                    return self.out(200, future_snapshot(json.load(r)))
            with self.up(self.path) as r:
                return self.out(r.status, r.read(), r.headers.get("Content-Type") or "application/json")
        except urllib.error.HTTPError as e:
            return self.out(e.code, e.read())

    def stream(self):
        with self.up("/api/stream") as r:
            unzip = zlib.decompressobj(16 + zlib.MAX_WBITS) if r.headers.get("Content-Encoding") == "gzip" else None
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            buf = b""
            while True:
                chunk = r.read1(65536)
                if not chunk:
                    return
                buf += unzip.decompress(chunk) if unzip else chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if line.startswith(b"data:"):
                        part = future_snapshot(json.loads(line[5:]))
                        line = b"data: " + json.dumps(part, ensure_ascii=False).encode()
                    self.wfile.write(line + b"\n")
                    self.wfile.flush()

    def do_POST(self):
        u = urlparse(self.path)
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        SEEN.append(f"POST {u.path} api={self.headers.get('X-Hub-Api')} {sorted(json.loads(body or b'{}'))}")
        if u.path == "/api/send":
            return self.out(404, {"error": "такого пути больше нет"})
        path = "/api/send" if u.path == "/api/say" else self.path
        try:
            with self.up(path, body) as r:
                return self.out(r.status, r.read())
        except urllib.error.HTTPError as e:
            return self.out(e.code, e.read())


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
