# Porting Matrix

Bu matris kaynak skill'leri Codex Engineering Workflow Pack icin karar seviyesinde siniflandirir. Faz 0'da skill yazilmaz; bu tablo Faz 1 ve Faz 2 uygulama siralamasini kilitler.

| Source skill | Target Codex skill adi | Karar | Oncelik | Codex uyarlama notu | Gerekli references/scripts | Ilk test senaryosu | Risk/failure mode |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `setup-matt-pocock-skills` | `setup-codex-engineering-workflow` | rewrite | v0.1 | Claude/AGENTS varsayimi kaldirilip local-first proje konfigurasyonu yazilmali. Local markdown issue varsayilan, GitHub opsiyonel olmali. | references: issue tracker, docs layout, test commands, handoff layout | Bos bir repo icin `docs/agents/*` karar taslagi uretmek | Setup fazla soru sorarsa ilk kullanim agirlasir. |
| `diagnose` | `diagnose` | adaptive port | v0.1 | Feedback loop, reproduce, hypothesis, instrumentation, regression test korunmali. HITL bash ve Unix varsayimlari sadelestirilmeli. | references: feedback loop patterns; optional scripts later | Bilerek bozulan bir testte once failure loop kurup sonra fix etmek | Kod okumaya atlayip deterministic repro kurmamak. |
| `tdd` | `tdd` | adaptive port | v0.1 | Vertical slice ve public behavior test ilkesi korunmali. Kullanici onayi ve test scope netligi Codex akisi ile yazilmali. | references: tests, mocking, interface design, refactoring | Kucuk bir feature icin bir failing test, minimal implementation, refactor dongusu | Horizontal test yazimi veya implementation detail testi. |
| `grill-with-docs` | `grill-with-docs` | adaptive port | v0.1 | `CONTEXT.md` ve ADR mantigi korunmali. Slash command dili kaldirilmali. Koddan cevaplanabilen sorular kullaniciya sorulmamali. | references: context format, ADR format | Belirsiz feature fikrini domain terimleri ve ADR kararlariyla netlestirmek | Fazla sorgulama veya domain docs'u spec gibi kullanma. |
| `to-prd` | `to-prd` | adaptive port | v0.1 | GitHub issue publish zorunlulugu kaldirilmali. Varsayilan cikti local PRD markdown olmali. | references: PRD template | Mevcut konusmadan local PRD dosyasi taslagi uretmek | Kullaniciyle yeniden interview yapmak veya stale file path eklemek. |
| `to-issues` | `to-issues` | adaptive port | v0.1 | Tracer bullet issue mantigi korunmali. Varsayilan cikti `docs/agents/issues/` altinda markdown olmali. | references: local issue template, vertical slice guide | PRD'den en az 5 bagimsiz local issue taslagi uretmek | Horizontal layer issue'lari uretmek. |
| `prototype` | `prototype` | adaptive port | v0.1 | Logic/UI branch ayrimi korunmali. Prototipin throwaway oldugu ve nasil temizlenecegi net olmali. | references: logic prototype, UI prototype | Bir state machine icin terminal prototip planlamak veya UI varyasyon route'u tasarlamak | Prototipin production koda sizmasi. |
| `zoom-out` | `zoom-out` | direct port | v0.1 | Cok kisa tutulabilir. `disable-model-invocation` frontmatter'i kaldirilmali. | none | Bilinmeyen bir module icin caller/module haritasi cikarmak | Cok yuzeysel ozet vermek. |
| `improve-codebase-architecture` | `improve-codebase-architecture` | adaptive port | v0.1 | Deep module, interface, locality, leverage dili korunmali. Claude subagent ve zorunlu HTML rapor varsayimi sadelestirilmeli. | references: architecture language, report template, interface design | Orta olcekli repoda 3 mimari friction candidate raporlamak | Soyut refactor onerileri uretmek, uygulanabilir siralama vermemek. |
| `handoff` | `handoff` | adaptive port | v0.1 | Temp dir zorunlulugu yerine proje konfigurasyonundaki handoff klasoru varsayilan olmali. Sensitive data redaction korunmali. | references: handoff template | Oturum sonunda sonraki Codex'in devam edecegi handoff dosyasi uretmek | Mevcut PRD/issue bilgisini kopyalayip duplicate etmek. |
| `triage` | `triage` | defer | v0.2 | Issue tracker state machine'e bagli. Local/GitHub label mapping oturmadan alinmamali. | references: agent brief, out-of-scope, labels | Local issue'lari `needs-info` / `ready-for-agent` durumuna ayirmak | Yanlis state transition veya issue tracker'a izinsiz yazma. |
| `review` | `review` | defer | v0.2 | Diff fixed point, spec source ve standards source gerektirir. Codex review stance ile yeniden tasarlanmali. | references: review axes, spec lookup, standards lookup | `main...HEAD` diff'i Standards ve Spec ekseninde incelemek | Spec yokken kesin hukum vermek veya subagent varsayimi tasimak. |
| `setup-pre-commit` | `setup-pre-commit` | adaptive port | v0.2 | Package manager detection ve test script algisi yararli. Ancak install/commit davranisi kullanici onayina baglanmali. | scripts later: package manager detect | Node repo icin hook planini cikarmak | Paket kurma veya commit'i otomatik yapmak. |
| `write-a-skill` | `write-a-skill` | adaptive port | v0.2 | Codex skill standardina gore yeniden yazilmali. Faz 0 standardini kaynak kabul etmeli. | references: skill checklist | Yeni workflow skill icin requirement ve skeleton planlamak | Kotu trigger description veya fazla uzun SKILL.md uretmek. |
| `grill-me` | `grill-me` | adaptive port | v0.2 | Genel plan netlestirme icin yararli. `grill-with-docs` ile overlap'i net ayrilmali. | none | Kod disi bir plan icin tek tek karar agaci sorgulamak | Kullaniciya fazla soru sormak. |
| `caveman` | `caveman` | defer | v0.2 | Iletisim modu; core engineering workflow degil. Kisa mod olarak opsiyonel alinabilir. | none | Kullanici "cok kisa konus" dediginde yanit stilini kisaltmak | Teknik netligi kaybetmek. |
| `git-guardrails-claude-code` | none | exclude | exclude | Claude hook sistemine bagli. Fikir olarak destructive git yasagi standarda alindi, skill olarak tasinmayacak. | none | Yok | Yanlis port edilirse Codex'te calismayan guvenlik hissi yaratir. |
| `migrate-to-shoehorn` | none | exclude | exclude | TypeScript test helper'a ozel. Genel Codex workflow pack hedefi disinda. | none | Yok | Niche dependency paketin odagini bozar. |
| `scaffold-exercises` | none | exclude | exclude | Kurs/exercise uretimi icin ozel. Engineering workflow cekirdegi degil. | none | Yok | Urun kapsaminda daginiklik yaratir. |

## v0.2'ye Tasima Gerekcesi

`review` v0.2'ye tasinmalidir cunku kaliteli review icin diff fixed point, branch/PR durumu, spec kaynagi ve repo standartlari gerekir. Bunlar setup ve local docs cekirdegi oturmadan guvenilir calismaz.

`triage` v0.2'ye tasinmalidir cunku issue tracker state machine'e baglidir. Label mapping, issue storage, local/GitHub davranisi ve reporter interaction kurallari once netlesmelidir.

Once local workflow cekirdegi oturmalidir: setup, diagnose, tdd, docs, PRD, issue, handoff.

## Next Implementation Order

1. `setup-codex-engineering-workflow`
2. `diagnose`
3. `tdd`
4. `grill-with-docs`
5. `to-prd`
6. `to-issues`
7. `handoff`
8. `zoom-out`
9. `prototype`
10. `improve-codebase-architecture`
