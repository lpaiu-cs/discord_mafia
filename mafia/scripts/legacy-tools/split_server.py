import re
import os

with open('src/web/server.ts', 'r', encoding='utf-8') as f:
    server_code = f.read()

# I will defer the heavy python script, let's examine the bottom of server.ts first.
