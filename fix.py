import glob, subprocess

configs = glob.glob('/etc/nginx/conf.d/*.conf') + glob.glob('/etc/nginx/sites-enabled/*')
target = None
for c in sorted(configs):
    try:
        content = open(c).read()
        if 'conciergecloud' in content or 'var/www/concierge' in content:
            target = c
            break
    except:
        pass
if not target and configs:
    target = configs[0]
print('Config nginx:', target)

if target:
    content = open(target).read()
    if '/crm' not in content:
        crm = """
    location /crm {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
    location /search.html {
        proxy_pass http://localhost:3001/search.html;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
"""
        idx = content.rfind('}')
        open(target, 'w').write(content[:idx] + crm + content[idx:])
        print('CRM proxy adicionado!')
    else:
        print('CRM proxy ja existe')
else:
    print('ERRO: config nao encontrado')

html_file = '/var/www/conciergecloud/index.html'
html = open(html_file).read()
if 'CRM Clientes' not in html:
    old = 'target="_blank">Falar com consultor</a>'
    new = old + '<a href="/crm" class="nav-cta" target="_blank" style="background:#10b981;margin-left:10px;">CRM Clientes</a>'
    open(html_file, 'w').write(html.replace(old, new, 1))
    print('Botao CRM adicionado!')
else:
    print('Botao ja existe')

r = subprocess.run(['nginx', '-t'], capture_output=True, text=True)
print('nginx -t:', r.stdout + r.stderr)
if r.returncode == 0:
    subprocess.run(['systemctl', 'reload', 'nginx'])
    print('PRONTO! CRM disponivel em /crm')
