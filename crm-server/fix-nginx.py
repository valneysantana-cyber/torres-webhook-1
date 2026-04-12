#!/usr/bin/env python3
"""
fix-nginx.py — Regenera o config nginx completo e correto para o CRM Torres.

Sempre sobrescreve /etc/nginx/sites-available/torrescrm com o config canônico,
garantindo:
  - listen 80 default_server  (VPS responde por IP, sem depender de server_name)
  - /guest e /guests proxiados sem auth (bot do Render acessa diretamente)
  - /campaigns proxiado sem auth (campanhas do VPS)
  - /health proxiado sem auth (health checks)
  - location / protegido com auth_basic (dashboard ConciergeCloud)

Uso: python3 fix-nginx.py
"""
import subprocess
import os

NGINX_CONF = '/etc/nginx/sites-available/torrescrm'
SYMLINK     = '/etc/nginx/sites-enabled/torrescrm'

CORRECT_CONFIG = """server {
    listen 80 default_server;
    server_name _;

    # Bot do Render acessa /guest/<phone>/message, /context, /profile, /checkout
    location /guest {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header host $host;
        proxy_set_header x-real-ip $remote_addr;
    }

    # Listagem de hospedes (painel)
    location /guests {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header host $host;
        proxy_set_header x-real-ip $remote_addr;
    }

    # Health check
    location /health {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header host $host;
    }

    # Campanhas do VPS (sem auth para o script local)
    location = /campaigns {
        proxy_pass http://127.0.0.1:3001;
    }

    # Dashboard ConciergeCloud — protegido por Basic Auth
    location / {
        auth_basic "Torres CRM";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header host $host;
        proxy_set_header x-real-ip $remote_addr;
    }
}
"""

print('[fix-nginx] Gravando config canonico em', NGINX_CONF)
with open(NGINX_CONF, 'w') as f:
    f.write(CORRECT_CONFIG)

# Garante que o symlink em sites-enabled existe
if not os.path.exists(SYMLINK):
    os.symlink(NGINX_CONF, SYMLINK)
    print('[fix-nginx] Symlink criado:', SYMLINK)
else:
    print('[fix-nginx] Symlink ja existe:', SYMLINK)

result = subprocess.run(['nginx', '-t'], capture_output=True, text=True)
print(result.stdout + result.stderr)

if result.returncode == 0:
    subprocess.run(['nginx', '-s', 'reload'])
    print('[fix-nginx] nginx recarregado — CRM ativo e seguro!')
else:
    print('[fix-nginx] ERRO no config nginx — verifique manualmente')
