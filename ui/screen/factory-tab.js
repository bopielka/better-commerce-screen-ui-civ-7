/**
 * A fifth tab, Factory Resources, in the Modern age only.
 *
 * The game has no such tab: factory resources appear as a subsection of the unassigned
 * pool and as a dropdown on settlements that have a factory. There is nowhere to see
 * them together, which is what this tab is for; its body is in factory-resources.js.
 *
 * Why the whole screen is replaced
 * --------------------------------
 * Tabs are children of `CommerceScreen`, declared inline in its JSX. Nothing in the
 * framework lets a mod push another `Tab.Item` into an existing `Tab`, so the only way
 * in is to register a `CommerceScreen` of our own at a higher priority. This function is
 * therefore a transcription of the game's own component - deliberately line for line,
 * so that a future game patch can be diffed against it - with one `Show` added at the
 * end and nothing else changed.
 *
 * It is written in Solid's compiled form (`createComponent`, prop getters) rather than
 * JSX, because a mod's scripts are plain ES modules with no build step. The getters are
 * not decoration: a plain value there would read the model once and never update.
 *
 * ⚠️ This is the one place in the mod that will break on a game patch that touches the
 * Commerce screen's own layout. Everything else wraps or decorates; this replaces.
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
import { TreasureConvoysContainer, withoutHomelandIdlers } from './treasure-tab.js';
import { isFactoryAge } from '../engine/age.js';

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
        if (activatedElement.nodeName.toLocaleLowerCase() === 'screen-resource-allocation') {
            Input.setActiveContext(InputContext.Shell);
        }
    }

    return createComponent(CommerceScreenContext.Provider, {
        value: model,
        get children() {
            return createComponent(ScreenFrame, {
                name: 'Commerce-Screen',
                panelContext: 'screen-resource-allocation',
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
                                    body: () =>
                                        createComponent(
                                            TradeRoutesContainer,
                                            mergeProps(() => model.data.tradeRouteTabData),
                                        ),
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
                                        return Game.age == Database.makeHash('AGE_EXPLORATION');
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
