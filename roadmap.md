# Codex Engineering Workflow Pack Agresif Roadmap'i

> Durum: Planlama aşaması
> Tarih: 2026-05-24
> Tempo: Agresif ama kontrollü
> Kaynak fikir: mattpocock/skills engineering ve productivity skill seti
> Ürün stratejisi: Önce local Codex skill paketi, sonra gerçek repo denemeleri, sonra paylaşılabilir plugin/skill bundle

---

## Özet

Codex Engineering Workflow Pack, Codex'i sadece kod yazan bir ajan olmaktan çıkarıp planlayan, teşhis eden, test-first ilerleyen, issue üreten ve mimari kaliteyi takip eden bir mühendislik çalışma sistemine dönüştürür.

İlk hedef, `mattpocock/skills` reposundaki en değerli engineering workflow fikirlerini Codex skill formatına uyarlamak ve kendi projelerinde hemen kullanılabilir hale getirmektir.

İlk paket kapsamı:

- `diagnose`
- `tdd`
- `grill-with-docs`
- `to-prd`
- `to-issues`
- `triage`
- `prototype`
- `zoom-out`
- `improve-codebase-architecture`
- `handoff`

İkinci dalga kapsamı:

- `review`
- `setup-pre-commit`
- `write-a-skill`
- `grill-me`
- `caveman`
- writing workflow skill'leri

Hedef zaman çizgisi:

- 1-2 günde product lock ve skill seçimi
- 3-5 günde ilk 5 Codex skill portu
- 1 haftada v0.1 local pack
- 2 haftada gerçek repo testleri ve iyileştirme
- 3-4 haftada paylaşılabilir skill bundle

---

## Ana Karar Kilitleri

```txt
Codex formatı netleşmeden toplu port yok.
Her skill tek başına kullanılmadan bundle release yok.
Gerçek repo denemesi olmadan "production-ready" iddiası yok.
Claude'a özel davranışlar Codex'e birebir taşınmayacak.
Script gerektiren işlerde sadece prompt talimatı ile yetinilmeyecek.
```

Ürün konumlandırması:

```txt
Codex için ciddi yazılım geliştirme workflow paketi.
```

Kısa İngilizce konumlandırma:

```txt
Engineering workflows for Codex: diagnose, plan, test, prototype, review, and ship with discipline.
```

---

## Faz 0: Product Lock ve Workspace Kurulumu

**Süre:** 1 gün
**Öncelik:** Kritik
**Hedef:** Paket kapsamı, klasör yapısı ve Codex skill standardı kilitlensin.

### Neden

Bu proje tek bir skill değil, birbirini tamamlayan bir workflow paketi. Başta sınır çizilmezse skill'ler birbirinin alanına girer, gereksiz uzun olur ve Codex context penceresini şişirir.

### Nasıl

- `mattpocock/skills` içindeki stabil skill'ler incelenecek
- Claude'a özel alanlar belirlenecek
- Codex skill anatomisi kilitlenecek
- Her skill için port kararı verilecek: birebir port, uyarlamalı port, birleşik skill, kapsam dışı
- Çıktılar bu klasörde plan dokümanları olarak tutulacak

### Önerilen Yapı

```txt
Codex Engineering Workflow Pack/
  roadmap.md
  prd.md
  source-analysis.md
  porting-matrix.md
  skills/
    diagnose/
      SKILL.md
      scripts/
      references/
    tdd/
      SKILL.md
      references/
    grill-with-docs/
      SKILL.md
      references/
    to-prd/
      SKILL.md
      references/
    to-issues/
      SKILL.md
      references/
```

### Kontrol Listesi

- [ ] Kaynak skill listesi çıkar
- [ ] Stabil / in-progress / deprecated ayrımı yap
- [ ] İlk v0.1 skill kapsamını kilitle
- [ ] Codex frontmatter standardını belirle
- [ ] Ortak referans dosyası ihtiyacını belirle
- [ ] Hedef kurulum yeri kararını ver: proje klasörü mü, `~/.codex/skills` mı

### Kabul Kriterleri

- [ ] v0.1'de hangi skill'lerin olacağı net
- [ ] Her skill için port stratejisi yazılı
- [ ] Claude'a özel alanların nasıl dönüştürüleceği belli
- [ ] Klasör yapısı gereksiz dosya üretmeyecek kadar sade

### Gate

Faz 1'e geçmek için v0.1 kapsamı kilitlenmeli. "Hepsini taşıyalım" yaklaşımı Faz 1'i başlatmaz.

---

## Faz 1: Core Skill Port v0.1

**Süre:** 3-5 gün
**Öncelik:** Kritik
**Hedef:** En yüksek değerli 5 skill Codex formatında çalışır hale gelsin.

### Neden

