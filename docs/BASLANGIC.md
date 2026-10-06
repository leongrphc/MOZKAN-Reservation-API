# MOZKAN - Türkçe başlangıç rehberi

MOZKAN, işletmelerin kapasitesi belirli etkinlikler açtığı ve üyelerin kontenjan ayırdığı bir REST API projesidir. Giriş seviyesinin biraz üzerinde backend becerilerini göstermek için tasarlandı: yetkilendirme, veritabanı ilişkileri, transaction, eşzamanlı istekler, süreli rezervasyon ve testler.

## Çalıştırma

Node.js 24 ve çalışan Docker Desktop gerekir. PowerShell'de proje klasöründe:

```powershell
npm ci
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Son komutun çıktısını `.env` içindeki `JWT_SECRET` değerine yaz. Örnek değeri uygulama bilinçli olarak kabul etmez.

```powershell
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

İkinci bir terminalde:

```powershell
npm run dev:worker
```

Uygulama adresi: http://localhost:3000/

Giriş ekranındaki demo hesap seçicileri formu doldurur. **Giriş yap** ile oturum açtıktan sonra işletmeni seç, etkinlikte yer ayır ve **Rezervasyonlarım** bölümünden onayla veya iptal et. İşletme sahibi hesabında etkinlik oluşturma ve kayıtlı üye ekleme formları da bulunur. Sayfa yenilenince tekrar giriş yapman gerekir.

İşletme sahibi ve yönetici hesaplarında **İşletme rezervasyonları** tüm katılımcıları gösterir; **İşlem geçmişi** oluşturma, onay, iptal ve otomatik süre dolumunu listeler. Üye hesapları bu listelere erişemez. Başka bir kullanıcının rezervasyonunu değiştirme yetkisi bu ekranlara eklenmemiştir.

Swagger adresi: http://localhost:3000/docs/

Tüm servisleri Docker ile çalıştırmak için `.env` hazırlandıktan sonra `docker compose up --build -d` kullanabilirsin. Port 3000 çakışmasın diye önce yerel `npm run dev` sürecini kapat.

## Swagger ile ilk deneme

1. Swagger'da `/api/v1/auth/login` uç noktasını aç. E-posta `member@mozkan.dev`, şifre `MozkanDemo2026!`.
2. Dönen `accessToken` değerini **Authorize** alanına yapıştır.
3. İşletme ID'si olarak `00000000-0000-0000-0000-000000000001` kullan.
4. Rezervasyon oluştururken etkinlik ID'si `00000000-0000-0000-0000-000000000002`, `seats` değeri `1` ve `Idempotency-Key` değeri `ilk-rezervasyon-001` olsun.
5. Aynı anahtarla aynı isteği tekrar gönder: ikinci kayıt oluşmaz.
6. Dönen rezervasyon ID'siyle `/confirm` çağır; ardından `/cancel` ile iptal et ve etkinliğin müsait kontenjanına bak.

Varsayılan tutma süresi 10 dakikadır ve etkinlik başlangıcını aşamaz. Süresi dolan rezervasyon, worker kapalı olsa bile kontenjan tüketmez. Aynı anahtarla tekrar istek atmak süreyi uzatmaz; yeni rezervasyon için yeni anahtar gerekir.

`owner@mozkan.dev` hesabıyla etkinlik oluşturabilir ve kayıtlı kullanıcıları işletmeye üye veya yönetici ekleyebilirsin. Üye hesabı etkinlik oluşturamaz. İşletme sahibi olmak, başka kullanıcıların rezervasyonlarını değiştirme yetkisi vermez.

## Kodda takip edilecek akış

- `src/app.ts`: uygulamanın kurulumu, pluginler, hata yönetimi, modüller.
- `src/shared/access.ts`: JWT doğrulama ve işletme üyeliği kontrolü.
- `src/modules/reservations/routes.ts`: HTTP isteğinin doğrulanması.
- `src/modules/reservations/service.ts`: kapasite, transaction, kilitler ve durum geçişleri.
- `tests/api.test.ts`: gerçek PostgreSQL üzerinde davranışların sınanması.

Özellikle son kontenjana aynı anda gelen isteklerin testini ve servis içindeki `FOR UPDATE` kullanımını birlikte incele. Mülakatta projenin en anlaşılır teknik örneklerinden biri bu akış olacak.

## Kontrol komutları

```powershell
npm run check
npm audit --omit=dev
```

Testler `.env` içindeki `TEST_DATABASE_URL` ile ayrı `mozkan_test` veritabanında, kendilerine ait geçici şemada çalışır. Docker bu veritabanını ilk kurulumda oluşturur.

Proje şu anda yerel çalıştırma ve GitHub'a yükleme için hazırlanmıştır. Canlı bir sunucuya dağıtım ve GitHub'a gönderim ayrı adımlardır.
