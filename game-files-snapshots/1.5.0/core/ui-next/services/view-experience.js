import { createMemo } from '../../vendor/solid-js/dist/solid.js';

const ViewExperience = createMemo(() => UI.getViewExperience());
const isMobile = createMemo(() => UI.getViewExperience() === UIViewExperience.Mobile);

export { ViewExperience, isMobile };
//# sourceMappingURL=view-experience.js.map
