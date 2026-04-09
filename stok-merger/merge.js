const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================
//  AYARLAR — sadece bu bölümü düzenle
// ============================================================
const CONFIG = {
  firma_a: {
    url: 'https://FIRMA-A-URL/stok.xml',   // <-- değiştir
    ad:  'Firma A',
  },
  firma_b: {
    url: 'https://FIRMA-B-URL/stok.xml',   // <-- değiştir
    ad:  'Firma B',
  },

  // XML'deki barkod/kod etiketi (öncelik sırasıyla dener)
  kodEtiketleri: ['barcode','Barcode','barkod','Barkod','code','Code','kod','Kod','sku','SKU','id','Id','productCode','product_code','stokKodu','StokKodu','upc','EAN'],

  // Ürün isim etiketi (öncelik sırasıyla dener)
  isimEtiketleri: ['name','Name','ad','Ad','title','Title','urunadi','UrunAdi','productName','product_name','baslik','Baslik'],

  // Stok etiketi
  stokEtiketleri: ['stock','Stock','stok','Stok','quantity','Quantity','miktar','Miktar','qty','Qty','adet','Adet','StockQuantity'],

  // Fiyat etiketi
  fiyatEtiketleri: ['price','Price','fiyat','Fiyat','satis_fiyati','SatisFiyati','listefiyati','ListeFiyati','salesPrice','sale_price','SalesPrice'],

  ciktiDosyasi: 'output/birlesik_stok.xml',
  logDosyasi:   'output/son_calisma.log',
};
// ============================================================

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'StokMerger/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Basit XML etiketi okuyucu (bağımlılık gerektirmez)
function parseXML(xmlStr, kaynak) {
  const urunler = [];

  // Ürün bloklarını bul (yaygın etiket adlarını dene)
  const blokEtiketleri = ['product','Product','item','Item','urun','Urun','row','Row','Product_Details'];
  let bloklar = [];

  for (const etiket of blokEtiketleri) {
    const re = new RegExp(`<${etiket}[^>]*>([\\s\\S]*?)</${etiket}>`, 'gi');
    const eslesme = xmlStr.match(re);
    if (eslesme && eslesme.length > 0) {
      bloklar = eslesme;
      break;
    }
  }

  if (bloklar.length === 0) {
    // Son çare: root'un direkt child'larını al
    const rootIceri = xmlStr.replace(/<\?xml[^>]*\?>/,'').replace(/<[^>]+>/, '').replace(/<\/[^>]+>\s*$/, '');
    const childRe = /<(\w+)[^>]*>[\s\S]*?<\/\1>/g;
    let m;
    while ((m = childRe.exec(rootIceri)) !== null) bloklar.push(m[0]);
  }

  function getEtiket(blok, etiketler) {
    for (const e of etiketler) {
      // önce child etiketi dene
      const re = new RegExp(`<${e}[^>]*>([^<]*)</${e}>`, 'i');
      const m = blok.match(re);
      if (m && m[1].trim()) return m[1].trim();
      // sonra attribute dene
      const atRe = new RegExp(`${e}=["']([^"']*)["']`, 'i');
      const am = blok.match(atRe);
      if (am && am[1].trim()) return am[1].trim();
    }
    return '';
  }

  bloklar.forEach(blok => {
    const kod   = getEtiket(blok, CONFIG.kodEtiketleri);
    const isim  = getEtiket(blok, CONFIG.isimEtiketleri);
    const stok  = getEtiket(blok, CONFIG.stokEtiketleri);
    const fiyat = getEtiket(blok, CONFIG.fiyatEtiketleri);

    if (kod || isim) {
      urunler.push({ kod, isim, stok: stok || '0', fiyat: fiyat || '0', kaynak });
    }
  });

  return urunler;
}

function escXml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function birlestirir(listA, listB) {
  const mapA = {};
  listA.forEach(p => { if (p.kod) mapA[p.kod.toLowerCase()] = p; });
  const mapB = {};
  listB.forEach(p => { if (p.kod) mapB[p.kod.toLowerCase()] = p; });

  const tumKodlar = new Set([...Object.keys(mapA), ...Object.keys(mapB)]);
  const sonuc = [];

  tumKodlar.forEach(kod => {
    const a = mapA[kod];
    const b = mapB[kod];
    sonuc.push({
      kod:       a ? a.kod : b.kod,
      isim:      a ? a.isim : b.isim,
      stokA:     a ? a.stok  : null,
      fiyatA:    a ? a.fiyat : null,
      stokB:     b ? b.stok  : null,
      fiyatB:    b ? b.fiyat : null,
      ikisindeDe: !!(a && b),
    });
  });

  // Önce her ikisinde olanlar, sonra sadece A, sonra sadece B
  sonuc.sort((x, y) => {
    if (x.ikisindeDe && !y.ikisindeDe) return -1;
    if (!x.ikisindeDe && y.ikisindeDe) return 1;
    return (x.isim || '').localeCompare(y.isim || '', 'tr');
  });

  return sonuc;
}

