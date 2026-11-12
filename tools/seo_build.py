#!/usr/bin/env python3
"""Вставляет SEO-теги в <head> публичных страниц и пересобирает robots.txt + sitemap.xml.
Запуск из корня сайта:  python3 tools/seo_build.py
Домен меняется в одном месте: SITE_URL ниже (или переменная окружения SITE_URL)."""
import os, re, json, datetime

SITE_URL = os.environ.get('SITE_URL', 'https://karoleenok.github.io/nika-site').rstrip('/')
NAME = 'Ника Дупина'
OG = SITE_URL + '/assets/img/og.jpg'
START, END = '<!-- seo:start -->', '<!-- seo:end -->'
TODAY = datetime.date.today().isoformat()

PERSON = {
  '@context': 'https://schema.org', '@type': 'Person', 'name': NAME,
  'jobTitle': 'Фитнес-тренер и специалист по питанию',
  'url': SITE_URL + '/', 'image': OG,
  'address': {'@type': 'PostalAddress', 'addressLocality': 'Хабаровск', 'addressCountry': 'RU'},
  'sameAs': ['https://t.me/nikaklubnika27', 'https://www.instagram.com/nikass.d/'],
}
def product(name, desc, page, price):
    return {'@context': 'https://schema.org', '@type': 'Product', 'name': name, 'description': desc,
            'image': OG, 'brand': {'@type': 'Person', 'name': NAME},
            'offers': {'@type': 'Offer', 'url': SITE_URL + '/' + page, 'price': str(price),
                       'priceCurrency': 'RUB', 'availability': 'https://schema.org/InStock'}}

# path -> (indexed, title|None, description|None, og_type, jsonld|None, priority)
PAGES = {
 'index.html': (True, None, None, 'website', PERSON, '1.0'),
 'guide-zaedanie.html': (True, 'Как перестать заедать эмоции — гайд от Ники Дупиной', 
   'Гайд для тех, кто заедает стресс и срывается на еду: почему так происходит и что делать. Доступ в личном кабинете.', 'product',
   product('Как перестать заедать эмоции', 'Гайд про эмоциональное переедание от Ники Дупиной.', 'guide-zaedanie.html', 899), '0.8'),
 'video-alkogol.html': (True, 'Как не отказывать себе в алкоголе при похудении — видео-разбор',
   'Видео-разбор: как пить бокал вина на празднике и не сорвать результат. Доступ в личном кабинете.', 'product',
   product('Как не отказывать себе в алкоголе при похудении', 'Видео-разбор от Ники Дупиной.', 'video-alkogol.html', 899), '0.8'),
 'legal/index.html': (True, None, None, 'website', None, '0.3'),
 'legal/offer.html': (True, None, None, 'website', None, '0.3'),
 'legal/privacy.html': (True, None, None, 'website', None, '0.3'),
 'legal/consent.html': (True, None, None, 'website', None, '0.3'),
 'legal/requisites.html': (True, None, None, 'website', None, '0.3'),
}
# страницы без индексации: только проверяем, что есть noindex
NOINDEX = ['cases.html','checkout.html','spasibo.html','404.html','lk/index.html','lk/login.html','admin/index.html','admin/login.html']

def esc(s): return s.replace('&','&amp;').replace('"','&quot;')

def build(path, indexed, title, desc, ogtype, ld):
    html = open(path, encoding='utf-8').read()
    html = re.sub(r'\s*' + re.escape(START) + r'.*?' + re.escape(END), '', html, flags=re.S)
    if title:
        html = re.sub(r'<title>.*?</title>', '<title>%s</title>' % esc(title), html, count=1, flags=re.S)
    if desc:
        html = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % esc(desc), html, count=1)
    t = re.search(r'<title>(.*?)</title>', html, re.S).group(1)
    d = re.search(r'<meta name="description" content="([^"]*)">', html).group(1)
    url = SITE_URL + '/' + ('' if path == 'index.html' else path)
    lines = [START,
      '<link rel="canonical" href="%s">' % url,
      '<meta property="og:site_name" content="%s">' % NAME,
      '<meta property="og:locale" content="ru_RU">',
      '<meta property="og:type" content="%s">' % ogtype,
      '<meta property="og:title" content="%s">' % t,
      '<meta property="og:description" content="%s">' % d,
      '<meta property="og:url" content="%s">' % url,
      '<meta property="og:image" content="%s">' % OG,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta name="twitter:card" content="summary_large_image">']
    if ld:
        lines.append('<script type="application/ld+json">%s</script>' % json.dumps(ld, ensure_ascii=False))
    lines.append(END)
    block = '\n  '.join(lines)
    html = re.sub(r'(<meta name="description"[^>]*>)', lambda m: m.group(1) + '\n  ' + block, html, count=1)
    open(path, 'w', encoding='utf-8').write(html)

for p, (idx, ti, de, ot, ld, pr) in PAGES.items():
    build(p, idx, ti, de, ot, ld)
for p in NOINDEX:
    if 'noindex' not in open(p, encoding='utf-8').read():
        print('ВНИМАНИЕ: нет noindex в', p)

open('robots.txt', 'w').write('User-agent: *\nAllow: /\nDisallow: /lk/\nDisallow: /admin/\nDisallow: /checkout.html\nDisallow: /spasibo.html\n\nSitemap: %s/sitemap.xml\n' % SITE_URL)
rows = ''.join('  <url><loc>%s/%s</loc><lastmod>%s</lastmod><priority>%s</priority></url>\n' % (SITE_URL, '' if p == 'index.html' else p, TODAY, v[5]) for p, v in PAGES.items())
open('sitemap.xml', 'w').write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows + '</urlset>\n')
print('ok', SITE_URL)
