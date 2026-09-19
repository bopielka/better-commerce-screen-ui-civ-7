import { Dynamic } from '../../vendor/solid-js/web/dist/web.js';
import { createSignal, createComponent, mergeProps } from '../../vendor/solid-js/dist/solid.js';
import { ComponentUtilities } from '../utilities/component-utilities.js';

const [componentRegistered, setComponentRegistered] = createSignal();
class ComponentRegistryImpl {
  componentFactories = /* @__PURE__ */ new Map();
  register(optionsOrName, createInstance, overridePriority) {
    let name = optionsOrName;
    let factory = createInstance;
    let cachedImages;
    let cachedStyles;
    if (typeof optionsOrName != "string") {
      name = optionsOrName.name;
      factory = optionsOrName.createInstance;
      overridePriority = optionsOrName.overridePriority;
      if (optionsOrName?.images) {
        cachedImages = ComponentUtilities.preloadImages(...optionsOrName.images);
      }
      if (optionsOrName?.styles) {
        cachedStyles = ComponentUtilities.loadStyles(...optionsOrName.styles);
      }
    }
    let wrappedComponentFactory = this.componentFactories.get(name);
    overridePriority ??= 0;
    if (wrappedComponentFactory) {
      if (wrappedComponentFactory.overridePriority <= overridePriority) {
        wrappedComponentFactory.overridePriority = overridePriority;
        wrappedComponentFactory.setFactory(() => factory);
      }
    } else {
      wrappedComponentFactory = this.wrapComponentFactory(name, factory, overridePriority, cachedImages, cachedStyles);
    }
    setComponentRegistered(() => wrappedComponentFactory);
    return wrappedComponentFactory;
  }
  /**
   * Gets a registered component from the component registry.
   * Will return a wrapper that points the component factory with the highest override priority.
   * @param name The name of the component to get
   * @returns The registered component or undefined if no registration was not found
   */
  get(name) {
    return this.componentFactories.get(name);
  }
  /**
   * Returns a promise that resolved when all styles and images are preloaded for a give list of components
   * @param components The list of components to preload styles and images for
   * @returns A promise that resolves when all associated styles and images are loaded
   */
  preloadComponents(...components) {
    return Promise.all([...components.map((c) => c.cachedImages ?? []), ...components.map((c) => c.cachedStyles ?? [])]);
  }
  wrapComponentFactory(name, factory, overridePriority, cachedImages, cachedStyles) {
    const [getFactory, setFactory] = createSignal(factory);
    const wrappedFactory = (props) => {
      return createComponent(Dynamic, mergeProps({
        get component() {
          return getFactory();
        }
      }, props));
    };
    wrappedFactory.factoryName = name;
    wrappedFactory.factory = getFactory;
    wrappedFactory.setFactory = setFactory;
    wrappedFactory.overridePriority = overridePriority;
    wrappedFactory.cachedImages = cachedImages;
    wrappedFactory.cachedStyles = cachedStyles;
    this.componentFactories.set(name, wrappedFactory);
    return wrappedFactory;
  }
}
const ComponentRegistry = new ComponentRegistryImpl();

export { ComponentRegistry, componentRegistered, setComponentRegistered };
//# sourceMappingURL=component-registry.js.map
