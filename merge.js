const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ============================================================
//  AYARLAR — sadece bu bölümü düzenle
// ============================================================
const CONFIG = {
  firma_a: {
    url: 'https://api.akdenizerp.com/xml/xmlweb.xml',   // <-- değiştir
    ad:  'akdeniz',
  },
  firma_b: {
    url: 'https://www.promolife.com.tr/xml_all/product.xml',   // <-- değiştir
    ad:  'promolife',
  },
  ciktiDosyasi: 'output/birlesik_stok.xml',
  logDosyasi:   'output/son_calisma.log',
};
// ============================================================

// ---- HTTP çekici (redirect destekli) ----------------------
function fetchURL(url, yonlendirmeSayisi = 0) {
  if (yonlendirmeSayisi > 5) return Promise.reject(new Error('Çok fazla yönlendirme'));
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'StokMerger/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        return fetchURL(res.headers.location, yonlendirmeSayisi + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const parcalar = [];
      res.on('data', c => parcalar.push(c));
      res.on('end', () => resolve(Buffer.concat(parcalar).toString('utf8')));
    }).on('error', reject);
  });
}

// ---- XML'den tek bir etiketin değerini al -----------------
function etiketDegeri(blok, etiket) {
  // CDATA desteği dahil
  const re = new RegExp(`<${etiket}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${etiket}>`, 'i');
  const m = blok.match(re);
  if (m) return (m[1] !== undefined ? m[1] : m[2] || '').trim();
  return '';
}

// ---- Firma A XML parse (etiket: <Urun>) -------------------
function parseA(xmlStr) {
  const urunler = [];
  const blokRe = /<Urun>([\s\S]*?)<\/Urun>/gi;
  let m;
  while ((m = blokRe.exec(xmlStr)) !== null) {
    const blok = m[0];

    const urunID     = etiketDegeri(blok, 'UrunID');
    const urunKod    = etiketDegeri(blok, 'UrunKod');
    const urunAd     = etiketDegeri(blok, 'UrunAd');
    const aciklama   = etiketDegeri(blok, 'UrunAciklama');
    const kategori   = etiketDegeri(blok, 'UrunKategoriID');
    const resim      = etiketDegeri(blok, 'UrunResim1URL');
    const siteURL    = etiketDegeri(blok, 'UrunSiteURL');
    const fiyat      = etiketDegeri(blok, 'UrunFiyat');
    const fiyatBirim = etiketDegeri(blok, 'UrunFiyatBirim');
    const kdv        = etiketDegeri(blok, 'UrunFiyatKDV');
    const toplamStok = etiketDegeri(blok, 'UrunToplamStok');
    const stokBirim  = etiketDegeri(blok, 'UrunToplamStokBirim');

    // Seçenekler (renk/beden varyantları) — her biri ayrı kayıt
    const secenekRe = /<Secenek>([\s\S]*?)<\/Secenek>/gi;
    let sm;
    const secenekler = [];
    while ((sm = secenekRe.exec(blok)) !== null) secenekler.push(sm[0]);

    if (secenekler.length > 0) {
      secenekler.forEach(s => {
        urunler.push({
          urunID,
          urunKod:    etiketDegeri(s, 'SecenekKod') || urunKod,
          grupKod:    etiketDegeri(s, 'GrupKod'),
          secenekID:  etiketDegeri(s, 'SecenekID'),
          urunAd, aciklama, kategori, resim, siteURL,
          fiyat, fiyatBirim, kdv,
          stok:      etiketDegeri(s, 'SecenekToplamStok') || toplamStok,
          stokBirim,
        });
      });
    } else {
      urunler.push({
        urunID, urunKod, grupKod: '', secenekID: '',
        urunAd, aciklama, kategori, resim, siteURL,
        fiyat, fiyatBirim, kdv,
        stok: toplamStok, stokBirim,
      });
    }
  }
  return urunler;
}

