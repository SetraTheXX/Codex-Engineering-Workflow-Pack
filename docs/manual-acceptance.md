# CEWP Manuel Kabul ve Deneme Rehberi

Bu rehber, CEWP'yi bakım sorumlusu veya pilot katılımcısı olarak güvenli biçimde
denemen içindir. Testleri yeni bir dalda, geçici bir klonda veya gözden çıkarılabilir
bir depoda yap. Komutları onaylamadan önce oku; prompt ve test dosyalarına gizli bilgi
koyma.

Kendi yaptığın testler `maintainer-dogfood` olarak kaydedilmelidir. Doğrulanmış
maintainer kaydı Phase 13 teknik kabul kanıtı sayılır; bağımsız kullanıcı yapılmış
gibi gösterilmez ve bağımsız reviewer PASS kapısı yine zorunludur.

## Şimdi ne yapmalısın?

1. Önce aşağıdaki **Kimlik bilgisi gerektirmeyen ön kontrol** bölümünü uygula.
2. Sonra deneme için küçük ve geçici bir Git deposu hazırla.
3. Bu depoda yalnız `README.md` dosyasını değiştiren tek bir denetimli checkpoint çalıştır.
4. Duraklatma, devam ettirme, doğrulama, inceleme ve makbuz adımlarını sırayla dene.
5. Sonucu `maintainer-dogfood` olarak kaydet; dış kullanıcı sonucu gibi gösterme.
6. Hata görürsen komutu, temizlenmiş hata mesajını, beklenen sonucu ve gerçek sonucu not et.

İlk turda gerçek bir projeni kullanma. Önce geçici depoda akışın tamamını gör.

## Kimlik bilgisi gerektirmeyen ön kontrol

CEWP kaynak deposunda PowerShell aç ve kaynak komutunun yolunu tanımla:

```powershell
$cewpRepo = "C:\path\to\Codex-Engineering-Workflow-Pack"
$cewp = Join-Path $cewpRepo "bin\cewp.js"
Set-Location $cewpRepo
node $cewp --help
node $cewp doctor --json
node $cewp compatibility --json
npm run test:clean-install
npm run test:plugin-lifecycle
```

Beklenen sonuç:

- Yardım metni görüntülenir.
- Doctor sonucu anlaşılır ve uygulanabilir olur.
- Uyumluluk sonucu `phase-13-complete-release-validation-required` gösterir.
- Temiz kurulum, kimlik bilgisi gerektirmeyen demo ve kaldırma testi geçer.
- İzole plugin testi kurulum, devre dışı bırakma, yükseltme ve kaldırma adımlarını geçer.
- Testler yeni bir Codex kimlik doğrulama dosyası oluşturmaz.

## Geçici deneme deposu hazırlama

PowerShell'de CEWP deposunun dışında geçici bir klasör oluştur:

```powershell
$deneme = Join-Path $env:TEMP "cewp-manuel-deneme"
New-Item -ItemType Directory -Force -Path $deneme | Out-Null
Set-Location $deneme
git init
git config user.email "cewp-deneme@example.local"
git config user.name "CEWP Manuel Deneme"
"# CEWP Manuel Deneme" | Set-Content README.md
git add README.md
git commit -m "Başlangıç"
```

Bu depo yalnız deneme içindir. İçinde gerçek kaynak kodu, token, parola veya özel belge
bulundurma.

## Denetimli checkpoint

Aşağıdaki yol gerçek yönetilen Codex yürütmesini kullanır. Hedefi küçük tut:

```powershell
node $cewp supervise plan --goal "README.md dosyasına Manuel kabul notu başlıklı tek bir bölüm ekle" --scope README.md --verify "git diff --check" --stop "Not eklenmiş ve git diff --check geçmiş olmalı" --json
node $cewp supervise approve <run-id> --yes --json
```

`<run-id>` yerine ilk komutun döndürdüğü çalışma kimliğini yaz.
Bu aşamada henüz `execute` çalıştırma; önce aşağıdaki duraklatma ve revizyon
kontrolünü tamamla.

Beklenen sonuç:

- Öneri çalıştırmadan önce açıkça gösterilir.
- Yürütme için ayrıca onay gerekir.
- Yalnızca izin verilen `README.md` değişir.
- Codex host tarafında tamamlandı görünmesi tek başına CEWP doğrulama PASS'i oluşturmaz.
- Yanlış depo veya worktree görünürse yürütmeyi onaylama.

## Duraklatma, revizyon ve devam ettirme

Finalization öncesinde kontrollü duraklatmayı ve revizyonu dene:

```powershell
node $cewp supervise pause <run-id> --reason budget-safe --yes --json
node $cewp supervise status <run-id> --json
node $cewp supervise resume <run-id> --yes --json
node $cewp supervise revise <run-id> --goal "Aynı sınırlı README notunu koru ve anlatımını netleştir" --json
node $cewp supervise approve <run-id> --yes --json
```

