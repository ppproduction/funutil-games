// ── Particle System ──
(function () {
    const container = document.getElementById('particles');
    if (!container) return;

    const COLORS = ['#f97316', '#ef4444', '#fbbf24', '#f472b6', '#a78bfa'];

    for (let i = 0; i < 30; i++) {
        const el = document.createElement('div');
        el.classList.add('particle');
        const size = Math.random() * 4 + 2;
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.left = Math.random() * 100 + '%';
        el.style.background = COLORS[Math.floor(Math.random() * COLORS.length)];
        el.style.animationDuration = (Math.random() * 15 + 10) + 's';
        el.style.animationDelay = (Math.random() * 10) + 's';
        container.appendChild(el);
    }
})();
