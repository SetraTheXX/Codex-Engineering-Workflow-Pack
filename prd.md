# Codex Engineering Workflow Pack PRD

> Durum: Taslak
> Tarih: 2026-05-24
> Ürün: Codex Engineering Workflow Pack
> Hedef kullanıcı: Codex ile gerçek yazılım projeleri geliştiren solo developer, teknik kurucu, öğrenci, freelancer ve küçük ekipler

---

## Problem Statement

Codex, tekil kod değişikliklerinde çok güçlü olabilir; fakat gerçek projelerde başarı sadece kod yazmaktan gelmez. İyi yazılım geliştirme; problemi netleştirme, kapsamı küçültme, test döngüsü kurma, hatayı sistematik teşhis etme, mimari borcu fark etme, işi issue'lara bölme ve yarım kalan işi devredilebilir hale getirme disiplinleri ister.

Bugünkü sorun şu:

- Kullanıcı fikri hızlıca koda çeviriyor ama kapsam bulanık kalıyor
- Codex bazen fazla büyük adımlar atıyor
- Test döngüsü kurulmadan feature yazılıyor
- Debug işi tahmin ve kod okuma seviyesinde kalıyor
- Büyük değişiklikler issue veya PRD olmadan dağılıyor
- Mimari kalite ancak bozulduktan sonra fark ediliyor
- Oturum bitince sonraki ajan ya da sonraki gün aynı bağlamı yeniden kurmak gerekiyor

Codex Engineering Workflow Pack, bu boşluğu doldurur. Amaç, Codex'e tekrar kullanılabilir mühendislik çalışma alışkanlıkları kazandırmaktır.

---

## Product Vision

Codex Engineering Workflow Pack, Codex için bir "software engineering operating system" gibi çalışır.

Kullanıcı bir proje üzerinde çalışırken şu akışları doğal şekilde başlatabilir:

```txt
Fikir -> grilling -> PRD -> issue'lar -> TDD implementation -> review -> handoff
Bug -> reproduce -> minimize -> instrument -> fix -> regression test
Repo -> zoom out -> architecture audit -> refactor plan -> issue'lar
```

Başarı, çok fazla skill taşımak değil; az ama doğru skill ile Codex'in daha disiplinli, daha az varsayım yapan ve daha kolay denetlenebilir çalışmasıdır.

---

## Goals

### v0.1 Goals

- En değerli engineering workflow skill'lerini Codex formatına uyarlamak
- Local kullanım için kurulabilir bir skill paketi oluşturmak
- İlk 10 skill'i gerçek projelerde denenebilir hale getirmek
- PRD, issue, diagnose, TDD ve architecture audit akışlarını çalıştırmak
- Windows ve Codex Desktop ortamında sorunsuz dosya/path davranışı sağlamak

### v0.2 Goals

- Review ve triage workflow'larını güçlendirmek
- Local markdown issue sistemi eklemek
- GitHub issues entegrasyonunu opsiyonel hale getirmek
- Skill doğrulama checklist'i ve porting matrix oluşturmak
- Public paylaşım için demo ve kullanım senaryoları hazırlamak

### Long-Term Goals

- Paylaşılabilir Codex skill bundle üretmek
- Farklı proje türleri için workflow presetleri sağlamak
- Dış kullanıcı feedback'i ile skill trigger ve body kalitesini artırmak
- Codex ile yazılım geliştirmede standart bir çalışma akışı oluşturmak

---

## Non-Goals

v0.1 kapsamında yapılmayacaklar:

- Tam marketplace plugin sistemi
- Cloud servis veya telemetry
- Otomatik private repo işlemleri
- Ücretli ürün/SaaS
- Tüm kaynak skill'leri birebir taşımak
- Claude Code hook sistemini aynen kopyalamak
- Her framework için özel implementation guide yazmak
- Kullanıcının onayı olmadan destructive git işlemleri yapmak

---

## Target Users

### Solo Developer