İlk değer, günlük kodlama akışında hemen kullanılan skill'lerden gelir. Bu yüzden önce planlama ya da paketleme değil, gerçek problem çözen skill'ler port edilmeli.

### İlk 5 Skill

1. `diagnose`
2. `tdd`
3. `grill-with-docs`
4. `prototype`
5. `zoom-out`

### Port Kuralları

- YAML frontmatter sadece `name` ve `description` içerecek
- Body, Codex'in mevcut tool ve çalışma tarzına göre yazılacak
- Gereksiz felsefe azaltılacak, uygulanabilir adımlar korunacak
- Uzun örnekler `references/` altına taşınacak
- Script gerekiyorsa `scripts/` altında tutulacak
- Her skill sonunda doğrulama davranışı net olacak

### Kontrol Listesi

- [ ] `diagnose` Codex'e uyarlanacak
- [ ] `tdd` Codex'e uyarlanacak
- [ ] `grill-with-docs` Codex'e uyarlanacak
- [ ] `prototype` Codex'e uyarlanacak
- [ ] `zoom-out` Codex'e uyarlanacak
- [ ] Her skill için `description` trigger kalitesi kontrol edilecek
- [ ] Her skill için minimum bir örnek kullanım yazılacak

### Kabul Kriterleri

- [ ] 5 skill Codex tarafından keşfedilebilir formatta
- [ ] Her skill tek başına okunabilir ve çalıştırılabilir
- [ ] Her skill gereksiz Claude referansı içermiyor
- [ ] En az 2 gerçek repo üzerinde manuel deneme yapıldı

### Gate

Faz 2'ye geçmek için `diagnose` ve `tdd` gerçek bir bug/fix veya küçük feature üzerinde başarılı denenmeli.

---

## Faz 2: Planning ve Issue Workflow

**Süre:** 3-4 gün
**Öncelik:** Yüksek
**Hedef:** Konuşmadan PRD, PRD'den issue, issue'dan uygulanabilir agent brief akışı kurulacak.

### Neden

Codex ile büyük projelerde asıl hız, tek seferde çok kod yazmaktan değil işi doğru parçalara bölmekten gelir. Bu faz paketi "kod yardımcısı"ndan "mühendislik planlama sistemi"ne taşır.

### Skill'ler

- `to-prd`
- `to-issues`
- `triage`
- `handoff`
- `setup-codex-engineering-workflow`

### Issue Tracker Stratejisi

Başlangıçta üç hedef desteklenebilir:

- Local markdown issue dosyaları
- GitHub issues via `gh`
- Sadece plan dokümanı üretme modu

v0.1 için önerilen varsayılan:

```txt
Local markdown issue dosyaları + opsiyonel GitHub publish.
```

### Kontrol Listesi

- [ ] `to-prd` skill portu
- [ ] `to-issues` skill portu
- [ ] `triage` skill portu
- [ ] `handoff` skill portu
- [ ] Local issue template tasarla
- [ ] GitHub yayınlama davranışını opsiyonel tut
- [ ] Agent brief formatı oluştur

### Kabul Kriterleri

- [ ] Bir fikirden PRD üretilebiliyor
- [ ] PRD dikey slice issue'lara bölünebiliyor
- [ ] Issue açıklamaları bağımsız bir Codex oturumunun uygulayacağı kadar net
- [ ] GitHub bağlantısı yoksa local dosya akışı bozulmuyor

### Gate

Faz 3'e geçmek için gerçek bir proje fikri PRD'ye, sonra en az 5 uygulanabilir issue'ya dönüşmeli.

---

## Faz 3: Architecture ve Review Workflow

**Süre:** 4-6 gün
**Öncelik:** Yüksek
**Hedef:** Kod tabanı büyürken mimari kaliteyi ve review disiplinini koruyan skill'ler hazır olsun.

### Neden

AI ile geliştirmede en büyük risk, çalışan ama zor değişen kod üretmek. Bu faz, paketin uzun vadeli kalite tarafını kurar.

### Skill'ler

- `improve-codebase-architecture`
- `review`
- `setup-pre-commit`
- `git-guardrails` için Codex uyarlaması

### Mimari Değerlendirme İlkeleri

- Modül derinliği
- Interface sadeliği
- Test yüzeyi
- Değişiklik lokalitesi
- Gereksiz adapter ve soyutlama tespiti
- Domain dili ile isimlendirme uyumu

### Kontrol Listesi

- [ ] `improve-codebase-architecture` portu
- [ ] `review` skill'i stabil hale getir
- [ ] Review çıktısını Standards / Spec / Risk olarak ayır
- [ ] Pre-commit kurulum skill'ini Codex uyumlu yap
- [ ] Git guardrails için Codex güvenlik modelini belirle
- [ ] Mimari rapor şablonu oluştur

