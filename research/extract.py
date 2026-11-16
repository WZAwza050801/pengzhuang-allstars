import re, base64, os, html
src = os.path.join(os.path.dirname(__file__), '..', 'pengzhuang_research.html')
out = os.path.dirname(__file__)
s = open(src, encoding='utf-8').read()
os.makedirs(os.path.join(out, 'img'), exist_ok=True)
i = 0
def rep(m):
    global i
    i += 1
    ext = m.group(1)
    data = base64.b64decode(m.group(2))
    name = f'img{i:02d}.{ext if ext != "jpeg" else "jpg"}'
    open(os.path.join(out, 'img', name), 'wb').write(data)
    return f'[[IMAGE:{name}]]'
s2 = re.sub(r'data:image/([a-z]+);base64,([A-Za-z0-9+/=]+)', rep, s)
open(os.path.join(out, 'stripped.html'), 'w', encoding='utf-8').write(s2)
t = re.sub(r'<script[\s\S]*?</script>', lambda m: '\n[SCRIPT]\n' + m.group(0)[:20000] + '\n[/SCRIPT]\n', s2)
t = re.sub(r'<style[\s\S]*?</style>', '', t)
t = re.sub(r'<img[^>]*src="([^"]*)"[^>]*>', r'\n<\1>\n', t)
t = re.sub(r'<(br|p|div|h\d|li|tr|section|pre)[^>]*>', '\n', t)
t = re.sub(r'<[^>]+>', '', t)
t = html.unescape(t)
t = re.sub(r'\n\s*\n+', '\n', t)
open(os.path.join(out, 'text.txt'), 'w', encoding='utf-8').write(t)
print(i, len(s2), len(t))
