import subprocess, re

target = '/etc/nginx/sites-enabled/conciergecloud.com.br'
c = open(target).read()

c = re.sub(r'\n\s*location /crm \{[^}]*proxy_pass[^}]*\}', '', c, flags=re.DOTALL)
c = re.sub(r'\n\s*location /search\.html \{[^}]*proxy_pass[^}]*\}', '', c, flags=re.DOTALL)

b = """
    location /crm {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
    location /search.html {
        proxy_pass http://localhost:3001/search.html;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }"""

m = '}\n\nserver {'
i = c.find(m)
if i == -1:
    m = '}\nserver {'
    i = c.find(m)

if i > 0:
    c = c[:i] + b + '\n' + c[i:]
    open(target, 'w').write(c)
    print('OK HTTPS!')
else:
    print('ERRO')

r = subprocess.run(['nginx', '-t'], capture_output=True, text=True)
print(r.stdout + r.stderr)
if r.returncode == 0:
    subprocess.run(['systemctl', 'reload', 'nginx'])
    print('DONE!')