### Kabul Kriterleri

- [ ] Bir repo için mimari iyileştirme raporu üretilebiliyor
- [ ] Review skill'i diff üzerinden somut bulgu verebiliyor
- [ ] Pre-commit kurulumu package manager algılıyor
- [ ] Çıktılar dosya/line referansı ile izlenebilir

### Gate

Faz 4'e geçmek için en az bir gerçek repo üzerinde review + architecture audit yapılmalı.

---

## Faz 4: Pack Installer ve Codex Entegrasyonu

**Süre:** 3-5 gün
**Öncelik:** Kritik
**Hedef:** Skill'ler tek tek kopyalanan dosyalar olmaktan çıkıp kurulabilir bir paket haline gelsin.

### Neden

Paket kurulamazsa sadece kişisel notlar olarak kalır. Ama kurulabilir hale gelirse her projede tekrar kullanılabilen bir mühendislik sistemi olur.

### Kurulum Hedefleri

- `~/.codex/skills` içine local kurulum
- Proje içine vendored skill kurulumu
- Güncelleme / overwrite stratejisi
- Opsiyonel `agents/openai.yaml` metadata

### Kontrol Listesi

- [ ] Skill klasörlerini final yapıya taşı
- [ ] `agents/openai.yaml` metadata ihtiyacını değerlendir
- [ ] Kurulum script'i gerekip gerekmediğine karar ver
- [ ] Windows ve Unix path uyumunu kontrol et
- [ ] Hızlı validasyon komutu yaz
- [ ] Paket README yerine minimal install notunu `prd.md` veya ayrı plan dosyasında tut

### Kabul Kriterleri

- [ ] Skill'ler Codex tarafından listelenebilir
- [ ] Temiz bir makinede manuel kurulum adımları net
- [ ] Path ve scriptler Windows'ta çalışıyor
- [ ] Gereksiz doküman kalabalığı yok

### Gate

Faz 5'e geçmek için paket sıfırdan kurulup en az 3 skill tetiklenmeli.

---

## Faz 5: Gerçek Proje Pilotları

**Süre:** 1-2 hafta
**Öncelik:** Kritik
**Hedef:** Paket gerçek projelerde denenip failure mode'lar yakalansın.

### Pilot Proje Türleri

- Next.js SaaS projesi
- CLI veya Node.js library
- Python backend
- Frontend dashboard
- Mevcut legacy repo

### Test Senaryoları

- Bug teşhisi
- Yeni feature TDD ile geliştirme
- PRD ve issue üretimi
- Mimari audit
- Review
- Handoff

### Kontrol Listesi

- [ ] En az 3 farklı repo seç
- [ ] Her repo için kullanılan skill'leri kaydet
- [ ] Nerede fazla soru sorduğunu not et
- [ ] Nerede yanlış varsayım yaptığını not et
- [ ] Trigger description'ları iyileştir
- [ ] Uzun body'leri references altına taşı

### Kabul Kriterleri

- [ ] En az 10 gerçek kullanım denemesi
- [ ] En az 5 skill revize edildi
- [ ] En az 3 somut failure mode düzeltildi
- [ ] Kullanım sonrası hızlı rapor var

### Gate

Public paylaşım için gerçek kullanım notları ve revizyonlar tamamlanmalı.

---

## Faz 6: Public Bundle ve İçerik

**Süre:** 1 hafta
**Öncelik:** Orta-Yüksek
**Hedef:** Paket paylaşılabilir, anlatılabilir ve portföy değeri taşıyan hale gelsin.

### Çıktılar

- Public GitHub repo
- Kısa demo video
- "Codex ile ciddi yazılım geliştirme workflow'u" yazısı
- Örnek kullanım transcript'leri
- Before / after örnekleri

### Kontrol Listesi

- [ ] Repo aç
- [ ] Lisans kararını ver
- [ ] İlk release tag'i oluştur
- [ ] Demo video kaydet
- [ ] Blog / LinkedIn post taslağı yaz
- [ ] 3 örnek kullanım senaryosu yayınla

### Kabul Kriterleri

- [ ] Başka biri paketi kurup kullanabiliyor
- [ ] İlk 10 dakikada ne işe yaradığı anlaşılıyor
- [ ] En az 3 örnek senaryo var
- [ ] Paket kişisel hack değil, ürünleşebilir workflow gibi duruyor

---

## Kapsam Dışı

v0.1 için kapsam dışı:

- Full marketplace plugin
- Otomatik GitHub App
- Ücretli SaaS
- Private telemetry
- Merkezi cloud servis
- Bütün mattpocock skill'lerini birebir taşımak
- Claude Code hook'larını aynı şekilde kopyalamak
- Her dil/framework için özel workflow

---

