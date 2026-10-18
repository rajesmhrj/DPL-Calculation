/* Builds playing-card elements (see .pc in css/site.css). */
(function () {
  'use strict';
  const RED = new Set(['♥', '♦']);
  const SUIT_NAME = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
  const RANK_NAME = { A: 'ace', J: 'jack', Q: 'queen', K: 'king' };

  /** make('7', '♠', { faceDown, maal, tag, size }) */
  function make(rank, suit, opts = {}) {
    const card = document.createElement('div');
    card.className = 'pc' + (RED.has(suit) ? ' red' : '') + (opts.faceDown ? ' face-down' : '') + (opts.maal ? ' maal' : '');
    if (opts.size) card.style.setProperty('--w', opts.size);
    card.setAttribute('role', 'img');
    const tag = opts.tag ? opts.tag.replace(/\n/g, ' ') : '';
    card.dataset.faceLabel = `${RANK_NAME[rank] || rank} of ${SUIT_NAME[suit]}${tag ? ', ' + tag : ''}`;
    card.setAttribute('aria-label', opts.faceDown ? 'face-down card' : card.dataset.faceLabel);
    const corner = cls => {
      const c = document.createElement('span');
      c.className = 'pc-corner ' + cls;
      c.append(rank, document.createElement('small'));
      c.lastChild.textContent = suit;
      return c;
    };
    const face = document.createElement('div');
    face.className = 'pc-face';
    const pip = document.createElement('span');
    pip.className = 'pc-pip';
    pip.textContent = suit;
    face.append(corner('tl'), pip, corner('br'));
    const back = document.createElement('div');
    back.className = 'pc-back';
    const inner = document.createElement('div');
    inner.className = 'pc-inner';
    inner.append(face, back);
    card.append(inner);
    if (opts.tag) {
      const t = document.createElement('span');
      t.className = 'pc-tag';
      t.textContent = opts.tag;
      card.append(t);
    }
    return card;
  }

  // Power cards: one Superman, three Putalis (butterflies).
  const BUTTERFLY = '<svg viewBox="0 0 40 32" aria-hidden="true"><path d="M20 9c-3-6-11-9-16-6s-2 12 5 13c-6 2-7 9-2 11s10-3 13-9c3 6 8 11 13 9s4-9-2-11c7-1 10-10 5-13S23 3 20 9z" fill="currentColor"/><path d="M20 7v20" stroke="#3b1d4f" stroke-width="2" stroke-linecap="round"/></svg>';
  function power(kind, opts = {}) {
    const isSup = kind === 'SUP';
    const card = make('A', '♠', opts);
    card.classList.remove('red');
    card.classList.add('power', isSup ? 'superman' : 'putali');
    card.dataset.faceLabel = (isSup ? 'Superman' : 'Putali') + ' power card' + (opts.tag ? ', ' + opts.tag.replace(/\n/g, ' ') : '');
    card.setAttribute('aria-label', opts.faceDown ? 'face-down card' : card.dataset.faceLabel);
    const face = card.querySelector('.pc-face');
    face.querySelectorAll('.pc-corner').forEach(c => { c.textContent = isSup ? 'S' : 'P'; });
    const pip = face.querySelector('.pc-pip');
    if (isSup) pip.textContent = '★'; else pip.innerHTML = BUTTERFLY;
    const name = document.createElement('span');
    name.className = 'pc-power-name';
    name.textContent = isSup ? 'Superman' : 'Putali';
    face.append(name);
    return card;
  }

  /** From a card key: "7♠", "10♥", "SUP" or "PUT". */
  function fromKey(k, opts) {
    if (k === 'SUP' || k === 'PUT') return power(k, opts);
    return make(k.slice(0, -1), k.slice(-1), opts);
  }
  const label = k => (k === 'SUP' ? 'Superman' : k === 'PUT' ? 'Putali' : k);

  function flip(card, faceUp) {
    card.classList.toggle('face-down', !faceUp);
    card.setAttribute('aria-label', faceUp ? card.dataset.faceLabel : 'face-down card');
  }

  window.Cards = { make, fromKey, label, flip, RED };
})();