function xmlOlustur(urunler, istatistik) {
  const simdi = new Date().toISOString();
  const satirlar = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- Oluşturulma: ${simdi} -->`,
    `<!-- Toplam: ${istatistik.toplam} ürün | Eşleşen: ${istatistik.eslesen} | Sadece A: ${istatistik.sadaceA} | Sadece B: ${istatistik.sadaceB} -->`,
    '<stok_raporu>',
    `  <meta>`,
    `    <olusturulma>${simdi}</olusturulma>`,
    `    <toplam_urun>${istatistik.toplam}</toplam_urun>`,
    `    <eslesen_urun>${istatistik.eslesen}</eslesen_urun>`,
    `    <sadece_firma_a>${istatistik.sadaceA}</sadece_firma_a>`,
    `    <sadece_firma_b>${istatistik.sadaceB}</sadece_firma_b>`,
    `    <firma_a_adi>${escXml(CONFIG.firma_a.ad)}</firma_a_adi>`,
    `    <firma_b_adi>${escXml(CONFIG.firma_b.ad)}</firma_b_adi>`,
    `  </meta>`,
    `  <urunler>`,
  ];

  urunler.forEach((u, i) => {
    const stokA = u.stokA !== null ? parseInt(u.stokA) || 0 : null;
    const stokB = u.stokB !== null ? parseInt(u.stokB) || 0 : null;
    const varlikDurumu = u.ikisindeDe ? 'her_ikisinde' : u.stokA !== null ? 'sadece_a' : 'sadece_b';
    const stokDurumu = (stokA > 0 || stokB > 0) ? 'var' : 'yok';

    satirlar.push(`    <urun id="${i + 1}">`);
    satirlar.push(`      <kod>${escXml(u.kod)}</kod>`);
    satirlar.push(`      <isim>${escXml(u.isim)}</isim>`);
    satirlar.push(`      <varlik_durumu>${varlikDurumu}</varlik_durumu>`);
    satirlar.push(`      <stok_durumu>${stokDurumu}</stok_durumu>`);
    satirlar.push(`      <${CONFIG.firma_a.ad.replace(/\s/g,'_')}>`);
    satirlar.push(`        <stok>${u.stokA !== null ? escXml(u.stokA) : 'N/A'}</stok>`);
    satirlar.push(`        <fiyat>${u.fiyatA !== null ? escXml(u.fiyatA) : 'N/A'}</fiyat>`);
    satirlar.push(`      </${CONFIG.firma_a.ad.replace(/\s/g,'_')}>`);
    satirlar.push(`      <${CONFIG.firma_b.ad.replace(/\s/g,'_')}>`);
    satirlar.push(`        <stok>${u.stokB !== null ? escXml(u.stokB) : 'N/A'}</stok>`);
    satirlar.push(`        <fiyat>${u.fiyatB !== null ? escXml(u.fiyatB) : 'N/A'}</fiyat>`);
    satirlar.push(`      </${CONFIG.firma_b.ad.replace(/\s/g,'_')}>`);
    satirlar.push(`    </urun>`);
  });

  satirlar.push('  </urunler>');
  satirlar.push('</stok_raporu>');
  return satirlar.join('\n');
}

async function main() {
  const loglar = [];
  const log = (msg) => {
    const satir = `[${new Date().toISOString()}] ${msg}`;
    console.log(satir);
    loglar.push(satir);
  };

  log('=== Stok Merger başlatıldı ===');

  let listA, listB;

  try {
    log(`Firma A çekiliyor: ${CONFIG.firma_a.url}`);
    const xmlA = await fetchURL(CONFIG.firma_a.url);
    listA = parseXML(xmlA, 'A');
    log(`Firma A: ${listA.length} ürün parse edildi`);
  } catch (e) {
    log(`HATA — Firma A: ${e.message}`);
    process.exit(1);
  }

  try {
    log(`Firma B çekiliyor: ${CONFIG.firma_b.url}`);
    const xmlB = await fetchURL(CONFIG.firma_b.url);
    listB = parseXML(xmlB, 'B');
    log(`Firma B: ${listB.length} ürün parse edildi`);
  } catch (e) {
    log(`HATA — Firma B: ${e.message}`);
    process.exit(1);
  }

  const birlesik = birlestirir(listA, listB);

  const istatistik = {
    toplam:  birlesik.length,
    eslesen: birlesik.filter(u => u.ikisindeDe).length,
    sadaceA: birlesik.filter(u => u.stokA !== null && u.stokB === null).length,
    sadaceB: birlesik.filter(u => u.stokB !== null && u.stokA === null).length,
  };

  log(`Birleştirme tamamlandı → Toplam: ${istatistik.toplam} | Eşleşen: ${istatistik.eslesen} | Sadece A: ${istatistik.sadaceA} | Sadece B: ${istatistik.sadaceB}`);

  const xmlCikti = xmlOlustur(birlesik, istatistik);

  fs.mkdirSync(path.dirname(CONFIG.ciktiDosyasi), { recursive: true });
  fs.writeFileSync(CONFIG.ciktiDosyasi, xmlCikti, 'utf8');
  log(`Çıktı kaydedildi: ${CONFIG.ciktiDosyasi}`);

  fs.writeFileSync(CONFIG.logDosyasi, loglar.join('\n'), 'utf8');
  log('=== Tamamlandı ===');
}

main();