## Test Planı

### Skill Format Testleri

- YAML frontmatter geçerli mi?
- `name` klasör adıyla uyumlu mu?
- `description` trigger açısından yeterli mi?
- Body 500 satırı geçiyor mu?
- Gereksiz reference duplication var mı?

### Manual Workflow Testleri

- `diagnose`: bilinçli bozulan test üzerinden bug fix
- `tdd`: küçük feature için red-green-refactor
- `to-prd`: konuşmadan PRD üretimi
- `to-issues`: PRD'den dikey slice issue'lar
- `prototype`: UI ve logic branch denemesi
- `review`: diff üzerinden bulgu üretimi

### Gerçek Repo Testleri

- Küçük repo
- Orta ölçekli app
- Test suite'i olan proje
- Test suite'i olmayan proje
- GitHub bağlantılı repo
- GitHub bağlantısız local repo

---

## Release Gate Kuralları

Her release öncesi:

- [ ] Tüm `SKILL.md` frontmatter'ları kontrol edildi
- [ ] Her skill en az bir gerçek prompt ile denendi
- [ ] Gereksiz Claude referansı kalmadı
- [ ] Windows path uyumu kontrol edildi
- [ ] Kurulum adımları temiz bir klasörde denendi
- [ ] Roadmap ve PRD güncel

Yeni skill için:

- [ ] Net trigger description var
- [ ] Body uygulanabilir adımlardan oluşuyor
- [ ] Gerekirse reference/script ayrımı yapılmış
- [ ] Örnek kullanım var
- [ ] Failure mode notu var

---

## Başarı Metrikleri

### Teknik Metrikler

- Port edilen stabil skill sayısı
- Gerçek repo deneme sayısı
- Başarılı workflow tamamlama oranı
- Ortalama skill body uzunluğu
- Trigger isabeti
- Kullanımdan sonra revize edilen skill sayısı

### Ürün Metrikleri

- Kurulum süresi
- İlk değer alma süresi
- Örnek senaryo sayısı
- Public repo star/fork
- Dış kullanıcı feedback'i

### Kişisel Verimlilik Metrikleri

- Bir feature'ı PRD -> issue -> implementation akışına sokma süresi
- Debug süresindeki azalma
- Review'da yakalanan gerçek bug sayısı
- Handoff sonrası devam edilebilirlik

---

## 14 Günlük Agresif Plan

### Gün 1

- Porting matrix çıkar
- v0.1 skill kapsamını kilitle
- Klasör yapısını oluştur
- `diagnose` ve `tdd` için kaynak analiz yap

### Gün 2-3

- `diagnose` portu
- `tdd` portu
- İki skill'i küçük repo üzerinde dene
- İlk revizyonları yap

### Gün 4-5

- `grill-with-docs` portu
- `prototype` portu
- `zoom-out` portu
- `CONTEXT.md` ve ADR okuma davranışını Codex'e uyarla

### Gün 6-7

- `to-prd`, `to-issues`, `handoff` portları
- Local markdown issue template
- Bir fikirden PRD ve issue üretme denemesi

### Gün 8-10

- `improve-codebase-architecture`
- `review`
- `triage`
- Gerçek repo üzerinde architecture audit

### Gün 11-12

- Pack installer / kurulum notları
- Frontmatter ve body temizliği
- Windows path ve script uyumu

### Gün 13-14

- 3 gerçek repo pilotu
- Failure mode düzeltmeleri
- v0.1 release candidate
- Demo transcript veya kısa video hazırlığı

---

## 30 Günlük Hedef

1. En az 10 Codex skill port edilmiş
2. En az 3 gerçek projede denenmiş
3. PRD -> issue -> TDD implementation akışı çalışmış
4. Diagnose workflow gerçek bug üzerinde değer üretmiş
5. Architecture audit raporu üretebilmiş
6. Pack kurulumu belgelenmiş
7. Public paylaşım için demo hazır
8. İlk dış kullanıcı feedback'i alınmış

---

## Varsayımlar

- Hedef ortam Codex Desktop ve local filesystem.
- İlk kullanım kişisel projelerde olacak.
- Skill'ler önce local tutulacak, sonra istenirse public repoya taşınacak.
- Kaynak skill'ler ilham ve başlangıç noktasıdır; birebir kopyalama hedef değildir.
- Codex skill standardı, Claude plugin standardından önceliklidir.
- Windows uyumu ilk günden korunacak.
- İlk değer mühendislik disiplini ve tekrar kullanılabilir workflow'lardan gelecek.

---

## Immediate Next Step

Şu an yapılacak ilk iş:

```txt
Faz 0:
Porting matrix oluştur, v0.1 skill kapsamını kilitle ve ilk iki skill olarak diagnose + tdd portlarına başla.
```
