import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numeroWhatsApp, lienWhatsApp } from '../src/telephone.js';

test('numeroWhatsApp', () => {
  assert.equal(numeroWhatsApp('066123456'), '24166123456');
  assert.equal(numeroWhatsApp('077 22 99 98'), '24177229998');
  assert.equal(numeroWhatsApp('+241 77 22 99 98'), '24177229998');
  assert.equal(numeroWhatsApp('0024166123456'), '24166123456');
  assert.equal(numeroWhatsApp('66-12-34-56'), '24166123456');
  assert.equal(numeroWhatsApp('+33 6 12 34 56 78'), '33612345678');
  assert.equal(numeroWhatsApp('06 61 23 45 6'), '24166123456'); // espaces mal placés : même numéro
  for (const t of ['', null, undefined, '12345', '06 61 23 4', '0661234565', 'abc', '+', '+12'])
    assert.equal(numeroWhatsApp(t), null, String(t));
});

test('lienWhatsApp encode le texte et renvoie null sans numéro', () => {
  assert.equal(lienWhatsApp('066123456', "l'été & co"), "https://wa.me/24166123456?text=l'%C3%A9t%C3%A9%20%26%20co");
  assert.equal(lienWhatsApp('', 'x'), null);
});
