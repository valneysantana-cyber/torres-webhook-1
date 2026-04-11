import subprocess, time

print('=== Instalando MongoDB 7.0 no Ubuntu 22.04 ===')

# 1. Baixar chave GPG
print('1. Baixando chave GPG...')
subprocess.run(['wget', '-qO', '/tmp/mongodb.gpg',
    'https://www.mongodb.org/static/pgp/server-7.0.asc'], check=True)

# 2. Importar chave
print('2. Importando chave GPG...')
subprocess.run([
    'gpg', '--no-default-keyring',
    '--keyring', '/usr/share/keyrings/mongodb-server-7.0.gpg',
    '--import', '/tmp/mongodb.gpg'
], check=True)

# 3. Adicionar repositorio
print('3. Adicionando repositorio...')
repo = 'deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse\n'
open('/etc/apt/sources.list.d/mongodb-org-7.0.list', 'w').write(repo)

setup_mongo.pyprint('4. Instalando mongodb-org...')
subprocess.run(['apt-get', 'update', '-q'], check=True)
subprocess.run(['apt-get', 'install', '-y', 'mongodb-org'], check=True)

# 5. Habilitar e iniciar
print('5. Iniciando mongod...')
subprocess.run(['systemctl', 'enable', 'mongod'])
subprocess.run(['systemctl', 'start', 'mongod'])
time.sleep(4)

# 6. Verificar status
r = subprocess.run(['systemctl', 'is-active', 'mongod'], capture_output=True, text=True)
print('Status mongod:', r.stdout.strip())

# 7. Criar usuario e database
print('6. Criando usuario torrescrm...')
js = """
use torresguest
db.createUser({user:"torrescrm",pwd:"Torres9xKw2026",roles:[{role:"readWrite",db:"torresguest"}]})
print("Usuario criado!")
"""
open('/tmp/create_user.js', 'w').write(js)
r = subprocess.run(['mongosh', '--quiet', '/tmp/create_user.js'],
    capture_output=True, text=True)
print(r.stdout)
if r.stderr: print('STDERR:', r.stderr[:200])

print('=== MongoDB pronto! ===')

# 8. Reiniciar torres-crm-api
print('7. Reiniciando torres-crm-api...')
r2 = subprocess.run(['pm2', 'restart', 'all'], capture_output=True, text=True)
print(r2.stdout or r2.stderr or 'pm2 ok')
