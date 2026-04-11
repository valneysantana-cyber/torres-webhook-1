import subprocess, os, time

# Write MongoDB JS user creation script
js = """
use torresguest
db.createUser({
  user: "torrescrm",
  pwd: "Torres9xKw2026",
  roles: [{role: "readWrite", db: "torresguest"}]
})
print("User created successfully!")
"""

with open('/tmp/create_user.js', 'w') as f:
    f.write(js)

print('JS file written.')

# First try to connect to running mongod (may be using old config/dbPath)
print('Attempting to create user in running mongod...')
r = subprocess.run(
    ['mongosh', '--quiet', '/tmp/create_user.js'],
    capture_output=True, text=True, timeout=30
)
print('STDOUT:', r.stdout)
if r.stderr:
    print('STDERR:', r.stderr[:600])

# Now handle systemd service - enable for boot
subprocess.run(['systemctl', 'enable', 'mongod'], capture_output=True)

# Restart pm2 so torres-crm-api reconnects to MongoDB
print('Restarting pm2...')
r2 = subprocess.run(['pm2', 'restart', 'all'], capture_output=True, text=True)
print(r2.stdout or r2.stderr)

print('=== DONE ===')
