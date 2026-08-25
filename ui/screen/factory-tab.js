/**
 * A fifth tab, Factory Resources, in the Modern age only.
 *
 * ⚠️ Adding a tab means replacing `CommerceScreen` itself - the tab list is built inside it - so
 * this module loads whether or not any tab is ever opened, and it is also where the trade tab's
 * data is prepared on its way through. Registered at `existing + 100` so it wins over Resource+
 * whatever the load order, and the original factory is still called.
 */
import { Show, createComponent, createMemo, mergeProps, onMount } from '/core/vendor/solid-js/dist/solid.js';
import { Tab } from '/core/ui-next/components/tab.js';
import { useAudio } from '/core/ui-next/services/audio-support.js';
import { ComponentRegistry } from '/core/ui-next/services/component-registry.js';
import { useLocalPlayerId } from '/core/ui-next/utilities/game-core-utilities.js';
import { ScreenFrame } from '/base-standard/ui-next/components/screen-frame.js';
import { CommerceScreen } from '/base-standard/ui-next/screens/commerce/commerce-screen.js';
import {
    CommerceScreenContext,
    createCommerceScreenModel,
} from '/base-standard/ui-next/screens/commerce/commerce-screen-model.js';
import { CommerceResourcesContainer } from '/base-standard/ui-next/screens/commerce/commerce-screen-resources-tab.js';
import { TradeRoutesContainer } from '/base-standard/ui-next/screens/commerce/commerce-screen-trade-tab.js';
import screenStyle from '/base-standard/ui-next/screens/commerce/commerce-screen.scss.js';
import { EmpireResourcesContainer } from './empire-tab.js';
import { FactoryResourcesContainer } from './factory-resources.js';
import { prepareTradeTabData } from './trade-routes.js';
import { TreasureConvoysContainer, withoutHomelandIdlers } from './treasure-tab.js';
import { COMMERCE_PANEL_CONTEXT } from './close-screen.js';
import { COMMERCE_SCREEN_SELECTOR } from './screen-parts.js';
import { isExplorationAge, isFactoryAge } from '../engine/age.js';

const CommerceScreenWithFactoryTab = (_props) => {
    const model = createCommerceScreenModel();
    const audioTrigger = useAudio('CommerceScreenPopup');
    const localPlayerId = useLocalPlayerId();

    const civName = createMemo(() => {
        const player = Players.get(localPlayerId());
        if (!player) {
            return '';
        }
        const civDefinition = GameInfo.Civilizations.lookup(player.civilizationType);
        return civDefinition ? Locale.compose(civDefinition.Name) : '';
    });

    onMount(() => audioTrigger('popup-open'));
    const handleOnClosing = () => audioTrigger('popup-close');
    const title = createMemo(() => Locale.compose('LOC_COMMERCE_SCREEN_TITLE', civName()));

    function onContextChanged(activatedElement, _deactivatedElement) {
        // Unexpected popups can leave the input context pointing elsewhere and never put
        // it back; this is the game's own guard, kept as it was.
        if (activatedElement.nodeName.toLocaleLowerCase() === COMMERCE_SCREEN_SELECTOR) {
            Input.setActiveContext(InputContext.Shell);
        }
    }

    return createComponent(CommerceScreenContext.Provider, {
        value: model,
        get children() {
            return createComponent(ScreenFrame, {
                name: 'Commerce-Screen',
                panelContext: COMMERCE_PANEL_CONTEXT,
                audioContext: 'CommerceScreen',
                get ornatePanelData() {
                    return model.data.ornatePanelData;
                },
                get title() {
                    return title();
                },
                onClosing: handleOnClosing,
                onContextChanged,
                get children() {
                    return createComponent(Tab, {
                        class: 'w-full flex flex-col flex-auto pointer-events-auto relative',
                        get onTabChanged() {
                            return model.onTabChanged;
                        },
                        get children() {
                            return [
                                createComponent(Tab.TabList, {
                                    class: 'w-187 self-center text-base font-base',
                                    nextHotkey: 'nav-next',
                                    previousHotkey: 'nav-previous',
                                }),
                                createComponent(Tab.Output, {}),
                                createComponent(Tab.Item, {
                                    name: 'Resources',
                                    title: () => 'LOC_UI_RESOURCE_ALLOCATION_TITLE',
                                    body: () =>
                                        createComponent(
                                            CommerceResourcesContainer,
                                            mergeProps(() => model.data.resourceTabData),
                                        ),
                                }),
                                createComponent(Tab.Item, {
                                    name: 'Trade',
                                    title: () => 'LOC_COMMERCE_TRADE_ROUTE_TAB',
                                    body: () => {
    // ⚠️ Read and prepared HERE, not inside the props getter: the getter runs inside a reactive
    // scope, and writing to the store from there would wake the effect that reads it.
                                        prepareTradeTabData(model.data.tradeRouteTabData);
                                        return createComponent(
                                            TradeRoutesContainer,
                                            mergeProps(() => model.data.tradeRouteTabData),
                                        );
                                    },
                                }),
                                createComponent(Tab.Item, {
                                    name: 'Empire',
                                    title: () => 'LOC_RESOURCECLASS_EMPIRE_NAME',
                                    // ⚠️ Not the game's EmpireResourceContainer: this tab
                                    // is one of the two this mod rebuilds. See empire-tab.js.
                                    body: () => createComponent(EmpireResourcesContainer, {}),
                                }),
                                createComponent(Show, {
                                    get when() {
                                        return isExplorationAge();
                                    },
                                    get children() {
                                        return createComponent(Tab.Item, {
                                            name: 'Treasure',
                                            title: () => 'LOC_RESOURCECLASS_TREASURE_NAME',
                                            body: () =>
                                                createComponent(
                                                    // ⚠️ Not the game's container: this tab
                                                    // is rebuilt too. See treasure-tab.js.
                                                    TreasureConvoysContainer,
                                                    mergeProps(() =>
                                                        withoutHomelandIdlers(model.data.treasureTabData),
                                                    ),
                                                ),
                                        });
                                    },
                                }),
                                // --- everything above is the game's; this is the addition ---
                                createComponent(Show, {
                                    get when() {
                                        return isFactoryAge();
                                    },
                                    get children() {
                                        return createComponent(Tab.Item, {
                                            // The model's tab-change handler switches on
                                            // this name and ignores anything it does not
                                            // know, so a new one is safe.
                                            name: 'Factory',
                                            title: () => 'LOC_RESOURCECLASS_FACTORY_NAME',
                                            body: () => createComponent(FactoryResourcesContainer, {}),
                                        });
                                    },
                                }),
                            ];
                        },
                    });
                },
            });
        },
    });
};

ComponentRegistry.register({
    name: 'CommerceScreen',
    styles: [screenStyle],
    overridePriority: (CommerceScreen.overridePriority ?? 0) + 100,
    createInstance: CommerceScreenWithFactoryTab,
});
