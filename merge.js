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

// ---- HTTP çekici ------------------------------------------
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

// ---- Tek etiket değeri (CDATA + entity decode) ------------
function etiketDegeri(blok, etiket) {
  var re = new RegExp('<' + etiket + '[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</' + etiket + '>', 'i');
  var m = blok.match(re);
  if (!m) return '';
  var val = (m[1] !== undefined ? m[1] : (m[2] || '')).trim();
  val = val.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
  return val;
}

// ---- Firma A parse: <RECORD> formatı ----------------------
function parseA(xmlStr) {
  var urunler = [];
  var blokRe = /<RECORD>([\s\S]*?)<\/RECORD>/gi;
  var m;
  while ((m = blokRe.exec(xmlStr)) !== null) {
    var b = m[0];
    urunler.push({
      kaynak:     CONFIG.firma_a.ad,
      urun_id:    etiketDegeri(b, 'urun_id'),
      urunkodu:   etiketDegeri(b, 'urunkodu'),
      grup_kodu:  etiketDegeri(b, 'urunattrgr'),
      varyant_id: etiketDegeri(b, 'urunattr_id'),
      varyant_adi:etiketDegeri(b, 'urunattradi'),
      urunadi:    etiketDegeri(b, 'urunadi'),
      aciklama:   etiketDegeri(b, 'urunaciklamasi'),
      kategori:   etiketDegeri(b, 'kategori'),
      stok:       '',
      stok_birim: '',
      fiyat:      '',
      fiyat_birim:'',
      kdv:        '',
      resim1:     etiketDegeri(b, 'stokresim'),
      resim2:     etiketDegeri(b, 'urunresim'),
      resim3:     etiketDegeri(b, 'urunresim1'),
      resim4:     etiketDegeri(b, 'urunresim2'),
      resim5:     etiketDegeri(b, 'urunresim3'),
      resim6:     etiketDegeri(b, 'urunresim4'),
      site_url:   '',
      stoktag:    etiketDegeri(b, 'stoktag'),
    });
  }
  return urunler;
}

// ---- Firma B parse: <Urun> formatı ------------------------
function parseB(xmlStr) {
  var urunler = [];
  var blokRe = /<Urun>([\s\S]*?)<\/Urun>/gi;
  var m;
  while ((m = blokRe.exec(xmlStr)) !== null) {
    var b = m[0];

    var urunID     = etiketDegeri(b, 'UrunID');
    var urunKod    = etiketDegeri(b, 'UrunKod');
    var urunAd     = etiketDegeri(b, 'UrunAd');
    var aciklama   = etiketDegeri(b, 'UrunAciklama');
    var kategori   = etiketDegeri(b, 'UrunKategoriID');
    var resim1     = etiketDegeri(b, 'UrunResim1URL');
    var siteURL    = etiketDegeri(b, 'UrunSiteURL');
    var fiyat      = etiketDegeri(b, 'UrunFiyat');
    var fiyatBirim = etiketDegeri(b, 'UrunFiyatBirim');
    var kdv        = etiketDegeri(b, 'UrunFiyatKDV');
    var toplamStok = etiketDegeri(b, 'UrunToplamStok');
    var stokBirim  = etiketDegeri(b, 'UrunToplamStokBirim');

    // Seçenekler (varyantlar) — her biri ayrı kayıt
    var secenekRe = /<Secenek>([\s\S]*?)<\/Secenek>/gi;
    var sm;
    var secenekler = [];
    while ((sm = secenekRe.exec(b)) !== null) secenekler.push(sm[0]);

    if (secenekler.length > 0) {
      secenekler.forEach(function(s) {
        urunler.push({
          kaynak:      CONFIG.firma_b.ad,
          urun_id:     urunID,
          urunkodu:    etiketDegeri(s, 'SecenekKod') || urunKod,
          grup_kodu:   etiketDegeri(s, 'GrupKod'),
          varyant_id:  etiketDegeri(s, 'SecenekID'),
          varyant_adi: etiketDegeri(s, 'SecenekKod') || urunKod,
          urunadi:     urunAd,
          aciklama:    aciklama,
          kategori:    kategori,
          stok:        etiketDegeri(s, 'SecenekToplamStok') || toplamStok,
          stok_birim:  stokBirim,
          fiyat:       fiyat,
          fiyat_birim: fiyatBirim,
          kdv:         kdv,
          resim1:      resim1,
          resim2:      '',
          resim3:      '',
          resim4:      '',
          resim5:      '',
          resim6:      '',
          site_url:    siteURL,
          stoktag:     '',
        });
      });
    } else {
      urunler.push({
        kaynak:      CONFIG.firma_b.ad,
        urun_id:     urunID,
        urunkodu:    urunKod,
        grup_kodu:   '',
        varyant_id:  '',
        varyant_adi: '',
        urunadi:     urunAd,
        aciklama:    aciklama,
        kategori:    kategori,
        stok:        toplamStok,
        stok_birim:  stokBirim,
        fiyat:       fiyat,
        fiyat_birim: fiyatBirim,
        kdv:         kdv,
        resim1:      resim1,
        resim2:      '',
        resim3:      '',
        resim4:      '',
        resim5:      '',
        resim6:      '',
        site_url:    siteURL,
        stoktag:     '',
      });
    }
  }
  return urunler;
}