// ---- Firma B XML parse (etiket: <RECORD>) -----------------
function parseB(xmlStr) {
  const urunler = [];
  const blokRe = /<RECORD>([\s\S]*?)<\/RECORD>/gi;
  let m;
  while ((m = blokRe.exec(xmlStr)) !== null) {
    const blok = m[0];
    urunler.push({
      urunID:      etiketDegeri(blok, 'urun_id'),
      urunKod:     etiketDegeri(blok, 'urunkodu'),
      urunAttrID:  etiketDegeri(blok, 'urunattr_id'),
      urunAttrGr:  etiketDegeri(blok, 'urunattrgr'),
      urunAttrAdi: etiketDegeri(blok, 'urunattradi'),
      urunAd:      etiketDegeri(blok, 'urunadi'),
      aciklama:    etiketDegeri(blok, 'urunaciklamasi'),
      kategori:    etiketDegeri(blok, 'kategori'),
      stokResim:   etiketDegeri(blok, 'stokresim'),
      urunResim:   etiketDegeri(blok, 'urunresim'),
      urunResim1:  etiketDegeri(blok, 'urunresim1'),
      urunResim2:  etiketDegeri(blok, 'urunresim2'),
      urunResim3:  etiketDegeri(blok, 'urunresim3'),
      urunResim4:  etiketDegeri(blok, 'urunresim4'),
      stokTag:     etiketDegeri(blok, 'stoktag'),
    });
  }
  return urunler;
}

