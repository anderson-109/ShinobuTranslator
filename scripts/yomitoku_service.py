"""Optional local YomiToku recognizer bridge. Run with scripts/start-yomitoku.ps1."""
import base64
import io
import json
import math
import re
from http.server import BaseHTTPRequestHandler, HTTPServer

MAX_BODY = 16 * 1024 * 1024

def recognize(regions, recognizer):
    import cv2
    import numpy as np
    from PIL import Image
    if not isinstance(regions, list) or not 1 <= len(regions) <= 8:
        raise ValueError("Expected 1–8 regions")
    results, ids = [], set()
    for region in regions:
        region_id, data = region.get("id"), region.get("imageDataUrl")
        if not isinstance(region_id, str) or len(region_id) > 300 or region_id in ids:
            raise ValueError("Invalid region ID")
        ids.add(region_id)
        if not isinstance(data, str) or not re.fullmatch(r"data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+", data):
            raise ValueError("Only base64 JPEG/PNG accepted")
        raw = base64.b64decode(data.split(",", 1)[1], validate=True)
        with Image.open(io.BytesIO(raw)) as info:
            if info.width * info.height > 6_000_000:
                raise ValueError("Image too large")
        image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Invalid image")
        output, _ = recognizer(image)
        words = [word if isinstance(word, dict) else word.model_dump() for word in output.words]
        vertical = sum(word.get('direction') == 'vertical' for word in words) > len(words) / 2
        def order(word):
            points = word['points']
            x = min(point[0] for point in points)
            y = min(point[1] for point in points)
            return (-x, y) if vertical else (y, x)
        words.sort(key=order)
        confidence = sum(float(word['rec_score']) for word in words) / len(words) if words else 0.0
        if not math.isfinite(confidence):
            confidence = 0.0
        results.append({"id": region_id, "text": '\n'.join(word['content'] for word in words), "confidence": max(0.0, min(1.0, confidence))})
    return results

class Handler(BaseHTTPRequestHandler):
    recognizer = None

    def allowed(self):
        origin = self.headers.get("Origin", "")
        return self.headers.get("Host", "") in ("127.0.0.1:8766", "localhost:8766") and (not origin or re.fullmatch(r"(?:chrome|moz)-extension://[a-zA-Z0-9-]+", origin))

    def respond(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        if self.allowed() and self.headers.get("Origin"):
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.respond(200 if self.allowed() else 403, {})

    def do_GET(self):
        self.respond(200 if self.allowed() and self.path == "/health" else 404, {"ready": True, "engine": "YomiToku", "model": "parseq-tiny-dynw-v4"})

    def do_POST(self):
        if not self.allowed() or self.path != "/ocr":
            self.respond(403, {"error": "Forbidden"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                self.respond(413, {"error": "Invalid request size or type"})
                return
            payload = json.loads(self.rfile.read(length))
            self.respond(200, {"regions": recognize(payload["regions"], self.recognizer)})
        except (ValueError, KeyError, TypeError):
            self.respond(400, {"error": "Invalid image request"})
        except Exception:
            self.respond(500, {"error": "YomiToku inference failed; check local terminal"})

    def log_message(self, format, *args):
        # Never log image data or recognized document text.
        print("YomiToku:", format % args, flush=True)

def main():
    import torch
    from yomitoku.ocr import OCR
    torch.set_num_threads(2)
    print("Loading YomiToku (first run downloads the model)...", flush=True)
    Handler.recognizer = OCR(configs={"text_detector": {"model_name": "dbnetv2"}, "text_recognizer": {"model_name": "parseq-tiny-dynw-v4"}}, device="cpu", visualize=False)
    server = HTTPServer(("127.0.0.1", 8766), Handler)
    server.timeout = 30
    print("YomiToku ready: http://127.0.0.1:8766 — Ctrl+C to stop", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
