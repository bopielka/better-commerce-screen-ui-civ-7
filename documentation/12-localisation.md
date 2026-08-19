# 12 — Localisation

## Layout

```
text/<locale>/InGameText.xml    every on-screen string
text/<locale>/ModInfoText.xml   the mod's name and description in the Mods browser
```

Locales shipped:

```
en_us  de_DE  es_ES  fr_FR  it_IT  ja_JP  ko_KR  pl_PL  pt_BR  ru_RU  zh_Hans_CN  zh_Hant_HK
```

Both files are registered per locale in the `.modinfo` — `InGameText.xml` under `<UpdateText>` in
**both** action groups, `ModInfoText.xml` under `<LocalizedText>`.

⚠️ `en_us` is listed **without** a `locale` attribute (it is the fallback); every other locale
carries `locale="xx_XX"`.

## ⚠️ Ukrainian lives in `ru_RU`

The game has **no Ukrainian locale**. Those strings sit in the Russian one. This is a deliberate
choice, noted in `text/ru_RU/InGameText.xml` itself and in three places in the `.modinfo`. **It is
not a mislabelled file — do not "fix" it.**

## File shape

```xml
<?xml version="1.0" encoding="utf-8"?>
<Database>
    <EnglishText>
        <Row Tag="LOC_NAJANE_COMMERCE_ASSIGN_ALL">
            <Text>Assign All</Text>
        </Row>
    </EnglishText>
</Database>
```

⚠️ The element is `<EnglishText>` in **every** locale file — it is the table name, not a claim about
the language. `text/en_us/InGameText.xml` is 284 lines and is the reference file.

## Key naming

| Prefix | Used for |
|---|---|
| `LOC_MOD_NAJANE_COMMERCE_*` | mod name and description (`ModInfoText.xml`) |
| `LOC_OPTIONS_NAJANE_COMMERCE_*` | option labels, descriptions, dropdown items |
| `LOC_OPTIONS_GROUP_NAJANE_COMMERCE` | ⚠️ the options group heading — the name is derived from the group id, not chosen |
| `LOC_NAJANE_COMMERCE_*` | everything on screen |

The full list of 140 keys is in `text/en_us/InGameText.xml`. Groups worth knowing:

| Group | Keys | Used by |
|---|---|---|
| Buttons | `ASSIGN_ALL`, `REASSIGN_ALL`, `UNASSIGN_ALL` + `_BUSY` + `_TOOLTIP` | `assign-all-buttons.js` |
| Shortcuts help | `SHORTCUTS`, `SHORTCUTS_TOOLTIP` | the "?" on Resources |
| Settlement controls | `PRIORITY_*`, `QUICK_ASSIGN*` | `settlement-controls.js` |
| Tab tooltips | `TAB_RESOURCES`, `TAB_EMPIRE`, `TAB_EMPIRE_TREASURE`, `TAB_TREASURE`, `TAB_FACTORY`, each + `_DESC`, plus `TAB_TRADE_DESC` | `tab-icons.js` |
| Empire tab | `EMPIRE_ONE`, `EMPIRE_ALL`, `EMPIRE_INCOME`, `EMPIRE_CAPPED`, `EMPIRE_CELEBRATION_ONLY`, `EMPIRE_NO_SCALING` | `empire-tab.js` |
| Unit classes | `UNITS_AIRCRAFT` … `UNITS_SIEGE`, plus `UNITS_CIVILIAN` (9) | `empire-effects.js` |
| Factory tab | `FACTORY_*` (17) | `factory-resources.js`, `factory-effects.js`, `assign-switches.js` |
| Trade | `TRADE_*`, `ROUTE_LAND`, `ROUTE_SEA`, `BLOCKED_LIMIT`, `BLOCKED_RANGE` | `trade-summary.js`, `trade-routes.js` |
| Buy a merchant | `BUY_MERCHANT` + `_TOOLTIP`, `_FUNDS`, `_BLOCKED`, `_ON_THE_WAY` | `trade-buy-merchant.js` |
| Sort tabs | `SORT_BALANCED`, `SORT_YIELD`, `SORT_RESOURCE`, `SORT_EMPIRE`, `SORT_FACTORY` | `trade-sort-tabs.js` |
| Merchant buttons | `SHOW_MERCHANT` + `_TOOLTIP`, `TRADE_FULL` + `_TOOLTIP` | `trade-buy-merchant.js` |
| Improve & buy | `IMPROVE_AND_BUY` + `_TOOLTIP`, `IMPROVE_FUNDS` | `trade-buy-merchant.js` |
| Warning fix | `TRADE_FULL_PROPOSE`, `TRADE_FULL_OPEN` | `trade-buy-merchant.js` |
| Refusal reason | `IMPROVE_STARTED` | `ui/engine/diplomacy.js` (`REASON_OVERRIDES`) |
| Settlement unassign | `SETTLEMENT_UNASSIGN` + `_TOOLTIP` | `settlement-controls.js` |
| Spare merchant | `SEND_SPARE` + `_TOOLTIP` | `trade-buy-merchant.js` |
| Factory clear | `FACTORY_CLEAR` + `_TOOLTIP` | `settlement-controls.js` |
| Resource locks | `RESOURCE_LOCK`, `RESOURCE_UNLOCK` + `_TOOLTIP` | `resource-locks-ui.js` |
| Treasure | `TREASURE_CLICK*`, `TREASURE_ON_ARRIVAL`, `TREASURE_AUTO_RETURN` + `_TOOLTIP` | `treasure-tab.js` |

