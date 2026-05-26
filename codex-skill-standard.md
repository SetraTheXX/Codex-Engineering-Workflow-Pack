# Codex Skill Standard

Bu dokuman Codex Engineering Workflow Pack icin v0.1 skill yazim standardini kilitler. Faz 0 kapsaminda skill yazilmaz; bu standart Faz 1'de kullanilacak karar zeminidir.

## Klasor Standardi

Repo-scoped skill gelistirme yolu:

```txt
.agents/skills/<skill-name>/SKILL.md
```

Bu proje icinde gelistirilen skill'ler once `.agents/skills/` altinda tutulmalidir. Boylece paket local-first kalir, repo icinde review edilebilir olur ve global Codex skill klasorune kopyalama daha sonra ayri bir kurulum karari olarak ele alinir.

Her skill kendi klasorunde yasamalidir:

```txt
skill-name/
  SKILL.md
  references/
  scripts/
  assets/
```

Zorunlu tek dosya `SKILL.md` olmalidir. `references/`, `scripts/` ve `assets/` sadece gercek ihtiyac varsa eklenmelidir.

`agents/openai.yaml` v0.1 icin zorunlu degildir. Gerekliligi Codex tarafinda netlesmeden standart parca yapilmamalidir.

## SKILL.md Frontmatter Standardi

Frontmatter yalnizca su alanlari icermelidir:

```yaml
---
name: skill-name
description: What this skill does. Use when specific triggers appear.
---
```

Tasinmayacak alanlar:

- `disable-model-invocation`
- `argument-hint`
- Claude hook veya plugin metadata alanlari
- Model, provider veya agent-specific config alanlari

## name Kurallari

- Klasor adi ile ayni olmali.
- Lowercase kebab-case kullanilmali.
- Kisaltma, marka veya kisi adi icermemeli.
- Skill'in davranisini anlatmali: `diagnose`, `to-issues`, `handoff`.

## description Kurallari

Description, Codex'in skill'i ne zaman yukleyecegini belirleyen ana sinyaldir.

Kurallar:

- Ilk cumle skill'in ne yaptigini soylemeli.
- Ikinci cumle `Use when...` ile tetikleyici durumlari yazmali.
- Slash command'a bagli olmamali.
- Benzer skill'lerden ayrisan sinirini belirtmeli.
- 1024 karakteri gecmemeli.
- Kisa, net ve davranis odakli olmali.

## references Kullanimi

`references/`, nadiren gereken ayrinti icindir.

Kullan:

- Uzun sablonlar
- Ornek PRD/issue formatlari
- Test kalitesi rehberleri
- Mimari terim sozlukleri
- Setup karar sablonlari

Kullanma:

- SKILL.md'de zaten olan metni tekrar etmek
- Genel yazilim bilgisi depolamak
- Fazla uzun manifesto saklamak

Referanslar bir seviye derinde olmalidir. `SKILL.md`, hangi durumda hangi referansin okunacagini acikca soylemelidir.

## scripts Kullanimi

`scripts/`, deterministik ve tekrar eden isler icindir.

Kullan:

- Frontmatter validation
- Markdown issue numaralandirma
- Format veya smoke check
- Tekrar tekrar yazilacak kucuk yardimci komutlar

Kullanma:

- Claude hook kopyalamak
- Kullanici onayi gerektiren destructive isleri otomatiklestirmek
- Tek seferlik analizleri script'e cevirmek
- Windows'ta calismayacak Unix-only varsayimlari dayatmak

Script varsa en az bir smoke test senaryosu dokumante edilmelidir.

## assets Kullanimi

`assets/`, ciktiya kopyalanacak sablon veya statik dosyalar icindir.

Kullan:

- Issue template
- Handoff template
- Report HTML iskeleti
- Demo fixture

Kullanma:

- Agent'in okumasini bekledigin dokumanlar
- Buyuk, belirsiz kaynak dump'lari

## Progressive Disclosure

Kural:

```txt
SKILL.md = temel workflow
references/ = ayrinti ve ornek
scripts/ = deterministik is
assets/ = cikti kaynagi
```

`SKILL.md` mumkunse 100-200 satir araliginda kalmalidir. 500 satir ustu kabul edilmez; ayrinti reference dosyasina bolunmelidir.

## Windows Path Uyumu

Bu paket Windows ve Codex Desktop hedeflidir.

Kurallar:

- Path'lerde bosluk olabilecegi varsayilmali.
- PowerShell ornekleri desteklenmeli.
- Unix-only komutlar tek yol olarak yazilmamali.
- Absolute path gerekirse quoted path veya markdown link uyumlu format kullanilmali.
- Script varsa Windows davranisi ayrica dusunulmeli.

## Destructive Davranis Yasagi

Skill'ler kullanici onayi olmadan su islemleri yapmayi onermemeli:

- `git reset --hard`
- `git clean`
- force push
- recursive delete
- config overwrite
- issue/PR kapatma
- remote publish

Riskli islerde skill davranisi once plan, sonra acik onay, sonra uygulama seklinde olmalidir.

## Local-first Issue ve Docs Yaklasimi

Varsayilan issue tracker local markdown olmalidir.

Onerilen yapi:

```txt
docs/agents/
  issue-tracker.md
  domain.md
  test-commands.md
  handoff.md
  issues/
```

GitHub opsiyoneldir. GitHub publish, v0.1'de zorunlu akisa baglanmamalidir.

Domain language icin varsayilan:

```txt
CONTEXT.md
docs/adr/
```

Alternatif yapilar `setup-codex-engineering-workflow` tarafindan kayda gecirilmelidir.

## Skill Body Okunabilirlik Kurallari

- Emir kipi kullan: "Read", "Explore", "Write", "Verify".
- Felsefeyi azalt, uygulanabilir adimlari one cikar.
- Her workflow sonunda verification beklentisi olsun.
- Gereksiz slogan veya uzun alinti kullanma.
- Claude-specific terimleri kullanma.
- Kullaniciya sorulacak sorular, koddan cevaplanamayacak kararlarla sinirli olmali.
- Her skill kendi failure mode'unu acikca bilmeli.

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
