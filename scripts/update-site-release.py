#!/usr/bin/env python3
"""Render the public release download card from a GitHub release response."""

import argparse
from datetime import datetime
from html import escape
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

START = '<!-- release-info:start -->'
END = '<!-- release-info:end -->'
REPOSITORY = 'devdownin/novaguard'


def github_url(value, prefix):
    if not isinstance(value, str):
        raise ValueError('Missing GitHub URL')
    url = urlsplit(value)
    if (url.scheme != 'https' or url.netloc != 'github.com'
            or not url.path.startswith(prefix) or url.query or url.fragment):
        raise ValueError('Unexpected release URL')
    return escape(value, quote=True)


def render_release(release):
    if release.get('draft') or release.get('prerelease'):
        raise ValueError('Only a published stable release may be promoted')
    version = release.get('tag_name')
    if not isinstance(version, str) or not version.strip():
        raise ValueError('Missing release version')
    published = datetime.fromisoformat(release['published_at'].replace('Z', '+00:00'))
    release_url = github_url(release['html_url'], f'/{REPOSITORY}/releases/tag/')
    apks = [asset for asset in release.get('assets', [])
            if isinstance(asset.get('name'), str)
            and asset['name'].lower().endswith('.apk')
            and asset.get('state') == 'uploaded'
            and isinstance(asset.get('size'), int) and asset['size'] > 0]
    # Prefer the existing universal filename. Several architecture-specific APKs
    # require a choice on the release page rather than an arbitrary download.
    universal = next((asset for asset in apks if asset['name'] == 'app-release.apk'), None)
    apk = universal or (apks[0] if len(apks) == 1 else None)
    if apk:
        url = github_url(apk['browser_download_url'], f'/{REPOSITORY}/releases/download/')
        action = f'<a class="button primary" href="{url}">Télécharger l’APK <span aria-hidden="true">↓</span></a>'
        detail = f'{apk["size"] / 1_000_000:.1f}'.replace('.', ',') + ' Mo · APK Android'
    else:
        action = f'<a class="button primary" href="{release_url}">Choisir un fichier de version</a>'
        detail = 'Consultez les fichiers disponibles sur GitHub'
    return f'''<div class="release-card" aria-label="Dernière version stable publiée">
      <p class="release-label">DERNIÈRE VERSION STABLE PUBLIÉE</p>
      <p class="release-version">{escape(version)} <span>· <time datetime="{published.date().isoformat()}">{published:%d/%m/%Y}</time></span></p>
      {action}
      <p class="release-size">{detail}</p>
      <a class="release-notes" href="{release_url}">Notes de version et autres fichiers</a>
    </div>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--site-dir', type=Path,
                        default=Path(__file__).resolve().parents[1] / 'site')
    args = parser.parse_args()
    release = json.loads(args.metadata.read_text(encoding='utf-8'))
    card = render_release(release)
    page_path = args.site_dir / 'index.html'
    page = page_path.read_text(encoding='utf-8')
    pattern = re.compile(re.escape(START) + r'.*?' + re.escape(END), re.DOTALL)
    updated, count = pattern.subn(lambda _: START + '\n' + card + '\n' + END, page)
    if count != 1:
        raise ValueError('Expected exactly one release card in index.html')
    page_path.write_text(updated, encoding='utf-8')
    print(f'Release card updated: {release["tag_name"]}')


if __name__ == '__main__':
    main()
