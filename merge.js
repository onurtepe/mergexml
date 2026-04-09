const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ============================================================
//  AYARLAR — sadece bu bölümü düzenle
// ============================================================
const CONFIG = {
  firma_a: {
    url: 'https://api.akdenizerp.com/xml/xmlweb.xml',
    ad:  'akdeniz',
  },
  firma_b: {
    url: 'https://www.promolife.com.tr/xml_all/product.xml',
    ad:  'promolife',
  },
  ciktiDosyasi: 'output/birlesik_stok.xml',
  logDosyasi:   'output/son_calisma.log',
};
// ============================================================

// ---- HTTP çekici (redirect destekli) ----------------------
function fetchURL(url, yonlendirmeSayisi) {
  yonlendirmeSayisi = yonlendirmeSayisi || 0;
  if (yonlendirmeSayisi > 5) return Promise.reject(new Error('Çok fazla yönlendirme'));
  return new Promise(function(resolve, reject) {
    var mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'StokMerger/1.0' } }, function(res) {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        return fetchURL(res.headers.location, yonlendirmeSayisi + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      var parcalar = [];
      res.on('data', function(c) { parcalar.push(c); });
      res.on('end', function() { resolve(Buffer.concat(parcalar).toString('utf8')); });
    }).on('error', reject);
  });
}

// ---- Tek etiket değeri (CDATA + HTML entity decode) -------
function etiketDegeri(blok, etiket) {
  var re = new RegExp('<' + etiket + '[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</' + etiket + '>', 'i');
  var m = blok.match(re);
  if (!m) return '';
  var val = (m[1] !== undefined ? m[1] : (m[2] || '')).trim();
  // HTML entity decode
  val = val.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
  return val;
}

// ---- RECORD formatı parse (her iki firma için ortak) ------
function parseRecords(xmlStr, firmAdi) {
  var urunler = [];

  // Önce RECORD bloklarını bul
  var blokRe = /<RECORD>([\s\S]*?)<\/RECORD>/gi;
  var m;
  var bloklar = [];
  while ((m = blokRe.exec(xmlStr)) !== null) bloklar.push(m[0]);

  if (bloklar.length === 0) {
    // Alternatif: küçük harf <record>
    blokRe = /<record>([\s\S]*?)<\/record>/gi;
    while ((m = blokRe.exec(xmlStr)) !== null) bloklar.push(m[0]);
  }

  bloklar.forEach(function(blok) {
    urunler.push({
      urunID:      etiketDegeri(blok, 'urun_id'),
      urunKodu:    etiketDegeri(blok, 'urunkodu'),
      urunAttrID:  etiketDegeri(blok, 'urunattr_id'),
      urunAttrGr:  etiketDegeri(blok, 'urunattrgr'),
      urunAttrAdi: etiketDegeri(blok, 'urunattradi'),
      urunAdi:     etiketDegeri(blok, 'urunadi'),
      aciklama:    etiketDegeri(blok, 'urunaciklamasi'),
      kategori:    etiketDegeri(blok, 'kategori'),
      stokResim:   etiketDegeri(blok, 'stokresim'),
      urunResim:   etiketDegeri(blok, 'urunresim'),
      urunResim1:  etiketDegeri(blok, 'urunresim1'),
      urunResim2:  etiketDegeri(blok, 'urunresim2'),
      urunResim3:  etiketDegeri(blok, 'urunresim3'),
      urunResim4:  etiketDegeri(blok, 'urunresim4'),
      stokTag:     etiketDegeri(blok, 'stoktag'),
      firma:       firmAdi,
    });
  });

  return urunler;
}

