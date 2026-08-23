# 04 — `ui/support/` — no knowledge of the game or of this mod

The leftmost layer. Three files, all pure utility. Anything here must be usable without the
game running and without knowing what the mod is for.

| File | Purpose |
|---|---|
| `diagnostics.js` | `log` / `warn`, and the switch between them |
| `dom.js` | the DOM helpers this renderer's gaps make necessary |
| `build-stamp.js` | written by the deploy script, never by hand — see [workflow](14-development-workflow.md) |

## `diagnostics.js`

```js
export const DIAGNOSTICS = false;  // ⚠️ off, which is how the mod ships
export function log(...args)       // only when DIAGNOSTICS
export function warn(...args)      // always
```

⚠️ **`console.log` never reaches `Logs\UI.log` in this engine.** Both helpers go through
`console.error`, prefixed `[better-commerce]`.

⚠️ **`DIAGNOSTICS` must be `false` for release.** `warn` still writes, so a genuine failure is
still recorded; what is switched off is the running commentary — assignment timings, how the
trade routes were grouped, how many cards a tab built. The author's previous mod shipped 1.0
with its logging still on.

Guidance for new code:

- `log(...)` for anything that helps understand a *decision* — which resource went where and
  why, what a pass measured, what a tab built.
- `warn(...)` for anything that means a feature silently did nothing. Prefer loud failure:
  the hardest bug to notice is a wrapper that quietly stopped wrapping. See the
  `panel-action exposes no getNotificationInfo` warning in
  `ui/screen/assign-notification.js` for the tone.

## `dom.js` (103 lines)

### `bindActivatable(element, activate)`

Makes an injected element clickable. Read
[Platform notes → Injected elements are not `Activatable`](03-platform-notes.md) for why this
is necessary at all.

What it does, and why each part matters:

| Step | Reason |
|---|---|
| sets `role="button"`, `tabindex="0"`, `data-activatable="true"` | accessibility and consistency with the screen's own controls |
| `click` → `activate`, with `stopPropagation` | ⚠️ otherwise the settlement card underneath treats the click as "assign the selected resource here" |
| 150 ms repeat guard | a click can arrive twice (mouse and touch); the second is not a second press |
| `mousedown` → `stopPropagation` **and `preventDefault`** | ⚠️ keeps the press from moving DOM focus. The screen's focus system lights up the surroundings of whatever holds focus — which is why clicking the priority picker used to wash the filters, the settlement card and the picker itself in yellow |
| `mouseup` → `stopPropagation` | same reason as `click` |
| `keydown` Enter / Space → `activate` | keyboard parity |
| `element.blur()` after activating | belt and braces for the focus highlight |

This is the same approach Resource+ uses for its own buttons.

### `clearChildren(element)`

⚠️ **This DOM implementation has no `replaceChildren`** — calling it throws
"replaceChildren is not a function". Empties by hand. Resource+ does the same, for the same
reason.

### `appendAll(parent, ...children)`

Only the older `appendChild` can be relied on here. Returns `parent`, so it composes:

```js
return appendAll(element, box, text);
```

### `ensureStyle(id, css)`

Puts a stylesheet in the document **once**, under an id, and hands the element back.

Six modules had grown their own four-line version of this, three of which differed in whether
they remembered the element they created — which is the half that matters, because that is
what a teardown needs to remove.

```js
styleElement = ensureStyle(STYLE_ID, STYLE);
// ...
styleElement?.remove();
```

Convention: style ids are `najane-<area>-style`; class names are `najane-<thing>`. Every
selector this mod writes is prefixed with one of its own classes or scoped to
`screen-resource-allocation`, so nothing leaks to other screens.

### `makeElement(tag, className, attributes = {})`

Trivial, but it is the single place where an element gets both its class and its attributes,
which keeps the call sites readable:

```js
const trigger = makeElement('div', `${CONTROL_CLASS}__trigger`, {
    'aria-label': label,
    'data-tooltip-content': Locale.compose(TOOLTIP),
    'data-tooltip-anchor': 'left',
});
```
