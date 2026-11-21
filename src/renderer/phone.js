'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.oshibkin;
  let menuOpen = false;
  let last = { mode: 'warning', canPostpone: true };

  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const TEXT = {
    warning: { msg: '1 новое сообщение', sub: 'Нажми, чтобы открыть', cd: (l) => `Дело через ${fmt(l)}` },
    postponed: { msg: '1 новое сообщение', sub: 'Отложено', cd: () => '' },
    waitPause: { msg: 'Поставь игру на паузу', sub: 'Детектив начнёт, как только ты отпустишь мышь и клавиатуру', cd: () => '' },
    final: { msg: 'Дело начинается!', sub: 'Поставь игру на паузу', cd: (l) => `Через ${l} с` },
    vacation: { msg: 'Ты в отпуске!', sub: 'Это дело детектив раскроет сам. Играй спокойно.', cd: () => '' },
  };

  function setMenu(open) {
    if (last.mode === 'vacation') open = false;
    menuOpen = open;
    $('menu').hidden = !open;
    api.send('phone:menu', open);
  }

  function render(d) {
    last = d;
    const t = TEXT[d.mode] || TEXT.warning;
    $('msg').textContent = t.msg;
    $('sub').textContent = t.sub;
    $('cd').textContent = t.cd(d.left || 0);
    $('later').disabled = !d.canPostpone;
    $('laterNote').textContent = d.canPostpone ? 'Отложить можно один раз перед каждым делом.' : 'Это дело ты уже откладывал.';
    if (d.mode === 'waitPause' || d.mode === 'final') $('menuText').textContent = '«Поставь игру на паузу, и начнём!»';
    if (d.buzz) {
      const p = $('phone');
      p.classList.remove('buzz');
      void p.offsetWidth;
      p.classList.add('buzz');
    }
    if (d.mode === 'vacation') setMenu(false);
  }

  $('phone').addEventListener('click', () => setMenu(!menuOpen));
  $('read').addEventListener('click', () => api.send('phone:read'));
  $('later').addEventListener('click', () => { setMenu(false); api.send('phone:later'); });
  api.on('phone:update', render);
})();
