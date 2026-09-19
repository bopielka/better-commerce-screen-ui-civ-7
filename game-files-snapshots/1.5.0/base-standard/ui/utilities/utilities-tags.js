const constructibleTagNames = /* @__PURE__ */ new Map([
  ["CULTURE", "LOC_TAG_CULTURE"],
  ["DIPLOMACY", "LOC_TAG_DIPLOMACY"],
  ["FOOD", "LOC_TAG_FOOD"],
  ["FORTIFICATION", "LOC_TAG_FORTIFICATION"],
  ["GOLD", "LOC_TAG_GOLD"],
  ["HAPPINESS", "LOC_TAG_HAPPINESS"],
  ["MILITARY", "LOC_TAG_MILITARY"],
  ["PRODUCTION", "LOC_TAG_PRODUCTION"],
  ["SCIENCE", "LOC_TAG_SCIENCE"],
  ["WAREHOUSE", "LOC_TAG_WAREHOUSE"],
  ["WATER", "LOC_TAG_WATER"],
  ["BRIDGE", "LOC_TAG_BRIDGE"],
  ["UNIQUE", "LOC_TAG_UNIQUE"],
  ["UNIQUE_IMPROVEMENT", "LOC_TAG_UNIQUE_IMPROVEMENT"],
  ["AGELESS", "LOC_TAG_AGELESS"],
  ["PERSISTENT", "LOC_TAG_PERSISTENT"]
]);
const constructibleTagsToExclude = [
  "TRADE",
  "SUPPLIES",
  "GREATWORK",
  "RELIGIOUS",
  "DISTRICT_WALL",
  "FULL_TILE",
  "UNIT_FORTIFICATION",
  "IGNORE_DISTRICT_PLACEMENT_CAP",
  "LINK_ADJACENT",
  "DAMAGE_UPON_OCCUPATION",
  "RAIL_CONNECTION",
  "MILL",
  "CRISIS",
  "URBANCENTER",
  "PERSISTENT"
];
function composeTagString(tags) {
  let tagText = "";
  for (const tag of tags) {
    if (tagText == "") {
      tagText += tag;
    } else {
      tagText += " | " + tag;
    }
  }
  return tagText;
}
const constructibleItemTypeMap = /* @__PURE__ */ new Map();
for (const e of GameInfo.TypeTags) {
  let tagSet = constructibleItemTypeMap.get(e.Type);
  if (!tagSet) {
    tagSet = /* @__PURE__ */ new Set();
    constructibleItemTypeMap.set(e.Type, tagSet);
  }
  tagSet.add(e.Tag);
}
function getConstructibleTagsFromType(type) {
  const tagSet = constructibleItemTypeMap.get(type);
  if (!tagSet) {
    return [];
  }
  return Array.from(tagSet).filter((tag) => !constructibleTagsToExclude.includes(tag) && constructibleTagNames.has(tag)).map((tag) => Locale.compose(constructibleTagNames.get(tag)));
}
function ConstructibleHasTagType(ConstructibleType, TypeTag) {
  const tagSet = constructibleItemTypeMap.get(ConstructibleType);
  if (!tagSet) {
    return false;
  }
  return tagSet.has(TypeTag);
}

export { ConstructibleHasTagType, composeTagString, getConstructibleTagsFromType };
//# sourceMappingURL=utilities-tags.js.map