// ---- XML formatını otomatik tespit et ---------------------
function parseXML(xmlStr, firma) {
  if (/<RECORD>/i.test(xmlStr)) return parseA(xmlStr);
  if (/<Urun>/i.test(xmlStr))   return parseB(xmlStr);
  return [];
}

// ---- XML karakter kaçış -----------------------------------
function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---- Birleşik XML oluştur ---------------------------------
function xmlOlustur(liste) {
  var simdi = new Date().toISOString();
  var toplamA = liste.filter(function(u){ return u.kaynak === CONFIG.firma_a.ad; }).length;
  var toplamB = liste.filter(function(u){ return u.kaynak === CONFIG.firma_b.ad; }).length;

  var out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<!-- Oluşturulma: ' + simdi + ' -->');
  out.push('<!-- ' + CONFIG.firma_a.ad + ': ' + toplamA + ' kayıt | ' + CONFIG.firma_b.ad + ': ' + toplamB + ' kayıt | Toplam: ' + liste.length + ' -->');
  out.push('<stok_raporu>');
  out.push('');
  out.push('  <meta>');
  out.push('    <olusturulma>'         + simdi      + '</olusturulma>');
  out.push('    <firma_a_kayit_sayisi>'+ toplamA    + '</firma_a_kayit_sayisi>');
  out.push('    <firma_b_kayit_sayisi>'+ toplamB    + '</firma_b_kayit_sayisi>');
  out.push('    <toplam_kayit>'        + liste.length + '</toplam_kayit>');
  out.push('  </meta>');
  out.push('');
  out.push('  <urunler>');

  liste.forEach(function(u, i) {
    out.push('    <urun id="' + (i + 1) + '">');
    out.push('      <kaynak>'      + esc(u.kaynak)      + '</kaynak>');
    out.push('      <urun_id>'     + esc(u.urun_id)     + '</urun_id>');
    out.push('      <urunkodu><![CDATA['    + (u.urunkodu    || '') + ']]></urunkodu>');
    out.push('      <grup_kodu><![CDATA['   + (u.grup_kodu   || '') + ']]></grup_kodu>');
    out.push('      <varyant_id>'   + esc(u.varyant_id)  + '</varyant_id>');
    out.push('      <varyant_adi><![CDATA[' + (u.varyant_adi || '') + ']]></varyant_adi>');
    out.push('      <urunadi><![CDATA['     + (u.urunadi     || '') + ']]></urunadi>');
    out.push('      <aciklama><![CDATA['    + (u.aciklama    || '') + ']]></aciklama>');
    out.push('      <kategori><![CDATA['    + (u.kategori    || '') + ']]></kategori>');
    out.push('      <stok>'         + esc(u.stok)        + '</stok>');
    out.push('      <stok_birim>'   + esc(u.stok_birim)  + '</stok_birim>');
    out.push('      <fiyat>'        + esc(u.fiyat)       + '</fiyat>');
    out.push('      <fiyat_birim>'  + esc(u.fiyat_birim) + '</fiyat_birim>');
    out.push('      <kdv>'          + esc(u.kdv)         + '</kdv>');
    out.push('      <resim1>'       + esc(u.resim1)      + '</resim1>');
    out.push('      <resim2>'       + esc(u.resim2)      + '</resim2>');
    out.push('      <resim3>'       + esc(u.resim3)      + '</resim3>');
    out.push('      <resim4>'       + esc(u.resim4)      + '</resim4>');
    out.push('      <resim5>'       + esc(u.resim5)      + '</resim5>');
    out.push('      <resim6>'       + esc(u.resim6)      + '</resim6>');
    out.push('      <site_url>'     + esc(u.site_url)    + '</site_url>');
    out.push('      <stoktag><![CDATA[' + (u.stoktag || '') + ']]></stoktag>');
    out.push('    </urun>');
  });

  out.push('  </urunler>');
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

  // İki listeyi birleştir: önce A, sonra B
  var birlesik = listA.concat(listB);

  var xmlCikti = xmlOlustur(birlesik);

  fs.mkdirSync(path.dirname(CONFIG.ciktiDosyasi), { recursive: true });
  fs.writeFileSync(CONFIG.ciktiDosyasi, xmlCikti, 'utf8');
  log('Çıktı kaydedildi: ' + CONFIG.ciktiDosyasi + ' (' + (xmlCikti.length / 1024).toFixed(1) + ' KB)');

  fs.writeFileSync(CONFIG.logDosyasi, loglar.join('\n') + '\n', 'utf8');
  log('=== Tamamlandı ===');
}

main();