Kendi projelerini Codex ile daha düzenli ilerletmek ister. En çok `tdd`, `diagnose`, `to-prd`, `handoff` kullanır.

### Freelancer

Müşteri işlerini hızlı ama kontrollü teslim etmek ister. En çok `grill-with-docs`, `to-issues`, `review`, `handoff` kullanır.

### Technical Founder

Ürün fikrini PRD'ye, PRD'yi uygulanabilir issue'lara çevirmek ister. En çok `to-prd`, `to-issues`, `prototype` kullanır.

### Maintainer

Mevcut kod tabanındaki kalite sorunlarını görmek ister. En çok `zoom-out`, `improve-codebase-architecture`, `review` kullanır.

---

## Core User Stories

1. Kullanıcı olarak, belirsiz bir feature fikrini Codex ile netleştirip PRD'ye çevirmek istiyorum.
2. Kullanıcı olarak, PRD'yi bağımsız uygulanabilir issue'lara bölmek istiyorum.
3. Kullanıcı olarak, bir bug bildirince Codex'in önce reproduce edilebilir feedback loop kurmasını istiyorum.
4. Kullanıcı olarak, feature geliştirirken Codex'in test-first ilerlemesini istiyorum.
5. Kullanıcı olarak, bilmediğim kod bölgesinde Codex'in önce büyük resmi anlatmasını istiyorum.
6. Kullanıcı olarak, yeni bir UI veya state modelini production koduna girmeden prototiplemek istiyorum.
7. Kullanıcı olarak, büyüyen kod tabanında mimari sürtünmeleri erken görmek istiyorum.
8. Kullanıcı olarak, oturum sonunda başka bir Codex oturumunun devam edebileceği handoff belgesi istiyorum.
9. Kullanıcı olarak, issue'ların AI agent tarafından uygulanabilecek netlikte olmasını istiyorum.
10. Kullanıcı olarak, skill'lerin Codex tarafından doğru zamanda tetiklenmesini istiyorum.

---

## Functional Requirements

### FR1: Codex Skill Format Uyumu

Her skill klasörü şu standardı takip etmeli:

```txt
skill-name/
  SKILL.md
  references/
  scripts/
  assets/
  agents/openai.yaml
```

Zorunlu olan tek dosya `SKILL.md`.

`SKILL.md` frontmatter:

```yaml
---
name: skill-name
description: Clear trigger description for Codex.
---
```

### FR2: Progressive Disclosure

Skill body kısa ve uygulanabilir olmalı. Uzun açıklamalar, örnekler ve formatlar `references/` altına taşınmalı.

Kural:

```txt
SKILL.md temel workflow'u anlatır.
references/ ayrıntı ve örnek taşır.
scripts/ deterministik tekrar eden işi yapar.
```

### FR3: Core Workflow Skill'leri

v0.1 aşağıdaki skill'leri içermeli:

- `diagnose`
- `tdd`
- `grill-with-docs`
- `to-prd`
- `to-issues`
- `prototype`
- `zoom-out`
- `improve-codebase-architecture`
- `review`
- `handoff`

### FR4: Setup Skill

Paket, proje başına çalışma bağlamını kuran bir setup skill içermeli:

- Issue tracker tercihi
- Domain docs lokasyonu
- ADR lokasyonu
- Local issue klasörü
- Agent brief formatı
- Test komutları
- Package manager

Önerilen ad:

```txt
setup-codex-engineering-workflow
```

### FR5: Local Issue Workflow

GitHub zorunlu olmamalı. Kullanıcı isterse issue'lar local markdown dosyası olarak üretilmeli.

Önerilen yapı:

```txt
docs/agents/issues/
  0001-add-login-rate-limit.md
  0002-add-validation-to-checkout.md
```

Issue formatı:

- Problem
- User impact
- Scope
- Acceptance criteria
- Suggested implementation notes
- Verification
- Out of scope

### FR6: PRD Workflow

`to-prd` skill'i mevcut konuşmadan ve repo bağlamından PRD üretmeli.

PRD şunları içermeli:

- Problem statement
- Goals
- Non-goals
- User stories
- Requirements
- Technical approach
- Risks
- Acceptance criteria
- Release gate

### FR7: Diagnose Workflow

`diagnose` skill'i bug fix sırasında şu sırayı korumalı:

```txt
Reproduce -> minimize -> hypothesize -> instrument -> fix -> regression test
```

En önemli çıktı, hızlı ve deterministik pass/fail feedback loop olmalı.

### FR8: TDD Workflow

`tdd` skill'i tek seferde tüm testleri yazmaya zorlamamalı. Dikey slice yaklaşımı kullanılmalı:

```txt
One failing test -> smallest implementation -> refactor -> next test
```

### FR9: Prototype Workflow

`prototype` skill'i iki branch desteklemeli:

- Logic prototype: terminal veya minimal script ile state/business logic denemesi
- UI prototype: route veya page üzerinde birden fazla tasarım varyasyonu

Prototype üretim kodu gibi davranmamalı. Deney bitince ya silinmeli ya da kararı dokümante edilip gerçek koda aktarılmalı.

### FR10: Architecture Workflow

`improve-codebase-architecture` skill'i şu çıktıları üretmeli:

- Mimari sürtünme listesi
- Derinleştirme fırsatları
- Shallow module tespitleri
- Test yüzeyi önerileri
- Risk ve önerilen sıra

---

## Technical Requirements

### TR1: Windows Compatibility

Paket Windows ortamında kullanılabilir olmalı.

- PowerShell örnekleri desteklenmeli
- Path'lerde boşluk olabileceği varsayılmalı
- Unix-only scriptler doğrudan taşınmamalı

### TR2: No Hidden Destructive Behavior

Skill'ler destructive git veya filesystem işlemlerini kullanıcı onayı olmadan yapmamalı.

Özellikle:

- `git reset --hard`
- `git clean`
- force push
- recursive delete
- config overwrite

### TR3: Source Attribution

Kaynak skill'lerden uyarlanan fikirler porting matrix'te izlenmeli. Nihai skill'ler Codex'e uygun yeniden yazılmış olmalı.

### TR4: Validation

Her skill için basit validasyon yapılmalı:

- Frontmatter parse edilebilir
- `name` geçerli
- `description` yeterli
- Referans verilen dosyalar mevcut
- Script varsa en az smoke test edilmiş

---

## Skill Inventory

### v0.1 Must Have

| Skill | Amaç | Port Tipi |
| --- | --- | --- |
| `diagnose` | Bug ve performance regression teşhisi | Uyarlamalı port |
| `tdd` | Red-green-refactor geliştirme | Uyarlamalı port |
| `grill-with-docs` | Planı domain docs ve ADR'lerle netleştirme | Uyarlamalı port |
| `to-prd` | Konuşmadan PRD üretme | Uyarlamalı port |
| `to-issues` | Planı dikey issue'lara bölme | Uyarlamalı port |
| `prototype` | Throwaway UI/logic prototipi | Uyarlamalı port |
| `zoom-out` | Kod alanının büyük resmini anlatma | Hafif port |
| `improve-codebase-architecture` | Mimari iyileştirme fırsatları | Uyarlamalı port |
| `review` | Diff/branch review | Stabilizasyon + port |
| `handoff` | Devredilebilir oturum özeti | Hafif port |

### v0.2 Should Have

| Skill | Amaç |
| --- | --- |
| `triage` | Issue triage state machine |
| `setup-pre-commit` | Husky/lint-staged/test hook kurulumu |
| `write-a-skill` | Yeni Codex skill yazma |
| `grill-me` | Genel plan sorgulama |
| `caveman` | Ultra kısa iletişim modu |

### Later

| Skill | Amaç |
| --- | --- |
| `writing-fragments` | Ham yazı malzemesi toplama |
| `writing-beats` | Beat bazlı narrative yazı |
| `writing-shape` | Notlardan makale şekillendirme |
| `edit-article` | Makale edit ve yapılandırma |

---