// ---- Promolife <Urun> formatı parse -----------------------
function parseUrun(xmlStr, firmAdi) {
  var urunler = [];
  var blokRe = /<Urun>([\s\S]*?)<\/Urun>/gi;
  var m;

  while ((m = blokRe.exec(xmlStr)) !== null) {
    var blok = m[0];

    var urunID     = etiketDegeri(blok, 'UrunID');
    var urunKod    = etiketDegeri(blok, 'UrunKod');
    var urunAd     = etiketDegeri(blok, 'UrunAd');
    var aciklama   = etiketDegeri(blok, 'UrunAciklama');
    var kategori   = etiketDegeri(blok, 'UrunKategoriID');
    var resim      = etiketDegeri(blok, 'UrunResim1URL');
    var siteURL    = etiketDegeri(blok, 'UrunSiteURL');
    var fiyat      = etiketDegeri(blok, 'UrunFiyat');
    var fiyatBirim = etiketDegeri(blok, 'UrunFiyatBirim');
    var kdv        = etiketDegeri(blok, 'UrunFiyatKDV');
    var toplamStok = etiketDegeri(blok, 'UrunToplamStok');
    var stokBirim  = etiketDegeri(blok, 'UrunToplamStokBirim');

    var secenekRe = /<Secenek>([\s\S]*?)<\/Secenek>/gi;
    var sm;
    var secenekler = [];
    while ((sm = secenekRe.exec(blok)) !== null) secenekler.push(sm[0]);

    if (secenekler.length > 0) {
      secenekler.forEach(function(s) {
        urunler.push({
          urunID:      urunID,
          urunKodu:    etiketDegeri(s, 'SecenekKod') || urunKod,
          grupKod:     etiketDegeri(s, 'GrupKod'),
          secenekID:   etiketDegeri(s, 'SecenekID'),
          urunAdi:     urunAd,
          aciklama:    aciklama,
          kategori:    kategori,
          stok:        etiketDegeri(s, 'SecenekToplamStok') || toplamStok,
          stokBirim:   stokBirim,
          fiyat:       fiyat,
          fiyatBirim:  fiyatBirim,
          kdv:         kdv,
          resim:       resim,
          siteURL:     siteURL,
          firma:       firmAdi,
        });
      });
    } else {
      urunler.push({
        urunID: urunID, urunKodu: urunKod, grupKod: '', secenekID: '',
        urunAdi: urunAd, aciklama: aciklama, kategori: kategori,
        stok: toplamStok, stokBirim: stokBirim,
        fiyat: fiyat, fiyatBirim: fiyatBirim, kdv: kdv,
        resim: resim, siteURL: siteURL, firma: firmAdi,
      });
    }
  }
  return urunler;
}

// ---- XML formatını otomatik tespit et ---------------------
function parseXML(xmlStr, firmAdi) {
  // RECORD formatı mı?
  if (/<RECORD>/i.test(xmlStr)) {
    return parseRecords(xmlStr, firmAdi);
  }
  // Urun formatı mı?
  if (/<Urun>/i.test(xmlStr)) {
    return parseUrun(xmlStr, firmAdi);
  }
  return [];
}

