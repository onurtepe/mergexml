# Stok Merger

İki firmanın XML stok dosyasını her gün otomatik olarak çekip birleştiren GitHub Actions sistemi.

## Kurulum (5 adım)

### 1. Bu repoyu fork'la veya klonla
GitHub'da "Use this template" veya "Fork" butonuna bas.

### 2. merge.js dosyasını düzenle
Dosyanın en üstündeki `CONFIG` bölümünü düzenle:

```js
const CONFIG = {
  firma_a: {
    url: 'https://FIRMA-A-URL/stok.xml',   // ← gerçek URL'yi yaz
    ad:  'Firma A',                         // ← istediğin ismi ver
  },
  firma_b: {
    url: 'https://FIRMA-B-URL/stok.xml',   // ← gerçek URL'yi yaz
    ad:  'Firma B',
  },
  ...
}
```

### 3. XML etiketlerini kontrol et
XML dosyanda barkod hangi etiket içinde? Örneğin `<barcode>`, `<StokKodu>` gibi.
`kodEtiketleri` listesine yoksa ekle. Aynı şekilde stok ve fiyat etiketleri için de.

### 4. GitHub Actions'ı etkinleştir
Repo → **Actions** sekmesi → "I understand my workflows, enable them" butonuna bas.

### 5. İlk çalıştırma
Actions → "Günlük Stok Birleştirme" → **Run workflow** butonuyla manuel test et.

---

## Çıktı dosyaları

| Dosya | Açıklama |
|-------|----------|
| `output/birlesik_stok.xml` | Birleştirilmiş stok XML'i |
| `output/son_calisma.log`   | Son çalışmanın log kaydı |

### Örnek XML çıktısı

```xml
<?xml version="1.0" encoding="UTF-8"?>
<stok_raporu>
  <meta>
    <olusturulma>2024-01-15T03:00:00Z</olusturulma>
    <toplam_urun>1250</toplam_urun>
    <eslesen_urun>980</eslesen_urun>
    <sadece_firma_a>150</sadece_firma_a>
    <sadece_firma_b>120</sadece_firma_b>
  </meta>
  <urunler>
    <urun id="1">
      <kod>8680000000001</kod>
      <isim>Örnek Ürün</isim>
      <varlik_durumu>her_ikisinde</varlik_durumu>
      <stok_durumu>var</stok_durumu>
      <Firma_A>
        <stok>42</stok>
        <fiyat>129.90</fiyat>
      </Firma_A>
      <Firma_B>
        <stok>15</stok>
        <fiyat>124.50</fiyat>
      </Firma_B>
    </urun>
  </urunler>
</stok_raporu>
```

---

## Zamanlama

Varsayılan: **Her gün 06:00 Türkiye saati** (UTC 03:00).

Değiştirmek için `.github/workflows/stok.yml` içindeki `cron` satırını düzenle:

```yaml
- cron: '0 3 * * *'   # UTC 03:00 = TR 06:00
```

Cron sözdizimi: `dakika saat gün ay haftanın_günü`

---

## Sorun giderme

- **XML parse edilemiyor**: `merge.js` içindeki `kodEtiketleri`, `isimEtiketleri` listelerine kendi XML etiket adlarını ekle.
- **HTTP hatası**: Firma URL'lerinin herkese açık (public) olduğundan emin ol.
- **Actions çalışmıyor**: Repo'da Actions etkinleştirilmiş mi kontrol et.