## UX Principles

Bu ürünün UX'i terminal veya web arayüzü değil, Codex ile çalışma hissidir.

İyi deneyim şu demektir:

- Codex ne zaman soru soracağını bilir
- Kod okuyarak cevaplayabileceği soruyu kullanıcıya sormaz
- Büyük işi küçük ve doğrulanabilir parçalara böler
- Her kritik işin sonunda verification ister veya çalıştırır
- Handoff sonrası bağlam kaybolmaz
- Skill tetiklenince gereksiz manifesto okumaz, işe başlar

---

## Acceptance Criteria

v0.1 tamam sayılması için:

- [ ] En az 10 skill Codex formatında hazır
- [ ] Her skill `name` ve `description` frontmatter'ına sahip
- [ ] Her skill en az bir gerçek kullanım senaryosuyla denenmiş
- [ ] `diagnose` gerçek veya simüle bug üzerinde feedback loop kurmuş
- [ ] `tdd` küçük feature üzerinde red-green-refactor çalıştırmış
- [ ] `to-prd` bir konuşmadan PRD üretmiş
- [ ] `to-issues` PRD'yi en az 5 dikey issue'ya bölmüş
- [ ] `handoff` başka oturumun devam edebileceği özet üretmiş
- [ ] Windows path uyumu kontrol edilmiş
- [ ] Gereksiz Claude-specific metadata temizlenmiş

---

## Risks

### Risk 1: Skill'ler fazla uzun olur

Mitigation:

- Body kısa tutulacak
- Ayrıntılar `references/` altına taşınacak
- Her skill için "minimum useful workflow" korunacak

### Risk 2: Codex trigger'ları yanlış çalışır

Mitigation:

- `description` alanları örnek triggerlarla güçlendirilecek
- Benzer skill'ler overlap etmeyecek şekilde ayrılacak
- Pilot kullanımda trigger notları tutulacak

### Risk 3: Claude davranışları Codex'e uymayabilir

Mitigation:

- Slash command varsayımları kaldırılacak
- Claude hook ve subagent referansları Codex araçlarına göre yeniden yazılacak
- Uymayan alanlar kapsam dışı bırakılacak

### Risk 4: Paket kişisel workflow olarak kalır

Mitigation:

- Kurulum ve kullanım akışı sade tutulacak
- Örnek senaryolar üretilecek
- Gerçek repo pilotları yapılacak

---

## Open Questions

- Skill'ler ilk aşamada doğrudan `~/.codex/skills` içine mi kurulacak, yoksa bu proje klasöründe mi geliştirilecek?
- Public repo hedefleniyor mu, yoksa önce tamamen kişisel workflow mu kalacak?
- GitHub issue entegrasyonu v0.1'e dahil mi, yoksa local markdown issue yeterli mi?
- İlk pilot projeler hangileri olacak?
- Paket adı `codex-engineering-workflow-pack` olarak mı kalacak?

---

## Launch Plan

### Internal v0.1

- 10 skill portu
- Local kullanım
- 3 pilot repo
- Failure mode revizyonları

### Public v0.1

- GitHub repo
- Kurulum yönergesi
- 3 örnek workflow
- Kısa demo video
- İlk feedback toplama

### v0.2

- Review ve triage güçlendirme
- Local/GitHub issue dual mode
- Validation script
- Daha iyi setup skill

---

## Success Metrics

### v0.1

- 10 port edilmiş skill
- 10 gerçek workflow denemesi
- 3 pilot repo
- 5 revize edilmiş skill
- 1 uçtan uca PRD -> issue -> implementation örneği

### v0.2

- Public repo
- İlk dış kullanıcı feedback'i
- Kurulum süresi 10 dakikanın altında
- En az 3 demo senaryosu
- En az 1 gerçek bug fix workflow başarısı

---

## Immediate Next Step

```txt
Porting matrix hazırla:
Her kaynak skill için port kararı, Codex uyarlama notu, resource ihtiyacı ve v0.1/v0.2 önceliği yaz.
```
