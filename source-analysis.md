# Source Analysis

Bu dokuman `mattpocock/skills` reposunu Codex icin birebir port edilecek bir kaynak olarak degil, muhendislik workflow fikirleri icin referans olarak degerlendirir.

## README Ana Stratejisi

`mattpocock/skills`, buyuk surec frameworkleri yerine kucuk, secilebilir ve birbirine eklenebilir agent skill'leri onerir. Strateji sudur:

- Agent'i tek seferde buyuk is yaptiran bir otomasyon gibi degil, dogru geri bildirim donguleriyle calisan bir muhendis gibi yonlendirmek.
- Misalignment, zayif test dongusu, belirsiz domain dili ve mimari curume gibi gercek yazilim failure mode'larini hedeflemek.
- Her skill'i dar bir davranisa odaklamak: diagnose bug cozer, tdd implementasyonu kucultur, grill-with-docs kavramlari netlestirir, to-issues isi dilimlere ayirir.
- Repo basina konfigurasyon kullanmak: issue tracker, triage label'lari, domain docs ve ADR yerleri setup skill'iyle belirlenir.

Codex Engineering Workflow Pack icin alinacak ana fikir: `small, local-first, composable engineering workflows`.

## Cozmeye Calistigi Failure Mode'lar

| Failure mode | Kaynak repo cozumu | Codex yorumu |
| --- | --- | --- |
| Agent kullaniciyi yanlis anlar | `grill-me`, `grill-with-docs` | Codex'te de plan netlestirme ilk adim olmali. |
| Domain dili belirsizdir | `CONTEXT.md`, ADR entegrasyonu | Codex icin local domain language dokumani korunmali. |
| Kod calismaz veya geri bildirim zayiftir | `diagnose`, `tdd` | v0.1'in en kritik cekirdegi. |
| Agent cok buyuk adim atar | Vertical slice, tracer bullet issues | `to-issues` local markdown issue uretmeli. |
| Mimari kalite gec fark edilir | `zoom-out`, `improve-codebase-architecture` | Codex'in kod okumadan once sistem haritasi cikarmasini saglar. |
| Is devredilemez kalir | `handoff` | Codex oturumlari arasinda baglam kaybini azaltir. |
| Issue state'i daginik olur | `triage` | Degerli ama v0.2; once local workflow cekirdegi oturmali. |

## Skill Gruplari

### Engineering

Ana urun degeri burada. `diagnose`, `tdd`, `grill-with-docs`, `to-prd`, `to-issues`, `prototype`, `zoom-out`, `improve-codebase-architecture` Codex icin dogrudan yararli fikirler tasir.

`setup-matt-pocock-skills` birebir tasinmamalidir; Codex icin `setup-codex-engineering-workflow` olarak yeniden yazilmalidir.

`triage` degerlidir fakat issue tracker state machine'e baglidir. v0.2'ye ertelenmelidir.

### Productivity

Destekleyici workflow grubudur.

- `handoff` v0.1'e alinmali; oturum devri bu paketin ana UX sorunlarindan biridir.
- `grill-me` v0.2'de genel plan netlestirme skill'i olarak alinabilir.
- `write-a-skill` v0.2'de paketin kendi skill uretim kalitesini artirir.
- `caveman` opsiyoneldir; muhendislik cekirdegi degil, iletisim modu.

### Misc

Yardimci, proje-spesifik veya Claude'a fazla bagli skill'lerdir.

- `setup-pre-commit` v0.2'de alinabilir; ancak package manager, test script ve Windows uyumu dikkat ister.
- `git-guardrails-claude-code` birebir tasinmamalidir; Claude hook sistemi Codex'e ait degildir.
- `migrate-to-shoehorn` ve `scaffold-exercises` bu paketin genel muhendislik workflow hedefi disindadir.

### In-progress

`review` yararli ama henuz stabil degildir. Diff, fixed point, spec kaynagi ve repo state bilgisi gerektirir. Bu yuzden v0.2'ye tasinmalidir.

## Codex Icin Dogrudan Uygun Olanlar

- `diagnose`: feedback loop odakli bug cozum disiplini Codex'e dogrudan uyar.
- `tdd`: one test, minimal implementation, refactor dongusu korunmali.
- `prototype`: throwaway logic/UI prototip mantigi Codex icin yararli.
- `zoom-out`: kisa ve etkili kod haritalama davranisi.
- `handoff`: Codex oturumlari icin dogal bir ihtiyac.

## Uyarlanmasi Gerekenler

- `setup-matt-pocock-skills`: Codex local-first setup skill'ine donusmeli.
- `grill-with-docs`: `CONTEXT.md` ve ADR fikirleri korunmali, slash command varsayimi kaldirilmali.
- `to-prd`: GitHub issue publish zorunlulugu kaldirilmali; local PRD varsayilan olmali.
- `to-issues`: local markdown issue uretimi varsayilan olmali.
- `improve-codebase-architecture`: Claude subagent ve HTML rapor varsayimlari Codex'e gore sadelestirilmeli.
- `review`: v0.2'de Codex review stance ile yeniden tasarlanmali.
- `triage`: v0.2'de local/GitHub issue state destegi netlesince alinmali.

## Tasinmamasi Gerekenler

- `git-guardrails-claude-code`: Claude hook sistemine bagli.
- `migrate-to-shoehorn`: TypeScript test helper nişi; genel pack hedefi degil.
- `scaffold-exercises`: kurs icerigi uretimi icin ozel.
- Deprecated skill'ler: mevcut urun stratejisine alinmamali.

## Claude-specific Alanlar

Tasinmayacak veya Codex'e gore yeniden ifade edilecek alanlar:

- Slash command varsayimlari: `/tdd`, `/diagnose`, `/setup-matt-pocock-skills`.
- Claude frontmatter alanlari: `disable-model-invocation`, `argument-hint`.
- Claude hook sistemi: `.claude/settings.json`, `PreToolUse`, Bash hook matcher.
- Claude subagent ifadeleri: `Agent tool`, `subagent_type=Explore`, `general-purpose subagent`.
- GitHub issue publish zorunlulugu ve `gh issue create` varsayimi.
- `AGENTS.md` ve `CLAUDE.md` dosyalarini birebir setup hedefi sayma.
- Unix-only script ve path varsayimlari.

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