// ---- XML özel karakter kaçış ------------------------------
function esc(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Birleşik XML oluştur ---------------------------------
function xmlOlustur(listA, listB) {
  const simdi = new Date().toISOString();
  const satirlar = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- Oluşturulma: ${simdi} -->`,
    `<!-- ${CONFIG.firma_a.ad}: ${listA.length} kayıt | ${CONFIG.firma_b.ad}: ${listB.length} kayıt | Toplam: ${listA.length + listB.length} -->`,
    '<stok_raporu>',
    '',
    '  <meta>',
    `    <olusturulma>${simdi}</olusturulma>`,
    `    <firma_a_kayit_sayisi>${listA.length}</firma_a_kayit_sayisi>`,
    `    <firma_b_kayit_sayisi>${listB.length}</firma_b_kayit_sayisi>`,
    `    <toplam_kayit>${listA.length + listB.length}</toplam_kayit>`,
    '  </meta>',
    '',
    `  <${CONFIG.firma_a.ad}>`,
  ];

  listA.forEach((u, i) => {
    satirlar.push(`    <urun id="${i + 1}">`);
    satirlar.push(`      <UrunID>${esc(u.urunID)}</UrunID>`);
    satirlar.push(`      <UrunKod><![CDATA[${u.urunKod || ''}]]></UrunKod>`);
    if (u.grupKod)   satirlar.push(`      <GrupKod><![CDATA[${u.grupKod}]]></GrupKod>`);
    if (u.secenekID) satirlar.push(`      <SecenekID>${esc(u.secenekID)}</SecenekID>`);
    satirlar.push(`      <UrunAd><![CDATA[${u.urunAd || ''}]]></UrunAd>`);
    satirlar.push(`      <Kategori>${esc(u.kategori)}</Kategori>`);
    satirlar.push(`      <Stok>${esc(u.stok)}</Stok>`);
    satirlar.push(`      <StokBirim>${esc(u.stokBirim)}</StokBirim>`);
    satirlar.push(`      <Fiyat>${esc(u.fiyat)}</Fiyat>`);
    satirlar.push(`      <FiyatBirim>${esc(u.fiyatBirim)}</FiyatBirim>`);
    satirlar.push(`      <KDV>${esc(u.kdv)}</KDV>`);
    if (u.resim)   satirlar.push(`      <Resim>${esc(u.resim)}</Resim>`);
    if (u.siteURL) satirlar.push(`      <SiteURL>${esc(u.siteURL)}</SiteURL>`);
    satirlar.push(`    </urun>`);
  });

  satirlar.push(`  </${CONFIG.firma_a.ad}>`);
  satirlar.push('');
  satirlar.push(`  <${CONFIG.firma_b.ad}>`);

  listB.forEach((u, i) => {
    satirlar.push(`    <urun id="${i + 1}">`);
    satirlar.push(`      <urun_id>${esc(u.urunID)}</urun_id>`);
    satirlar.push(`      <urunkodu>${esc(u.urunKod)}</urunkodu>`);
    satirlar.push(`      <urunattr_id>${esc(u.urunAttrID)}</urunattr_id>`);
    satirlar.push(`      <urunattrgr>${esc(u.urunAttrGr)}</urunattrgr>`);
    satirlar.push(`      <urunattradi><![CDATA[${u.urunAttrAdi || ''}]]></urunattradi>`);
    satirlar.push(`      <urunadi><![CDATA[${u.urunAd || ''}]]></urunadi>`);
    satirlar.push(`      <kategori><![CDATA[${u.kategori || ''}]]></kategori>`);
    if (u.stokResim)  satirlar.push(`      <stokresim>${esc(u.stokResim)}</stokresim>`);
    if (u.urunResim)  satirlar.push(`      <urunresim>${esc(u.urunResim)}</urunresim>`);
    if (u.urunResim1) satirlar.push(`      <urunresim1>${esc(u.urunResim1)}</urunresim1>`);
    if (u.urunResim2) satirlar.push(`      <urunresim2>${esc(u.urunResim2)}</urunresim2>`);
    if (u.urunResim3) satirlar.push(`      <urunresim3>${esc(u.urunResim3)}</urunresim3>`);
    if (u.urunResim4) satirlar.push(`      <urunresim4>${esc(u.urunResim4)}</urunresim4>`);
    if (u.stokTag)    satirlar.push(`      <stoktag><![CDATA[${u.stokTag}]]></stoktag>`);
    satirlar.push(`    </urun>`);
  });

  satirlar.push(`  </${CONFIG.firma_b.ad}>`);
  satirlar.push('');
  satirlar.push('</stok_raporu>');
  return satirlar.join('\n');
}

// ---- Ana akış ---------------------------------------------
async function main() {
  const loglar = [];
  const log = msg => {
    const satir = `[${new Date().toISOString()}] ${msg}`;
    console.log(satir);
    loglar.push(satir);
  };

  log('=== Stok Merger başlatıldı ===');

  let listA = [], listB = [];

  try {
    log(`Firma A çekiliyor: ${CONFIG.firma_a.url}`);
    const xmlA = await fetchURL(CONFIG.firma_a.url);
    listA = parseA(xmlA);
    log(`Firma A: ${listA.length} kayıt parse edildi`);
  } catch (e) {
    log(`HATA — Firma A: ${e.message}`);
    process.exit(1);
  }

  try {
    log(`Firma B çekiliyor: ${CONFIG.firma_b.url}`);
    const xmlB = await fetchURL(CONFIG.firma_b.url);
    listB = parseB(xmlB);
    log(`Firma B: ${listB.length} kayıt parse edildi`);
  } catch (e) {
    log(`HATA — Firma B: ${e.message}`);
    process.exit(1);
  }

  const xmlCikti = xmlOlustur(listA, listB);

  fs.mkdirSync(path.dirname(CONFIG.ciktiDosyasi), { recursive: true });
  fs.writeFileSync(CONFIG.ciktiDosyasi, xmlCikti, 'utf8');
  log(`Çıktı kaydedildi: ${CONFIG.ciktiDosyasi} (${(xmlCikti.length / 1024).toFixed(1)} KB)`);

  fs.writeFileSync(CONFIG.logDosyasi, loglar.join('\n') + '\n', 'utf8');
  log('=== Tamamlandı ===');
}

main();
