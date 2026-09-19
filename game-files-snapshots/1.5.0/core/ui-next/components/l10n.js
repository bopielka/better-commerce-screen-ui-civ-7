import { template, use, spread } from '../../vendor/solid-js/web/dist/web.js';
import { createMemo, splitProps, getOwner, mergeProps } from '../../vendor/solid-js/dist/solid.js';
import { ComponentRegistry } from '../services/component-registry.js';

var _tmpl$ = /* @__PURE__ */ template(`<div></div>`);
const Compose = (props) => {
  return createMemo(() => Locale.compose(props.text ?? "", ...props.args ?? []));
};
const Stylize = (props) => {
  const [local, other] = splitProps(props, ["text", "args"]);
  const stylizedText = createMemo(() => Locale.stylize(local.text ?? "", ...local.args ?? []));
  const owner = getOwner();
  return (() => {
    var _el$ = _tmpl$();
    use((el) => {
      if (!props.disableTooltips) {
        el.owner = owner;
      }
      if (typeof props.ref === "function") props.ref(el);
    }, _el$);
    spread(_el$, mergeProps(other, {
      get innerHTML() {
        return stylizedText();
      }
    }), false, false);
    return _el$;
  })();
};
const L10n = {
  /**
   * Compose text using the Locale.Compose.
   * Generate text given a localization-syntax string and additional optional arguments
   * ```tsx
   * <L10n.Compose text="LOC_EXAMPLE_STRING" args={["LOC_ARG_1", 2]} />
   * ```
   * Default implementation: {@link Compose}
   * @param {LocaleProps} props See {@link LocaleProps} for a full list of properties
   *
   * Commonly Used Properties:
   * @param {string} props.text The localization string to compose.
   * @param {LocalizedTextArgument[]} props.args A list of arguments to feed into the string. Default: undefined
   */
  Compose: ComponentRegistry.register("Compose", Compose),
  /**
   * Compose text using the Locale.Stylize.
   * Convert a string or localized text containing stylized markup into HTML formatted text.
   * ```tsx
   * <L10n.Stylize text="LOC_EXAMPLE_STRING" args={["LOC_ARG_1", 2]} />
   * ```
   * Default implementation: {@link Stylize}
   * @param {StylizeProps} props See {@link StylizeProps} for a full list of properties
   *
   * Commonly Used Properties:
   * @param {string} props.text The localization string to stylize.
   * @param {LocalizedTextArgument[]} props.args A list of arguments to feed into the string. Default: undefined
   */
  Stylize: ComponentRegistry.register("Stylize", Stylize)
};

export { L10n };
//# sourceMappingURL=l10n.js.map
