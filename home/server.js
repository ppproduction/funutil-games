require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3005;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const FUNUTIL_URL = process.env.FUNUTIL_URL || 'http://localhost:3001';
const PAKDA_PAKDI_URL = process.env.PAKDA_PAKDI_URL || 'http://localhost:3006';
const HOUSIE_URL = process.env.HOUSIE_URL || 'http://localhost:3007';

function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const GAMES = [
    {
        slug: 'pakda-pakdi',
        title: 'Pakda Pakdi',
        emoji: '🏃',
        description: 'A thrilling chase game inspired by the classic Indian street game. Run, dodge & survive!',
        gradient: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)',
        accent: '#f97316',
        live: true,
        url: PAKDA_PAKDI_URL
    },
    {
        slug: 'housie',
        title: 'Housie (Tambola)',
        emoji: '🎟️',
        description: 'The classic game of probabilities! Build your ticket, mark drawn numbers and win exiting claims like Jaldi 5.',
        gradient: 'linear-gradient(135deg, #8a2be2 0%, #ff007f 100%)',
        accent: '#8a2be2',
        live: true,
        url: HOUSIE_URL
    }
];

function buildCardHtml(game) {
    const badge = game.live
        ? '<span class="badge live-badge">Live</span>'
        : '<span class="badge coming-soon">Coming Soon</span>';
    const linkAttr = game.live
        ? `href="${escapeHtml(game.url)}"`
        : 'href="#" onclick="return false;" tabindex="-1"';
    const disabledClass = game.live ? '' : ' card-disabled';

    return `
    <a ${linkAttr} class="card${disabledClass}" style="--card-gradient: ${game.gradient}; --card-accent: ${game.accent}">
      ${badge}
      <div class="card-glow"></div>
      <div class="card-emoji">${game.emoji}</div>
      <h2 class="card-title">${escapeHtml(game.title)}</h2>
      <p class="card-desc">${escapeHtml(game.description)}</p>
      ${game.live ? '<span class="card-cta">Play Now →</span>' : ''}
    </a>`;
}

function homePage(baseUrl = BASE_URL) {
    const cardsHtml = GAMES.map(buildCardHtml).join('\n');

    const schema = {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'FunUtil Games',
        url: baseUrl,
        description: 'Free multiplayer browser games — chase, compete & have fun with friends.',
        isPartOf: {
            '@type': 'WebSite',
            name: 'FunUtil',
            url: FUNUTIL_URL
        }
    };

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Games Hub — Free Browser Games | FunUtil</title>
  <meta name="description" content="Play free multiplayer browser games at FunUtil — chase games, puzzles, and more. No downloads, no sign-up, just fun." />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${escapeHtml(baseUrl)}/" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Games Hub — Free Browser Games" />
  <meta property="og:description" content="Free multiplayer browser games — chase, compete & have fun." />
  <meta property="og:url" content="${escapeHtml(baseUrl)}/" />
  <meta property="og:image" content="${escapeHtml(baseUrl)}/og-image.svg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="FunUtil Games" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Games Hub — Free Browser Games" />
  <meta name="twitter:description" content="Free multiplayer browser games — chase, compete & have fun." />
  <meta name="twitter:image" content="${escapeHtml(baseUrl)}/og-image.svg" />
  <meta name="theme-color" content="#0a0a1a" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎮</text></svg>" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Outfit:wght@700;800;900&display=swap" />
  <link rel="stylesheet" href="/public/style.css" />
  <script type="application/ld+json">${JSON.stringify(schema)}</script>
</head>
<body>
  <div class="particles" id="particles"></div>
  <div class="aurora"></div>

  <div class="site-wrapper">
    <nav class="navbar">
      <a href="${escapeHtml(FUNUTIL_URL)}" class="navbar-back" title="Back to FunUtil">← FunUtil</a>
      <a href="/" class="navbar-brand"><span>🎮</span> Games</a>
    </nav>

    <main class="container">
      <header class="hero">
        <div class="hero-badge">🎮 Free Browser Games</div>
        <h1 class="hero-title">Let's <span class="highlight">Play</span></h1>
        <p class="hero-sub">Multiplayer fun right in your browser — no downloads, no sign-up, just jump in and play.</p>
      </header>

      <section class="cards-grid" aria-label="Available games">
        ${cardsHtml}
      </section>

      <section class="about-section">
        <h2 class="section-heading">Games for Everyone</h2>
        <p class="about-text">FunUtil Games brings classic playground fun to your browser. Challenge your friends to real-time multiplayer games inspired by the games we all grew up playing — from Pakda Pakdi (tag) to strategy puzzles and more.</p>
        <p class="about-text">Every game is free, works on any device, and needs zero setup. Share a link, invite your friends, and start playing in seconds.</p>
      </section>
    </main>

    <footer>
      <p>Made with ❤️ by <strong><a href="${escapeHtml(FUNUTIL_URL)}" class="footer-link">FunUtil</a></strong></p>
    </footer>
  </div>

  <script src="/public/script.js" defer></script>
</body>
</html>`;
}

function sitemapXml(baseUrl = BASE_URL) {
    const now = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>${baseUrl}/sitemap-pages.xml</loc><lastmod>${now}</lastmod></sitemap>
<sitemap><loc>${PAKDA_PAKDI_URL}/sitemap.xml</loc><lastmod>${now}</lastmod></sitemap>
</sitemapindex>`;
}

