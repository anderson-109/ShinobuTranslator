"""Requires the local service running; sends generated, non-personal Japanese text."""
import base64
import io
import json
import urllib.request
import urllib.error
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import yomitoku

image = Image.new('RGB', (1100, 180), 'white')
font = Path(yomitoku.__file__).parent / 'resource' / 'MPLUS1p-Medium.ttf'
ImageDraw.Draw(image).text((20, 30), 'こんにちは世界', font=ImageFont.truetype(str(font), 88), fill='black')
buffer = io.BytesIO()
image.save(buffer, 'PNG')
image.save('artifacts/yomitoku-generated-test.png')
payload = json.dumps({'regions': [{'id': 'generated-test', 'imageDataUrl': 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()}]}).encode()
request = urllib.request.Request('http://127.0.0.1:8766/ocr', data=payload, headers={'Content-Type': 'application/json', 'Origin': 'chrome-extension://' + 'a' * 32})
with urllib.request.urlopen(request, timeout=120) as response:
    assert response.headers['Access-Control-Allow-Origin'] == 'chrome-extension://' + 'a' * 32
    result = json.load(response)['regions'][0]
assert result['id'] == 'generated-test'
assert 'こんにちは' in result['text'], repr(result)
assert 0 <= result['confidence'] <= 1
print('PASS real CPU YomiToku inference of generated Japanese text', ascii(result['text']), result['confidence'])
request = urllib.request.Request('http://127.0.0.1:8766/ocr', data=payload, headers={'Content-Type': 'application/json', 'Origin': 'https://untrusted.example'})
try:
    urllib.request.urlopen(request, timeout=10)
    raise AssertionError('Untrusted website must be rejected')
except urllib.error.HTTPError as error:
    assert error.code == 403
print('PASS local bridge rejects ordinary website origins')
