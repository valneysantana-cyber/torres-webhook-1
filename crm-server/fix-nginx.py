#!/usr/bin/env python3
# fix-nginx.py - Restore nginx Basic Auth and /campaigns bypass
import subprocess

NGINX_CONF = '/etc/nginx/sites-available/torrescrm'

with open(NGINX_CONF, 'r') as f:
    config = f.read()

if 'auth_basic' in config:
    print('[fix-nginx] auth_basic already present, skipping')
else:
    old = 'location / {'
    new = ('location = /campaigns {\n'
           '        proxy_pass http://127.0.0.1:3001;\n'
           '    }\n\n'
           '    location / {\n'
           '        auth_basic "Torres CRM";\n'
           '        auth_basic_user_file /etc/nginx/.htpasswd;')
    config = config.replace(old, new, 1)
    with open(NGINX_CONF, 'w') as f:
        f.write(config)
    print('[fix-nginx] Config updated')

result = subprocess.run(['nginx', '-t'], capture_output=True, text=True)
print(result.stdout + result.stderr)
if result.returncode == 0:
    subprocess.run(['nginx', '-s', 'reload'])
    print('[fix-nginx] nginx reloaded - CRM secured!')
else:
    print('[fix-nginx] nginx config test FAILED')