function sitemapPagesXml(baseUrl = BASE_URL) {
    const now = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${baseUrl}/</loc><lastmod>${now}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>`;
}

function serveStatic(filePath, res) {
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
            return;
        }
        const ext = path.extname(filePath);
        const types = {
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml'
        };
        const isImage = ['.png', '.jpg', '.svg'].includes(ext);
        res.writeHead(200, {
            'Content-Type': types[ext] || 'application/octet-stream',
            'Cache-Control': isImage ? 'public, max-age=86400' : 'public, max-age=3600'
        });
        res.end(content);
    });
}

const server = http.createServer((req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || `localhost:${PORT}`;
    const dynamicBaseUrl = `${protocol}://${host}`;

    const url = new URL(req.url, dynamicBaseUrl);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`User-agent: *\nAllow: /\nSitemap: ${dynamicBaseUrl}/sitemap.xml\n`);
        return;
    }

    if (pathname === '/ads.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('google.com, pub-7863489646399489, DIRECT, f08c47fec0942fa0\n');
        return;
    }

    if (pathname === '/sitemap.xml') {
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
        res.end(sitemapXml(dynamicBaseUrl));
        return;
    }

    if (pathname === '/sitemap-pages.xml') {
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
        res.end(sitemapPagesXml(dynamicBaseUrl));
        return;
    }

    if (pathname === '/og-image.svg') {
        res.writeHead(200, {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=86400'
        });
        res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a1a"/>
      <stop offset="100%" style="stop-color:#1a1040"/>
    </linearGradient>
    <linearGradient id="txt" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#f97316"/>
      <stop offset="100%" style="stop-color:#ef4444"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="600" y="250" text-anchor="middle" font-family="sans-serif" font-size="80" font-weight="800" fill="url(#txt)">🎮 Games Hub</text>
  <text x="600" y="340" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#c4b5fd">Free Browser Games</text>
  <text x="600" y="420" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#9ca3af">Pakda Pakdi · Chase · Compete · Win</text>
</svg>`);
        return;
    }

    if (pathname.startsWith('/public/')) {
        serveStatic(path.join(__dirname, pathname), res);
        return;
    }

    if (pathname === '/' || pathname === '') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(homePage(dynamicBaseUrl));
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>404</title><link rel="stylesheet" href="/public/style.css"></head>
<body><div class="site-wrapper"><main class="container"><div class="hero"><h1 class="hero-title">404 — Page Not Found</h1><p class="hero-sub">The page you're looking for doesn't exist.</p><a href="/" class="card-cta" style="display:inline-block;margin-top:1.5rem;">← Back to Games</a></div></main></div></body></html>`);
});

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`Games hub running on ${BASE_URL}`);
    });
}

module.exports = { server };