Beklenen sonuç:

- Duraklatma gerçeğe uygun ve devam ettirilebilir bir durum üretir.
- Önceden tamamlanan kanıt kaybolmaz.
- Devam ettirme, çalışmayı doğru önceki kapıya döndürür.
- Revizyon kapsamı sessizce değiştirmez; yeniden inceleme gerektirir.

## Yürütme ve doğrulama

Revize edilen planı yeniden onayladıktan sonra:

```powershell
node $cewp supervise execute <run-id> --yes --json
node $cewp supervise verify <run-id> --json
```

Beklenen sonuç:

- Yalnızca izin verilen `README.md` değişir.
- Kapsam dışı değişiklik güvenli biçimde reddedilir.
- Repository doğrulama komutu ayrı çalışır ve sonucu kaydedilir.
- Host tarafındaki tamamlanma tek başına doğrulama PASS'i değildir.

## Bağımsız inceleme ve makbuz

Yürütme ve doğrulama tamamlandıktan sonra:

```powershell
node $cewp supervise review <run-id> --yes --json
node $cewp supervise receipt <run-id> --json
node $cewp supervise finalize <run-id> --yes --json
```

Beklenen sonuç:

- Doğrulama veya reviewer PASS yoksa finalize reddedilir.
- JSON ve Markdown makbuzu; owner/backend, kapsam, doğrulama, inceleme, kullanım
  kaynağı, bilinmeyen host kullanımı ve bütünlük bilgisini gösterir.
- Ham prompt, token veya gizli dosya içeriği makbuza kopyalanmaz.

## Sahiplik çakışması

CEWP geliştirme deposunda:

```powershell
Set-Location $cewpRepo
npm run test:ownership-gates
npm run test:integration-binding
```

Beklenen sonuç:

- `managed` ve `native` sahiplik aynı görev worktree'sini hedefleyemez.
- Güvensiz iç içe dispatch güvenli biçimde reddedilir.
- Bırakılan veya terk edilen sahiplik açıkça kaydedilir.

Bunu iki gerçek ajanı aynı worktree üzerinde başlatarak deneme. Deterministik testleri kullan.

## Hata ve kurtarma

CEWP geliştirme deposunda:

```powershell
Set-Location $cewpRepo
npm run test:supervised-failure
npm run test:supervised-controls
npm run test:workflow-failure-matrix
npm run test:workflow-lifecycle
```

Beklenen sonuç:

- Tekrarlanan aynı hata imzası sınırsız döngü başlatmaz.
- Operasyon bütçesi veya host limiti, devam ettirilebilir ve dürüst durum üretir.
- Reviewer için korunan bütçe başka işler tarafından tüketilmez.
- Kısmi kanıt kurtarma sırasında korunur.
- Hiçbir hata yolu sahte reviewer PASS üretmez.

## Pilot kanıtı

Kendi testini dürüstçe bakım sorumlusu denemesi olarak kaydet:

```powershell
Set-Location $deneme
node $cewp pilot create --pilot-id maintainer-manual-1 --participant maintainer-dogfood --participant-id maintainer-1 --json
node $cewp pilot status --json
node $cewp pilot export maintainer-manual-1 --json
```

Beklenen sonuç:

- Pilot durumu tamamlanmamış kalır.
- Bakım sorumlusu kaydı bağımsız kullanıcı sayımlarına dahil edilmez.
- Asıl kayıt ignored `.cewp/pilots/` altında kalır.
- Export ayrı ve redakte edilmiş bir projeksiyondur.

Gelecekteki dış katılımcı kendi gerçek repository sonucunu onaylamalı ve kişisel bilgi
içermeyen bağımsız bir katılımcı kimliği kullanmalıdır.

## Ne iddia edilmemeli?

- Geçen fixture testi, gerçek dış kullanıcı veya case study değildir.
- Kendi testin bağımsız kullanıcı testi değildir.
- Native host tamamlanması CEWP doğrulaması veya reviewer PASS değildir.
- Eksik, eski veya bozuk host kullanım bilgisi sıfır değildir.
- Windows testi tek başına Linux release matrisini kanıtlamaz.
- Artifact hazırlamak publish, tag, push veya GitHub release yapmak değildir.
- Phase 13 teknik kabulü tamamlanmış olsa da son kaynak release matrisi ve açık yayın kararı geçmeden `1.0.0` yayımlandı denmemelidir.

## Test sonunda kaydetmen gerekenler

- CEWP sürümü
- İşletim sistemi
- Node, Git ve Codex sürümleri
- Çalıştırılan komut
- Beklenen davranış
- Gerçek davranış
- Duraklatma veya kurtarma sonucu
- Reviewer kararı
- Son makbuzun gizli bilgi içermeyen özeti

Herkese açık rapora token, auth dosyası, ham özel prompt, kaynak kodu veya mutlak özel
repository yolu koyma.