## ⚠️ Strings this mod must own, and why

### The eight unit classes

**The unit-class tags have no name anywhere in the game's data** — nothing displays them, so nothing
translates them. The resource descriptions spell the classes out in prose, written by hand per
resource. So `LOC_NAJANE_COMMERCE_UNITS_*` are this mod's own keys.

⚠️ `LIGHT` and `HEAVY` are **naval** classes — the game's own descriptions say "light naval units"
for exactly this reason. Translate them that way. See
[planner: valuation](08-planner-valuation.md).

### "Balanced"

Every yield already has a translated name in the game's data, so only
`LOC_NAJANE_COMMERCE_PRIORITY_BALANCED` needs a string of ours — **one line of translation per
language instead of eight.**

## Reusing the game's own strings

Wherever the game already has the wording, this mod composes the game's key rather than inventing
one. Examples in use:

```
LOC_UI_RESOURCE_ALLOCATION_TITLE                    LOC_COMMERCE_TRADE_ROUTE_TAB
LOC_RESOURCECLASS_EMPIRE_NAME                       LOC_RESOURCECLASS_TREASURE_NAME
LOC_RESOURCECLASS_FACTORY_NAME                      LOC_COMMERCE_UNASSIGN_RESOURCES
LOC_COMMERCE_EMPIRE_RESOURCES_ORIGIN_TITLE          LOC_COMMERCE_EMPIRE_RESOURCE_TITLE
LOC_COMMERCE_EMPIRE_ORIGIN_CITY_CONTRIBUTION_COUNTER
LOC_UI_CONTENT_MGR_SUBTITLE                         (the shared "Mods" options tab)
```

⚠️ **The wording for things like empire, treasure and factory resources is taken from the game's own
translation files**, so it matches the rest of the interface rather than reading like a separate
mod — *including which terms take a capital, which differs by language.* When adding a new string,
check whether the game already says it.

`GameInfo.Yields.lookup(type).Name` and `GameInfo.Constructibles.lookup(type).Name` are used the
same way.

## In code

```js
Locale.compose('LOC_NAJANE_COMMERCE_PRIORITY_CURRENT', priorityLabel(type))
Locale.toLower(text)
```

- **Never build a user-visible string by concatenation** where a key with parameters would do.
- ⚠️ **Do not parse a composed string** to get data back out. `trade-routes.js` reads the route's
  `domain` and `nearestCityId` from the projection precisely because taking `domainString` apart
  again would break in every language that words it differently.
- ⚠️ `Locale.stylize` **strips elements**. It is a markup translator, not a pass-through: a `<div>`
  vanishes and takes its line breaks with it. Use the game's own markup — `[B]…[/B]`,
  `[icon:YIELD_GOLD]`, `[icon:ECONOMIC_VP]`.
- ⚠️ Multi-line tooltips need **both** `\n` **and** `white-space: pre-wrap` on
  `#tooltip-root-content > div`. See [Platform notes](03-platform-notes.md).

## Layout consequences of translation

⚠️ **Labels get longer.** The three buttons are fixed at 10.5rem so none reads as the primary
action, which means the box cannot grow — "Assigning…" is longer than "Assign All", and in Polish
longer still, so the label spilled past the border and the middle button broke onto a second line.
Text is kept on one line and allowed to shrink, using the game's own `font-fit-shrink`
(`coh-font-fit-mode: shrink`).

⚠️ **Some game strings are stored in capitals.** The English source for the trade tab is literally
"TRADE ROUTES", which reads as shouting once it is in a tooltip. `softenCaps` in `tab-icons.js`
lowercases only strings that are entirely uppercase, and leaves scripts without letter case alone
(`text === text.toLowerCase()`).

⚠️ **The Empire tab's first column sizes itself** rather than taking a fixed third, because what is
in it varies by age, civilisation **and language**.

## Adding a string — checklist

1. Add the `<Row Tag="…">` to `text/en_us/InGameText.xml`.
2. Add it to **all eleven** other locale files. A missing key renders as the raw tag on screen.
3. Remember `ru_RU` is Ukrainian.
4. Check the game does not already have the wording.
5. Compose it with `Locale.compose`, never by concatenation.
6. Run `deploy.sh` / `deploy-on-mac.sh` — it verifies every file the `.modinfo` references exists.
7. Check `Database.log` after loading: XML that fails validation is reported there.
