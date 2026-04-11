import subprocess, os, time

# Fix mongod.conf - correct for MongoDB 7.0 + systemd
conf = """storage:
  dbPath: /var/lib/mongodb

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log

net:
  port: 27017
  bindIp: 127.0.0.1

security:
  authorization: enabled
"""

with open('/etc/mongod.conf', 'w') as f:
    f.write(conf)
print('mongod.conf updated')

# Create directories with correct permissions
os.makedirs('/var/lib/mongodb', exist_ok=True)
os.makedirs('/var/log/mongodb', exist_ok=True)
subprocess.run(['chown', '-R', 'mongodb:mongodb', '/var/lib/mongodb'])
subprocess.run(['chown', '-R', 'mongodb:mongodb', '/var/log/mongodb'])
subprocess.run(['chmod', '750', '/var/lib/mongodb'])
print('Directories and permissions set')

# Restart mongod
subprocess.run(['systemctl', 'daemon-reload'])
subprocess.run(['systemctl', 'restart', 'mongod'])
time.sleep(5)

r = subprocess.run(['systemctl', 'is-active', 'mongod'], capture_output=True, text=True)
status = r.stdout.strip()
print('Status mongod:', status)

if status == 'active':
    js = """
use torresguest
db.createUser({user:"torrescrm",pwd:"Torres9xKw2026",roles:[{role:"readWrite",db:"torresguest"}]})
print("Usuario criado!")
"""
    open('/tmp/create_user.js', 'w').write(js)
    r = subprocess.run(['mongosh', '--quiet', '/tmp/create_user.js'],
        capture_output=True, text=True)
    print(r.stdout)
    if r.stderr: print('STDERR:', r.stderr[:300])

    r2 = subprocess.run(['pm2', 'restart', 'all'], capture_output=True, text=True)
    print(r2.stdout or r2.stderr or 'pm2 ok')
    print('=== PRONTO! ===')
else:
    import subprocess as sp
    log = sp.run(['tail', '-20', '/var/log/mongodb/mongod.log'], capture_output=True, text=True)
    print('LOG:', log.stdout)
