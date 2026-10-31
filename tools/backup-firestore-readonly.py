#!/usr/bin/env python3
"""READ-ONLY backup of the COLLECTIVE Firestore data (evora-athletes): candidature + settings.
Run in Google Cloud Shell with the owner's gcloud login. Never writes to Firestore.
Output: a private 0700 directory under $HOME with one JSON file per collection (0600).
Prints only document counts, never document contents or credentials.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PROJECT = 'evora-athletes'
ROOT = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/'
COLLECTIONS = ('candidature', 'settings')


def get(url, token):
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token, 'X-Goog-User-Project': PROJECT,
                                               'User-Agent': 'EvoraCollectiveBackup/1.0 (Cloud Shell)', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def collection(name, token):
    docs, page = [], None
    while True:
        query = {'pageSize': '300'}
        if page:
            query['pageToken'] = page
        data = get(ROOT + name + '?' + urllib.parse.urlencode(query), token)
        docs.extend(data.get('documents', []))
        page = data.get('nextPageToken')
        if not page:
            return docs


def main():
    token = subprocess.run(['gcloud', 'auth', 'print-access-token', '--quiet'], capture_output=True, text=True, check=True).stdout.strip()
    if not token:
        sys.exit('STOP: accesso Google Cloud Shell non disponibile.')
    out = Path.home() / ('evora-collective-backup-' + time.strftime('%Y%m%d-%H%M%S'))
    out.mkdir(mode=0o700)
    for name in COLLECTIONS:
        docs = collection(name, token)
        target = out / (name + '.json')
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump({'project': PROJECT, 'collection': name, 'exportedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'documents': docs}, f)
        print(name + ': ' + str(len(docs)) + ' documenti salvati.')
    print('Backup in sola lettura completato: ' + str(out))
    print('Contiene dati personali delle candidature: non condividerlo e non caricarlo su repository.')


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as e:
        sys.exit('STOP: HTTP ' + str(e.code) + ' durante la lettura. Nessun dato modificato.')
    except Exception:
        sys.exit('STOP: backup non completato. Nessun dato modificato.')
