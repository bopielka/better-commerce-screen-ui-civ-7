# Steam Workshop — teksty do publikacji

Wszystko po angielsku. **Aktualizujemy przy każdym nowym ficzerze.** Opisujemy tylko to,
co gracz zauważy — żadnych szczegółów technicznych.

---

## 1. Opis moda (pole „Description")

Pełny opis leży w **[steam-description.bbcode](steam-description.bbcode)** — gotowy do
wklejenia, w formacie BBCode, którego używa Warsztat.

Trzymany osobno z jednego powodu: ten plik zawiera też notatki robocze po polsku, a plik
`.bbcode` nie zawiera niczego poza tym, co ma trafić na stronę moda. Nie da się wkleić za
dużo przez pomyłkę.

⚠️ Zmiany opisu robimy **tylko** w pliku `.bbcode`, żeby nie powstały dwie rozjeżdżające
się wersje.

---

## 1a. Krótki opis (do postów i zajawek)

```
Right-click to unassign, Shift to do it to a whole group, and one button to lay out your
entire empire - with unhappy settlements rescued first. The Commerce screen, made
workable.
```

---

## 2. Changelog

### Wersja 0.1 — pierwsze wydanie *(jeszcze niewydane)*

```
FIRST RELEASE

Mouse
- Right-click an assigned resource to unassign it.
- Shift + right-click unassigns every resource of that kind in that settlement.
- Shift + hover previews the whole group before you act on it.
- Shift while assigning fills the settlement with that kind of resource.

Automation
- Assign All, Reassign All and Unassign All above the tabs.
- Priority picker, quick assign and unassign on every settlement card.
- Unhappy settlements are rescued first, cities before towns, levelled rather than
  dumped.
- Unit-production resources are placed last.
- Warehouse-scaling resources go where the warehouses are.
- Turtles and silk gather in your culture city, jade in a separate gold city.
- "Factories first" in the Modern age, on by default and switchable.
- Production-carrying resources prefer cities over towns.
- Cities default to production, towns to food.

Options
- Optional automatic assignment when a resource arrives, from a single new resource up to
  a full rebuild. Set to Never by default.

Trade routes
- Origin, destination and domain on one title line; the two lines of prose removed.
- Three cards per row, all the same size.
- Routes you cannot start split into "only the trade limit" and "out of range".
- A route total above the tabs, with a per-leader breakdown of the room you have left.

Treasure convoys
- Homeland settlements dropped from the "not generating" list.
- Three cards per row.
- The repeated heading removed; the payout sentence reduced to its two numbers, with
  the condition in a tooltip.
- A "?" explaining that clicking a card moves the map without closing the screen.

Empire resources
- Every resource's bonus totalled for your empire, per copy and for all copies.
- A single income total for all empire resources above the tabs.
- Combat bonuses name every unit class they reach.
- Capped and Celebration-only bonuses marked as such.

Factory resources
- A fifth tab in the Modern age, listing every factory resource in three columns.
- "In factories" totals what the slotted copies are actually producing.
- "Not assigned" shows what the idle ones would add once placed.

Screen
- Tabs shown as icons with tooltips.
- The standing instruction line removed, on every tab.
- Unassigned yield totals shown as badges.
- Shorter filter and sort boxes.
- "Unassign all" moved up from the bottom of the settlement list.
```

---

## Uwagi praktyczne (nie do wklejania)

- Kłódki na zasobach z Resource+ nie zostały przeniesione, więc „Reassign All" czyści
  wszystko. Jeśli kiedyś dojdą, trzeba poprawić opis „Reassign All".
- Diagnostyka (`DIAGNOSTICS` w `ui/support/diagnostics.js`) **musi być wyłączona przed
  wydaniem** — poprzedni mod wyszedł z włączoną. Zostaje włączona do czasu wydania, bo
  loguje też czas przypisywania i wynik grupowania szlaków.
- **Tłumaczenia:** wszystkie napisy moda siedzą w `text/<locale>/InGameText.xml`.
  Na razie są `en_us` i `pl_PL`; przed wydaniem dorzucamy pozostałe 10 języków
  (jak w modzie o specjalistach) i dopisujemy pliki do `<LocalizedText>` w `.modinfo`.
  ⚠️ Każdy nowy plik językowy musi zawierać też `<Replace Tag="LOC_COMMERCE_TREASURE_RESOURCES_TITLE" …>`
  z pustym `<Text>` — to on kasuje nagłówek „Zasoby skarbowe" z kart konwojów. Bez tego
  wiersza dany język dalej go widzi.
