#!/usr/bin/env python3
"""A tiny scripted OpenAI-compatible endpoint, to prove the harness plumbing without your GPU box.

  python fake_llm.py 8099      then:  SEAMS_LLM_BASE_URL=http://127.0.0.1:8099/v1 SEAMS_LLM_MODEL=fake battle.py run --steps 6

It cycles through a fixed script of wire requests (some malformed on purpose), answers 429 once
in a while to exercise back-off, and refuses concurrent requests (503) to prove the harness is serial.
"""
import json, sys, threading, itertools
from http.server import BaseHTTPRequestHandler, HTTPServer

SCRIPT = [
    '{"op": "hello"}',
    'I will now probe things. {"op": "quote_route", "work": "sha256:fx-derived", "event_ref": "f1", "amount": {"value": 500, "asset_code": "USD", "asset_scale": 2}}',
    '<think>hmm</think>```json\n{"op": "quote_route", "work": "sha256:fx-derived", "event_ref": "f2", "amount": {"value": true, "asset_code": "USD", "asset_scale": 2}}\n```',
    'no json at all',
    '{"finding": "boolean amounts look accepted"}',
    '{"op": "check_use", "work": "sha256:nobody", "capability": "view"}',
    '{"op": "emit", "creator_key_ref": "key:x", "tier": "gm", "kind": "scene", "content_b64": "eA=="}',
    '{"done": true}',
]
lock = threading.Lock()
cyc = itertools.cycle(SCRIPT)
count = itertools.count(1)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        if not lock.acquire(blocking=False):
            self.send_response(503); self.end_headers(); return
        try:
            i = next(count)
            if i % 7 == 0:
                self.send_response(429); self.send_header("Retry-After", "1"); self.end_headers(); return
            if body.get("tools") and "echo" in json.dumps(body["tools"]):
                msg = {"role": "assistant", "content": None, "tool_calls": [{"id": "c1", "type": "function",
                       "function": {"name": "echo", "arguments": '{"x": 7}'}}]}
            else:
                msg = {"role": "assistant", "content": next(cyc)}
            out = json.dumps({"choices": [{"message": msg}], "usage": {"prompt_tokens": 1, "completion_tokens": 1}}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)
        finally:
            lock.release()


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8099), H).serve_forever()