// ---- XML karakter kaçış -----------------------------------
function esc(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Birleşik XML oluştur ---------------------------------
function xmlOlustur(listA, listB) {
  var simdi = new Date().toISOString();

  function yazUrun(u, idx) {
    var satirlar = [];
    satirlar.push('    <urun id="' + (idx + 1) + '">');
    if (u.urunID)      satirlar.push('      <urun_id>'    + esc(u.urunID)      + '</urun_id>');
    if (u.urunKodu)    satirlar.push('      <urunkodu>'   + esc(u.urunKodu)    + '</urunkodu>');
    if (u.grupKod)     satirlar.push('      <grup_kod>'   + esc(u.grupKod)     + '</grup_kod>');
    if (u.secenekID)   satirlar.push('      <secenek_id>' + esc(u.secenekID)   + '</secenek_id>');
    if (u.urunAttrID)  satirlar.push('      <urunattr_id>'+ esc(u.urunAttrID)  + '</urunattr_id>');
    if (u.urunAttrGr)  satirlar.push('      <urunattrgr>' + esc(u.urunAttrGr)  + '</urunattrgr>');
    if (u.urunAttrAdi) satirlar.push('      <urunattradi><![CDATA[' + u.urunAttrAdi + ']]></urunattradi>');
    if (u.urunAdi)     satirlar.push('      <urunadi><![CDATA['     + u.urunAdi     + ']]></urunadi>');
    if (u.kategori)    satirlar.push('      <kategori><![CDATA['    + u.kategori    + ']]></kategori>');
    if (u.stok)        satirlar.push('      <stok>'       + esc(u.stok)        + '</stok>');
    if (u.stokBirim)   satirlar.push('      <stok_birim>' + esc(u.stokBirim)   + '</stok_birim>');
    if (u.fiyat)       satirlar.push('      <fiyat>'      + esc(u.fiyat)       + '</fiyat>');
    if (u.fiyatBirim)  satirlar.push('      <fiyat_birim>'+ esc(u.fiyatBirim)  + '</fiyat_birim>');
    if (u.kdv)         satirlar.push('      <kdv>'        + esc(u.kdv)         + '</kdv>');
    if (u.stokResim)   satirlar.push('      <stokresim>'  + esc(u.stokResim)   + '</stokresim>');
    if (u.urunResim)   satirlar.push('      <urunresim>'  + esc(u.urunResim)   + '</urunresim>');
    if (u.urunResim1)  satirlar.push('      <urunresim1>' + esc(u.urunResim1)  + '</urunresim1>');
    if (u.urunResim2)  satirlar.push('      <urunresim2>' + esc(u.urunResim2)  + '</urunresim2>');
    if (u.urunResim3)  satirlar.push('      <urunresim3>' + esc(u.urunResim3)  + '</urunresim3>');
    if (u.urunResim4)  satirlar.push('      <urunresim4>' + esc(u.urunResim4)  + '</urunresim4>');
    if (u.resim)       satirlar.push('      <resim>'      + esc(u.resim)       + '</resim>');
    if (u.siteURL)     satirlar.push('      <site_url>'   + esc(u.siteURL)     + '</site_url>');
    if (u.stokTag)     satirlar.push('      <stoktag><![CDATA[' + u.stokTag + ']]></stoktag>');
    satirlar.push('    </urun>');
    return satirlar.join('\n');
  }

  var out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<!-- Oluşturulma: ' + simdi + ' -->');
  out.push('<!-- ' + CONFIG.firma_a.ad + ': ' + listA.length + ' kayıt | ' + CONFIG.firma_b.ad + ': ' + listB.length + ' kayıt | Toplam: ' + (listA.length + listB.length) + ' -->');
  out.push('<stok_raporu>');
  out.push('');
  out.push('  <meta>');
  out.push('    <olusturulma>' + simdi + '</olusturulma>');
  out.push('    <firma_a_kayit_sayisi>' + listA.length + '</firma_a_kayit_sayisi>');
  out.push('    <firma_b_kayit_sayisi>' + listB.length + '</firma_b_kayit_sayisi>');
  out.push('    <toplam_kayit>' + (listA.length + listB.length) + '</toplam_kayit>');
  out.push('  </meta>');
  out.push('');
  out.push('  <' + CONFIG.firma_a.ad + '>');
  listA.forEach(function(u, i) { out.push(yazUrun(u, i)); });
  out.push('  </' + CONFIG.firma_a.ad + '>');
  out.push('');
  out.push('  <' + CONFIG.firma_b.ad + '>');
  listB.forEach(function(u, i) { out.push(yazUrun(u, i)); });
  out.push('  </' + CONFIG.firma_b.ad + '>');
  out.push('');
  out.push('</stok_raporu>');
  return out.join('\n');
}

// ---- Ana akış ---------------------------------------------
async function main() {
  var loglar = [];
  function log(msg) {
    var satir = '[' + new Date().toISOString() + '] ' + msg;
    console.log(satir);
    loglar.push(satir);
  }

  log('=== Stok Merger başlatıldı ===');

  var listA = [], listB = [];

  try {
    log('Firma A çekiliyor: ' + CONFIG.firma_a.url);
    var xmlA = await fetchURL(CONFIG.firma_a.url);
    listA = parseXML(xmlA, CONFIG.firma_a.ad);
    log('Firma A (' + CONFIG.firma_a.ad + '): ' + listA.length + ' kayıt parse edildi');
  } catch(e) {
    log('HATA — Firma A: ' + e.message);
    process.exit(1);
  }

  try {
    log('Firma B çekiliyor: ' + CONFIG.firma_b.url);
    var xmlB = await fetchURL(CONFIG.firma_b.url);
    listB = parseXML(xmlB, CONFIG.firma_b.ad);
    log('Firma B (' + CONFIG.firma_b.ad + '): ' + listB.length + ' kayıt parse edildi');
  } catch(e) {
    log('HATA — Firma B: ' + e.message);
    process.exit(1);
  }

  if (listA.length === 0 && listB.length === 0) {
    log('UYARI: Her iki firmadan da 0 kayıt geldi. XML yapısı tanınamadı.');
    log('İpucu: XML dosyasının ilk 200 karakterini kontrol et.');
  }

  var xmlCikti = xmlOlustur(listA, listB);

  fs.mkdirSync(path.dirname(CONFIG.ciktiDosyasi), { recursive: true });
  fs.writeFileSync(CONFIG.ciktiDosyasi, xmlCikti, 'utf8');
  log('Çıktı kaydedildi: ' + CONFIG.ciktiDosyasi + ' (' + (xmlCikti.length / 1024).toFixed(1) + ' KB)');

  fs.writeFileSync(CONFIG.logDosyasi, loglar.join('\n') + '\n', 'utf8');
  log('=== Tamamlandı ===');
}

main();
