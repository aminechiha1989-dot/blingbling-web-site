"""Détoure automatiquement les photos des vêtements (fond transparent).
Lancé par GitHub Actions toutes les 10 minutes : traite les articles
nouveaux ou dont la photo a changé, puis met à jour cutouts/index.json."""
import hashlib
import io
import json
import os
import urllib.request

import numpy as np
from PIL import Image, ImageFilter
from rembg import new_session, remove
from scipy import ndimage

API = 'https://blingbling-b7cg.onrender.com/api/products?include_sold=1'
OUT = 'cutouts'
INDEX = os.path.join(OUT, 'index.json')
SKIP = ('Accessoires', 'Bijoux', 'Sacs')  # photos mises en scène : on garde l'original


def get(url, timeout=180):
    req = urllib.request.Request(url, headers={'User-Agent': 'blingbling-cutouts'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def url_hash(url):
    return hashlib.md5(url.encode()).hexdigest()[:8]


def cut(img, session):
    src = img.convert('RGB')
    m = np.array(remove(src, session=session, only_mask=True)) > 20
    m = ndimage.binary_closing(m, iterations=3)
    m = ndimage.binary_fill_holes(m)
    lab, n = ndimage.label(m)
    if n > 1:
        sz = ndimage.sum(m, lab, range(1, n + 1))
        m = np.isin(lab, np.where(sz > 0.01 * sz.max())[0] + 1)
    m = ndimage.binary_erosion(m, iterations=1)
    a = Image.fromarray((m * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.7))
    out = src.copy()
    out.putalpha(a)
    out = out.crop(a.point(lambda v: 255 if v > 8 else 0).getbbox())
    out.thumbnail((900, 1200))
    return out


def main():
    index = json.load(open(INDEX)) if os.path.exists(INDEX) else {}
    products = json.loads(get(API))
    session = None
    changed = False
    for p in products:
        pid, url = str(p['id']), (p.get('image_url') or '').strip()
        cat = (p.get('category') or '').strip()
        if not url or cat.startswith(SKIP):
            continue
        h = url_hash(url)
        if index.get(pid) == h and os.path.exists(f'{OUT}/{pid}.webp'):
            continue
        try:
            session = session or new_session('isnet-general-use')
            img = Image.open(io.BytesIO(get(url)))
            cut(img, session).save(f'{OUT}/{pid}.webp', quality=88, method=6)
            index[pid] = h
            changed = True
            print('détouré', pid, p['name'])
        except Exception as e:  # une photo en échec ne bloque pas les autres
            print('échec', pid, e)
    if changed:
        with open(INDEX, 'w') as f:
            json.dump(index, f, indent=0, sort_keys=True)
    print('terminé, changements :', changed)


if __name__ == '__main__':
    main()
